import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

// R4C-15：`importRecords` 是 `saveRecord` 的批量化，因此只能在真 PouchDB 上验。
// 「批量写绕过了六步里的某一步」这类失败在假仓库上断不出来——指纹、`_rev`、缓存通知都只在真库才看得见。

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mock-pack-import-'))
mkdirSync(path.join(DATA_DIR, 'biz_storage'), { recursive: true })
process.env.MOCK_MIGRATION_USER_DATA = DATA_DIR

// 服务模块会经 constants.ts 引用 electron，测试环境用最小 app 替身把 userData 指到临时目录
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>process.env.MOCK_MIGRATION_USER_DATA}',
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { MockRepo } = await import('@main/repository/mock.repo')
const { RECORD_TYPE } = await import('@main/repository/mock.docs')
const { MOCK_RECORD_REJECT_LIMIT } = await import('@shared/mock.models')
const { MOCK_PACK_WRITE_BATCH } = await import('@shared/mock.pack')
const { makeMatch, makeRecord } = await import('../unit/fixtures')

const repo = new MockRepo() as any
await repo.init()

const events: any[] = []
repo.onRecordChanged((event: any) => events.push(event))

/** 只取本次用例期间发生的通知，避免用例之间靠执行顺序互相读数 */
function eventsSince(mark: number) {
  return events.slice(mark)
}

async function newRule(name: string): Promise<string> {
  return repo.save({ name, desc: '' })
}

/**
 * 一条能过 `recordFieldsOf` 的记录。
 * 末了把 `id` 压回 `null`：`makeRecord` 默认补一个 `rec_<序号>`，带着它走 `saveRecord`
 * 会落进更新分支并抛 `recordMissing`，而本卡的用例要的正是「包侧那条还没落库」这个形状。
 */
function packRecord(ruleId: string, i: number, extra: any = {}) {
  const record = makeRecord({
    ruleId, name: `记录 ${i}`,
    match: makeMatch({ path: `/v1/orders/${i}`, enabled: false }), ...extra,
  })
  record.id = extra.id ?? null
  return record
}

async function recordIds(ruleId: string): Promise<string[]> {
  return (await repo.listRecordSummaries(ruleId)).map((it: any) => it._id)
}

const statusOf = (result: any, index: number) =>
  result.outcomes.find((it: any) => it.index === index)

