import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { registerHooks } from 'node:module'
import { after, describe, it } from 'node:test'
import express from 'express'
import { BizCode } from '@shared/base.models'
import { MockError } from '@shared/mock.errors'
import {
  MOCK_PACK_FORMAT, MOCK_PACK_MAX_FILE_BYTES, MOCK_PACK_MAX_RECORDS, MOCK_PACK_VERSION,
  readMockPackText,
} from '@shared/mock.pack'
import { makeMatch } from './fixtures'

// 路由链上的 electron 只用到 app.getPath / app.getVersion，base.api 顶层 import vant 只为报错提示：
// 与 form-file.test.ts、pack-web-export.test.ts 同一套替身，才能在 Node 里挂真实由。
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
const { MockPackService, readMockPack } = await import('@main/service/mock.pack.service')
const { API_URL } = await import('@shared/api.const')

/**
 * 阶段一的样例记录：只保证顶层是个对象。它故意过不了阶段二（没 match、状态码字段名不对），
 * 因为包级闸门压根不看字段——条目级用例见 pack-records.test.ts，需要好记录的在这里用 `validRecordAt`。
 */
function recordAt(i: number) {
  return { id: `rec_${i}`, name: `记录 ${i}`, response: { status: 200, body: '{}' } }
}

/** 两阶段都过得了的记录：包不带 url，所以 match 必须是完整形态（`makeMatch` 给的就是库内那个形状） */
function validRecordAt(i: number) {
  return {
    id: `rec_${i}`, name: `记录 ${i}`, match: makeMatch({ path: `/v1/orders/${i}` }),
    response: { statusCode: 200, headers: {}, body: '{}', bodyType: 'json', delayMs: 0 },
  }
}

function ruleWith(count: number, offset = 0) {
  return {
    id: 'rule_1', name: '订单中心',
    records: Array.from({ length: count }, (_unused, i) => recordAt(offset + i))
  }
}

function packText(rules: unknown[]) {
  return JSON.stringify({ format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION, exportedAt: 1, rules })
}

/** 断言「抛的是哪个包级错误码」：只断言抛出不足以钉住错误码，也不足以钉住它没被别的码冒充 */
function expectPackCode(code: string, run: () => unknown, label: string) {
  let thrown: unknown
  try {
    run()
  } catch (err) {
    thrown = err
  }
  assert.ok(thrown instanceof MockError, `${label}：期望抛 MockError，实际 ${String(thrown)}`)
  assert.equal((thrown as MockError).code, code, `${label}：错误码不对，detail=${String((thrown as MockError).detail)}`)
  assert.ok(typeof (thrown as MockError).detail === 'string' && (thrown as MockError).detail.length > 0,
    `${label}：包级失败要留可排查的 detail，不能只给一个码`)
}

