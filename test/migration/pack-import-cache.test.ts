import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

// R4C-17：「导入即生效」是 R4 的验收口径（PRD 4.4.8 的 AC-R4-11，也是 4.4.6「禁止裸 bulkDocs」那条禁令的验收对象），
// 又是最容易被一句「缓存大概会重建」糊过去的那条。
// 假仓库发不出 `invalidate` 事件，假缓存给不出真实读库次数，所以本卡两侧都用真的。
// 「匹配过程不回读库」在 test/bench/matcher.bench.ts 里只有源码级护栏（`match()` 里不许出现 mockRepo）；
// 这里补的是运行时那半边：把仓库那两把读原语包上计数器，命中那一步读了几次写死在断言里。

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mock-pack-import-cache-'))
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
const { MOCK_PACK_FORMAT, MOCK_PACK_VERSION } = await import('@shared/mock.pack')
const { makeMatch, makeRecord } = await import('../unit/fixtures')

const repo = new MockRepo() as any
await repo.init()

const ok = { statusCode: 200, headers: {}, body: '{"ok":true}', bodyType: 'json', delayMs: 0 }

/** 快照读 = 重扫场景，响应读 = 取响应体：命中路径「不回读库」断的就是这两个数 */
const reads = { summaries: 0, byId: 0 }
const listSummaries = repo.listRecordSummaries.bind(repo)
const getRecordById = repo.getRecordById.bind(repo)
repo.listRecordSummaries = async (...args: any[]) => {
  reads.summaries++
  return listSummaries(...args)
}
repo.getRecordById = async (...args: any[]) => {
  reads.byId++
  return getRecordById(...args)
}

function resetReads() {
  reads.summaries = 0
  reads.byId = 0
}

/** 独立缓存实例：统计、快照、库读计数都不跨用例，读数只反映本次流程 */
function newCache() {
  const cache = new MockCache() as any
  cache.mockRepo = repo
  cache.init()
  resetReads()
  return cache
}

function packRecord(i: number, extra: any = {}) {
  return {
    id: null, name: `记录 ${i}`,
    match: makeMatch({ path: `/v1/orders/${i}`, enabled: false }),
    response: { ...ok, body: `{"i":${i}}` },
    variants: [], activeVariantId: null, ...extra
  }
}

function scenario(name: string, records: any[]) {
  return { id: `rule_pack_${name}`, name, desc: `${name} 的描述`, records }
}

function packTextOf(...rules: any[]) {
  return JSON.stringify({ format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION, rules })
}

function mergePack(...records: any[]) {
  return packTextOf(scenario('任意', records))
}

function request(pathname: string) {
  return { method: 'GET', url: `http://api.demo.com${pathname}`, headers: [] }
}

async function newRule(name: string): Promise<string> {
  return repo.save({ name, desc: '' })
}

async function readAll(ruleId: string): Promise<any[]> {
  const items: any[] = []
  await repo.iterateRecords(ruleId, (record: any) => { items.push(record) })
  return items
}

let seq = 0
function uniqueName(prefix: string) {
  return `${prefix}-${++seq}`
}

async function mergeInto(targetRuleId: string, text: string, conflict: string) {
  return importMockPack(repo, text, { mode: 'merge', targetRuleId, conflict } as any)
}

describe('批导入按批作废整个场景（R4C-17）', () => {
  it('整批只发一次 invalidate：下一次请求才整体重建快照，不逐条编译', async () => {
    const ruleId = await newRule(uniqueName('批作废'))
    const cache = newCache()
    const events: any[] = []
    repo.onRecordChanged((event: any) => events.push(event))

    // 空场景先匹配一次，快照才进得了内存：没有东西可废，「批作废」就断不出来
    await cache.match(ruleId, request('/v1/orders/0'))
    assert.equal(cache.getStats().compiledBuilds, 1)
    assert.equal(cache.getStats().snapshotCount, 1, '写库前该场景的快照在内存里')

    const result = await mergeInto(ruleId, mergePack(packRecord(0), packRecord(1), packRecord(2)), 'skip')
    assert.deepEqual([result.created.length, result.failed.length], [3, 0])
    assert.deepEqual(events.map(it => it.type), ['invalidate'],
      '整批一次作废：逐条 upsert 会把同一份快照编译 N 遍')
    assert.equal(events[0].ruleId, ruleId, '作废的是目标场景，不是包里带的那个场景 ID')
    assert.equal(cache.getStats().snapshotCount, 0, '作废当场摘掉快照，不等下一次请求')

    const miss = await cache.match(ruleId, request('/v1/orders/0'))
    assert.equal(miss.matched, false, '导入的记录默认未启用，不参与命中（风险表 RK6）')
    const stats = cache.getStats()
    assert.equal(stats.compiledBuilds, 2, '重建只发生在下一次请求那一步')
    assert.equal(stats.incrementalUpserts, 0, '批导入一条都不该走增量编译')
  })
})

