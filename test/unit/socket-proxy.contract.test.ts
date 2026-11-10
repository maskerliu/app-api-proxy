import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import { describe, it } from 'node:test'
import { ProxyMock } from '@shared/proxy.models'
import { MOCK_HOST_HEADER, MOCK_UID_HEADER } from '@shared/http-header'
import {
  buildUpstreamHeaders, encodeFramePayload, isProxyPath, isSendableCloseCode, mapUpstreamError,
  MAX_CLOSE_REASON, parseProtocols, parseProxyRequest,
  resolveTargetUrl, truncateReason,
} from '@main/service/socket-proxy.contract'

type FakeRequest = Pick<IncomingMessage, 'url' | 'headers' | 'rawHeaders'>

function request(url: string, headers: Record<string, string | string[]> = {},
  rawHeaders: string[] = []): FakeRequest {
  return { url, headers, rawHeaders }
}

function rawHeadersOf(entries: [string, string][]): string[] {
  return entries.flatMap(([key, value]) => [key, value])
}

function routedError(fn: () => unknown): any {
  try {
    fn()
  } catch (err) {
    return err
  }
  assert.fail('expected error')
}

describe('isProxyPath', () => {
  it('命中 /_proxy 及其子路径', () => {
    assert.equal(isProxyPath('/_proxy'), true)
    assert.equal(isProxyPath('/_proxy/'), true)
    assert.equal(isProxyPath('/_proxy/ws?x=1'), true)
    assert.equal(isProxyPath('/_proxyX/ws'), false)
    assert.equal(isProxyPath('/other/_proxy'), false)
  })
})

describe('parseProxyRequest', () => {
  it('去掉 /_proxy 前缀并保留原始 query 顺序与编码', () => {
    const parsed = parseProxyRequest(request('/_proxy/ws/chat?a=%E4%B8%AD&b=x%20y&a=2?z=1'))
    assert.equal(parsed.path, '/ws/chat')
    assert.equal(parsed.query, 'a=%E4%B8%AD&b=x%20y&a=2?z=1')
  })

  it('/_proxy 与 /_proxy/ 都映射到根路径', () => {
    assert.equal(parseProxyRequest(request('/_proxy')).path, '/')
    assert.equal(parseProxyRequest(request('/_proxy?x=1')).path, '/')
    assert.equal(parseProxyRequest(request('/_proxy/')).path, '/')
  })

  it('剥离 __mock_host / __mock_uid 查询参数', () => {
    const parsed = parseProxyRequest(request('/_proxy/ws?a=1&__mock_host=api.example.com&b=2&__mock_uid=u1'))
    assert.equal(parsed.query, 'a=1&b=2')
    assert.equal(parsed.mockHost, 'api.example.com')
    assert.equal(parsed.uid, 'u1')
  })

  it('请求头优先于查询参数', () => {
    const parsed = parseProxyRequest(request(
      '/_proxy/ws?__mock_host=query-host&__mock_uid=query-uid',
      { [MOCK_HOST_HEADER]: 'header-host', [MOCK_UID_HEADER]: 'header-uid' },
    ))
    assert.equal(parsed.mockHost, 'header-host')
    assert.equal(parsed.uid, 'header-uid')
    assert.equal(parsed.query, '')
  })

  it('空值按未提供处理，非法编码保持原样', () => {
    const parsed = parseProxyRequest(request('/_proxy/ws?__mock_host=%20&bad=%E0%A4%A'))
    assert.equal(parsed.mockHost, undefined)
    assert.equal(parsed.query, 'bad=%E0%A4%A')
  })

  it('解析 Sec-WebSocket-Protocol 列表', () => {
    const parsed = parseProxyRequest(request('/_proxy/ws', { 'sec-websocket-protocol': 'chat, superchat' }))
    assert.deepEqual(parsed.protocols, ['chat', 'superchat'])
    assert.deepEqual(parseProtocols(['a, b', 'c']), ['a', 'b', 'c'])
    assert.deepEqual(parseProtocols(undefined), [])
  })
})

