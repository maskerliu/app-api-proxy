import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

// test/fixtures/har/*.har 的「真能导入」那半边：HAR 自己那三层（读信封、逐条解析、字段映射）在
// test/unit/har.test.ts 与 har-map.test.ts 里已经钉绿，但那份映射结果进不进得了库——过不过得了阶段二闸门、
// 缺 name 走不走 notes 通道、base64 正文进库还是不是 binary、host 空串在真匹配里是什么表现——
// 只有真 PouchDB + 真缓存断得出来（同 R4C-17 与 fixture 导入那两批的理由）。
// 只在临时库里跑，绝不指向用户数据目录。
//
// 这里没有 `importHar` 那条端点可用（`/_appmock/importHar` 仍是空结果桩，接线属 R4C-35），
// 所以「HAR → 映射 → 规则包 → 既有导入链路」这一段编排由本文件手工拼出来，拼法就是 R4C-35 要在服务层做的那件事。
// 换句话说，这几条用例证明的是「HAR 派生的记录走得通既有导入管线」，不证明端点已经接上，也不证明界面能看到。

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mock-har-fixture-'))
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
const { readHarText, parseHarEntries, mapHarEntries } = await import('@main/service/mock.har')
const { detectMatchWarnings } = await import('@main/service/mock.conflict')
const { MOCK_PACK_FORMAT, MOCK_PACK_VERSION } = await import('@shared/mock.pack')
const { makeMatch, makeRecord } = await import('../unit/fixtures')

const HAR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/har')
// 与 test/fixtures/mock-pack/v1.json 钉在同一刻：编排里出现 Date.now() 造的值，断言就会跟着漂
const EXPORTED_AT = Date.parse('2026-11-15T02:30:00Z')

interface HarPack {
  doc: any
  parsed: any
  mapped: any
  packText: string
}

/** 一份 HAR 信封（对象形态）→ 映射结果 → 可直接喂给既有导入链路的规则包文本 */
function packFromHar(doc: unknown, options?: { includeStatic?: boolean, sceneName?: string }): HarPack {
  const text = JSON.stringify(doc)
  const parsedHar = readHarText(text, Buffer.byteLength(text))
  const parsed = parseHarEntries(parsedHar.entries)
  const mapped = mapHarEntries(parsed.entries, { analyzedAt: EXPORTED_AT, ...options })
  const pack = {
    format: MOCK_PACK_FORMAT,
    version: MOCK_PACK_VERSION,
    appVersion: '1.0.6',
    exportedAt: EXPORTED_AT,
    rules: [{ name: options?.sceneName ?? 'HAR 演示', records: mapped.records.map((it: any) => it.record) }],
  }
  return { doc: parsedHar, parsed, mapped, packText: JSON.stringify(pack) }
}

function harToPack(name: string, options?: { includeStatic?: boolean, sceneName?: string }): HarPack {
  const text = readFileSync(path.join(HAR_DIR, name), 'utf8')
  return packFromHar(JSON.parse(text), options)
}

/** 手造 entry 用的最小信封：只给映射层真读的那几个字段，其余留空正是「真实形态缺字段」那一档 */
function harEntry(url: string, body: unknown) {
  const text = JSON.stringify(body)
  return {
    request: { method: 'GET', url, headers: [{ name: 'accept', value: 'application/json' }] },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [{ name: 'content-type', value: 'application/json' }],
      content: { size: text.length, mimeType: 'application/json', text },
    },
  }
}

const repo = new MockRepo() as any
await repo.init()

const cacheOf = () => {
  const cache = new MockCache() as any
  cache.mockRepo = repo
  cache.init()
  return cache
}

async function recordsOf(ruleId: string): Promise<any[]> {
  const items: any[] = []
  await repo.iterateRecords(ruleId, (record: any) => { items.push(record) })
  return items
}

