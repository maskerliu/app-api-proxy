import type { ProxyMock } from './proxy.models'

// 纯函数模块：主进程与渲染层共用，不得依赖 axios / vant / node 内置模块。

export const MOCK_MAX_BODY_BYTES = 2 * 1024 * 1024
export const MOCK_MAX_VARIANTS = 20
export const MOCK_MAX_DELAY_MS = 60000

export type MockValidationCode =
  | 'statusRange'
  | 'headerName'
  | 'headerValue'
  | 'bodyTooLarge'
  | 'urlEmpty'
  | 'variantLimit'
  | 'variantIdMissing'
  | 'delayRange'
  | 'bodyType'
  | 'bodyEncoding'

export interface MockValidationIssue {
  code: MockValidationCode
  field?: string
  detail?: string
}

const HEADER_NAME_REG = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
])
const BODY_TYPES: ProxyMock.MockBodyType[] = ['json', 'xml', 'text', 'binary']

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value ?? '').length
}

// binary 类型在 UI 中使用 base64 文本，切换类型时做无损转换
export function textToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value ?? '')
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

// 不是合法 UTF-8（或不是 base64）时返回 null，由调用方保留原文
export function base64ToText(value: string): string {
  try {
    const binary = atob(value ?? '')
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (err) {
    return null
  }
}

export function inferBodyType(contentType: string): ProxyMock.MockBodyType {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  if (type === 'application/json' || type.endsWith('+json')) return 'json'
  if (type === 'application/xml' || type === 'text/xml' || type.endsWith('+xml')) return 'xml'
  if (type.startsWith('text/') || type === 'application/x-www-form-urlencoded') return 'text'
  return 'binary'
}

// 发送与保存前统一过滤：逐跳头、长度/压缩头不能再透传
export function sanitizeResponseHeaders(headers: ProxyMock.MockResponseHeaders): ProxyMock.MockResponseHeaders {
  const result: ProxyMock.MockResponseHeaders = {}
  for (const name of Object.keys(headers ?? {})) {
    const key = String(name)
    const lower = key.toLowerCase()
    if (!HEADER_NAME_REG.test(key)) continue
    if (HOP_BY_HOP_HEADERS.has(lower)) continue
    if (lower === 'content-length' || lower === 'content-encoding') continue

    const raw = headers[key]
    const values = (Array.isArray(raw) ? raw : [raw])
      .filter(it => it != null)
      .map(it => String(it).replace(/[\r\n]+/g, ' '))
    if (values.length === 0) continue
    result[key] = values.length === 1 ? values[0] : values
  }
  return result
}

export function validateResponseDef(
  def: ProxyMock.MockResponseDef,
  fieldPrefix: string = 'response'
): MockValidationIssue[] {
  const issues: MockValidationIssue[] = []
  if (def == null) {
    issues.push({ code: 'bodyType', field: fieldPrefix })
    return issues
  }

  const status = Number(def.statusCode)
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    issues.push({ code: 'statusRange', field: `${fieldPrefix}.statusCode` })
  }

  const delay = Number(def.delayMs ?? 0)
  if (!Number.isInteger(delay) || delay < 0 || delay > MOCK_MAX_DELAY_MS) {
    issues.push({ code: 'delayRange', field: `${fieldPrefix}.delayMs` })
  }

  if (!BODY_TYPES.includes(def.bodyType)) {
    issues.push({ code: 'bodyType', field: `${fieldPrefix}.bodyType` })
  }
  if (def.bodyEncoding != null && def.bodyEncoding !== 'utf8' && def.bodyEncoding !== 'base64') {
    issues.push({ code: 'bodyEncoding', field: `${fieldPrefix}.bodyEncoding` })
  }

  if (typeof def.body === 'string' && utf8ByteLength(def.body) > MOCK_MAX_BODY_BYTES) {
    issues.push({ code: 'bodyTooLarge', field: `${fieldPrefix}.body` })
  }

  for (const name of Object.keys(def.headers ?? {})) {
    if (!HEADER_NAME_REG.test(name)) {
      issues.push({ code: 'headerName', field: `${fieldPrefix}.headers`, detail: name })
      continue
    }
    const raw = def.headers[name]
    const values = Array.isArray(raw) ? raw : [raw]
    if (values.some(it => /[\r\n]/.test(String(it ?? '')))) {
      issues.push({ code: 'headerValue', field: `${fieldPrefix}.headers`, detail: name })
    }
  }

  return issues
}

export function validateMockRecord(record: ProxyMock.MockRecord): MockValidationIssue[] {
  const issues: MockValidationIssue[] = []
  if (record == null) {
    issues.push({ code: 'bodyType', field: 'record' })
    return issues
  }
  if (!record.url) issues.push({ code: 'urlEmpty', field: 'url' })

  issues.push(...validateResponseDef(record.response, 'response'))

  const variants = record.variants ?? []
  if (variants.length > MOCK_MAX_VARIANTS) {
    issues.push({ code: 'variantLimit', field: 'variants' })
  }
  for (let i = 0; i < variants.length; i++) {
    issues.push(...validateResponseDef(variants[i], `variants[${i}]`))
  }
  if (record.activeVariantId != null && !variants.some(it => it?.id === record.activeVariantId)) {
    issues.push({ code: 'variantIdMissing', field: 'activeVariantId' })
  }

  return issues
}

// 读库补齐默认值：旧记录、手工构造的记录都能进入统一模型
export function normalizeMockRecord(record: Partial<ProxyMock.MockRecord>): ProxyMock.MockRecord {
  const response = normalizeResponse(record?.response)
  const variants = Array.isArray(record?.variants) ? record.variants.map(it => ({
    ...normalizeResponse(it),
    id: it?.id,
    name: it?.name ?? '',
    updatedAt: it?.updatedAt,
  } as ProxyMock.MockVariant)) : []
  const activeVariantId = record?.activeVariantId != null && variants.some(it => it.id === record.activeVariantId)
    ? record.activeVariantId
    : null

  return {
    id: record?.id ?? null,
    ruleId: record?.ruleId ?? null,
    name: record?.name ?? '',
    url: record?.url ?? '',
    response,
    variants,
    activeVariantId,
    source: record?.source,
    createdAt: record?.createdAt ?? 0,
    updatedAt: record?.updatedAt ?? 0,
  }
}

export function normalizeResponse(def: Partial<ProxyMock.MockResponseDef>): ProxyMock.MockResponseDef {
  return {
    statusCode: Number.isInteger(Number(def?.statusCode)) ? Number(def.statusCode) : 200,
    headers: def?.headers ?? {},
    body: typeof def?.body === 'string' ? def.body : '',
    bodyType: BODY_TYPES.includes(def?.bodyType) ? def.bodyType : 'json',
    bodyEncoding: def?.bodyType === 'binary' || def?.bodyEncoding === 'base64' ? 'base64' : undefined,
    delayMs: Number.isFinite(Number(def?.delayMs)) ? Number(def.delayMs) : 0,
  }
}
