import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { describe, it } from 'node:test'
import { MockError } from '@shared/mock.errors'
import type { MockErrorCode } from '@shared/mock.errors'
import { MOCK_PACK_FORMAT, MOCK_PACK_VERSION } from '@shared/mock.pack'
import { MOCK_SHARE_MAX_SCENE_BYTES } from '@shared/mock.share'
import type { MockShareUrlGet } from '@main/service/mock.share'

// 订阅这一段住在 `mock.share.ts`，那个模块经 `mock.pack.service` 引用 electron；替身只要能被 import 就够。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>"",getVersion:()=>"0.0.0-test"}',
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { readShareUrlPack, toShareUrlError } = await import('@main/service/mock.share')

/**
 * URL 订阅（PRD C4 / S-A5）的等价类用例，逐条对着 9.2 那张表跑。
 *
 * 不起服务器：`get` 这一层就是为了让状态码、重试次数、正文能被喂成确定值才存在的。
 * 请求面只有 `url` 与 `maxBytes`，连 header 都传不进来——「Content-Type 不参与判定」这条不是靠代码自觉，
 * 是接口的形状就没给它留位置（9.2 最后一行）。
 */

interface Script {
  status?: number
  text?: string
  /** 报的字节数可以与正文不符：超限那一格要的就是「对面声称这么大」 */
  bytes?: number
  error?: unknown
}

function stubGet(script: Script[]): { get: MockShareUrlGet; calls: { url: string; maxBytes: number }[] } {
  const calls: { url: string; maxBytes: number }[] = []
  const get: MockShareUrlGet = async (url, options) => {
    calls.push({ url, maxBytes: options.maxBytes })
    const next = script.shift()
    if (next == null) throw new Error('用例没安排这一次请求：多问了一次')
    if (next.error != null) throw next.error
    const text = next.text ?? ''
    return { status: next.status ?? 200, text, bytes: next.bytes ?? Buffer.byteLength(text, 'utf8') }
  }
  return { get, calls }
}

function stubWait() {
  const delays: number[] = []
  return { delays, wait: async (ms: number) => { delays.push(ms) } }
}

function packText(scenes = 1): string {
  return JSON.stringify({
    format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION,
    rules: Array.from({ length: scenes }, (_, i) => ({ name: `场景${i}`, records: [] })),
  })
}

async function rejectCode(promise: Promise<unknown>): Promise<MockError> {
  try {
    await promise
  } catch (err) {
    if (err instanceof MockError) return err
    throw err
  }
  assert.fail('应抛出 MockError')
}

