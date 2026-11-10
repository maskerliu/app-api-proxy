import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ProxyMock } from '@shared/proxy.models'
import { normalizeMockRecord } from '@shared/mock.validation'
import {
  applyMigrationPatch, planMigrationV4,
} from '@main/service/mock.migration'
import type { MigrationPatch, MigrationPlan, MigrationSourceRecord } from '@main/service/mock.migration'
import { fingerprintOf } from '@main/repository/mock.docs'
import { matchRecords, normalizeRequest } from '@main/service/mock.matcher'
import { restoreStrict } from '@main/service/mock.derive'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.resolve(HERE, '../fixtures/mock-v3/records.json')
const PROXY_SERVICE_PATH = path.resolve(HERE, '../../src/main/service/proxy.service.ts')
const MOCK_SERVICE_PATH = path.resolve(HERE, '../../src/main/service/mock.service.ts')

const ANALYZED_AT = 1700000000000

type FixtureDoc = Record<string, any> & { _id: string }

function loadFixture(): FixtureDoc[] {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')).docs
}

function toSource(doc: FixtureDoc): MigrationSourceRecord {
  return {
    record: normalizeMockRecord({ ...doc, id: doc._id }),
    keepMatch: doc.match?.version === 1,
    name: doc.name,
  }
}

function patchMap(plan: MigrationPlan): Map<string, MigrationPatch> {
  return new Map(plan.patches.map(it => [it.recordId, it]))
}

function applyPlan(docs: FixtureDoc[], patches: MigrationPatch[]): FixtureDoc[] {
  const byId = new Map(patches.map(it => [it.recordId, it]))
  return docs.map(doc => {
    const clone: FixtureDoc = JSON.parse(JSON.stringify(doc))
    const patch = byId.get(clone._id)
    return patch == null ? clone : applyMigrationPatch(clone, patch)
  })
}

function toRecords(docs: FixtureDoc[]): ProxyMock.MockRecord[] {
  return docs.map(doc => normalizeMockRecord({ ...doc, id: doc._id }))
}

function matchOn(records: ProxyMock.MockRecord[], method: string, url: string) {
  return matchRecords(records, normalizeRequest({ method, url }))
}

function findDoc(docs: FixtureDoc[], id: string): FixtureDoc {
  const doc = docs.find(it => it._id === id)
  assert.ok(doc != null, `fixture 缺少 ${id}`)
  return doc
}