/** 按名字在库里找出导入的那条记录，然后启用它——启用走的是编辑器同一条 saveRecord */
async function enable(ruleId: string, name: string): Promise<any> {
  const record = (await recordsOf(ruleId)).find(it => it.name === name)
  assert.ok(record, `库里没有「${name}」这条记录`)
  return repo.saveRecord({ ...record, match: { ...record.match, enabled: true } })
}

function request(url: string, method = 'GET') {
  return { method, url, headers: {} }
}

describe('HAR 三条样本：没录到响应的 entry 跳过、原因可见（AC-R4-06）', () => {
  it('三条里一条 status=0 → 两条进包，跳过那条报 harNoResponse 且带文件下标', () => {
    const { doc, parsed, mapped } = harToPack('three-entries.har')
    assert.equal(doc.entries.length, 3)
    assert.deepEqual(parsed.skipped, [{ entryIndex: 2, reason: 'harNoResponse', detail: 'status=0' }])
    assert.equal(mapped.records.length, 2, '导入 2 条')
    assert.deepEqual(mapped.skipped, [], '这一道没有新拒的条目：跳过全在解析层那一步，两层各自数各自的')
    // 下标讲的是文件里的 entry 下标，用户拿它能对回 HAR 那一行
    assert.deepEqual(mapped.records.map((it: any) => it.entryIndex), [0, 1])
  })

  it('两条都落库、都没被自动启用，缺 name 走 notes 而不是这里编一个', async () => {
    const { packText, mapped } = harToPack('three-entries.har', { sceneName: 'HAR 三条' })
    assert.ok(mapped.records.every((it: any) => it.record.name === undefined),
      '映射层不编名字，名字交给 R4C-12 的默认值通道')

    const preview = await previewMockPack(repo, packText, { mode: 'new' } as any)
    assert.deepEqual([preview.kind, preview.ruleCount, preview.recordCount, preview.invalidCount], ['pack', 1, 2, 0])
    assert.deepEqual(preview.issues, [], '两条都该过阶段二闸门')
    assert.ok(preview.notes.some((it: any) => it.code === 'packFieldDefaulted'),
      '包里没写 name/id 属「按默认值补齐」，要从 notes 里数得出来，不能静默')

    const result = await importMockPack(repo, packText, { mode: 'new' } as any)
    assert.deepEqual([result.ruleIds.length, result.created.length], [1, 2])
    assert.deepEqual([result.updated.length, result.skipped.length, result.failed.length, result.invalid.length], [0, 0, 0, 0])
    assert.equal(result.enabled, false, '导入结果页要能显式说出「已导入但未启用」')

    const all = await recordsOf(result.ruleIds[0])
    assert.deepEqual(all.map((it: any) => it.url).sort(), [
      'https://api.demo.com/v1/orders/SO20261116001',
      'https://api.demo.com/v1/orders/SO20261116001/items',
    ], 'host 只活在 source/url 那一侧，映射层没把它丢掉，丢的是匹配条件里的 host')
    assert.ok(all.every((it: any) => it.match.enabled === false), '风险表 RK6：导入不许劫持真实请求')
    assert.ok(all.every((it: any) => it.match.derivation.source === 'import'))
    // 默认名回落的是 url（`mock.docs.ts` 的 recordFieldsOf），不是这里另起一句「HAR 导入 N」
    assert.deepEqual(all.map((it: any) => it.name).sort(), all.map((it: any) => it.url).sort())
  })
})

