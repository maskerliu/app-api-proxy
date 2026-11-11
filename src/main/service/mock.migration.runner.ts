import { inject, injectable } from 'inversify'
import type { ProxyMock } from '@shared/proxy.models'
import type {
  MigrationReport, MockMigrationReportItem, RevertMockRequest, RevertMockResponse,
} from '@shared/mock.models'
import { MockError } from '@shared/mock.errors'
import { IOC_TYPES } from '../constants'
import { MockRepo } from '../repository/mock.repo'
import type {
  LegacyRuleDoc, MockMigrationReportDoc, MockRecordDoc, MockRecordSummary, MockRuleDoc,
} from '../repository/mock.docs'
import {
  CONFLICT_RETRY, DELETE_BATCH, LEGACY_SCHEMA_VERSION, MATCH_SCHEMA_VERSION, META_ID, MIGRATION_REPORT_ID,
  MIGRATION_REPORT_TYPE, RECORD_SCHEMA_VERSION, RECORD_TYPE, RULE_TYPE, SCHEMA_VERSION, assertBulkOk, isMigratedV4,
  legacyRecordId, legacyRecordsOf, responseFromLegacy, sourceFromLegacy, summaryToRecord,
} from '../repository/mock.docs'
import { restoreStrict } from './mock.derive'
import { MigrationPatch, applyMigrationPatch, planMigrationV4 } from './mock.migration'

const MIGRATION_BATCH = 50
const MIGRATION_SYNC_LIMIT = 2000

/**
 * Mock schema 迁移执行器（服务层）：负责顺序、计划与报告内容。
 * 落库、并发队列与迁移闸门状态都在 MockRepo，本类不直接碰 PouchDB，
 * 因此仓库层不需要反向 import 这里。
 */
@injectable()
export class MockMigrationRunner {

  @inject(IOC_TYPES.MockRepo)
  private repo: MockRepo

  private runTask: Promise<void> = null

  /** 备份并按版本依次迁移；重复调用只执行一次 */
  public run(): Promise<void> {
    if (this.runTask == null) {
      this.runTask = this.runMigrations().catch(err => {
        this.runTask = null
        throw err
      })
    }
    return this.runTask
  }

  private async runMigrations() {
    await this.repo.backupOnce()
    await this.migrateLegacy()
    await this.migrateRecordsV3()
    await this.scheduleMigrationV4()
  }

  /** 大库标记 pending 后后台迁移，不阻塞启动 */
  private async scheduleMigrationV4() {
    const meta = await this.repo.getMeta()
    if (isMigratedV4(meta)) {
      this.repo.unblockMigrationWrites()
      return
    }

    const total = await this.repo.countRecords()
    if (total > MIGRATION_SYNC_LIMIT) {
      this.repo.blockMigrationWrites()
      await this.repo.saveMeta({ migrationPending: true, migrationStatus: 'pending' })
      this.migrateRecordsV4(total)
        .catch(err => {
          this.repo.blockMigrationWrites()
          console.error('mock v4 migration failed:', err)
          this.repo.saveMeta({ migrationStatus: 'failed' }).catch(() => { })
        })
      return
    }

    try {
      await this.migrateRecordsV4(total)
    } catch (err) {
      // 迁移失败时阻止写入，读路径仍可按旧字段展示，避免应用无法启动
      this.repo.blockMigrationWrites()
      console.error('mock v4 migration failed:', err)
    }
  }

  private async migrateLegacy() {
    const meta = await this.repo.getMeta()
    if ((meta?.version ?? 0) >= LEGACY_SCHEMA_VERSION) return

    let startkey: string = null
    while (true) {
      const options: any = { include_docs: true, limit: 20 }
      if (startkey != null) {
        options.startkey = startkey
        options.skip = 1
      }
      const page = await this.repo.readDocs(options)
      if (page.rows.length === 0) break
      startkey = page.rows[page.rows.length - 1].id

      for (const row of page.rows) {
        const doc = row.doc as LegacyRuleDoc
        if (doc == null) continue
        if (doc._id === META_ID || doc._id.startsWith('_design/')) continue
        if (doc.type === RECORD_TYPE || doc.type === RULE_TYPE) continue
        await this.migrateRule(doc)
      }
    }

    await this.repo.saveMeta({ version: LEGACY_SCHEMA_VERSION })
  }