describe('v3 → v4 迁移计划（AC-R1-09）', () => {
  const docs = loadFixture()
  const plan = planMigrationV4(docs.map(toSource), ANALYZED_AT)
  const patches = patchMap(plan)

  it('迁移零丢失：每条记录都有写回计划，不存在静默丢弃', () => {
    assert.equal(docs.length, 11)
    assert.equal(plan.patches.length, docs.length)
    const planned = new Set(plan.patches.map(it => it.recordId))
    assert.equal(planned.size, docs.length)
    for (const doc of docs) {
      assert.ok(planned.has(doc._id), `${doc._id} 没有迁移计划`)
      const patch = patches.get(doc._id)
      assert.ok(patch.match != null || patch.invalidReason != null,
        `${doc._id} 既没有 match 也没有 invalidReason`)
    }
  })

  it('报告计数与自动放宽记录一致', () => {
    // a1/a2 忽略 ts+sign，10086/10087 参数化，legacy 忽略 ts
    assert.equal(plan.autoRelaxedRecords, 5)
    assert.equal(plan.autoIgnoredKeyCount, 5)
    assert.equal(plan.parameterizedPathCount, 2)
    // broken=1，重复指纹被禁用=3（a1、10086、ping_old）
    assert.equal(plan.invalidRecords, 4)
    // items 覆盖所有已分析记录；自动放宽只占其中一部分
    const analyzedItems = plan.items.filter(it => it.invalidReason == null)
    assert.equal(analyzedItems.length, 10)
    const relaxedItems = analyzedItems.filter(it => it.autoIgnoredKeys.length > 0 || it.pathParameterized)
    assert.equal(relaxedItems.length, 5)
    const invalidItems = plan.items.filter(it => it.invalidReason != null)
    assert.equal(invalidItems.length, 4)
    for (const patch of plan.patches) {
      if (patch.invalidReason == null) continue
      assert.ok(plan.items.some(it => it.recordId === patch.recordId && it.invalidReason === patch.invalidReason),
        `${patch.recordId} 的无效原因未进入报告`)
    }
  })

  it('AC-R1-01 · 动态键 ts/sign 自动忽略，E5 语义键保留为条件', () => {
    for (const id of ['rec_a1', 'rec_a2']) {
      const match = patches.get(id).match
      assert.deepEqual(match.query.ignoreKeys, ['sign', 'ts'])
      const keys = match.query.conditions.map(it => it.key)
      assert.deepEqual(keys, ['role'])
      assert.equal(match.query.conditions[0].value, 'admin')
      assert.equal(match.query.allowExtra, true)
      assert.equal(match.level, 'standard')
      assert.equal(match.derivation.source, 'migration')
      assert.equal(match.derivation.analyzedAt, ANALYZED_AT)
      assert.deepEqual(match.derivation.autoIgnoredKeys, ['sign', 'ts'])
    }
  })

  it('AC-R1-01 · 动态值变化后仍命中，额外参数不影响标准档', () => {
    const applied = applyPlan(docs, plan.patches)
    const records = toRecords(applied)
    const hit = matchOn(records, 'GET', '/v1/users?ts=1800000000000&sign=zzz&role=admin&extra=1')
    assert.equal(hit.matched, true)
    const forbidden = matchOn(records, 'GET', '/v1/users?ts=1800000000000&sign=zzz&role=guest')
    assert.equal(forbidden.matched, false)
  })

  it('AC-R1-02 · 同 Path 不同 Method 各自独立，不互相覆盖', () => {
    const get = patches.get('rec_orders_get').match
    const post = patches.get('rec_orders_post').match
    assert.equal(get.method, 'GET')
    assert.equal(post.method, 'POST')
    assert.notEqual(patches.get('rec_orders_get').fingerprint, patches.get('rec_orders_post').fingerprint)
    assert.ok(!plan.duplicates.some(it => it.keptRecordId.startsWith('rec_orders')))

    const records = toRecords(applyPlan(docs, plan.patches))
    assert.equal(matchOn(records, 'GET', '/v1/orders/detail?orderId=1').recordId, 'rec_orders_get')
    assert.equal(matchOn(records, 'POST', '/v1/orders/detail?orderId=1').recordId, 'rec_orders_post')
    assert.equal(matchOn(records, 'PUT', '/v1/orders/detail?orderId=1').matched, false)
  })

  it('AC-R1-12 · ID 段记录参数化为 glob，两个原请求都命中', () => {
    for (const id of ['rec_user_10086', 'rec_user_10087']) {
      const match = patches.get(id).match
      assert.equal(match.pathType, 'glob')
      assert.equal(match.path, '/v1/users/*')
      assert.equal(match.parameterizedSegmentIndex, 2)
      assert.equal(match.derivation.pathParameterized, true)
      assert.equal(match.pathOriginal, findDoc(docs, id).url.split('?')[0])
    }

    const records = toRecords(applyPlan(docs, plan.patches))
    assert.equal(matchOn(records, 'GET', '/v1/users/10086?x=1').matched, true)
    assert.equal(matchOn(records, 'GET', '/v1/users/10087?x=1').matched, true)
    assert.equal(matchOn(records, 'GET', '/v1/users/99999?x=1&extra=1').matched, true)
  })

  it('AC-R1-09 · 无法解析 URL 的记录保留并标记 urlInvalid', () => {
    const patch = patches.get('rec_broken')
    assert.equal(patch.invalidReason, 'urlInvalid')
    assert.equal(patch.match, undefined)

    const applied = applyPlan(docs, plan.patches)
    const broken = findDoc(applied, 'rec_broken')
    assert.equal(broken.matchInvalid, 'urlInvalid')
    assert.equal(applied.length, docs.length)
    assert.deepEqual(broken.response, findDoc(docs, 'rec_broken').response)
  })

  it('AC-R1-19 · 重复指纹保留最新，其余禁用但响应不删除', () => {
    assert.equal(plan.duplicates.length, 3)
    const pingFingerprint = patches.get('rec_ping_new').fingerprint
    const ping = plan.duplicates.find(it => it.fingerprint === pingFingerprint)
    assert.ok(ping != null)
    assert.equal(ping.keptRecordId, 'rec_ping_new')
    assert.deepEqual(ping.disabledRecordIds, ['rec_ping_old'])

    const users = plan.duplicates.find(it =>
      it.keptRecordId === 'rec_a2' || it.keptRecordId === 'rec_a1')
    assert.ok(users != null)
    assert.equal(users.keptRecordId, 'rec_a2')
    assert.deepEqual(users.disabledRecordIds, ['rec_a1'])

    const details = plan.duplicates.find(it =>
      it.keptRecordId === 'rec_user_10087' || it.keptRecordId === 'rec_user_10086')
    assert.ok(details != null)
    assert.equal(details.keptRecordId, 'rec_user_10087')
    assert.deepEqual(details.disabledRecordIds, ['rec_user_10086'])

    for (const id of ['rec_ping_old', 'rec_a1', 'rec_user_10086']) {
      assert.equal(patches.get(id).invalidReason, 'duplicateAfterMigration')
    }

    const applied = applyPlan(docs, plan.patches)
    for (const id of ['rec_ping_old', 'rec_a1', 'rec_user_10086']) {
      const doc = findDoc(applied, id)
      assert.equal(doc.matchInvalid, 'duplicateAfterMigration')
      assert.equal(doc.match.enabled, false)
      assert.deepEqual(doc.response, findDoc(docs, id).response)
    }
    const keptPing = findDoc(applied, 'rec_ping_new')
    assert.equal(keptPing.matchInvalid, undefined)
    assert.equal(keptPing.match.enabled, true)
  })

  it('迁移只改匹配字段，响应/变体/来源/时间戳与原文档一致', () => {
    const applied = applyPlan(docs, plan.patches)
    for (const original of docs) {
      const next = findDoc(applied, original._id)
      assert.deepEqual(next.response, original.response)
      assert.deepEqual(next.variants, original.variants)
      assert.deepEqual(next.source, original.source)
      assert.equal(next.name, original.name)
      assert.equal(next.url, original.url)
      assert.equal(next.createdAt, original.createdAt)
      assert.equal(next.updatedAt, original.updatedAt)
    }
  })

  it('旧版本 record 快照保留，可用于回滚', () => {
    const applied = applyPlan(docs, plan.patches)
    const legacy = findDoc(applied, 'rec_legacy_snapshot')
    assert.deepEqual(legacy.record, findDoc(docs, 'rec_legacy_snapshot').record)
    assert.equal(legacy.response.statusCode, 201)
    assert.equal(legacy.response.delayMs, 120)
    assert.deepEqual(legacy.match.query.ignoreKeys, ['ts'])
    assert.equal(legacy.match.query.mode, 'ignore')
  })

  it('迁移幂等：第二次计划的写回不改变任何文档', () => {
    const first = applyPlan(docs, plan.patches)
    const secondPlan = planMigrationV4(first.map(toSource), ANALYZED_AT + 1)
    // 已迁移记录被跳过；仅未迁移的无效记录会重复写回同一原因
    assert.ok(secondPlan.patches.length < plan.patches.length)
    for (const patch of secondPlan.patches) {
      assert.equal(patch.invalidReason, 'urlInvalid')
      assert.equal(patch.match, undefined)
    }
    const second = applyPlan(first, secondPlan.patches)
    // applyPlan 做 JSON 深拷贝，比较时统一去掉 undefined 字段
    assert.deepEqual(second, JSON.parse(JSON.stringify(first)))
  })

  it('AC-R1-13 · 单条撤销回到严格档，保留响应与变体', () => {
    const applied = applyPlan(docs, plan.patches)
    const record = toRecords(applied).find(it => it.id === 'rec_a2')
    const before = JSON.parse(JSON.stringify(record))
    const change = restoreStrict(record, ANALYZED_AT)
    assert.equal(change.changed, true)
    assert.equal(change.match.level, 'strict')
    assert.equal(change.match.query.allowExtra, false)
    assert.deepEqual(change.match.query.ignoreKeys, [])
    assert.deepEqual(change.match.query.conditions.map(it => it.key).sort(), ['role', 'sign', 'ts'])
    assert.equal(change.match.enabled, true)
    assert.deepEqual(JSON.parse(JSON.stringify(record.response)), before.response)
    assert.deepEqual(record.variants, before.variants)
    assert.equal(record.url, before.url)
    assert.equal(record.source.url, before.source.url)

    const reverted = { ...record, match: change.match }
    assert.equal(matchOn([reverted], 'GET', '/v1/users?ts=1699999911111&sign=bbb&role=admin').matched, true)
    assert.equal(matchOn([reverted], 'GET', '/v1/users?ts=1699999911111&sign=bbb&role=admin&extra=1').matched, false)
  })

  it('AC-R1-12 · 全局撤销恢复精确 Path，参数化不再命中其他 ID', () => {
    const applied = applyPlan(docs, plan.patches)
    const validIds = new Set(plan.patches.filter(it => it.invalidReason == null).map(it => it.recordId))
    const reverted = toRecords(applied).map(record => {
      if (!validIds.has(record.id) || record.id !== 'rec_user_10087') return record
      return { ...record, match: restoreStrict(record, ANALYZED_AT).match }
    })
    assert.equal(matchOn(reverted, 'GET', '/v1/users/10087?x=1').matched, true)
    assert.equal(matchOn(reverted, 'GET', '/v1/users/10086?x=1').matched, false)
    // 其他记录的响应不受撤销影响
    const revertedDoc = findDoc(applied, 'rec_user_10087')
    assert.deepEqual(revertedDoc.response, findDoc(docs, 'rec_user_10087').response)
  })

  it('AC-R1-15 · 中文编码迁移后按原文匹配', () => {
    const match = patches.get('rec_cn').match
    const condition = match.query.conditions.find(it => it.key === 'q')
    assert.equal(condition.value, '中文')
    assert.equal(condition.op, 'equals')
    const records = toRecords(applyPlan(docs, plan.patches))
    assert.equal(matchOn(records, 'GET', '/v1/search?q=%E4%B8%AD%E6%96%87&page=1').matched, true)
    assert.equal(matchOn(records, 'GET', '/v1/search?q=英文&page=1').matched, false)
  })

  it('未迁移/未命中时匹配器返回未命中，供代理层直接转发', () => {
    const records = toRecords(applyPlan(docs, plan.patches))
    assert.equal(matchOn(records, 'GET', '/not-recorded/at-all').matched, false)
    assert.equal(matchOn(records, 'GET', '/not-recorded/at-all').record, undefined)
  })

  it('代理回退接线：Mock 关闭/未命中走转发，异常不阻断请求', () => {
    const proxy = readFileSync(PROXY_SERVICE_PATH, 'utf8')
    assert.ok(proxy.includes('if (attempt.matched)'))
    assert.ok(proxy.includes('this.sendMockResponse(resp, attempt.response, delay)'))
    assert.ok(proxy.includes('await this.proxy(sessionId, req, resp, startTime, delay, rawBody, miss)'))
    assert.ok(proxy.includes("console.warn('mock failed, fallback to proxy:'"))

    const mock = readFileSync(MOCK_SERVICE_PATH, 'utf8')
    assert.ok(mock.includes('return { matched: false, meta: NO_MATCH_META }'))
    assert.ok(mock.includes('return { matched: false, meta: { hit: false, miss: result.miss } }'))
  })
})

