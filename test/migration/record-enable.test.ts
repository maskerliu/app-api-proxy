import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

// 结果页那颗「启用这 N 条」的仓库层半边。
// 它走的不是 `saveRecord` 那六步（校验 / 派生 / 查重 / 指纹 / 时间戳 / upsert），而是「读 doc、翻一个布尔、写回去」，
// 所以本卡断言的全是这条捷径**不该顺手做的事**：不刷新时间戳、不重算指纹、不重写没变化的 doc、不半截落笔。
// 这几条一旦哪天被「统一走保存路径」合并掉，症状分别是：整批在列表里跳到最新、档位被牵成自定义、
// 一次点击白顶高几百条 `_rev`、以及「前三个场景开了、第四个被闸门顶回」。

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mock-record-enable-'))
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
const { MockCache } = await import('@main/service/mock.cache')
const { importMockPack } = await import('@main/service/mock.pack.service')
const { RECORD_TYPE } = await import('@main/repository/mock.docs')
const { MockError } = await import('@shared/mock.errors')
const { MOCK_PACK_FORMAT, MOCK_PACK_VERSION, MOCK_PACK_MAX_RECORDS } = await import('@shared/mock.pack')
const { makeMatch } = await import('../unit/fixtures')

const repo = new MockRepo() as any
await repo.init()

const ok = { statusCode: 200, headers: {}, body: '{"ok":true}', bodyType: 'json', delayMs: 0 }

function packRecord(i: number) {
  return {
    id: null, name: `记录 ${i}`,
    match: makeMatch({ path: `/v1/orders/${i}`, enabled: false }),
    response: { ...ok, body: `{"i":${i}}` },
    variants: [], activeVariantId: null,
  }
}

function packTextOf(...rules: any[]) {
  return JSON.stringify({ format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION, rules })
}

async function newRule(name: string): Promise<string> {
  return repo.save({ name, desc: '' })
}

async function importInto(ruleId: string, count: number): Promise<string[]> {
  const result = await importMockPack(repo, packTextOf({
    id: `rule_${ruleId}`, name: '导入的来源', desc: '',
    records: Array.from({ length: count }, (_, i) => packRecord(i)),
  }), { mode: 'merge', targetRuleId: ruleId, conflict: 'skip' } as any)
  assert.equal(result.failed.length, 0)
  assert.equal(result.created.length, count, '种子必须是新建的停用记录，否则本卡前面几条断言都失去意义')
  return result.created
}

/** 直接读 doc：本卡要看的是落库后的原样字段，`getRecordById` 的读出投影把 `_rev` 抹掉了 */
async function readDoc(id: string): Promise<any> {
  return repo.getDoc(id)
}

/** 走一遍保存路径把某条置为启用——用来造「本来就开着」的那条，顺带证明它不是这次点击写的 */
async function enableTheSlowWay(id: string) {
  const record = await repo.getRecordById(id)
  await repo.saveRecord({ ...record, match: { ...record.match, enabled: true } })
}

function request(pathname: string) {
  return { method: 'GET', url: `http://api.demo.com${pathname}`, headers: [] }
}

let seq = 0
function uniqueName(prefix: string) {
  return `${prefix}-${++seq}`
}

describe('批量启用只翻启用位（时间戳与指纹照抄）', () => {
  it('created/alreadyEnabled 各归各，落库的 createdAt/updatedAt/matchFingerprint 一字未动', async () => {
    const ruleId = await newRule(uniqueName('保时间戳'))
    const [first, second] = await importInto(ruleId, 2)
    const before = await readDoc(first)
    await enableTheSlowWay(second)

    const result = await repo.enableRecords([first, second, first])

    assert.deepEqual(result.enabled, [first], '同一个 id 传两次只翻一次，也只报一次')
    assert.deepEqual([result.alreadyEnabled, result.unavailable], [1, 0])

    const after = await readDoc(first)
    assert.equal(after.match.enabled, true)
    assert.deepEqual(
      [after.createdAt, after.updatedAt, after.matchFingerprint, after.name, after.url],
      [before.createdAt, before.updatedAt, before.matchFingerprint, before.name, before.url],
      '除了 enabled，那条 doc 的其余字段必须逐字节相同')
    assert.equal(after.match.level, before.match.level, 'enabled 不在 canonicalMatch 里，翻转不该把档位牵成自定义')
    assert.notEqual(after._rev, before._rev, '写过的那条当然换 _rev——用它跟下面那条没写的对照')
  })

  it('本来就启用的那条一个字节都不写：_rev 不变', async () => {
    const ruleId = await newRule(uniqueName('已启用不重写'))
    const [id] = await importInto(ruleId, 1)
    await enableTheSlowWay(id)
    const before = await readDoc(id)

    const result = await repo.enableRecords([id])
    assert.deepEqual([result.enabled.length, result.alreadyEnabled, result.unavailable], [0, 1, 0])
    assert.equal((await readDoc(id))._rev, before._rev, 'enabled 已是 true 就不该再重写一遍')
  })

  it('`enabled` 缺省的旧记录算已启用：补一个 true 只是白顶高一次 _rev', async () => {
    const ruleId = await newRule(uniqueName('缺省启用位'))
    const [id] = await importInto(ruleId, 1)
    const doc = await readDoc(id)
    delete doc.match.enabled
    await repo.pouchdb.put(doc)
    const before = await readDoc(id)

    const result = await repo.enableRecords([id])
    assert.deepEqual([result.enabled.length, result.alreadyEnabled], [0, 1])
    assert.equal((await readDoc(id))._rev, before._rev)
  })
})