describe('R4C-10 包级校验：format / version / 体积 / 总条数 / 空包', () => {
  it('合法包原样交出对象图，不补默认值也不改字节', () => {
    const text = packText([ruleWith(2)])
    const pack = readMockPackText(text, Buffer.byteLength(text, 'utf8'))
    assert.equal(pack.format, MOCK_PACK_FORMAT)
    assert.equal(pack.rules.length, 1)
    assert.equal(pack.rules[0].records.length, 2)
    // 归一化（重算指纹、enabled 置 false）是 R4C-12：这一层若顺手补默认值，阶段二就分不清「包里没有」和「我填的」
    assert.equal(pack.rules[0].records[0].match, undefined)
  })

  it('不是对象、format 不符、rules 缺失都算「不是本程序的包」', () => {
    for (const [label, value] of [
      ['数组', []],
      ['字符串', 'hello'],
      ['null', null],
      ['缺 format', { version: 1, rules: [ruleWith(1)] }],
      ['format 是别的', { format: 'har', version: 1, rules: [ruleWith(1)] }],
      ['缺 rules', { format: MOCK_PACK_FORMAT, version: 1 }],
      ['rules 不是数组', { format: MOCK_PACK_FORMAT, version: 1, rules: {} }],
    ] as Array<[string, unknown]>) {
      expectPackCode('packFormatUnknown', () => readMockPackText(JSON.stringify(value), 10), label)
    }
  })

  it('JSON 解析不过同样是 packFormatUnknown，不是抛原始 SyntaxError', () => {
    expectPackCode('packFormatUnknown', () => readMockPackText('{"format": "appapi-mock-pack"', 30), '截断的 json')
    expectPackCode('packFormatUnknown', () => readMockPackText('name: order', 12), 'yaml 混进来的')
  })

  it('版本只认 pack.version：高于当前支持值才拒，appVersion 再高也不影响', () => {
    const newer = JSON.stringify({
      format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION + 1, appVersion: '99.0.0', rules: [ruleWith(1)]
    })
    expectPackCode('packVersionUnsupported', () => readMockPackText(newer, 60), `version=${MOCK_PACK_VERSION + 1}`)

    // 反向：包是旧程序导出的（appVersion 低）或压根没写 appVersion，都照常放行
    for (const appVersion of ['0.1.0', undefined]) {
      const pack = readMockPackText(JSON.stringify({
        format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION, appVersion, rules: [ruleWith(1)]
      }), 60)
      assert.equal(pack.rules[0].records.length, 1, `appVersion=${String(appVersion)} 不该参与兼容性判断`)
    }

    // version 缺失/非整数/小于 1 属「这不是我们的包」：给 packVersionUnsupported 会让用户去升级一个并不存在的旧版本
    for (const [label, version] of [['缺失', undefined], ['字符串', '1'], ['小数', 1.5], ['零', 0], ['负数', -1]] as Array<[string, unknown]>) {
      expectPackCode('packFormatUnknown', () => readMockPackText(
        JSON.stringify({ format: MOCK_PACK_FORMAT, version, rules: [ruleWith(1)] }), 60), `version=${label}`)
    }
  })

  it('体积按字节判，且排在解析之前', () => {
    const ok = packText([ruleWith(1)])
    // 恰好等于上限放行：上限与 express body parser 同值，再大就只多 1MB 余量进到服务端（base.router 注释同口径）
    assert.equal(readMockPackText(ok, MOCK_PACK_MAX_FILE_BYTES).rules.length, 1)
    expectPackCode('packTooLarge', () => readMockPackText(ok, MOCK_PACK_MAX_FILE_BYTES + 1), '超 1 字节')
    // 顺序也钉住：超限的非法 JSON 拿到的是 packTooLarge，不是先解析一遍再拒
    expectPackCode('packTooLarge', () => readMockPackText('{ not json', MOCK_PACK_MAX_FILE_BYTES + 1), '超限且坏 json')
    // 真发一份 50MB+1 的包不适合放进单测：传输层上限是 51MB，越界文件在 multipart 就被切断，
    // 所以这一档只能在字节数入参上验，渲染层的 file.size 预检由 pack-file.test.ts 守。
  })

  it('空文件、只带普通字段、空白文本都是 packEmpty', () => {
    for (const [label, text] of [
      ['0 字节', ''],
      ['只有空白', '  \r\n\t '],
      // 没有文件部分时 fetchFormFileText 回 undefined，端点照样要给人话
      ['没有文件部分', undefined],
    ] as Array<[string, string | undefined]>) {
      expectPackCode('packEmpty', () => readMockPackText(text, 0), label)
    }
    expectPackCode('packEmpty', () => readMockPackText('{"format":"appapi-mock-pack","version":1,"rules":[]}', 50), '没有场景')
    expectPackCode('packEmpty', () => readMockPackText(packText([ruleWith(0), ruleWith(0)]), 80), '场景全空')
    // 空场景的包是 R4C-06 刻意留下的（要能区分「这个场景是空的」和「这个场景没导出」），导入侧才给出这句原因
    assert.ok(packText([ruleWith(0)]).includes('"records":[]'))
  })

  it('总条数跨场景累加，超过 5000 整包拒绝', () => {
    const atLimit = packText([ruleWith(MOCK_PACK_MAX_RECORDS - 1, 0), ruleWith(1, 999)])
    assert.equal(readMockPackText(atLimit, atLimit.length).rules.length, 2, '恰好等于上限该放行')

    const overByOne = packText([ruleWith(MOCK_PACK_MAX_RECORDS, 0), ruleWith(1, 999)])
    expectPackCode('packRecordLimit', () => readMockPackText(overByOne, overByOne.length), '5001 条')

    // 单场景都不超、合起来超：只按每个 rules[i].records.length 判的写法会从这里漏过去
    const eachHalf = packText([ruleWith(2501, 0), ruleWith(2501, 9000)])
    expectPackCode('packRecordLimit', () => readMockPackText(eachHalf, eachHalf.length), '两个 2501 条')
  })

  it('结构坏在哪一处就写进 detail，排查不用重跑一遍包', () => {
    const broken = JSON.stringify({
      format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION,
      rules: [ruleWith(1), { name: '缺 records', records: 'none' }]
    })
    let detail = ''
    try {
      readMockPackText(broken, broken.length)
    } catch (err) {
      detail = (err as MockError).detail
    }
    assert.match(detail, /rules\[1]\.records/, `detail 里要点明坏的下标，实际是 ${detail}`)
  })

  it('字节数走 Buffer.byteLength：中文包不按字符数算', () => {
    const text = packText([ruleWith(1)]).replace('订单中心', '订单中心中中中')
    assert.ok(Buffer.byteLength(text, 'utf8') > text.length, '这份样例本身要能体现字节 > 字符')
    const sizes: Array<[unknown, unknown]> = []
    const original = Buffer.byteLength
    ;(Buffer as any).byteLength = (input: unknown, encoding: unknown) => {
      sizes.push([input, encoding])
      return (original as any).call(Buffer, input, encoding)
    }
    try {
      assert.equal(readMockPack(text).pack.rules.length, 1)
    } finally {
      ;(Buffer as any).byteLength = original
    }
    assert.deepEqual(sizes, [[text, 'utf8']], 'readMockPack 没有把文本交给 byteLength 算字节')
  })
})