describe('导入即生效：启用之后第一次命中不回读库（R4C-17 核心验收）', () => {
  it('未启用不命中 → 启用 → 立即命中，命中那一步库读为 0，响应体才第一次回源', async () => {
    const ruleId = await newRule(uniqueName('启用即命中'))
    const cache = newCache()
    await mergeInto(ruleId, mergePack(packRecord(0), packRecord(1)), 'skip')

    // 先匹配一次把快照建起来：启用走的就是编辑器那条 saveRecord，事件是 upsert，命中增量维护
    assert.equal((await cache.match(ruleId, request('/v1/orders/0'))).matched, false)
    const imported = (await readAll(ruleId)).find(it => it.name === '记录 0')

    resetReads()
    await repo.saveRecord({ ...imported, match: { ...imported.match, enabled: true } })
    const hit = await cache.match(ruleId, request('/v1/orders/0'))
    assert.equal(hit.matched, true, '启用之后第一次请求就该命中')
    assert.equal(hit.recordId, imported.id)
    assert.equal(cache.getStats().incrementalUpserts, 1, '启用走的是增量，不是重扫')
    assert.deepEqual(reads, { summaries: 0, byId: 0 },
      '命中判定全部来自快照：启用之后第一次命中一次库读都不该有')

    // 响应体是快照唯一不带的东西：命中之后才回源一次，拿到的必须是包里的内容
    const forResponse = await cache.getRecordForResponse(ruleId, hit.recordId!)
    assert.equal(JSON.parse(forResponse.response.body).i, 0, '响应体取自包，不是导出前的占位')
    assert.deepEqual(reads, { summaries: 0, byId: 1 }, '只有取响应体那一次回读库')

    resetReads()
    assert.equal((await cache.match(ruleId, request('/v1/orders/0'))).matched, true)
    await cache.getRecordForResponse(ruleId, hit.recordId!)
    assert.deepEqual(reads, { summaries: 0, byId: 0 }, '再请求一次：memo 与响应缓存都在，库读为零')
  })
})

describe('导入即生效：覆盖导入换掉的响应体立刻生效（R4C-17 响应缓存半边）', () => {
  it('预热响应缓存后重放同一个包（只改 body）→ 下一次取响应拿到新文本', async () => {
    const ruleId = await newRule(uniqueName('覆盖换体'))
    const seed = makeRecord({ ruleId, name: '库里那条', match: makeMatch({ path: '/v1/orders/9' }) })
    seed.id = null as any
    seed.response = { ...ok, body: '旧文本' }
    const saved = await repo.saveRecord(seed)
    const stored = await repo.getRecordById(saved.id)

    const cache = newCache()
    const hit = await cache.match(ruleId, request('/v1/orders/9'))
    assert.equal(hit.matched, true, '种子记录是启用的：先证明预热走的是命中路径')
    assert.equal((await cache.getRecordForResponse(ruleId, hit.recordId!)).response.body, '旧文本')

    const result = await mergeInto(ruleId, mergePack({
      ...stored, id: stored.id,
      response: { ...ok, body: '新文本' },
      variants: [], activeVariantId: null,
    }), 'overwrite')
    assert.deepEqual([result.created.length, result.updated.length], [0, 1])
    assert.equal((await readAll(ruleId)).length, 1, '覆盖是同一条文档，不是又塞进来一份')

    // 批作废同时清了快照与响应缓存。快照重不重建跟这条断言无关，响应体不能还是旧的
    const after = await cache.getRecordForResponse(ruleId, hit.recordId!)
    assert.equal(after.response.body, '新文本', '响应缓存没随批作废就会拿到覆盖前的旧文本')
    assert.equal((await readAll(ruleId))[0].match.enabled, true,
      '覆盖换内容不换开关：库里那条原本在生效，不该被这次导入停下')
    assert.equal((await cache.match(ruleId, request('/v1/orders/9'))).matched, true,
      '保住启用位之后仍然导入即生效，用户不必为了重新生效再点一次启用')
  })
})

describe('导入即生效不等于导入即启用（技术设计 D5 / 风险表 RK6）', () => {
  it('新建模式把场景建出来供 UI 选，但不改当前启用场景；包里写 enabled:true 落库仍是停用', async () => {
    const otherRuleId = await newRule(uniqueName('当前启用'))
    await repo.setLastActiveRuleId(otherRuleId)

    const base = uniqueName('新建不越开关')
    const text = packTextOf(scenario(base,
      [packRecord(0, { match: makeMatch({ path: '/v1/orders/0', enabled: true }) })]))
    const cache = newCache()
    const result = await importMockPack(repo, text, { mode: 'new' })
    const newRuleId = result.ruleIds[0]

    assert.ok((await repo.listRules()).some(it => it._id === newRuleId),
      '新场景要出现在场景列表里，UI 才选得到它（D5 的「由用户在界面上选目标场景」）')
    assert.equal(await repo.getLastActiveRuleId(), otherRuleId,
      '导入不写 lastActiveRuleId：唯一会写它的是启用场景那条路径')
    assert.equal((await readAll(newRuleId))[0].match.enabled, false,
      '包里写 enabled:true 也归一化成停用（R4C-12 的生效侧）')
    assert.equal((await cache.match(newRuleId, request('/v1/orders/0'))).matched, false,
      '新建模式导进来就命中 = 绕过了「导入不自动启用」')
  })
})