describe('buildUpstreamHeaders', () => {
  it('移除逐跳头、握手头与代理专用头', () => {
    const headers = buildUpstreamHeaders(request('/_proxy/ws',
      { connection: 'keep-alive, x-custom-hop' }, rawHeadersOf([
      ['Host', 'proxy.local'],
      ['Connection', 'keep-alive, x-custom-hop'],
      ['x-custom-hop', '1'],
      ['Upgrade', 'websocket'],
      ['Sec-WebSocket-Key', 'key'],
      ['Sec-WebSocket-Version', '13'],
      ['Sec-WebSocket-Extensions', 'permessage-deflate'],
      ['Sec-WebSocket-Protocol', 'chat'],
      ['x-mock-host', 'api.example.com'],
      ['x-mock-uid', 'u1'],
      ['Authorization', 'Bearer token'],
      ['Cookie', 'a=1'],
    ])))
    assert.deepEqual({ ...headers }, {
      authorization: 'Bearer token',
      cookie: 'a=1',
    })
  })

  it('同名头合并为数组，丢弃非法头名与含换行的值', () => {
    const headers = buildUpstreamHeaders(request('/_proxy/ws', {}, rawHeadersOf([
      ['X-Trace', 'a'],
      ['X-Trace', 'b'],
      ['Bad Header', 'x'],
      ['X-Bad', 'line\r\ninjected: 1'],
    ])))
    assert.deepEqual({ ...headers }, { 'x-trace': ['a', 'b'] })
  })
})

describe('resolveTargetUrl', () => {
  it('按目标协议映射 ws / wss 并拼接基础路径与 query', () => {
    const parsed = parseProxyRequest(request('/_proxy/ws/chat?room=1'))
    const httpTarget = resolveTargetUrl({ ...parsed, mockHost: 'http://api.example.com' })
    assert.equal(httpTarget.url, 'ws://api.example.com/ws/chat?room=1')
    assert.equal(httpTarget.host, 'api.example.com')

    const httpsTarget = resolveTargetUrl({ ...parsed, mockHost: 'https://api.example.com/v1/' })
    assert.equal(httpsTarget.url, 'wss://api.example.com/v1/ws/chat?room=1')

    assert.equal(resolveTargetUrl({ ...parsed, mockHost: 'ws://api.example.com' }).url,
      'ws://api.example.com/ws/chat?room=1')
    assert.equal(resolveTargetUrl({ ...parsed, mockHost: 'wss://api.example.com' }).url,
      'wss://api.example.com/ws/chat?room=1')
  })

  it('不带协议时默认 http', () => {
    const parsed = parseProxyRequest(request('/_proxy/ws'))
    assert.equal(resolveTargetUrl({ ...parsed, mockHost: 'api.example.com:8080' }).url,
      'ws://api.example.com:8080/ws')
  })

  it('启用 dataServer 时覆盖目标地址并带出延迟', () => {
    const parsed = parseProxyRequest(request('/_proxy/ws?x=1'))
    const target = resolveTargetUrl({ ...parsed, mockHost: 'origin.example.com' },
      { status: true, dataServer: 'https://mock.example.com/base', delay: 30 })
    assert.equal(target.url, 'wss://mock.example.com/base/ws?x=1')
    assert.equal(target.delay, 30)
  })

  it('dataServer 未启用时忽略覆盖', () => {
    const parsed = parseProxyRequest(request('/_proxy/ws'))
    const target = resolveTargetUrl({ ...parsed, mockHost: 'origin.example.com' },
      { status: false, dataServer: 'https://mock.example.com' })
    assert.equal(target.url, 'ws://origin.example.com/ws')
    assert.equal(target.delay, 0)
  })

  it('缺少或非法目标返回 WS-E01，协议不支持返回 WS-E03', () => {
    const parsed = parseProxyRequest(request('/_proxy/ws'))

    const missing = routedError(() => resolveTargetUrl(parsed))
    assert.equal(missing.wsCode, ProxyMock.SocketErrorCode.MISSING_TARGET)
    assert.equal(missing.status, 400)

    const invalid = routedError(() => resolveTargetUrl({ ...parsed, mockHost: 'http://' }))
    assert.equal(invalid.wsCode, ProxyMock.SocketErrorCode.MISSING_TARGET)

    const unsupported = routedError(() => resolveTargetUrl({ ...parsed, mockHost: 'ftp://example.com' }))
    assert.equal(unsupported.wsCode, ProxyMock.SocketErrorCode.UNSUPPORTED_PROTOCOL)
    assert.equal(unsupported.status, 400)
    // 文案在 shared/url 之外重拼：协议名不带裸输入，非法地址要带
    assert.equal(unsupported.message, 'unsupported target protocol: ftp:')
    assert.equal(invalid.message, 'invalid target: http://')
  })
})