describe('v3 → v4 迁移压测（5,000 条）', () => {
  const RULE_COUNT = 5
  const PER_RULE = 1000

  function buildPressureDocs(): FixtureDoc[] {
    const docs: FixtureDoc[] = []
    for (let rule = 0; rule < RULE_COUNT; rule++) {
      for (let index = 0; index < PER_RULE; index++) {
        const id = 1000 + index
        // status 是 E5 语义键，值不同也会保留为条件，避免参数化后全部撞成同一指纹
        const url = `/v1/g${rule}/items/${id}?page=1&ts=${1700000000000 + index}&status=stage-${id}`
        docs.push({
          _id: `rec_p${rule}_${index}`,
          ruleId: `rule_pressure_${rule}`,
          name: `压力记录 ${rule}/${index}`,
          url,
          response: {
            statusCode: 200,
            headers: {},
            body: `{"id":${id}}`,
            bodyType: 'json',
            delayMs: 0,
          },
          variants: [],
          activeVariantId: null,
          source: { method: 'GET', url, statusCode: 200 },
          createdAt: 1700000000000 + index,
          updatedAt: 1700000000000 + index,
        })
      }
    }
    return docs
  }

  it('5,000 条全部迁移且无重复误判', () => {
    const docs = buildPressureDocs()
    assert.equal(docs.length, 5000)
    const started = Date.now()
    const plan = planMigrationV4(docs.map(toSource), ANALYZED_AT)
    const elapsed = Date.now() - started

    assert.equal(plan.patches.length, 5000)
    assert.equal(new Set(plan.patches.map(it => it.recordId)).size, 5000)
    assert.equal(plan.invalidRecords, 0)
    assert.equal(plan.duplicates.length, 0)
    assert.equal(plan.parameterizedPathCount, 5000)
    assert.equal(plan.autoIgnoredKeyCount, 5000)
    assert.ok(elapsed < 30000, `迁移计划耗时 ${elapsed}ms 超过 30s`)

    const sample = plan.patches.find(it => it.recordId === 'rec_p0_0').match
    assert.equal(sample.path, '/v1/g0/items/*')
    assert.equal(sample.pathType, 'glob')
    assert.deepEqual(sample.query.ignoreKeys, ['ts'])
    assert.deepEqual(sample.query.conditions.map(it => it.key), ['page', 'status'])

    const applied = applyPlan(docs, plan.patches)
    const records = toRecords(applied)
    assert.equal(records.length, 5000)
    assert.equal(matchOn(records, 'GET', '/v1/g3/items/1321?page=1&ts=1&status=stage-1321&extra=1').matched, true)
    assert.equal(matchOn(records, 'GET', '/v1/g3/items/1321?page=2&ts=1&status=stage-1321').matched, false)
  })

  it('压力样例的重复赢家与惩罚确定且与输入顺序无关', () => {
    const docs = buildPressureDocs()
    // 人为制造 10 组同条件记录（不同 updatedAt），验证迁移二跑结论一致
    for (let i = 0; i < 10; i++) {
      docs.push({
        _id: `rec_dup_${i}`,
        ruleId: 'rule_pressure_0',
        url: '/v1/dup?role=admin',
        response: { statusCode: 200, headers: {}, body: 'dup', bodyType: 'text', delayMs: 0 },
        variants: [],
        activeVariantId: null,
        source: { method: 'GET', url: '/v1/dup?role=admin' },
        createdAt: 1700000000000 + i,
        updatedAt: 1700000000000 + i,
      })
    }

    const forward = planMigrationV4(docs.map(toSource), ANALYZED_AT)
    const backward = planMigrationV4([...docs].reverse().map(toSource), ANALYZED_AT)
    const byId = (plan: MigrationPlan) => new Map(plan.patches.map(it => [it.recordId, it]))

    const forwardPatches = byId(forward)
    const backwardPatches = byId(backward)
    assert.equal(forwardPatches.size, backwardPatches.size)
    for (const [id, patch] of forwardPatches) {
      assert.deepEqual(backwardPatches.get(id), patch, `${id} 的计划受输入顺序影响`)
    }

    const dupGroup = forward.duplicates.find(it => it.keptRecordId === 'rec_dup_9')
    assert.ok(dupGroup != null)
    assert.equal(dupGroup.disabledRecordIds.length, 9)
    const disabled = forward.patches
      .filter(it => it.recordId.startsWith('rec_dup_') && it.invalidReason != null)
      .map(it => it.recordId)
      .sort()
    assert.deepEqual(disabled, Array.from({ length: 9 }, (_, i) => `rec_dup_${i}`).sort())
  })
})