describe('HAR 正文与静态资源开关进库（AC-R4-07）', () => {
  it('默认开关下十一份 entry 收成八条：图与 js 逐条跳过并各报一种原因', () => {
    const { doc, parsed, mapped } = harToPack('chrome-shop.har')
    assert.equal(doc.entries.length, 11)
    assert.equal(parsed.skipped.length, 1, '解析层只拒那条没录到响应的 SSE')
    assert.deepEqual(mapped.skipped, [
      { entryIndex: 8, reason: 'harStaticResource', detail: 'kind=js mimeType=application/javascript; charset=utf-8' },
      { entryIndex: 9, reason: 'harStaticResource', detail: 'kind=image mimeType=image/png' },
    ], '跳过明细按文件下标升序，展示层不必再排一次')
    assert.equal(mapped.records.length, 8)
  })

  it('开关打开后 js 那条仍进不了库：类型判成二进制却没有 base64 标记（已知缺口，非本批引入）', () => {
    const { mapped } = harToPack('chrome-shop.har', { includeStatic: true })
    assert.deepEqual(mapped.skipped, [
      { entryIndex: 8, reason: 'harBodyUnreadable', detail: 'encoding=(missing) mimeType=application/javascript; charset=utf-8' },
    ])
    assert.equal(mapped.records.length, 9, '九条 = 十一条 - 一条无响应 - 一条 js')
    // 这条缺口记在案：`inferBodyType`（mock.validation.ts）认 application/javascript 是 binary，
    // 而浏览器 HAR 里的 js 正文是按文本写的，于是 bodyOf 判「读不出」。改法属 R4 的待裁决清单（`text` 档），
    // 本批只把它钉成现状，不让它悄悄变成默认。
  })

  it('base64 正文进库仍是 binary/base64，解出来是原字节', async () => {
    const { packText, mapped } = harToPack('chrome-shop.har', { includeStatic: true, sceneName: 'HAR 商城' })
    assert.equal(mapped.records.length, 9)
    const preview = await previewMockPack(repo, packText, { mode: 'new' } as any)
    const result = await importMockPack(repo, packText, { mode: 'new' } as any)

    // 九条里同一笔订单在两个域名下各录一次（切了 CDN/结算域的那种真实档案最常这样）：host 一丢就成了同指纹，
    // 写入按包内顺序留第一条、第二条报 matchDuplicate。预览的 conflictCount 在这一档数是 0——
    // 它只跟目标场景比，新建模式压根没有目标场景 ⇒ 界面那句「将导入 9 条」在这里比实际多 1（待裁决，见变更记录）。
    assert.deepEqual([preview.conflictCount, preview.recordCount], [0, 9])
    assert.deepEqual([result.created.length, result.skipped.length], [8, 1])
    assert.deepEqual([result.skipped[0].reason, result.skipped[0].ruleIndex, result.skipped[0].recordIndex],
      ['matchDuplicate', 0, 3], '跳过明细带包内坐标，用户能指回档案里那一行')

    const all = await recordsOf(result.ruleIds[0])
    assert.equal(all.length, 8)
    const dup = all.find((it: any) => it.url === 'https://api.demo.com/v1/orders/SO20261115001')
    assert.equal(dup.response.body, mapped.records.find((it: any) => it.entryIndex === 2).record.response.body,
      '留下的是包内在前的那一条：同一 URL 录两次时后一份正文进不了库，这一点要在用例里说死')

    const pdf = all.find((it: any) => it.url.endsWith('/v1/report/monthly.pdf'))
    assert.deepEqual([pdf.response.bodyType, pdf.response.bodyEncoding], ['binary', 'base64'])
    assert.equal(Buffer.from(pdf.response.body, 'base64').subarray(0, 5).toString(), '%PDF-',
      '库里存的那串 base64 必须真解得回 PDF 头，否则「Binary 类型正确展示」只是标签对了')

    const png = all.find((it: any) => it.url.endsWith('/logo.png'))
    assert.deepEqual([png.response.bodyType, png.response.bodyEncoding], ['binary', 'base64'])
    assert.equal(Buffer.from(png.response.body, 'base64').subarray(0, 4).toString('hex'), '89504e47')

    const xml = all.find((it: any) => it.url.endsWith('/v1/invoice/SO20261115001.xml'))
    assert.deepEqual([xml.response.bodyType, xml.response.bodyEncoding], ['xml', undefined],
      '文本档不该被顺手补上 bodyEncoding，导出侧那把尺会跟着误判')
    assert.match(xml.response.body, /^<\?xml version="1\.0"/)
  })

  it('这一档预览数不出「将导入几条」：包内自撞只在写入那一步才现形', async () => {
    const { packText } = harToPack('chrome-shop.har', { includeStatic: true, sceneName: 'HAR 预览对账' })
    const preview = await previewMockPack(repo, packText, { mode: 'new' } as any)
    const result = await importMockPack(repo, packText, { mode: 'new' } as any)

    // 「将导入 N 条」的口径是 recordCount - invalidCount（R4C-13 定下），而包内同指纹自撞既不算 invalid
    // 也不进 conflicts——冲突只跟目标场景比，新建模式压根没有目标场景 ⇒ 预览说 9、实际写 8。
    // 同一个包第二次合并导入时这条自撞才看得见（库里已有第一条），所以偏大的只有新建档。
    // 这条差额是 AC 映射跑出来的读数，不是本批引入的行为；要不要在预览里补一个「包内自撞 N 条」列待裁决。
    assert.deepEqual([preview.recordCount - preview.invalidCount, result.created.length, result.skipped.length], [9, 8, 1])
    assert.equal(preview.conflictCount, 0, '预览看不见包内自撞，这一句就是把「看不见」钉成读数')
  })
})

