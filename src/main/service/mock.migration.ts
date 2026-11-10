import type { ProxyMock } from '@shared/proxy.models'
import type { MockMigrationDuplicate, MockMigrationReportItem, MockMatchRule } from '@shared/mock.models'
import { normalizeMatchRule } from '@shared/mock.validation'
import { fingerprintOf } from '../repository/mock.docs'
import { analyzeMatchStability } from './mock.derive'

// v3 -> v4 迁移的计划步骤：纯计算、无 IO，便于在旧库副本上做回归。
// 仓库层负责把计划写回 PouchDB 并维护 meta / 报告落库顺序；指纹定义在 mock.docs，
// 因为它同时是 saveRecord 的落库唯一性键。

export interface MigrationSourceRecord {
  record: ProxyMock.MockRecord
  /** 旧库已带 match（重入或部分迁移）时保留原条件，只补指纹 */
  keepMatch: boolean
  /** 旧库展示名，缺失时回落到 record.name / url */
  name?: string
}

export interface MigrationPatch {
  recordId: string
  match?: MockMatchRule
  fingerprint?: string
  invalidReason?: string
}

export interface MigrationPlan {
  patches: MigrationPatch[]
  items: MockMigrationReportItem[]
  duplicates: MockMigrationDuplicate[]
  autoRelaxedRecords: number
  autoIgnoredKeyCount: number
  parameterizedPathCount: number
  invalidRecords: number
}

function displayName(source: MigrationSourceRecord): string {
  return source.name ?? source.record.name ?? source.record.url ?? ''
}

/**
 * 按规则生成 v4 匹配条件与指纹：
 * - 已有 match 的记录保持不变，只补指纹
 * - URL 无法解析的记录标记 urlInvalid 并停用
 * - 同指纹保留 updatedAt 最新（相同则 id 较小者），其余标记 duplicateAfterMigration
 */
export function planMigrationV4(sources: MigrationSourceRecord[], analyzedAt: number): MigrationPlan {
  const plan: MigrationPlan = {
    patches: [],
    items: [],
    duplicates: [],
    autoRelaxedRecords: 0,
    autoIgnoredKeyCount: 0,
    parameterizedPathCount: 0,
    invalidRecords: 0,
  }

  const byRule = new Map<string, MigrationSourceRecord[]>()
  for (const source of sources ?? []) {
    if (source?.record?.ruleId == null) continue
    const list = byRule.get(source.record.ruleId) ?? []
    list.push(source)
    byRule.set(source.record.ruleId, list)
  }

  byRule.forEach((list, ruleId) => {
    const analysis = analyzeMatchStability(
      list.map(it => it.record),
      { source: 'migration', analyzedAt },
    )
    const resultById = new Map(analysis.map(it => [it.recordId, it]))
    const patches: MigrationPatch[] = []

    for (const source of list) {
      const record = source.record
      if (source.keepMatch) {
        // 已迁移记录不再重算，否则会覆盖历史撤销/禁用结果；仅在缺指纹时补齐
        if (record.matchFingerprint == null) {
          patches.push({
            recordId: record.id,
            fingerprint: fingerprintOf(normalizeMatchRule(record.match)),
          })
        }
        continue
      }

      const result = resultById.get(record.id)
      if (result?.match == null) {
        patches.push({ recordId: record.id, invalidReason: 'urlInvalid' })
        plan.invalidRecords++
        plan.items.push({
          recordId: record.id,
          ruleId,
          name: displayName(source),
          autoIgnoredKeys: [],
          pathParameterized: false,
          invalidReason: 'urlInvalid',
        })
        continue
      }

      const match = normalizeMatchRule(result.match)
      patches.push({ recordId: record.id, match, fingerprint: fingerprintOf(match) })

      if (result.autoIgnoredKeys.length > 0 || result.pathParameterized) {
        plan.autoRelaxedRecords++
        plan.autoIgnoredKeyCount += result.autoIgnoredKeys.length
        if (result.pathParameterized) plan.parameterizedPathCount++
      }
      plan.items.push({
        recordId: record.id,
        ruleId,
        name: displayName(source),
        autoIgnoredKeys: result.autoIgnoredKeys,
        pathParameterized: result.pathParameterized,
      })
    }

    resolveDuplicateFingerprints(list, patches, plan)
    plan.patches.push(...patches)
  })

  return plan
}

function resolveDuplicateFingerprints(list: MigrationSourceRecord[], patches: MigrationPatch[],
  plan: MigrationPlan) {
  const byFingerprint = new Map<string, MigrationSourceRecord[]>()
  const patchById = new Map(patches.map(it => [it.recordId, it]))
  for (const source of list) {
    const patch = patchById.get(source.record.id)
    if (patch == null || patch.invalidReason != null || patch.fingerprint == null) continue
    const group = byFingerprint.get(patch.fingerprint) ?? []
    group.push(source)
    byFingerprint.set(patch.fingerprint, group)
  }

  byFingerprint.forEach((group, fingerprint) => {
    if (group.length < 2) return
    const sorted = [...group].sort((a, b) => {
      const delta = (b.record.updatedAt ?? 0) - (a.record.updatedAt ?? 0)
      return delta !== 0 ? delta : a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0
    })
    const kept = sorted[0]
    const disabled = sorted.slice(1)
    plan.duplicates.push({
      fingerprint,
      keptRecordId: kept.record.id,
      disabledRecordIds: disabled.map(it => it.record.id),
    })
    for (const duplicate of disabled) {
      const patch = patchById.get(duplicate.record.id)
      if (patch == null) continue
      patch.invalidReason = 'duplicateAfterMigration'
      plan.invalidRecords++
      plan.items.push({
        recordId: duplicate.record.id,
        ruleId: duplicate.record.ruleId,
        name: displayName(duplicate),
        autoIgnoredKeys: [],
        pathParameterized: false,
        invalidReason: 'duplicateAfterMigration',
      })
    }
  })
}

/** 迁移写回的结果：只改匹配相关字段，响应、变体、名称与时间戳保持原样 */
export interface MigrationPatchTarget {
  match?: MockMatchRule
  matchFingerprint?: string
  matchInvalid?: string
}

export function applyMigrationPatch<T extends MigrationPatchTarget>(target: T, patch: MigrationPatch): T {
  if (patch.match != null) target.match = patch.match
  if (patch.fingerprint != null) target.matchFingerprint = patch.fingerprint
  if (patch.invalidReason != null) {
    target.matchInvalid = patch.invalidReason
    if (target.match != null) target.match.enabled = false
  } else if (patch.match != null && target.matchInvalid != null) {
    // 只有重新算出有效条件时才解除历史禁用，补指纹不能解锁
    delete target.matchInvalid
    target.match.enabled = true
  }
  return target
}