  /** v2 -> v3：旧记录补齐结构化响应字段，保留 _id 与 record 兼容字段 */
  private async migrateRecordsV3() {
    const meta = await this.repo.getMeta()
    if ((meta?.version ?? 0) >= RECORD_SCHEMA_VERSION) return

    let startkey: string = null
    while (true) {
      const options: any = { include_docs: true, limit: 50 }
      if (startkey != null) {
        options.startkey = startkey
        options.skip = 1
      }
      const page = await this.repo.readDocs(options)
      if (page.rows.length === 0) break
      startkey = page.rows[page.rows.length - 1].id

      for (const row of page.rows) {
        const doc = row.doc as MockRecordDoc
        if (doc == null) continue
        if (doc._id === META_ID || doc._id.startsWith('_design/')) continue
        if (doc.type !== RECORD_TYPE || doc.response != null) continue

        const legacy = (doc.record ?? {}) as ProxyMock.ProxyRequestRecord
        const upgraded: MockRecordDoc = {
          ...doc,
          name: doc.name ?? legacy.url ?? doc.url,
          response: responseFromLegacy(legacy),
          variants: [],
          activeVariantId: null,
          source: doc.source ?? sourceFromLegacy(legacy, doc)
        }
        await this.repo.putWithRetry(upgraded)
      }
    }

    await this.repo.saveMeta({ version: RECORD_SCHEMA_VERSION })
    console.log('mock schema migrated to v3')
  }

  /**
   * v3 -> v4：按规则做稳定性分析生成匹配条件与指纹。
   * - 已有 match.version=1 的记录不覆盖，只补指纹
   * - URL 无法解析的记录标记 matchInvalid 并停用
   * - 指纹重复保留 updatedAt 最新，其余标记 duplicateAfterMigration
   * 报告先落库再写 meta，失败可重入。
   */
  private async migrateRecordsV4(total: number) {
    const meta = await this.repo.getMeta()
    if (isMigratedV4(meta)) return

    const startedAt = Date.now()
    const summaries = await this.repo.listAllRecordSummaries()
    const byRule = new Map<string, MockRecordSummary[]>()
    for (const summary of summaries) {
      if (summary.ruleId == null) continue
      const list = byRule.get(summary.ruleId) ?? []
      list.push(summary)
      byRule.set(summary.ruleId, list)
    }

    const report: MigrationReport = {
      migratedAt: startedAt,
      status: 'running',
      totalRecords: total || summaries.length,
      processedRecords: 0,
      autoRelaxedRecords: 0,
      autoIgnoredKeyCount: 0,
      parameterizedPathCount: 0,
      invalidRecords: 0,
      items: [],
      duplicates: [],
      errors: [],
    }
    this.repo.beginMigrationGuard(byRule.keys())

    try {
      for (const [ruleId, list] of byRule) {
        const plan = planMigrationV4(
          list.map(summary => ({
            record: summaryToRecord(summary),
            keepMatch: summary.match?.version === 1,
            name: summary.name,
          })),
          startedAt,
        )

        report.autoRelaxedRecords += plan.autoRelaxedRecords
        report.autoIgnoredKeyCount += plan.autoIgnoredKeyCount
        report.parameterizedPathCount += plan.parameterizedPathCount
        report.invalidRecords += plan.invalidRecords
        report.items.push(...plan.items)
        report.duplicates.push(...plan.duplicates)

        await this.applyMatchPatches(plan.patches, report)
        this.repo.markRuleMigrated(ruleId)
        report.processedRecords += list.length
      }

      report.status = 'completed'
      report.migratedAt = Date.now()
      report.processedRecords = summaries.length
      report.durationMs = report.migratedAt - startedAt
      report.peakHeapUsedMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
      await this.saveMigrationReport(report)
      await this.repo.saveMeta({
        version: SCHEMA_VERSION,
        mockSchemaVersion: MATCH_SCHEMA_VERSION,
        migratedAt: report.migratedAt,
        migrationPending: false,
        migrationStatus: 'completed',
      })
      this.repo.completeMigration()
      console.log(`mock schema migrated to v4: ${summaries.length} records`)
    } catch (err) {
      report.status = 'failed'
      report.errors = [{ recordId: '', reason: (err as Error)?.message ?? String(err) }]
      await this.saveMigrationReport(report).catch(() => { })
      await this.repo.saveMeta({ migrationStatus: 'failed' }).catch(() => { })
      throw err
    }
  }