describe('两阶段校验的端点接线：拒绝即零写入', () => {
  // readPack 现在压根没有仓库依赖，这条断言钉的是将来：别为了「总条数」去查库，
  // 一旦阶段一读了库，坏包就可能已经带着一次遍历落进写库分支。
  const newFakeRepo = () => {
    const calls: string[] = []
    return {
      calls,
      listRules: async () => { calls.push('listRules'); return [] },
      getRule: async () => { calls.push('getRule'); return null },
      countRecords: async () => { calls.push('countRecords'); return 0 },
      iterateRecords: async () => { calls.push('iterateRecords') },
    }
  }

  it('校验失败与校验通过都不碰仓库', () => {
    const repo = newFakeRepo()
    const service = new MockPackService()
    ;(service as any).mockRepo = repo

    expectPackCode('packFormatUnknown', () => service.readPack('not json at all'), '路由外的坏包')
    assert.deepEqual(repo.calls, [], '包级校验读了库，就不能再说「零写入」')
    assert.equal(service.readPack(packText([ruleWith(1)])).pack.rules.length, 1)
    assert.deepEqual(repo.calls, [], '阶段一整个都不该出现库原语')
  })

  it('服务侧一次读取串两阶段：包级抛、条目级进 issues', () => {
    const repo = newFakeRepo()
    const service = new MockPackService()
    ;(service as any).mockRepo = repo

    const read = service.readPack(packText([{ ...ruleWith(0), records: [validRecordAt(0), recordAt(1)] }]))
    assert.equal(read.pack.rules.length, 1)
    assert.equal(read.valid.length, 1, '好记录要带着坐标交给下一阶段')
    assert.equal(read.valid[0].recordIndex, 0)
    assert.equal(read.invalidCount, 1)
    assert.equal(read.issues[0].code, 'matchMissing', `明细要能指出为什么跳，实际 ${JSON.stringify(read.issues)}`)
    assert.deepEqual(repo.calls, [], '条目级失败同样不该出现库原语')
  })

  // 真实由 + 真实 multipart 通道：坏包拿到的是错误码，不是一个「成功的空结果」
  const router = new AppMockRouter()
  const repo = newFakeRepo()
  const service = new MockPackService()
  ;(service as any).mockRepo = repo
  ;(router as any).mockPackService = service

  const app = express()
  app.use(router.router)
  const server = app.listen(0)
  after(() => new Promise<void>(resolve => server.close(() => resolve())))

  async function uploadPack(pathname: string, text?: string) {
    const boundary = '----AppApiProxyPackValidateProbe'
    const body = text === undefined
      // 只带普通字段、不带文件部分：渲染层「没选到文件」时就是这个形状
      ? `--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\nnew\r\n--${boundary}--\r\n`
      : `--${boundary}\r\nContent-Disposition: form-data; name="pack"; filename="rules.json"\r\n`
        + `Content-Type: application/json\r\n\r\n${text}\r\n--${boundary}--\r\n`
    const address = server.address() as AddressInfo
    const res = await fetch(`http://127.0.0.1:${address.port}${pathname}?mode=new`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  // 过了闸门之后两个端点各自回什么样的桩：这里钉的是「当前还没实现到哪」，
  // R4C-13 填预览统计、R4C-14 填写入时，这两条断言会同时变红，改的人就看得见自己动了哪个桩。
  const stubShapes: Record<string, (data: any) => void> = {
    [API_URL.PREVIEW_MOCK_PACK]: (data) => {
      assert.equal(data.ruleCount, 0, 'R4C-13 之前预览统计还没实现，这里不能假装已有')
      assert.equal(data.recordCount, 0)
    },
    [API_URL.IMPORT_MOCK_PACK]: (data) => {
      assert.deepEqual(data.created, [], 'R4C-14 之前不写库')
      assert.equal(data.enabled, false)
    },
  }

  for (const pathname of [API_URL.PREVIEW_MOCK_PACK, API_URL.IMPORT_MOCK_PACK]) {
    it(`${pathname}：坏包以包级错误码拒绝，且不产生任何库调用`, async () => {
      const cases: Array<[string, unknown, string]> = [
        ['不是 json', '{ oops', 'packFormatUnknown'],
        ['版本更高', { format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION + 1, rules: [ruleWith(1)] }, 'packVersionUnsupported'],
        ['没有条目', { format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION, rules: [ruleWith(0)] }, 'packEmpty'],
        ['条数超限', { format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION, rules: [ruleWith(MOCK_PACK_MAX_RECORDS + 1)] }, 'packRecordLimit'],
        ['没带文件', undefined, 'packEmpty'],
      ]
      for (const [label, value, code] of cases) {
        const { status, body } = await uploadPack(pathname, value === undefined ? undefined : JSON.stringify(value))
        // 全仓约定：异常也回 HTTP 200 + BizCode.ERROR，靠 errorCode 分诊
        assert.equal(status, 200, label)
        assert.equal(body.code, BizCode.ERROR, `${label} 应当是错误回包`)
        assert.equal(body.errorCode, code, `${label} 的错误码不对：${JSON.stringify(body)}`)
        assert.equal(body.data, undefined, `${label} 不能既报错又带回半截结果`)
      }
      assert.deepEqual(repo.calls, [], `${pathname} 在包级拒绝路径上读了库`)
    })

    it(`${pathname}：过了两阶段闸门仍回空结果桩（明细回传与写库未接线）`, async () => {
      const { body } = await uploadPack(pathname, packText([{ ...ruleWith(0), records: [validRecordAt(0)] }]))
      assert.equal(body.code, BizCode.SUCCESS)
      stubShapes[pathname](body.data)
      assert.deepEqual(repo.calls, [], `${pathname} 在桩阶段不碰仓库`)
    })

    // 条目级失败是「数据」不是「错误码」：一条坏记录不该让整个请求变成 BizCode.ERROR（PRD 4.4.7）。
    // R4C-13 若把明细实现成抛错，这条会先红。
    it(`${pathname}：好坏混包仍回成功——条目级不过只跳那一条`, async () => {
      const { body } = await uploadPack(pathname, packText([
        { id: 'rule_1', name: '订单中心', records: [validRecordAt(0), recordAt(1), null] }
      ]))
      assert.equal(body.code, BizCode.SUCCESS, `坏条目把整包带崩了：${JSON.stringify(body)}`)
      stubShapes[pathname](body.data)
      assert.deepEqual(repo.calls, [], '条目级失败也不该产生库调用')
    })
  }

  it('IMPORT_HAR 不吃规则包的包级闸门：一份合法包文本走 HAR 端点仍回桩结果', async () => {
    const { body } = await uploadPack(API_URL.IMPORT_HAR, packText([ruleWith(1)]))
    assert.equal(body.code, BizCode.SUCCESS)
    assert.deepEqual(body.data.suggestions, [])
    assert.deepEqual(repo.calls, [])
  })
})