describe('HAR 派生记录导入即生效（AC-R4-11 的 HAR 半边）', () => {
  it('启用之后真实请求命中，响应体就是包里那份文本', async () => {
    const { packText } = harToPack('three-entries.har', { sceneName: 'HAR 生效' })
    const result = await importMockPack(repo, packText, { mode: 'new' } as any)
    const ruleId = result.ruleIds[0]

    const url = 'https://api.demo.com/v1/orders/SO20261116001'
    const before = cacheOf()
    assert.equal((await before.match(ruleId, request(url))).matched, false, '没启用之前一条都不许命中')

    // 两条都启用之后再建缓存：增量事件那条路径由 pack-import-cache.test.ts 专门钉，
    // 这里要断的是「HAR 派生的条件进库后还认不认得原请求」，不该跟事件派发时机抢顺序
    await enable(ruleId, url)
    await enable(ruleId, `${url}/items`)
    const cache = cacheOf()

    const hit = await cache.match(ruleId, request(url))
    assert.equal(hit.matched, true, 'HAR 派生的 exact path 条件进库后必须还认得原请求')
    const response = await cache.getRecordForResponse(ruleId, hit.recordId)
    assert.deepEqual([response.response.statusCode, response.response.bodyType], [200, 'json'])
    assert.equal(JSON.parse(response.response.body).data.orderNo, 'SO20261116001')

    const list = await cache.match(ruleId, request(`${url}/items`))
    assert.equal(list.matched, true, '第二条（子路径）不能被第一条 exact 盖住')
    const listRecord = await cache.getRecordForResponse(ruleId, list.recordId)
    assert.deepEqual(JSON.parse(listRecord.response.body).data, [{ sku: 'SKU-1001', count: 1 }], '第二条的正文原样落库')
  })
})

