import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

// test/fixtures/mock-pack/v1.json 的「真能导入」那半边：读侧三阶段在 test/unit/pack-fixture.test.ts 里已经钉绿，
// 但「进了库之后条件还认不认得出原来的请求」只有真 PouchDB + 真缓存才断得出来（同 R4C-17 的理由）。
// 只在临时库里跑，绝不指向用户数据目录。

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mock-pack-fixture-'))
mkdirSync(path.join(DATA_DIR, 'biz_storage'), { recursive: true })
process.env.MOCK_MIGRATION_USER_DATA = DATA_DIR

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
const { importMockPack, previewMockPack } = await import('@main/service/mock.pack.service')

const FIXTURE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/mock-pack/v1.json')
const text = readFileSync(FIXTURE_PATH, 'utf8')

const repo = new MockRepo() as any
await repo.init()

const SCENE_TOTAL = 3
const RECORD_TOTAL = 15

function request(method: string, pathname: string, headers: Record<string, string> = {}) {
  return { method, url: `https://api.demo.com${pathname}`, headers }
}

async function recordsOf(ruleId: string): Promise<any[]> {
  const items: any[] = []
  await repo.iterateRecords(ruleId, (record: any) => { items.push(record) })
  return items
}

/** 按名字在库里找出 fixture 那条记录，然后启用它——启用走的是编辑器同一条 saveRecord */
async function enable(ruleId: string, name: string): Promise<any> {
  const record = (await recordsOf(ruleId)).find(it => it.name === name)
  assert.ok(record, `库里没有「${name}」这条记录`)
  const saved = await repo.saveRecord({ ...record, match: { ...record.match, enabled: true } })
  return saved
}

describe('fixture 预览：新建模式下两个数都对得上', () => {
  it('零失败、零冲突、零补默认值', async () => {
    const preview = await previewMockPack(repo, text, { mode: 'new' } as any)
    assert.equal(preview.kind, 'pack')
    assert.equal(preview.appVersion, '1.0.6')
    assert.deepEqual([preview.ruleCount, preview.recordCount, preview.invalidCount], [SCENE_TOTAL, RECORD_TOTAL, 0])
    assert.deepEqual([preview.issueTotal, preview.noteTotal, preview.conflictCount], [0, 0, 0])
    assert.deepEqual(preview.issues, [])
    assert.deepEqual(preview.conflicts, [])
    assert.deepEqual(preview.notes, [])
    // 两个变体挂在同一条记录上，且只有「将写入」的那批计数
    assert.equal(preview.variantCount, 2)
    assert.equal(preview.suggestedRuleName, undefined, '多场景包不填建议名：一个名字代表不了三个场景')
    assert.equal(preview.quota, undefined, '新建模式每个场景从 0 起，配额档位不该出现')
  })
})

describe('fixture 真库导入（新建模式）', () => {
  it('三个场景十五条记录全落库，且一条都没被自动启用', async () => {
    const result = await importMockPack(repo, text, { mode: 'new' } as any)
    assert.equal(result.mode, 'new')
    assert.deepEqual([result.ruleIds.length, result.created.length], [SCENE_TOTAL, RECORD_TOTAL])
    assert.deepEqual([result.updated.length, result.skipped.length, result.failed.length, result.invalid.length], [0, 0, 0, 0])
    assert.equal(result.invalidTotal, 0)
    assert.equal(result.enabled, false, '导入结果页要能显式说出「已导入但未启用」')
    assert.equal(result.nameCollided, false)
    assert.equal(result.partial, false)

    const rules = await repo.listRules()
    assert.equal(rules.length, SCENE_TOTAL)
    assert.deepEqual([...rules.map(it => it.name)].sort(),
      ['移动端登录', '静态资源与二进制', '订单查询'].sort(), '包里的三个场景名各自建了一个新场景')

    const all = (await Promise.all(result.ruleIds.map(recordsOf))).flat()
    assert.equal(all.length, RECORD_TOTAL)
    assert.ok(all.every(it => it.match.enabled === false), '风险表 RK6：导入不许劫持真实请求')
    assert.ok(all.every(it => it.match.derivation.source === 'import'))
    assert.deepEqual(new Set(all.map(it => it.id)).size, RECORD_TOTAL,
      '新建模式不带包里的 id 进库，条条款款都由仓库重新分配')
  })

  it('变体、脱敏与 base64 正文原样进库', async () => {
    const loginScene = (await repo.listRules()).find(it => it.name === '移动端登录')
    const records = await recordsOf(loginScene._id)

    const withVariants = records.find(it => it.name === '个人资料-含未授权变体')
    assert.equal(withVariants.variants.length, 2)
    assert.ok(withVariants.variants.some((it: any) => it.id === withVariants.activeVariantId))
    assert.equal(withVariants.variants.find((it: any) => it.statusCode === 401).name, '未授权')

    const login = records.find(it => it.name === '登录-成功')
    assert.equal(login.source.headers.authorization, '***', '脱敏必须在库里也看得见，不然导出-导入一圈就把凭证洗回来了')
    assert.equal(login.source.headers['x-device-id'], 'PAD-0001', '非敏感录制头不该被一起抹掉')

    const binaryScene = (await repo.listRules()).find(it => it.name === '静态资源与二进制')
    const png = (await recordsOf(binaryScene._id)).find(it => it.name === '站点图标-PNG base64')
    assert.equal(png.response.bodyType, 'binary')
    assert.equal(png.response.bodyEncoding, 'base64')
    assert.match(png.response.body, /^iVBORw0KGgo/)
  })
})

