import type { IncomingMessage, OutgoingHttpHeaders } from 'http'
import { API_URL } from '@shared/api.const'
import {
  emptyToNull, headerFirst, HOP_BY_HOP_HEADERS, isHeaderName, MOCK_HOST_HEADER, MOCK_UID_HEADER,
  splitConnectionTokens,
} from '@shared/http-header'
import { ProxyMock } from '@shared/proxy.models'
import {
  decodeRawToken, stripTrailingSlash, toAbsoluteTarget, UrlTargetError,
} from '@shared/url'

// 上游可以是 http/https（代理侧升级为 ws/wss）或直接的 ws/wss
const TARGET_PROTOCOLS = ['http:', 'https:', 'ws:', 'wss:']

export const MOCK_HOST_QUERY = '__mock_host'
export const MOCK_UID_QUERY = '__mock_uid'
export const RESERVED_QUERY = [MOCK_HOST_QUERY, MOCK_UID_QUERY]
export const MAX_CLOSE_REASON = 123
export const MAX_TEXT_FRAME = 256 * 1024
export const MAX_BINARY_FRAME = 128 * 1024

const DROP_UPSTREAM_HEADERS = [
  ...HOP_BY_HOP_HEADERS,
  'host', 'content-length',
  'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-accept',
  'sec-websocket-extensions', 'sec-websocket-protocol',
  MOCK_HOST_HEADER, MOCK_UID_HEADER,
]

export interface ParsedProxyRequest {
  path: string
  query: string
  uid?: string
  mockHost?: string
  protocols: string[]
}

export interface ResolvedTarget {
  url: string
  host: string
  delay: number
}

export interface TargetConfig {
  status?: boolean
  dataServer?: string
  delay?: number
}

export interface EncodedFrame {
  size: number
  data: string
  encoding: 'utf8' | 'base64'
  truncated: boolean
}

type RequestLike = Pick<IncomingMessage, 'url' | 'headers'>
type RawHeaderLike = Pick<IncomingMessage, 'rawHeaders' | 'headers'>

export function isProxyPath(rawUrl: string): boolean {
  const path = rawUrl.split('?')[0]
  return path === API_URL.Proxy || path.startsWith(`${API_URL.Proxy}/`)
}

// 保留原始 query 顺序与编码，仅剥离 __mock_host / __mock_uid
export function parseProxyRequest(req: RequestLike): ParsedProxyRequest {
  const rawUrl = req.url ?? '/'
  const queryIndex = rawUrl.indexOf('?')
  const rawPath = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl
  const rawQuery = queryIndex >= 0 ? rawUrl.slice(queryIndex + 1) : ''

  let uid = emptyToNull(headerFirst(req.headers[MOCK_UID_HEADER]))
  let mockHost = emptyToNull(headerFirst(req.headers[MOCK_HOST_HEADER]))
  const parts: string[] = []

  for (const part of rawQuery.split('&')) {
    if (part === '') continue
    const eq = part.indexOf('=')
    const rawKey = eq >= 0 ? part.slice(0, eq) : part
    const key = decodeRawToken(rawKey)
    if (RESERVED_QUERY.includes(key)) {
      const value = eq >= 0 ? decodeRawToken(part.slice(eq + 1)) : ''
      if (key === MOCK_UID_QUERY && uid == null) uid = emptyToNull(value)
      if (key === MOCK_HOST_QUERY && mockHost == null) mockHost = emptyToNull(value)
      continue
    }
    parts.push(part)
  }

  const path = rawPath === API_URL.Proxy
    ? '/'
    : rawPath.startsWith(`${API_URL.Proxy}/`) ? rawPath.slice(API_URL.Proxy.length) : '/'

  return {
    path,
    query: parts.join('&'),
    uid: uid ?? undefined,
    mockHost: mockHost ?? undefined,
    protocols: parseProtocols(req.headers['sec-websocket-protocol']),
  }
}

export function parseProtocols(value: string | string[] | undefined): string[] {
  if (value == null) return []
  const values = Array.isArray(value) ? value : [value]
  return values
    .flatMap(it => String(it).split(','))
    .map(it => it.trim())
    .filter(it => it.length > 0)
}