describe('打不开的是条数而不是逐条失败原因', () => {
  it('读不到的 id、规则文档、没有 match 的记录各计一次 unavailable，不进 enabled', async () => {
    const ruleId = await newRule(uniqueName('打不开'))
    const [id] = await importInto(ruleId, 1)
    // 没有 match 的记录 doc：仓库层写入口都不会产出这种形状，只能直接塞一个进去
    const noMatchId = `rec_${uniqueName('无匹配条件')}`
    await repo.pouchdb.put({
      _id: noMatchId, type: RECORD_TYPE, ruleId, name: '没有启用位的一条',
      response: ok, variants: [], activeVariantId: null, createdAt: 1, updatedAt: 1,
    })

    const events: any[] = []
    repo.onRecordChanged((event: any) => events.push(event))
    const result = await repo.enableRecords(['rec_不存在的', ruleId, noMatchId, id])

    assert.deepEqual(result.enabled, [id])
    assert.deepEqual([result.alreadyEnabled, result.unavailable], [0, 3],
      '一次点击是「把这几条打开」，读不到的那条要计入总数，否则结果页会报出对不上账的 N 条')
    assert.deepEqual(events.filter(it => it.type === 'invalidate').map(it => it.ruleId), [ruleId],
      '作废通知按触碰到的场景各发一次，跟条数无关')
  })

  it('空入参与全空 id 都不碰库，返回三个零', async () => {
    assert.deepEqual(await repo.enableRecords([]), { enabled: [], alreadyEnabled: 0, unavailable: 0 })
    assert.deepEqual(await repo.enableRecords([null as any, undefined as any, '' as any]),
      { enabled: [], alreadyEnabled: 0, unavailable: 0 })
  })

  it('超过包级上限直接拒绝，且拒绝排在读库之前', async () => {
    const ruleId = await newRule(uniqueName('超限'))
    const [id] = await importInto(ruleId, 1)
    const ids = [id, ...Array.from({ length: MOCK_PACK_MAX_RECORDS }, (_, i) => `rec_凑数${i}`)]

    await assert.rejects(() => repo.enableRecords(ids), (err: any) =>
      err instanceof MockError && err.code === 'recordTooMany')
    assert.equal((await readDoc(id)).match.enabled, false, '拒绝必须是零写入')
  })
})

describe('迁移闸门：整次点击要么全落笔要么全不落', () => {
  it('一次点击跨两个场景、其中一个待迁移 → 抛错且另一个场景也没被改', async () => {
    const readyRule = await newRule(uniqueName('闸门外'))
    const blockedRule = await newRule(uniqueName('待迁移'))
    const [readyId] = await importInto(readyRule, 1)
    const [blockedId] = await importInto(blockedRule, 1)

    repo.beginMigrationGuard([blockedRule])
    repo.blockMigrationWrites()
    try {
      await assert.rejects(() => repo.enableRecords([readyId, blockedId]), (err: any) =>
        err instanceof MockError && err.code === 'migrationFailed')
    } finally {
      repo.unblockMigrationWrites()
    }

    assert.deepEqual([
      (await readDoc(readyId)).match.enabled,
      (await readDoc(blockedId)).match.enabled,
    ], [false, false], '预检排在落笔之前：不能出现「一半开了、一半被顶回」的半截状态')

    // 闸门放开后同一次点击能原样重放，说明拒绝那一次没留下中间状态
    const result = await repo.enableRecords([readyId, blockedId])
    assert.deepEqual(result.enabled.sort(), [blockedId, readyId].sort())
  })
})

describe('启用后即命中（结果页那颗按钮的验收对象）', () => {
  it('导入不命中 → enableRecords → 第一次请求就命中，靠作废重建而不是回读单条', async () => {
    const ruleId = await newRule(uniqueName('启用即命中'))
    const ids = await importInto(ruleId, 2)
    const cache = new MockCache() as any
    cache.mockRepo = repo
    cache.init()

    assert.equal((await cache.match(ruleId, request('/v1/orders/0'))).matched, false,
      '导入的记录默认停用：这一步没变')
    const builtBefore = cache.getStats().compiledBuilds

    // 批量启用发的是整场景作废，所以重扫一次是预期内的成本；要钉的是它不逐条回源取记录
    const reads: Record<string, number> = { summaries: 0, byId: 0 }
    const listSummaries = repo.listRecordSummaries.bind(repo)
    const getRecordById = repo.getRecordById.bind(repo)
    repo.listRecordSummaries = async (...args: any[]) => { reads.summaries++; return listSummaries(...args) }
    repo.getRecordById = async (...args: any[]) => { reads.byId++; return getRecordById(...args) }

    await repo.enableRecords(ids)
    const hit = await cache.match(ruleId, request('/v1/orders/0'))
    assert.equal(hit.matched, true, '批量启用之后第一次请求就该命中')
    assert.equal(reads.byId, 0, '生效路径是作废重建，不是把每条读回来再塞进快照')
    assert.deepEqual([cache.getStats().compiledBuilds - builtBefore,
      cache.getStats().incrementalUpserts], [1, 0],
      '整场景重扫一次：逐条增量编译会把同一份快照编 N 遍')

    reads.summaries = 0
    reads.byId = 0
    assert.equal((await cache.match(ruleId, request('/v1/orders/1'))).matched, true)
    assert.deepEqual(reads, { summaries: 0, byId: 0 }, '重建之后第二次请求全走内存快照')
  })
})
