// HTTP 头取值的唯一实现。主进程与渲染进程共用，不得依赖 node 内置模块或 UI 库。

export const MOCK_HOST_HEADER = 'x-mock-host'
export const MOCK_UID_HEADER = 'x-mock-uid'

export const HEADER_NAME_REG = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export const HOP_BY_HOP_HEADERS = [
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]

export type HeaderValue = string | string[] | undefined
export type HeaderMap = Record<string, HeaderValue>

export function isHeaderName(name: string): boolean {
  return HEADER_NAME_REG.test(String(name ?? ''))
}

/** Connection 头里显式声明的逐跳头同样要丢弃 */
export function splitConnectionTokens(value: HeaderValue): string[] {
  return String(value ?? '')
    .split(',')
    .map(it => it.trim().toLowerCase())
    .filter(it => it.length > 0)
}

/**
 * 值级取单值。不 trim、空串不转 null：调用方要用判空语义时显式套 emptyToNull，
 * 否则「头不存在」和「头为空」会被合并成同一种情况。
 */
export function headerFirst(value: HeaderValue): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return first == null ? null : String(first)
}

/** 值级取多值，逐项 trim；头缺失返回 null，用于区分缺失与空值 */
export function headerValuesOf(value: HeaderValue): string[] | null {
  if (value == null) return null
  const list = Array.isArray(value) ? value : [value]
  return list.filter(it => it != null).map(it => String(it).trim())
}

export function emptyToNull(value: string | null | undefined): string | null {
  return value == null || value.trim() === '' ? null : value
}

/** map 级取单值，大小写不敏感。存储层与渲染进程的 header key 大小写不可控，必须走这里 */
export function pickHeader(headers: HeaderMap | undefined, name: string): string | null {
  return headerFirst(rawOf(headers, name))
}

/** map 级取多值，大小写不敏感 */
export function pickHeaderList(headers: HeaderMap | undefined, name: string): string[] | null {
  return headerValuesOf(rawOf(headers, name))
}

function rawOf(headers: HeaderMap | undefined, name: string): HeaderValue {
  if (headers == null || name == null) return undefined
  // Node/Express 已经把 header 名转成小写，先命中这条路径，避免每次遍历整个 map
  const lower = String(name).toLowerCase()
  if (Object.prototype.hasOwnProperty.call(headers, lower)) return headers[lower]
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key]
  }
  return undefined
}