export function buildUpstreamHeaders(req: RawHeaderLike): OutgoingHttpHeaders {
  const skip = new Set([...DROP_UPSTREAM_HEADERS, ...splitConnectionTokens(req.headers['connection'])])
  const headers: OutgoingHttpHeaders = Object.create(null)

  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i]
    const key = name.toLowerCase()
    if (key.startsWith(':') || !isHeaderName(key)) continue
    if (skip.has(key)) continue
    const value = req.rawHeaders[i + 1]
    if (value == null || /[\r\n]/.test(value)) continue
    const existing = headers[key]
    if (existing == null) headers[key] = value
    else if (Array.isArray(existing)) existing.push(value)
    else headers[key] = [existing as string, value]
  }
  return headers
}

export function resolveTargetUrl(parsed: ParsedProxyRequest, config?: TargetConfig): ResolvedTarget {
  let base = parsed.mockHost
  if (config?.status && config.dataServer != null && config.dataServer !== '') {
    base = config.dataServer
  }
  if (base == null || base.trim() === '') {
    throw routeError(ProxyMock.SocketErrorCode.MISSING_TARGET, 400,
      `missing ${MOCK_HOST_HEADER} header or __mock_host query`)
  }

  const raw = base.trim()
  let url: URL
  try {
    url = toAbsoluteTarget(raw, TARGET_PROTOCOLS)
  } catch (err) {
    if (err instanceof UrlTargetError && err.code === 'unsupported') {
      throw routeError(ProxyMock.SocketErrorCode.UNSUPPORTED_PROTOCOL, 400,
        `unsupported target protocol: ${err.detail}`)
    }
    throw routeError(ProxyMock.SocketErrorCode.MISSING_TARGET, 400, `invalid target: ${raw}`)
  }

  const protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:'
  const basePath = stripTrailingSlash(url.pathname)
  const path = basePath + (parsed.path.startsWith('/') ? parsed.path : `/${parsed.path}`)
  const targetUrl = `${protocol}//${url.host}${path}${parsed.query.length > 0 ? `?${parsed.query}` : ''}`
  // URL 构造一次确保拼接结果合法（非法字符直接拒绝，而不是让 ws 抛错）
  try {
    // eslint-disable-next-line no-new
    new URL(targetUrl)
  } catch (err) {
    throw routeError(ProxyMock.SocketErrorCode.MISSING_TARGET, 400, `invalid target url: ${targetUrl}`)
  }

  return {
    url: targetUrl,
    host: url.host,
    delay: config?.delay ?? 0,
  }
}

// 单帧只保留可展示的部分：文本按 UTF-8、二进制按 Base64，超出上限截断
export function encodeFramePayload(data: Buffer, opcode: ProxyMock.SocketOpcode): EncodedFrame {
  const size = data.length
  const limit = opcode === 'binary' ? MAX_BINARY_FRAME : MAX_TEXT_FRAME
  const truncated = size > limit
  const body = truncated ? data.subarray(0, limit) : data
  return {
    size,
    data: opcode === 'text' ? body.toString('utf-8') : body.toString('base64'),
    encoding: opcode === 'text' ? 'utf8' : 'base64',
    truncated,
  }
}

export function sanitizeHeaders(headers: NodeJS.Dict<string | string[]>): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  for (const key of Object.keys(headers)) {
    const value = headers[key]
    if (value != null) result[key] = value
  }
  return result
}

export function truncateReason(reason: string): string {
  const buffer = Buffer.from(reason, 'utf8')
  if (buffer.length <= MAX_CLOSE_REASON) return reason
  return buffer.subarray(0, MAX_CLOSE_REASON).toString('utf8')
}

export function isSendableCloseCode(code: number): boolean {
  return (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999)
}

export function mapUpstreamError(err: any): { code: string, status: number } {
  const message = String(err?.message ?? err ?? '')
  const code = String(err?.code ?? '')
  if (/timed?\s*out/i.test(message) || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return { code: ProxyMock.SocketErrorCode.HANDSHAKE_TIMEOUT, status: 504 }
  }
  if (/certificate|self[-\s]?signed|tls|ssl/i.test(message)
    || /^(CERT_|ERR_TLS_|UNABLE_TO_VERIFY_|DEPTH_ZERO_)/i.test(code)) {
    return { code: ProxyMock.SocketErrorCode.TLS_FAILED, status: 502 }
  }
  if (/max.?payload|too large|1009/i.test(message)) {
    return { code: ProxyMock.SocketErrorCode.MESSAGE_TOO_LARGE, status: 502 }
  }
  return { code: ProxyMock.SocketErrorCode.CONNECT_FAILED, status: 502 }
}

function routeError(wsCode: string, status: number, message: string) {
  const err: any = new Error(message)
  err.wsCode = wsCode
  err.status = status
  return err
}