describe('encodeFramePayload', () => {
  it('文本按 utf8 保存，未超限不截断', () => {
    const encoded = encodeFramePayload(Buffer.from('你好，ws'), 'text')
    assert.equal(encoded.data, '你好，ws')
    assert.equal(encoded.encoding, 'utf8')
    assert.equal(encoded.truncated, false)
    assert.equal(encoded.size, Buffer.byteLength('你好，ws'))
  })

  it('二进制按 base64 保存', () => {
    const source = Buffer.from([0, 1, 2, 250])
    const encoded = encodeFramePayload(source, 'binary')
    assert.equal(encoded.data, source.toString('base64'))
    assert.equal(encoded.encoding, 'base64')
    assert.equal(encoded.truncated, false)
  })

  it('超过上限时截断并保留原始大小', () => {
    const text = 'a'.repeat(256 * 1024 + 10)
    const encodedText = encodeFramePayload(Buffer.from(text), 'text')
    assert.equal(encodedText.truncated, true)
    assert.equal(encodedText.size, text.length)
    assert.equal(Buffer.byteLength(encodedText.data), 256 * 1024)

    const binary = Buffer.alloc(128 * 1024 + 10, 7)
    const encodedBinary = encodeFramePayload(binary, 'binary')
    assert.equal(encodedBinary.truncated, true)
    assert.equal(encodedBinary.data.length, Math.ceil((128 * 1024) / 3) * 4)
  })
})

describe('close code 与错误映射', () => {
  it('只允许发送标准与私有区间的关闭码', () => {
    for (const code of [1000, 1001, 1002, 1003, 1007, 1014, 3000, 4999]) {
      assert.equal(isSendableCloseCode(code), true, String(code))
    }
    for (const code of [1005, 1006, 1015, 1016, 2999, 5000]) {
      assert.equal(isSendableCloseCode(code), false, String(code))
    }
  })

  it('关闭原因按 UTF-8 字节截断到 123 字节', () => {
    assert.equal(truncateReason('normal'), 'normal')
    const long = '中'.repeat(100)
    const result = truncateReason(long)
    assert.ok(Buffer.byteLength(result, 'utf8') <= MAX_CLOSE_REASON)
  })

  it('握手异常映射到对应错误码', () => {
    assert.deepEqual(mapUpstreamError(new Error('handshake timed out')),
      { code: ProxyMock.SocketErrorCode.HANDSHAKE_TIMEOUT, status: 504 })
    assert.deepEqual(mapUpstreamError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })),
      { code: ProxyMock.SocketErrorCode.HANDSHAKE_TIMEOUT, status: 504 })
    assert.deepEqual(mapUpstreamError(new Error('self signed certificate')),
      { code: ProxyMock.SocketErrorCode.TLS_FAILED, status: 502 })
    assert.deepEqual(mapUpstreamError(new Error('Max payload size exceeded')),
      { code: ProxyMock.SocketErrorCode.MESSAGE_TOO_LARGE, status: 502 })
    assert.deepEqual(mapUpstreamError(new Error('connect ECONNREFUSED')),
      { code: ProxyMock.SocketErrorCode.CONNECT_FAILED, status: 502 })
  })
})