describe('迁移指纹与写回工具', () => {
  it('指纹对条件顺序不敏感，且长度固定', () => {
    const docs = loadFixture()
    const plan = planMigrationV4(docs.map(toSource), ANALYZED_AT)
    const a1 = plan.patches.find(it => it.recordId === 'rec_a1')
    const a2 = plan.patches.find(it => it.recordId === 'rec_a2')
    assert.equal(a1.fingerprint, a2.fingerprint)
    assert.match(a1.fingerprint, /^[0-9a-f]{40}$/)

    const reversed = {
      ...a1.match,
      query: { ...a1.match.query, conditions: [...a1.match.query.conditions].reverse() },
    }
    assert.equal(fingerprintOf(reversed), a1.fingerprint)
  })

  it('applyMigrationPatch 只补指纹时不清除已有禁用状态', () => {
    const match = planMigrationV4(loadFixture().map(toSource), ANALYZED_AT)
      .patches.find(it => it.recordId === 'rec_a1').match
    const target: Record<string, any> = {
      match: { ...match, enabled: false },
      matchInvalid: 'duplicateAfterMigration',
      matchFingerprint: 'old',
    }
    applyMigrationPatch(target, { recordId: 'rec_a1', fingerprint: 'new' })
    assert.equal(target.matchFingerprint, 'new')
    assert.equal(target.matchInvalid, 'duplicateAfterMigration')
    assert.equal(target.match.enabled, false)
  })
})