  private async applyMatchPatches(patches: MigrationPatch[], report?: MigrationReport) {
    for (let i = 0; i < patches.length; i += MIGRATION_BATCH) {
      const chunk = patches.slice(i, i + MIGRATION_BATCH)
      const patchById = new Map(chunk.map(it => [it.recordId, it]))
      const rows = await this.repo.readDocs({
        keys: chunk.map(it => it.recordId),
        include_docs: true,
      })
      const docs: MockRecordDoc[] = []
      for (const row of rows.rows) {
        const doc = (row as any).doc as MockRecordDoc
        if (doc == null) continue
        const patch = patchById.get(doc._id)
        if (patch == null) continue

        applyMigrationPatch(doc, patch)
        docs.push(doc)
      }
      if (docs.length === 0) continue

      const results = await this.repo.bulkSave(docs as any) as any[]
      const retry: MockRecordDoc[] = []
      for (let index = 0; index < results.length; index++) {
        const result = results[index]
        if (result?.error == null) continue
        if (result.status === 409) {
          // 迁移期间可能被外部进程修改：重新取 rev 后单条重试
          if (docs[index] != null) retry.push(docs[index])
          continue
        }
        report?.errors.push({
          recordId: result.id ?? docs[index]?._id ?? '',
          reason: result.message ?? result.name ?? 'writeFailed',
        })
      }
      for (const doc of retry) {
        try {
          await this.repo.putWithRetry(doc)
        } catch (err) {
          report?.errors.push({
            recordId: doc._id,
            reason: (err as Error)?.message ?? String(err),
          })
        }
      }
    }
  }

  public async getMigrationReport(): Promise<MigrationReport | null> {
    const doc = await this.repo.getDoc<MockMigrationReportDoc>(MIGRATION_REPORT_ID)
    if (doc == null) return null
    const { _id, _rev, type, ...report } = doc as any
    return report as MigrationReport
  }

  public async revertMatch(request: RevertMockRequest): Promise<RevertMockResponse> {
    const result: RevertMockResponse = { reverted: 0, failed: [], duplicateDisabled: [] }
    const report = await this.getMigrationReport()
    const now = Date.now()
    const targets: Array<{ recordId: string; item?: MockMigrationReportItem }> = []

    if (request?.scope === 'all') {
      for (const item of report?.items ?? []) {
        if (item.invalidReason != null || item.revertedAt != null) continue
        if (request.ruleId != null && item.ruleId !== request.ruleId) continue
        targets.push({ recordId: item.recordId, item })
      }
    } else {
      if (request?.recordId == null) throw new MockError('recordMissing')
      targets.push({
        recordId: request.recordId,
        item: report?.items?.find(it => it.recordId === request.recordId),
      })
    }

    for (const target of targets) {
      const record = await this.repo.getRecordById(target.recordId)
      if (record == null) {
        result.failed.push({ recordId: target.recordId, reason: 'recordMissing' })
        continue
      }
      const reverted = await this.revertRecord(record, now, result)
      if (reverted && target.item != null) target.item.revertedAt = now
    }

    if (report != null && targets.some(it => it.item != null)) {
      await this.saveMigrationReport(report)
    }
    return result
  }