describe('R4C-15 importRecords 批量写（真 PouchDB）', () => {
  it('六步一步不少：指纹、name 回落、按批通知，全部落在真库里', async () => {
    const ruleId = await newRule('批量写-单批')
    const mark = events.length
    const named = Array.from({ length: MOCK_PACK_WRITE_BATCH - 1 }, (_, i) => packRecord(ruleId, i))
    // 无名记录走 name 回落：库里那条要拿 match.path 顶上，否则列表整列空白
    const unnamed = packRecord(ruleId, 900, { name: '' })
    const records = [...named, unnamed]

    const result = await repo.importRecords(ruleId, records)
    assert.equal(result.created.length, records.length)
    assert.equal(result.updated.length, 0)
    assert.deepEqual(result.outcomes.map((it: any) => it.index), records.map((_, i) => i),
      'outcomes 与入参同序：调用方要按包内坐标回指明细')

    const docs = await repo.listRecordSummaries(ruleId)
    assert.equal(docs.length, records.length)
    for (const doc of docs) {
      assert.ok(doc.matchFingerprint, `${doc.name} 落了指纹，查重与派生才认得出它`)
    }
    // 摘要按 RECORD_SUMMARY_FIELDS 取字段，不带 `type`，落库形状要读一条真 doc 来验
    const fallen = await repo.getDoc(docs.find((it: any) => it.match.path === '/v1/orders/900')._id)
    assert.equal(fallen.type, RECORD_TYPE)
    assert.equal(fallen.name, '/v1/orders/900', '无名记录用 match.path 顶上，否则记录列表整列空白')
    // 一批一次通知，而不是逐条 upsert：5000 条导入不该把同一份快照编译 5000 次
    assert.deepEqual(eventsSince(mark), [{ type: 'invalidate', ruleId }])
  })

  it('跨批按批通知，条数超过一批也全量落库', async () => {
    const ruleId = await newRule('批量写-跨批')
    const mark = events.length
    const count = MOCK_PACK_WRITE_BATCH + 1
    const result = await repo.importRecords(ruleId,
      Array.from({ length: count }, (_, i) => packRecord(ruleId, i)))

    assert.equal(result.created.length, count)
    assert.equal((await recordIds(ruleId)).length, count)
    assert.equal(eventsSince(mark).filter((it: any) => it.ruleId === ruleId).length, 2)
  })

  it('不调用 bulkSave：裸批量写会跳过六步，这条把禁令钉住', async () => {
    const ruleId = await newRule('批量写-禁 bulkSave')
    const original = repo.bulkSave.bind(repo)
    let calls = 0
    repo.bulkSave = async (docs: any[]) => { calls++; return original(docs) }
    try {
      await repo.importRecords(ruleId, [packRecord(ruleId, 0)])
    } finally {
      repo.bulkSave = original
    }
    assert.equal(calls, 0, 'importRecords 必须走自己的管线，不借裸批量写')
  })

  it('一条坏数据不拖垮整批：坏的那条带错误码，其余照写', async () => {
    const ruleId = await newRule('批量写-单条失败')
    const bad = makeRecord({ ruleId, name: '没 match 也没 url', match: undefined })
    const result = await repo.importRecords(ruleId, [packRecord(ruleId, 0), bad, packRecord(ruleId, 2)])

    assert.equal(statusOf(result, 1).status, 'failed')
    assert.equal(statusOf(result, 1).reason, 'matchMissing')
    assert.equal(statusOf(result, 1).id, null)
    assert.equal(result.created.length, 2)
    assert.equal((await recordIds(ruleId)).length, 2)
  })

  it('指纹撞库内的那条不写，报 duplicate 并指回占位的记录', async () => {
    const ruleId = await newRule('批量写-撞库内')
    const saved = await repo.saveRecord(packRecord(ruleId, 7))
    const before = await recordIds(ruleId)

    const result = await repo.importRecords(ruleId, [packRecord(ruleId, 7)])
    assert.deepEqual(statusOf(result, 0),
      { index: 0, status: 'duplicate', id: saved.id, reason: 'matchDuplicate' })
    assert.deepEqual(await recordIds(ruleId), before, '库里一条不多一条不少')
  })

  it('同批内两条同指纹只写第一条：批量写不能绕过指纹唯一', async () => {
    const ruleId = await newRule('批量写-同批重复')
    const twice = packRecord(ruleId, 1)
    const result = await repo.importRecords(ruleId, [twice, { ...twice }, packRecord(ruleId, 2)])

    assert.equal(statusOf(result, 0).status, 'created')
    assert.equal(statusOf(result, 1).status, 'duplicate')
    assert.equal(statusOf(result, 1).id, statusOf(result, 0).id, 'duplicate 要指回同批里先落的那条')
    assert.equal((await recordIds(ruleId)).length, 2)
  })

  it('包内 id 属于本场景时走更新：续 _rev、保住 createdAt', async () => {
    const ruleId = await newRule('批量写-更新分支')
    const created = await repo.saveRecord(packRecord(ruleId, 3))
    const before = await repo.getDoc(created.id)

    const result = await repo.importRecords(ruleId,
      [{ ...packRecord(ruleId, 3), id: created.id, name: '改过名' }])
    const after = await repo.getDoc(created.id)

    assert.equal(statusOf(result, 0).status, 'updated')
    assert.deepEqual(result.updated, [created.id])
    assert.equal(after._id, created.id, 'id 保留，不另起一条')
    assert.equal(after.createdAt, before.createdAt, 'createdAt 是库里那条的，不是导入这一刻')
    assert.notEqual(after._rev, before._rev)
    assert.equal(after.name, '改过名')
  })

  it('包内 id 属于别的场景时不覆盖：另发新 id，来源那条原封不动', async () => {
    const source = await newRule('批量写-跨场景来源')
    const target = await newRule('批量写-跨场景目标')
    const hijackId = (await repo.saveRecord(packRecord(source, 9))).id
    const before = await repo.getDoc(hijackId)

    const result = await repo.importRecords(target,
      [{ ...packRecord(source, 9), id: hijackId }])
    const written = statusOf(result, 0)

    assert.equal(written.status, 'created')
    assert.notEqual(written.id, hijackId, '目标场景里另发一个 id，不去盖别人那条')
    assert.equal((await repo.getDoc(hijackId)).ruleId, source, '来源场景那条的 ruleId 没被改到目标场景')
    assert.equal((await recordIds(source)).length, 1)
    assert.equal((await recordIds(target)).length, 1)
  })

  it('迁移闸门期间整批拒绝，一条都不写', async () => {
    const ruleId = await newRule('批量写-迁移闸门')
    repo.blockMigrationWrites()
    repo.beginMigrationGuard([ruleId])
    try {
      await assert.rejects(() => repo.importRecords(ruleId, [packRecord(ruleId, 0)]),
        (err: any) => err.code === 'migrationFailed')
    } finally {
      repo.unblockMigrationWrites()
      repo.beginMigrationGuard([])
    }
    assert.deepEqual(await recordIds(ruleId), [])
  })

  it('上限复核排在查重之前：越界整批拒绝，零写入', async () => {
    const ruleId = await newRule('批量写-上限')
    const original = repo.countRecords.bind(repo)
    repo.countRecords = async () => MOCK_RECORD_REJECT_LIMIT
    try {
      await assert.rejects(() => repo.importRecords(ruleId, [packRecord(ruleId, 0)]),
        (err: any) => err.code === 'recordTooMany')
    } finally {
      repo.countRecords = original
    }
    assert.deepEqual(await recordIds(ruleId), [])
  })

  it('与单条保存共享规则级串行锁：并发导入不会各写一条同指纹', async () => {
    const ruleId = await newRule('批量写-并发')
    const records = [packRecord(ruleId, 11)]
    const [a, b] = await Promise.all([
      repo.importRecords(ruleId, records),
      repo.importRecords(ruleId, records),
    ])

    const duplicates = [a, b].flatMap(it => it.outcomes.filter((o: any) => o.status === 'duplicate'))
    assert.equal(duplicates.length, 1, '后进入的那一批把这条报成重复，而不是也写进去')
    assert.equal((await recordIds(ruleId)).length, 1)
  })

  it('空批次是合法的：不写库也不发通知', async () => {
    const ruleId = await newRule('批量写-空批')
    const mark = events.length
    const result = await repo.importRecords(ruleId, [])

    // `aborted` 是 R4C-19 加的第四栏：没给 signal 时必须显式回「没取消」，不能靠调用方看 created 反推
    assert.deepEqual(result, { outcomes: [], created: [], updated: [], aborted: false })
    assert.equal(eventsSince(mark).length, 0)
  })
})