describe('HAR 不区分域名与遮蔽可见（AC-R4-13 / Q2 的代价）', () => {
  const twoHosts = () => packFromHar({
    log: {
      version: '1.2',
      creator: { name: 'Web Inspector', version: '537.36' },
      entries: [
        harEntry('https://api-a.demo.com/v1/orders?page=1', { code: 0, data: { from: 'A' } }),
        harEntry('https://api-b.demo.com/v1/orders?page=1', { code: 0, data: { from: 'B' } }),
      ],
    },
  }, { sceneName: 'HAR 双域名' })

  it('同 path 不同 host 两条派生条件逐字段相同、host 是空串，域名只留在 url 一侧', () => {
    const { mapped } = twoHosts()
    const [a, b] = mapped.records.map((it: any) => it.record)
    assert.deepEqual([a.match.host, b.match.host], ['', ''], 'Q2 裁决：HAR 派生的记录不带 host 条件')
    assert.deepEqual(a.match, b.match, '两条的匹配条件一字不差——这正是「看不出域名」的形式')
    assert.notEqual(a.source.url, b.source.url,
      '域名只在 url/录制来源那一侧留着，展示上还分得出两条')
  })

  it('两条只差 host 的 entry 在库里折成一条，留下那条在两个域名下都命中', async () => {
    const { packText } = twoHosts()
    const result = await importMockPack(repo, packText, { mode: 'new' } as any)
    const ruleId = result.ruleIds[0]

    // Q2 的代价在这里比「互相遮蔽」更硬：host 是指纹的一个组成位，而 HAR 派生时它就是空串，
    // 于是两个域名的 entry 算出同一个指纹，第二条直接写不进去。
    // 库里那条是包内顺序在前的 api-a，api-b 那份正文压根没落库——界面要给用户这句解释。
    assert.deepEqual([result.created.length, result.skipped.length, result.skipped[0].reason], [1, 1, 'matchDuplicate'])
    const all = await recordsOf(ruleId)
    assert.equal(all.length, 1)
    assert.equal(all[0].source.url.includes('api-a'), true)

    await enable(ruleId, all[0].name)
    const cache = cacheOf()
    for (const host of ['api-a', 'api-b']) {
      const hit = await cache.match(ruleId, request(`https://${host}.demo.com/v1/orders?page=1`))
      assert.equal(hit.matched, true, `${host} 下的请求必须命中：host 压根不在条件里`)
      assert.equal(hit.recordId, all[0].id)
    }
    const served = await cache.getRecordForResponse(ruleId, all[0].id)
    assert.equal(JSON.parse(served.response.body).data.from, 'A',
      '问 api-b 拿回的是 api-a 那一份：另一家那份正文在库里没有')
  })

  it('遮蔽要看得见得有两条：宽口径盖住 HAR 那条时报 shadowed，条数只有冲突扫描给得出', async () => {
    const ruleId = await repo.save({ name: '已有宽口径', desc: '' } as any)
    const broad = makeRecord({
      ruleId, name: '整段前缀兜底', url: 'https://api.demo.com/v1',
      match: makeMatch({ path: '/v1', pathType: 'prefix' }),
    })
    broad.id = null
    await repo.saveRecord(broad)

    const { packText } = twoHosts()
    const result = await importMockPack(repo, packText, { mode: 'merge', targetRuleId: ruleId, conflict: 'skip' } as any)
    assert.deepEqual([result.created.length, result.skipped.length], [1, 1], '合并进已有场景：包内自撞那条照旧写不进来')
    assert.equal(result.shadowedCount, undefined,
      '契约里那格「与既有规则构成遮蔽的条数」还没有人填（接线属 R4C-35），今天只有下面这条扫描给得出数')

    const disabled = await recordsOf(ruleId)
    assert.deepEqual(detectMatchWarnings(disabled), [],
      '导入的记录一律停用，而 `detectMatchWarnings` 只看启用档 ⇒ 这一步遮蔽不可见，与「不自动劫持」是同一件事的两面')

    for (const it of disabled) await repo.saveRecord({ ...it, match: { ...it.match, enabled: true } })
    const enabled = await recordsOf(ruleId)
    const warnings = detectMatchWarnings(enabled)
    assert.equal(warnings.length, 1, '结果页那个「遮蔽 N 条」的 N 就是这么数出来的')
    assert.deepEqual([warnings[0].type, warnings[0].recordId], ['shadowed',
      enabled.find((it: any) => it.match.derivation?.source === 'import').id], '被盖住的必须是 HAR 那条')
    assert.equal(warnings[0].coveredBy, enabled.find((it: any) => it.name === '整段前缀兜底').id,
      '要点名被谁盖住，用户才知道该禁用哪一条')
  })
})
