import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { registerHooks } from 'node:module'
import { after, beforeEach, describe, it } from 'node:test'
import express from 'express'
import { BizCode } from '@shared/base.models'
import { ProxyMock } from '@shared/proxy.models'
import { MOCK_HAR_MAX_ENTRIES } from '@shared/mock.pack'

// 与 pack-validate.test.ts 同一套替身：路由链上的 electron 只用到 app.getPath / app.getVersion，
// base.api 顶层 import vant 只为报错提示，替身到位才能在裸 Node 里挂真实由。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>process.env.TMPDIR||"/tmp",getVersion:()=>"0.0.0"};export const BrowserWindow={getFocusedWindow:()=>undefined}',
        shortCircuit: true,
      }
    }
    if (specifier === 'vant') {
      return { url: 'data:text/javascript,export const showNotify=()=>{}', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { AppMockRouter } = await import('@main/router/appmock.router')
const { MockPackService, buildMockPackFromHar } = await import('@main/service/mock.pack.service')
const { fingerprintOf } = await import('@main/repository/mock.docs')
const { API_URL } = await import('@shared/api.const')

/**
 * 写库那一步用替身：本文件验的是「端点把什么交给了谁、参数有没有真的通到判定」，
 * 不仿真仓库的批语义（查重、真命中那些在 test/migration/har-fixture-import.test.ts 里量）。
 */
function newFakeRepo() {
  const calls: string[] = []
  const rules: Array<{ _id: string, name: string }> = []
  const written: Array<{ ruleId: string, records: ProxyMock.MockRecord[] }> = []
  const summaries: Array<Record<string, any>> = []
  let seq = 0
  const repo: any = {
    calls, rules, written, summaries,
    listRules: async () => { calls.push('listRules'); return rules },
    getRule: async (ruleId: string) => {
      calls.push('getRule')
      return rules.find(it => it._id === ruleId) ?? null
    },
    countRecords: async () => { calls.push('countRecords'); return summaries.length },
    iterateRecords: async () => { calls.push('iterateRecords') },
    listRecordSummaries: async () => { calls.push('listRecordSummaries'); return summaries },
    save: async (rule: ProxyMock.MockRule) => {
      calls.push('save')
      const _id = `rule_${++seq}`
      rules.push({ _id, name: rule.name })
      return _id
    },
    delete: async (ruleId: string) => {
      calls.push('delete')
      const index = rules.findIndex(it => it._id === ruleId)
      if (index >= 0) rules.splice(index, 1)
      const batch = written.findIndex(it => it.ruleId === ruleId)
      if (batch >= 0) written.splice(batch, 1)
      return true
    },
    importRecords: async (ruleId: string, records: ProxyMock.MockRecord[]) => {
      calls.push('importRecords')
      written.push({ ruleId, records })
      return {
        created: records.map((_unused, index) => `${ruleId}_rec_${index}`),
        updated: [], aborted: false,
        outcomes: records.map((_unused, index) => ({ index, status: 'created', id: `${ruleId}_rec_${index}` })),
      }
    },
  }
  return repo as typeof repo & Record<string, any>
}

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

/** 手造 entry 的最小信封：只给映射层真读的那几个字段，其余留空正是「真实形态缺字段」那一档 */
function harEntry(url: string, body: unknown = { ok: true }) {
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

/** 没有录到响应的 entry：真实 Chrome 档案里 SSE / 取消请求就是这个形状（HAR 把 status 记成 0） */
function deadEntry(url: string) {
  return {
    request: { method: 'GET', url, headers: [] },
    response: { status: 0, statusText: '', headers: [], content: { size: 0, mimeType: 'x-unknown' } },
  }
}

function harDoc(entries: unknown[]) {
  return JSON.stringify({ log: { version: '1.2', creator: { name: 'probe', version: '1' }, entries } })
}

const THREE_ENTRIES = harDoc([
  harEntry('https://api.demo.com/v1/orders/SO20261116001', { from: 'A' }),
  harEntry('https://api.demo.com/v1/orders/SO20261116001/items', { from: 'A' }),
  deadEntry('https://api.demo.com/v1/config'),
])

const router = new AppMockRouter()
const repo = newFakeRepo()
const service = new MockPackService()
;(service as any).mockRepo = repo
;(router as any).mockPackService = service

const app = express()
app.use(router.router)
const server = app.listen(0)
after(() => new Promise<void>(resolve => server.close(() => resolve())))

const boundary = '----AppApiProxyHarImportProbe'

/**
 * `asField` 那一档走的是浏览器上传 .har 的真实形态：文件部分不带 Content-Type，
 * formidable 把它当普通字段处理，于是原始文件名压根进不到服务端（`sceneName` 只能是 query）。
 */
async function uploadHar(text: string | undefined, query = '', asField = false) {
  const part = asField
    ? `Content-Disposition: form-data; name="pack"\r\n\r\n${text}\r\n`
    : `Content-Disposition: form-data; name="pack"; filename="session.har"\r\n`
      + `Content-Type: application/json\r\n\r\n${text}\r\n`
  const body = text === undefined
    ? `--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\nnew\r\n--${boundary}--\r\n`
    : `--${boundary}\r\n${part}--${boundary}--\r\n`
  const address = server.address() as AddressInfo
  const res = await fetch(`http://127.0.0.1:${address.port}${API_URL.IMPORT_HAR}${query}`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

/** `calls` / `written` 挂在 describe 级替身上累加，每条用例只判自己这一次请求产生了什么 */
const takeCalls = () => repo.calls.splice(0)
const takeWritten = () => repo.written.splice(0)

// 场景名要能按字面断言，就必须只有本条用例产生的那些库内场景：清空数组而不是换替身，
// 因为 router 持有的那个 service 认的是这个对象引用（换掉就得重新挂线，反而多一处与产品代码不同的地方）。
beforeEach(() => {
  repo.rules.length = 0
  repo.summaries.length = 0
  takeCalls()
  takeWritten()
})

/** 取本次导入新建的那个场景名 */
function nameOfRule(ruleId: string) {
  return repo.rules.find(it => it._id === ruleId)?.name
}

describe('R4C-35 importHar 端点接线：不再是空结果桩（AC-R4-06 端到端）', () => {
  it('三条里一条 status=0：两条写库、跳过那条带着文件下标与原因', async () => {
    const { status, body } = await uploadHar(THREE_ENTRIES, `?mode=new&sceneName=${encodeURIComponent('端到端档')}`)
    assert.equal(status, 200)
    assert.equal(body.code, BizCode.SUCCESS, JSON.stringify(body))
    const result = body.data
    assert.deepEqual([result.ruleIds.length, result.created.length], [1, 2], '导入 2 条')
    assert.deepEqual(result.skipped, [
      { entryIndex: 2, reason: 'harNoResponse', detail: 'status=0' },
    ], '跳过 1 条并展示原因：坐标是文件里的 entry 下标，包内坐标对它们无意义')
    assert.equal(result.enabled, false, '结果页要能显式说出「已导入但未启用」')
    assert.equal(result.mode, 'new')
    assert.equal(nameOfRule(result.ruleIds[0]), '端到端档', '场景名用 query 里传来的文件名，不另起一名')
    assert.deepEqual(takeCalls(), ['listRules', 'save', 'importRecords'])

    const written = takeWritten()
    assert.equal(written[0].records.length, 2)
    assert.ok(written[0].records.every(it => it.match?.enabled === false), '风险表 RK6：导入不许劫持真实请求')
    assert.ok(written[0].records.every(it => it.match?.derivation?.source === 'import'),
      '派生来源标成 import，命中解释与稳定性面板据此分得开录制与导入')
    assert.deepEqual(written[0].records.map(it => it.source?.url), [
      'https://api.demo.com/v1/orders/SO20261116001',
      'https://api.demo.com/v1/orders/SO20261116001/items',
    ], 'host 只活在 source/url 那一侧，匹配条件里的 host 按 Q2 留空')
  })

  it('端点交出去的映射结果与 buildMockPackFromHar 同一份：包文本不是另算的', async () => {
    const built = buildMockPackFromHar(THREE_ENTRIES, { sceneName: '同源核对', analyzedAt: 1 })
    assert.deepEqual(built.skipped, [{ entryIndex: 2, reason: 'harNoResponse', detail: 'status=0' }])
    assert.equal(built.recordCount, JSON.parse(built.packText).rules[0].records.length,
      '条数与包文本出自同一次映射：两处各数一遍就会有一个数说谎')

    const { body } = await uploadHar(THREE_ENTRIES, '?mode=new')
    const written = takeWritten()
    assert.equal(written.length, 1, '端点只调用了一次写库')
    assert.deepEqual(written[0].records.map(it => it.match?.path), [
      '/v1/orders/SO20261116001', '/v1/orders/SO20261116001/items',
    ], 'path 是映射层派生出来的原样，端点这一侧不再加工')
  })

  it('一条都没映射出来时不报 packEmpty：回空结果 + 跳过明细，且不碰任何库原语', async () => {
    const { body } = await uploadHar(harDoc([deadEntry('https://api.demo.com/v1/config')]), '?mode=new')
    assert.equal(body.code, BizCode.SUCCESS, JSON.stringify(body))
    assert.deepEqual([body.data.ruleIds.length, body.data.created.length], [0, 0])
    assert.deepEqual(body.data.skipped, [
      { entryIndex: 0, reason: 'harNoResponse', detail: 'status=0' },
    ], '文件有条目、只是全被跳过：那原因与条数就是这一页要展示的东西')
    assert.deepEqual(takeCalls(), [], '零映射连场景都不该建，否则库里多一个空壳')
  })

  it('不填场景名时回落到中性串 HAR，而不是留一个空名场景', async () => {
    const { body } = await uploadHar(THREE_ENTRIES, '?mode=new')
    assert.equal(body.code, BizCode.SUCCESS, JSON.stringify(body))
    assert.equal(nameOfRule(body.data.ruleIds[0]), 'HAR')
  })

  it('同一份 HAR 导两次：第二个场景名追加 (1)，nameCollided 报出来', async () => {
    const query = `?mode=new&sceneName=${encodeURIComponent('重复导入')}`
    const first = await uploadHar(THREE_ENTRIES, query)
    const second = await uploadHar(THREE_ENTRIES, query)
    assert.equal(first.body.data.nameCollided, false)
    assert.equal(second.body.data.nameCollided, true, 'AC-R4-03 那格改名提示对 HAR 同样成立')
    assert.deepEqual([nameOfRule(first.body.data.ruleIds[0]), nameOfRule(second.body.data.ruleIds[0])],
      ['重复导入', '重复导入(1)'])
  })

  // 桩时代的响应体是 `emptyMockPackImportResult` 拼上 `suggestions: []`；接线之后建议随记录进库
  // （`match.derivation.suggestions`），结果页那一格不再由这里编造一份平行的数。
  it('参数化建议留在记录身上，端点不另开一栏', async () => {
    const { body } = await uploadHar(harDoc([
      harEntry('https://api.demo.com/v1/orders/123456789', { ok: true }),
    ]), '?mode=new')
    const written = takeWritten()
    const suggestion = written[0].records[0].match?.derivation?.suggestions ?? []
    assert.ok(suggestion.some((it: any) => it.reason === 'pathParameterizable'),
      `ID 形态段只给建议：${JSON.stringify(suggestion)}`)
    assert.equal(written[0].records[0].match?.path, '/v1/orders/123456789', '建议不自动应用（§9）')
    assert.equal(body.data.suggestions, undefined, '那一格没有生产者，宁可缺字段也不要端点编一个空数组冒充「已算过」')
  })
})

describe('R4C-35 端点参数：那三项开关真的通到判定', () => {
  /** 页面 HAR 的常态：一张 png 加几条接口。png 判成静态资源靠的是响应类型，不是 URL 后缀 */
  function pngDoc() {
    const entries = [
      harEntry('https://cdn.demo.com/logo.png', Buffer.from('89504e470d0a', 'hex').toString('base64')),
      harEntry('https://api.demo.com/v1/orders/123456789', { ok: true }),
    ]
    const png = entries[0].response
    png.headers = [{ name: 'content-type', value: 'image/png' }]
    png.content.mimeType = 'image/png'
    png.content.encoding = 'base64'
    return harDoc(entries)
  }

  it('includeStatic：默认跳过图片，打开后那条真进候选（端点不接就等于开关永远无效）', async () => {
    const text = pngDoc()

    const off = await uploadHar(text, '?mode=new')
    assert.equal(off.body.code, BizCode.SUCCESS, JSON.stringify(off.body))
    assert.deepEqual(off.body.data.skipped, [
      { entryIndex: 0, reason: 'harStaticResource', detail: 'kind=image mimeType=image/png' },
    ], '默认档：图片逐条跳过并计数')
    assert.equal(takeWritten()[0].records.length, 1)

    // 只有字面 'false' 算关：那是 `toMockPackFlag` 在全仓的单一口径（导出侧 redact 读它，渲染层传布尔、
    // axios 序列化成 'false'）。`'0'` 在这里被当成「开」——记在这儿而不是顺手改它：改这条会连带动到导出那两个开关的语义。
    for (const [query, skippedCount] of [['?mode=new&includeStatic=false', 1], ['?mode=new&includeStatic=0', 0]] as Array<[string, number]>) {
      const { body } = await uploadHar(text, query)
      assert.equal(body.data.skipped.length, skippedCount, `${query}：${skippedCount === 1 ? '显式 false 与缺省同档' : '非 false 的串一律算开'}`)
      takeWritten()
    }

    const on = await uploadHar(text, '?mode=new&includeStatic=true')
    assert.deepEqual(on.body.data.skipped, [], 'includeStatic=true 必须被端点认下来')
    const written = takeWritten()[0].records
    assert.equal(written.length, 2)
    assert.deepEqual(written[0].response?.bodyType, 'binary')
    assert.equal(Buffer.from(String(written[0].response?.body), 'base64').subarray(0, 4).toString('hex'), '89504e47',
      '打开开关后进库的正文仍是原字节，不然那条开关只是把跳过明细换成了坏数据')
  })

  it('sceneName 只能来自 query：文件部分没带 Content-Type 时文件名压根进不到服务端', async () => {
    const { body } = await uploadHar(THREE_ENTRIES, '?mode=new', true)
    assert.equal(body.code, BizCode.SUCCESS, JSON.stringify(body))
    assert.equal(body.data.created.length, 2, 'formidable 把无类型部分当字段，正文仍读得到（R4C-04 那条通道）')
    assert.equal(nameOfRule(body.data.ruleIds[0]), 'HAR',
      '这条路径拿不到 session.har 那个名字，所以要场景名就得自己传 query')
  })

  it('conflict：同一个查询参数在 HAR 链路上同样改判落点', async () => {
    const ruleId = 'rule_seed'
    const mapped = buildMockPackFromHar(THREE_ENTRIES, { sceneName: '库内已有同条件' })
    const existing = JSON.parse(mapped.packText).rules[0].records[0]
    repo.rules.push({ _id: ruleId, name: '既有场景' })
    // 库内那条占住的正是映射结果第一条的指纹：指纹由服务层算，这里只把同一把尺的结果交给替身索引
    repo.summaries.push({
      _id: 'rec_existing', ruleId, name: '既有记录',
      matchFingerprint: fingerprintOf(existing.match), createdAt: 0, updatedAt: 0,
    })

    const skipped = await uploadHar(THREE_ENTRIES, `?mode=merge&targetRuleId=${ruleId}&conflict=skip`)
    assert.equal(skipped.body.code, BizCode.SUCCESS, JSON.stringify(skipped.body))
    assert.deepEqual(skipped.body.data.skipped.map((it: any) => it.reason),
      ['harNoResponse', 'matchDuplicate'], '跳过明细按「先文件、后库」两段拼接')
    assert.deepEqual(skipped.body.data.skipped.map((it: any) => [it.entryIndex, it.recordIndex]),
      [[2, undefined], [undefined, 0]], '两组坐标用的是不同的尺，各自带各自的')
    assert.equal(takeWritten()[0].records.length, 1, '冲突那条压根没交给写库')

    const covered = await uploadHar(THREE_ENTRIES, `?mode=merge&targetRuleId=${ruleId}&conflict=overwrite`)
    assert.deepEqual(covered.body.data.skipped.map((it: any) => it.reason), ['harNoResponse'])
    assert.deepEqual(takeWritten()[0].records.map((it: any) => it.id), ['rec_existing', null],
      '覆盖策略按库内那条的 ID 落点；第二条没有包内 ID，交回仓库分配')
  })

  it('mode 与 targetRuleId：缺省按新建、拼错的显式拒绝、认成合并却没给场景也拒绝', async () => {
    const bad = await uploadHar(THREE_ENTRIES, '?mode=Merge')
    assert.equal(bad.body.errorCode, 'ruleMissing', '大小写照样认（与规则包同一把尺），但合并缺场景必须拒')
    assert.deepEqual(takeCalls(), [], '拒绝发生在写库之前')

    const nonsense = await uploadHar(THREE_ENTRIES, '?mode=append')
    assert.equal(nonsense.body.errorCode, 'packModeUnsupported',
      '认不出来的取值不落回新建：新建是唯一会改库结构的档位')
    assert.deepEqual(takeCalls(), [])
  })
})

// 「拿规则包打 HAR 端点」那条信封互斥不在本文件：`test/unit/pack-validate.test.ts` 手里就有一份合法规则包文本，
// 同一条断言不必有两个主人。
describe('R4C-35 端点失败口径：HAR 侧的拒绝即零写入', () => {
  it('entry 候选数超过上限：整包拒绝、错误码 harEntryLimit、一个字节都不写', async () => {
    const entries = Array.from({ length: MOCK_HAR_MAX_ENTRIES + 1 },
      (_unused, index) => harEntry(`https://api.demo.com/v1/orders/${index}`))
    const { status, body } = await uploadHar(harDoc(entries), '?mode=new')
    assert.equal(status, 200, '全仓约定：业务失败也回 HTTP 200，靠 errorCode 分诊')
    assert.equal(body.code, BizCode.ERROR)
    assert.equal(body.errorCode, 'harEntryLimit')
    assert.match(String(body.detail), new RegExp(`candidates=${MOCK_HAR_MAX_ENTRIES + 1}`),
      'detail 要带「判的是候选数」这个数，否则用户以为上限判在文件条数上')
    assert.equal(body.data, undefined, '不能既报错又带回半截结果')
    assert.deepEqual(takeCalls(), [], '超限的档案不该先建场景再回滚')
  })

  it('没带文件与空文本都回 packEmpty，与规则包同一条口径', async () => {
    for (const [label, text] of [['没带文件部分', undefined], ['空文本', '']] as Array<[string, string | undefined]>) {
      const { body } = await uploadHar(text, '?mode=new')
      assert.equal(body.errorCode, 'packEmpty', `${label}：两种「没有文件」都该停在信封那一步`)
    }
    assert.deepEqual(takeCalls(), [])
  })

  it('空档案（log.entries 为 []）报 packEmpty 而不是零条跳过明细', async () => {
    const { body } = await uploadHar(harDoc([]), '?mode=new')
    assert.equal(body.errorCode, 'packEmpty')
    assert.deepEqual(body.data, undefined, '压根没有条目与「有条目但全被跳过」是两件事，前者没有可展示的原因')
    assert.deepEqual(takeCalls(), [])
  })
})

describe('R4C-35 与规则包共用那一个导入任务槽', () => {
  it('取消信号透传到 HAR 那条链路的写库调用，零写入时新建的场景被回收', async () => {
    const fake = newFakeRepo()
    const local = new MockPackService()
    ;(local as any).mockRepo = fake
    const entered = deferred()
    const released = deferred()
    let signalAtWrite: AbortSignal | undefined
    fake.importRecords = async (ruleId: string, records: ProxyMock.MockRecord[], options: any) => {
      signalAtWrite = options?.signal
      entered.resolve()
      await released.promise
      const aborted = options?.signal?.aborted === true
      return {
        created: [], updated: [], aborted,
        outcomes: records.map((_unused, index) => ({
          index, status: aborted ? 'failed' : 'created', id: null,
          reason: aborted ? 'packWriteAborted' : undefined,
        })),
      }
    }

    const running = local.importHar(THREE_ENTRIES, { mode: 'new', sceneName: '取消档' })
    await entered.promise
    assert.equal(signalAtWrite instanceof AbortSignal, true,
      'HAR 导入也吃那道取消信号：两条入口共用一个任务槽，取消才只有一处判据')
    assert.equal(local.cancelImport(), true, '取消按钮打的是同一个服务，HAR 这边不能没人接')
    released.resolve()
    const result = await running
    assert.equal(result.aborted, true)
    assert.equal(result.failed.length, 2)
    assert.equal(result.skipped.length, 1, '取消不影响 HAR 层已经数出来的那条跳过')
    assert.deepEqual(result.ruleIds, [], '一条都没写进去 ⇒ 那个刚建出来的场景壳回收，不留空壳')
    assert.deepEqual(fake.rules, [])
    assert.equal(local.getImportProgress().running, false, '任务槽在 finally 里交还，HAR 那次也不例外')
  })

  it('规则包导入进行中时再来一份 HAR 直接被拒', async () => {
    const fake = newFakeRepo()
    const local = new MockPackService()
    ;(local as any).mockRepo = fake
    const entered = deferred()
    const released = deferred()
    fake.importRecords = async () => {
      entered.resolve()
      await released.promise
      return { created: [], updated: [], aborted: false, outcomes: [] }
    }
    const packText = buildMockPackFromHar(THREE_ENTRIES, { sceneName: '并发档' }).packText
    const running = local.import(packText, { mode: 'new' })
    await entered.promise
    await assert.rejects(() => local.importHar(THREE_ENTRIES, { mode: 'new' }), /packImportInProgress/)
    released.resolve()
    await running
    assert.equal(local.importTask, null)
  })
})