  private async revertRecord(record: ProxyMock.MockRecord, analyzedAt: number,
    result: RevertMockResponse): Promise<boolean> {
    if (record.match == null) {
      result.failed.push({ recordId: record.id, reason: 'matchMissing' })
      return false
    }

    const restored = restoreStrict(record, analyzedAt)
    if (restored.match == null || restored.reason != null) {
      result.failed.push({ recordId: record.id, reason: restored.reason ?? 'sourceMissing' })
      return false
    }

    try {
      // 撤销是显式迁移动作，不受 UI 乐观锁影响
      await this.repo.saveRecord({ ...record, match: restored.match, matchInvalid: undefined })
      result.reverted++
      return true
    } catch (err) {
      if (err instanceof MockError && err.code === 'matchDuplicate') {
        // 撤销后与另一条记录条件相同：按最新优先停用本条并写回报告
        await this.repo.markRecordInvalid(record.id, 'duplicateAfterRevert')
        result.failed.push({ recordId: record.id, reason: 'matchDuplicate' })
        result.duplicateDisabled.push(record.id)
        return false
      }
      result.failed.push({ recordId: record.id, reason: (err as Error)?.message ?? String(err) })
      return false
    }
  }

  private async saveMigrationReport(report: MigrationReport) {
    for (let attempt = 0; ; attempt++) {
      const existing = await this.repo.getDoc<MockMigrationReportDoc>(MIGRATION_REPORT_ID)
      const doc: any = { _id: MIGRATION_REPORT_ID, type: MIGRATION_REPORT_TYPE, ...report }
      if (existing != null) doc._rev = existing._rev
      try {
        await this.repo.putDoc(doc)
        return
      } catch (err: any) {
        if (err?.status === 409 && attempt < CONFLICT_RETRY) continue
        throw err
      }
    }
  }

  /** 删除规则时同步清理迁移报告中的条目，避免复核页出现悬空记录 */
  public async clearRuleFromReport(ruleId: string) {
    const report = await this.getMigrationReport()
    if (report?.items == null) return
    const next = report.items.filter(it => it.ruleId !== ruleId)
    if (next.length === report.items.length) return
    report.items = next
    await this.saveMigrationReport(report)
  }

  private async migrateRule(doc: LegacyRuleDoc) {
    const records = legacyRecordsOf(doc)
    const urls = Object.keys(records)
    const now = Date.now()

    const recordDocs: MockRecordDoc[] = urls.map((url, idx) => {
      const value = records[url]
      const record = value != null && typeof value === 'object' ? value : {}
      const legacyRecord = { ...record, url } as ProxyMock.ProxyRequestRecord
      return {
        _id: legacyRecordId(doc._id, url),
        type: RECORD_TYPE,
        ruleId: doc._id,
        url,
        name: url,
        response: responseFromLegacy(legacyRecord),
        variants: [],
        activeVariantId: null,
        source: sourceFromLegacy(legacyRecord, { url, createdAt: now + idx }),
        createdAt: now + idx,
        updatedAt: now + idx,
        record: legacyRecord
      }
    })

    // 先写记录再改规则文档，中途失败可重入；已存在的记录文档按冲突忽略
    for (let i = 0; i < recordDocs.length; i += DELETE_BATCH) {
      const results = await this.repo.bulkSave(recordDocs.slice(i, i + DELETE_BATCH) as any) as any[]
      assertBulkOk(results, '迁移记录')
    }

    const ruleDoc: MockRuleDoc = {
      _id: doc._id,
      _rev: doc._rev,
      type: RULE_TYPE,
      name: doc.name ?? '',
      desc: doc.desc ?? '',
      createdAt: doc.createdAt ?? now,
      updatedAt: doc.updatedAt ?? now
    }
    await this.repo.putDoc(ruleDoc)
    console.log(`mock schema migrated: rule ${doc._id}, ${recordDocs.length} records`)
  }
}