describe('订阅 URL 读侧（C4 / S-A5）', () => {
  it('裸包：200 的正文原样交出去，字节按正文实算', async () => {
    const text = packText()
    const { get, calls } = stubGet([{ text }])
    const payload = await readShareUrlPack('https://host/app.json', { get })
    assert.equal(payload.text, text)
    assert.equal(payload.bytes, Buffer.byteLength(text, 'utf8'))
    assert.equal(calls.length, 1)
  })

  it('BizResponse 包裹：取 data.content，交出去的是里面那段而不是整个响应', async () => {
    const inner = packText()
    const { get } = stubGet([{ text: JSON.stringify({ code: 0, msg: 'ok', data: { content: inner } }) }])
    const payload = await readShareUrlPack('https://host/api/export', { get })
    assert.equal(payload.text, inner)
    assert.equal(payload.bytes, Buffer.byteLength(inner, 'utf8'))
  })

  it('登录墙 HTML：remoteShapeUnknown 带正文开头，不因为 Content-Type 是 json 就放过', async () => {
    const html = '<!DOCTYPE html><html><body>Sign in</body></html>'
    const { get } = stubGet([{ text: html }])
    const err = await rejectCode(readShareUrlPack('https://host/share', { get }))
    assert.equal(err.code, 'remoteShapeUnknown')
    // 证据串截到 32 字符为止（detail 会摊到界面上），剩下的由错误码本身补齐
    assert.equal(err.detail, 'stage=read head=<!DOCTYPE html><html><body>…')
  })

  it('空正文与只有空白的正文都按形态不认识报，而不是「没有备份」', async () => {
    const empty = stubGet([{ text: '' }])
    assert.equal((await rejectCode(readShareUrlPack('https://host/x', { get: empty.get }))).code, 'remoteShapeUnknown')
    const blank = stubGet([{ text: '   ' }])
    const err = await rejectCode(readShareUrlPack('https://host/x', { get: blank.get }))
    assert.equal(err.code, 'remoteShapeUnknown')
    assert.equal(err.detail, 'stage=read empty body')
  })

  it('判定顺序在包闸门之前：version 过高的包仍报「请升级」，不被降级成形态不认识', async () => {
    const future = JSON.stringify({ format: MOCK_PACK_FORMAT, version: 99, rules: [] })
    const { get } = stubGet([{ text: future }])
    const payload = await readShareUrlPack('https://host/x', { get })
    // 这一段只认形状，条数与版本留给下一道闸门（`readMockPackText`），C4-2 的理由就在这儿
    assert.equal(payload.text, future)
  })

  it('404 与 410 分开于「连不上」，而且一次都不重试（9.2 的按实际状态分报）', async () => {
    for (const status of [404, 410]) {
      const { get, calls } = stubGet([{ status }])
      const err = await rejectCode(readShareUrlPack('https://host/x', { get, wait: stubWait().wait }))
      assert.equal(err.code, 'remoteNotFound')
      assert.equal(err.detail, `stage=read status=${status}`)
      assert.equal(calls.length, 1)
    }
  })

  it('401/403 是权限问题、400/405 是对面答错了：两种说法都不许变成「网络不行」', async () => {
    const forbidden = stubGet([{ status: 403 }])
    assert.equal((await rejectCode(readShareUrlPack('https://host/x', { get: forbidden.get }))).code, 'remoteForbidden')
    const denied = stubGet([{ status: 401 }])
    assert.equal((await rejectCode(readShareUrlPack('https://host/x', { get: denied.get }))).code, 'remoteForbidden')
    const wrong = stubGet([{ status: 400 }])
    assert.equal((await rejectCode(readShareUrlPack('https://host/x', { get: wrong.get }))).code, 'remoteShapeUnknown')
    const method = stubGet([{ status: 405 }])
    assert.equal((await rejectCode(readShareUrlPack('https://host/x', { get: method.get }))).code, 'remoteShapeUnknown')
  })

  it('429 与 5xx 退避重试到上限：指数 250/500/1000，一共问 4 次', async () => {
    const { get, calls } = stubGet([{ status: 429 }, { status: 500 }, { status: 503 }, { status: 500 }])
    const wait = stubWait()
    const err = await rejectCode(readShareUrlPack('https://host/x', { get, wait: wait.wait }))
    assert.equal(err.code, 'remoteUnreachable')
    assert.equal(err.detail, 'stage=read status=500')
    assert.deepEqual(wait.delays, [250, 500, 1000])
    assert.equal(calls.length, 4)
  })

  it('重定向跟到上限仍没落地：归「连不上」而不是「地址不对」，因为那多半是中间那一跳的问题', async () => {
    const { get, calls } = stubGet([{ status: 302 }, { status: 302 }, { status: 302 }, { status: 302 }])
    const wait = stubWait()
    const err = await rejectCode(readShareUrlPack('https://host/x', { get, wait: wait.wait }))
    assert.equal(err.code, 'remoteUnreachable')
    assert.equal(err.detail, 'stage=read status=302')
    assert.equal(calls.length, 4)
  })

  it('网络错与超时同一条路：前三次 ECONNRESET 第四次读成功，退避 250 与 500', async () => {
    const text = packText()
    const boom = Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })
    const { get, calls } = stubGet([{ error: boom }, { error: boom }, { text }, { text }])
    const wait = stubWait()
    const payload = await readShareUrlPack('https://host/x', { get, wait: wait.wait })
    assert.equal(payload.text, text)
    assert.deepEqual(wait.delays, [250, 500])
    assert.equal(calls.length, 3)
  })

  it('体积超限拒而不落盘：按清单尺 32MB 判，且这把尺原样交给传输层去断流', async () => {
    const huge = MOCK_SHARE_MAX_SCENE_BYTES + 1
    const { get, calls } = stubGet([{ text: 'x', bytes: huge }])
    const err = await rejectCode(readShareUrlPack('https://host/x', { get }))
    assert.equal(err.code, 'sceneTooLargeForCloud')
    assert.equal(err.detail, `stage=read bytes=${huge} limit=${MOCK_SHARE_MAX_SCENE_BYTES}`)
    assert.equal(calls[0].maxBytes, MOCK_SHARE_MAX_SCENE_BYTES)
  })

  it('URL 原样交给传输层，一次都不重新编码（9.2：二次编码是这类功能最常见的 404 原因）', async () => {
    const urls = [
      'https://host/a%20b.json', 'https://host/a+b.json', 'https://host/a b.json', 'https://host/dir/',
      'https://host/a.json?path=%2Fv1%2Fusers&x=1', 'https://host/a.json?path=/v1/users',
      'https://host/已编码中文名.json', 'https://host/%E4%B8%AD%E6%96%87.json', 'http://10.0.0.5:8884/x',
    ]
    for (const url of urls) {
      const { get, calls } = stubGet([{ text: packText() }])
      await readShareUrlPack(url, { get })
      assert.equal(calls[0].url, url)
    }
  })

  it('协议只认 http/https：ftp 与看不懂的串按「地址填错了」报，且不回显地址本身', async () => {
    const ftp = await rejectCode(readShareUrlPack('ftp://host/x.json', { get: stubGet([]).get }))
    assert.equal(ftp.code, 'remotePathMissing')
    assert.equal(ftp.detail, 'stage=list scheme=ftp:')
    const junk = await rejectCode(readShareUrlPack('host without scheme', { get: stubGet([]).get }))
    assert.equal(junk.code, 'remotePathMissing')
    assert.equal(junk.detail, 'stage=list url unparseable')

    // http 不阻止（内网静态目录是真实用例），警示是界面那句常驻的话，不在这一层拦
    const { get, calls } = stubGet([{ text: packText() }])
    await readShareUrlPack('http://nas.internal/mock.json', { get })
    assert.equal(calls.length, 1)
  })

  it('取消在重试等待里也立刻生效：退避睡着的时候按下取消，不许真睡完这一觉', async () => {
    const boom = Object.assign(new Error('timeout of 60000ms exceeded'), { code: 'ECONNABORTED' })
    const { get, calls } = stubGet([{ error: boom }, { text: packText() }])
    const controller = new AbortController()
    const started = Date.now()
    const pending = readShareUrlPack('https://host/x', { get, signal: controller.signal })
    await new Promise(resolve => setTimeout(resolve, 20))
    controller.abort()
    await assert.rejects(pending, (err: Error) => err.name === 'AbortError')
    assert.ok(Date.now() - started < 200, '取消要在退避里立刻醒，不是把这一觉睡完')
    assert.equal(calls.length, 1)
  })

  it('取消不是错误码：已中止的信号原样抛 AbortError，不会变成一句「远端连不上」', async () => {
    const controller = new AbortController()
    controller.abort()
    const { get, calls } = stubGet([{ text: packText() }])
    await assert.rejects(readShareUrlPack('https://host/x', { get, signal: controller.signal }),
      (err: Error) => err.name === 'AbortError')
    assert.equal(calls.length, 0)
  })

  describe('toShareUrlError：传输层的失败只在这一处变成错误码', () => {
    const cases: [string, unknown, MockErrorCode, string][] = [
      ['axios 的读超时', { code: 'ECONNABORTED', message: 'timeout of 60000ms exceeded' }, 'remoteUnreachable', 'stage=read errno=ECONNABORTED'],
      ['连接被拒', { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:8884' }, 'remoteUnreachable', 'stage=read errno=ECONNREFUSED'],
      ['域名解不出来', { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND host' }, 'remoteUnreachable', 'stage=read errno=ENOTFOUND'],
      ['重定向跟到上限', { code: 'ERR_FR_TOO_MANY_REDIRECTS', message: 'Maximum number of redirects exceeded' }, 'remoteUnreachable', 'stage=read redirects=3'],
    ]
    for (const [title, raw, code, detail] of cases) {
      it(title, () => {
        const err = toShareUrlError(Object.assign(new Error(String(raw.message)), raw))
        assert.equal(err.code, code)
        assert.equal(err.detail, detail)
      })
    }

    it('maxContentLength 断流说成体积上限，而不是「连不上」', () => {
      const err = toShareUrlError(Object.assign(
        new Error(`maxContentLength size of ${MOCK_SHARE_MAX_SCENE_BYTES} exceeded`), { code: 'ERR_BAD_RESPONSE' }))
      assert.equal(err.code, 'sceneTooLargeForCloud')
      assert.equal(err.detail, `stage=read limit=${MOCK_SHARE_MAX_SCENE_BYTES}`)
    })

    it('axios 的取消（ERR_CANCELED）变回 AbortError：界面要说的是「已取消」，不是去查网络', () => {
      assert.throws(() => toShareUrlError(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })),
        (err: Error) => err.name === 'AbortError')
    })

    it('已经是 MockError 的（清单那侧抛出来的）不改口，证据串照旧截断', () => {
      const source = new MockError('remoteCorrupted', 'sha1 mismatch')
      assert.equal(toShareUrlError(source), source)
      const junk = toShareUrlError(new Error('a'.repeat(200)))
      assert.equal(junk.code, 'remoteUnreachable')
      assert.ok(String(junk.detail).length <= 'stage=read '.length + 33, 'detail 受 describeValue 那把尺')
    })
  })
})
