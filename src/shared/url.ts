// URL / 路径 / Query 取值的唯一实现。主进程与渲染进程共用，不得依赖 node 内置模块或 UI 库。
import { emptyToNull } from './http-header'

/** 占位主机名：用它判断「原串里根本没有真实主机」。 */
export const PLACEHOLDER_HOSTNAME = 'placeholder.local'

/** 相对地址解析用的占位 base。 */
export const PLACEHOLDER_BASE = `http://${PLACEHOLDER_HOSTNAME}`

const SCHEME_REG = /^[a-z][a-z\d+\-.]*:\/\//i

export type UrlTargetFailure = 'invalid' | 'unsupported'

/** 上游地址解析失败：invalid 是地址本身不可解析，unsupported 是协议不在白名单内。 */
export class UrlTargetError extends Error {
  constructor(readonly code: UrlTargetFailure, readonly detail: string) {
    super(code === 'invalid' ? `invalid target: ${detail}` : `unsupported protocol: ${detail}`)
  }
}

/** 裸 host（无协议）按 http 处理，协议白名单外一律拒绝；错误由调用方转成自己的错误码与文案。 */
export function toAbsoluteTarget(raw: string, allowedProtocols: string[]): URL {
  const value = String(raw ?? '').trim()
  const withScheme = SCHEME_REG.test(value) ? value : `http://${value}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch (err) {
    throw new UrlTargetError('invalid', value)
  }
  if (allowedProtocols.indexOf(url.protocol) < 0) throw new UrlTargetError('unsupported', url.protocol)
  return url
}

/** 宽松解析：相对串按 PLACEHOLDER_BASE 补全，空串得到根路径，解析不了返回 null。 */
export function parseLooseUrl(raw: string): URL | null {
  try {
    return new URL(String(raw ?? ''), PLACEHOLDER_BASE)
  } catch (err) {
    return null
  }
}

/** 用于比较的规范路径：decodeURI（不把 %2F 还原成分隔符）+ 折叠重复分隔符 + 补前导斜杠。 */
export function normalizePathname(pathname: string): string {
  const raw = String(pathname ?? '')
  let value: string
  try {
    value = decodeURI(raw)
  } catch (err) {
    value = raw
  }
  value = value.replace(/\/{2,}/g, '/')
  return value.startsWith('/') ? value : `/${value}`
}

/**
 * keepRoot=true 用于「路径本身」的比较键：根路径保持 '/'，空串保持空串
 * （否则 path 为空的规则会多出 '/' 这个键，把根路径请求也匹配上）。
 * keepRoot=false 用于拼接上游路径：允许返回空串。
 */
export function stripTrailingSlash(path: string, keepRoot = false): string {
  const value = String(path ?? '')
  if (keepRoot && value.length <= 1) return value
  const stripped = value.replace(/\/+$/, '')
  return keepRoot ? stripped || '/' : stripped
}

export function pathSegments(path: string): string[] {
  return String(path ?? '').split('/').filter(it => it !== '')
}

/** 原始 query 片段：不 decode、丢空片段；'#' 只在出现于 '?' 之后时才截断（路径里的 # 属于路径）。 */
export function queryParts(rawUrl: string): string[] {
  const raw = String(rawUrl ?? '')
  const queryIndex = raw.indexOf('?')
  if (queryIndex < 0) return []
  const hashIndex = raw.indexOf('#', queryIndex)
  return raw.slice(queryIndex + 1, hashIndex < 0 ? undefined : hashIndex)
    .split('&')
    .filter(it => it !== '')
}

/** 表单式 query：'+' 是空格。解码失败返回已替换 '+' 的原文。 */
export function decodeQueryPart(value: string): string {
  const plus = String(value ?? '').replace(/\+/g, ' ')
  try {
    return decodeURIComponent(plus)
  } catch (err) {
    return plus
  }
}

/** 转发链路式 query：'+' 原样保留，只在解码失败时返回原文。 */
export function decodeRawToken(value: string): string {
  try {
    return decodeURIComponent(String(value ?? ''))
  } catch (err) {
    return String(value ?? '')
  }
}

/** 取控制参数（如 __mock_uid）：按键名解码后比较，取第一次出现，空值视为缺失。 */
export function queryTokenOf(rawUrl: string, key: string): string | null {
  for (const part of queryParts(rawUrl)) {
    const eq = part.indexOf('=')
    const rawKey = eq >= 0 ? part.slice(0, eq) : part
    if (decodeRawToken(rawKey) !== key) continue
    return emptyToNull(decodeRawToken(eq >= 0 ? part.slice(eq + 1) : ''))
  }
  return null
}

/** 主机与端口：IPv6 取方括号内，端口非纯数字时整体视为主机名。 */
export function splitHostPort(value: string): { host: string; port: number | null } {
  const host = String(value ?? '').trim().toLowerCase()
  if (host === '') return { host: '', port: null }

  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end > 0) {
      const hostname = host.slice(1, end)
      const rest = host.slice(end + 1)
      const matched = /^:(\d+)$/.exec(rest)
      return { host: hostname, port: matched == null ? null : Number(matched[1]) }
    }
  }

  const colon = host.lastIndexOf(':')
  if (colon > 0 && /^\d+$/.test(host.slice(colon + 1))) {
    return { host: host.slice(0, colon), port: Number(host.slice(colon + 1)) }
  }
  return { host, port: null }
}