describe('fixture 导入后即生效（启用第一条就命中，条件语义没在圈里走丢）', () => {
  const cacheOf = () => {
    const cache = new MockCache() as any
    cache.mockRepo = repo
    cache.init()
    return cache
  }

  it('POST 登录 + 设备号请求头 → 命中；请求头不对 → 不命中', async () => {
    const scene = (await repo.listRules()).find(it => it.name === '移动端登录')
    await enable(scene._id, '登录-成功')
    const cache = cacheOf()

    const hit = await cache.match(scene._id, request('POST', '/api/auth/login', { 'x-device-id': 'PAD-0001' }))
    assert.equal(hit.matched, true, 'fixture 里那条 POST + 请求头条件的记录必须在启用后命中')
    const response = await cache.getRecordForResponse(scene._id, hit.recordId)
    assert.equal(JSON.parse(response.response.body).data.nick, '刘十一')

    const miss = await cache.match(scene._id, request('POST', '/api/auth/login', { 'x-device-id': 'PAD-9999' }))
    assert.equal(miss.matched, false, '请求头条件是包语义的一部分，圈一圈不该把它丢了')
  })

  it('query 必配且不许多余参数：allowExtra=false 在库里同样生效', async () => {
    const scene = (await repo.listRules()).find(it => it.name === '订单查询')
    await enable(scene._id, '订单列表-精确路径且 query 必配')
    const cache = cacheOf()

    const hit = await cache.match(scene._id, request('GET', '/v1/orders?page=1&status=paid'))
    assert.equal(hit.matched, true)
    assert.equal((await cache.match(scene._id, request('GET', '/v1/orders?page=2&status=paid'))).matched, false)
    assert.equal((await cache.match(scene._id, request('GET', '/v1/orders?page=1&status=paid&extra=1'))).matched, false,
      'allowExtra=false 的记录被多带一个参数就该整条不匹配')
  })

  it('glob 与 regex 两档路径在库里仍然认得出来', async () => {
    const scene = (await repo.listRules()).find(it => it.name === '订单查询')
    // 两条都启用之后再建缓存：事件驱动的增量编译由 pack-import-cache.test.ts 专门钉，
    // 这里要断的是「包里的路径条件进库后还认不认得出请求」，不该跟事件派发时机抢顺序
    await enable(scene._id, '订单详情-glob 且忽略签名键')
    await enable(scene._id, '订单回调-正则路径')
    const cache = cacheOf()

    assert.equal((await cache.match(scene._id, request('GET', '/v1/orders/SO20261115001'))).matched, true)
    assert.equal((await cache.match(scene._id, request('GET', '/v2/orders/SO20261115001'))).matched, false)

    const callback = await cache.match(scene._id, request('POST', '/v1/orders/SO20261115001/callback'))
    assert.equal(callback.matched, true, 'regex 档位那条必须在启用后命中')
    assert.equal((await cache.match(scene._id, request('POST', '/v1/orders/SO2026111501/callback'))).matched, false,
      'regex 里那 11 位数字的长度约束不该在导入圈里被放宽')
  })

  it('204 空正文那条：命中且响应体就是空', async () => {
    const scene = (await repo.listRules()).find(it => it.name === '移动端登录')
    await enable(scene._id, '会话注销-204 空正文')
    const cache = cacheOf()
    const hit = await cache.match(scene._id, request('DELETE', '/api/auth/session'))
    assert.equal(hit.matched, true)
    const response = await cache.getRecordForResponse(scene._id, hit.recordId)
    assert.deepEqual([response.response.statusCode, response.response.body], [204, ''])
  })
})

describe('fixture 可重放：同一个包第二次合并导入不再产生副本', () => {
  it('合并进空场景十五全建，重放同一个包十五全跳', async () => {
    const ruleId = await repo.save({ name: '重放目标', desc: '' })

    const first = await importMockPack(repo, text, { mode: 'merge', targetRuleId: ruleId, conflict: 'skip' } as any)
    assert.deepEqual([first.created.length, first.skipped.length, first.failed.length], [RECORD_TOTAL, 0, 0])

    const again = await importMockPack(repo, text, { mode: 'merge', targetRuleId: ruleId, conflict: 'skip' } as any)
    assert.deepEqual([again.created.length, again.updated.length, again.skipped.length], [0, 0, RECORD_TOTAL])
    assert.deepEqual([...new Set(again.skipped.map(it => it.reason))], ['matchDuplicate'])
    assert.equal(again.aborted, false)
    assert.equal((await recordsOf(ruleId)).length, RECORD_TOTAL, '重放同一个包不该把库翻倍')

    const preview = await previewMockPack(repo, text, { mode: 'merge', targetRuleId: ruleId } as any)
    assert.equal(preview.conflictCount, RECORD_TOTAL, '重放前预览就该把十五条同指纹冲突报出来')
    // 撞的是指纹档而不是同 ID 档：第一次合并落库时仓库给每条重新分配了 uuid（`mock.repo.ts` 的
    // `ownedIds.has(packId)` 只在包内 id 本来就属于本场景时才沿用它），包里那份 id 指不回库内任何一条。
    assert.deepEqual([...new Set(preview.conflicts.map(it => it.kind))], ['fingerprint'])
    assert.deepEqual([preview.quota.existingRecordCount, preview.quota.incomingRecordCount, preview.quota.totalRecordCount],
      [RECORD_TOTAL, RECORD_TOTAL, RECORD_TOTAL * 2])
    assert.deepEqual([preview.quota.warn, preview.quota.reject], [false, false], '30 条离 5,000 的建议档还远')
  })
})