// R4C-16：`updatedAt` 是列表与匹配排序的兜底键，导入若不注入就会把源机的相对优先级抹平（AC-R4-01）。
// 注入只在导入路径开得动，所以这几条全部对照「不传 options」的默认形状写。
describe('R4C-16 时间戳注入（仅导入路径）', () => {
  const PACK_CREATED = 1_600_000_000_000
  const PACK_UPDATED = 1_600_000_000_500

  it('preserveTimestamps：新建取包内原值，写入时刻不参与', async () => {
    const ruleId = await newRule('时间戳-新建取包值')
    const result = await repo.importRecords(ruleId,
      [packRecord(ruleId, 0, { createdAt: PACK_CREATED, updatedAt: PACK_UPDATED })],
      { preserveTimestamps: true })
    const doc = await repo.getDoc(result.created[0])

    assert.deepEqual([doc.createdAt, doc.updatedAt], [PACK_CREATED, PACK_UPDATED])
  })

  it('不传 options 与 R4C-15 完全一致：整批共用一个写入时刻', async () => {
    const ruleId = await newRule('时间戳-默认不注入')
    const before = Date.now()
    const result = await repo.importRecords(ruleId,
      [packRecord(ruleId, 0, { createdAt: PACK_CREATED, updatedAt: PACK_UPDATED }), packRecord(ruleId, 1)])
    const docs = await Promise.all(result.created.map((id: string) => repo.getDoc(id)))

    assert.equal(new Set(docs.map((it: any) => it.updatedAt)).size, 1, '整批一个时刻，不许逐条取时间')
    assert.ok(docs[0].updatedAt >= before, '默认口径下包值一概不用')
    assert.equal(docs[0].createdAt, docs[0].updatedAt)
  })

  it('包值不可用（0、字符串、超 Date 范围）回落写入时刻，但仍算写成功', async () => {
    const ruleId = await newRule('时间戳-坏值回落')
    const before = Date.now()
    const records = [
      packRecord(ruleId, 0, { createdAt: 0, updatedAt: '昨天' }),
      packRecord(ruleId, 1, { createdAt: 8.64e15 + 1, updatedAt: -5 }),
    ]
    const result = await repo.importRecords(ruleId, records, { preserveTimestamps: true })
    const docs = await Promise.all(result.created.map((id: string) => repo.getDoc(id)))

    assert.deepEqual(result.created.length, 2, '时间戳坏不是写入失败，回落就行')
    for (const doc of docs) {
      assert.ok(doc.createdAt >= before && doc.updatedAt >= before,
        `坏值该换成写入时刻，实际 ${doc.createdAt}/${doc.updatedAt}`)
    }
  })

  it('合并覆盖取库内原值（Q3）：包值与 now 都不许顶掉 updatedAt', async () => {
    const ruleId = await newRule('时间戳-覆盖取目标值')
    const saved = await repo.saveRecord(packRecord(ruleId, 2))
    const before = await repo.getDoc(saved.id)

    const result = await repo.importRecords(ruleId,
      [{ ...packRecord(ruleId, 2), id: saved.id, name: '改过名', createdAt: PACK_CREATED, updatedAt: PACK_UPDATED }],
      { preserveTimestamps: true })
    const after = await repo.getDoc(saved.id)

    assert.equal(statusOf(result, 0).status, 'updated')
    assert.deepEqual([after.createdAt, after.updatedAt], [before.createdAt, before.updatedAt],
      '覆盖不动时间戳：列表「更新时间」保持不变，结果页要写「保持原有优先级不变」')
    assert.equal(after.name, '改过名', '内容该照写，只有时间戳不动')
  })
})
