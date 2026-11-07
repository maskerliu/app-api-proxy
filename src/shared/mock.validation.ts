import type { ProxyMock } from './proxy.models'
import type { MockErrorCode } from './mock.errors'
import type {
  MockHeaderCondition,
  MockMatchDerivation,
  MockMatchRule,
  MockQueryCondition,
  MockQueryOperator,
} from './mock.models'
import {
  MOCK_MATCH_LEVELS, MOCK_MAX_PATTERN_LENGTH, MOCK_METHODS, MOCK_PATH_TYPES,
  MOCK_QUERY_OPERATORS, normalizeHost, normalizeMethod, uniqueStrings,
} from './mock.models'

// 纯函数模块：主进程与渲染层共用，不得依赖 axios / vant / node 内置模块。

export const MOCK_MAX_BODY_BYTES = 2 * 1024 * 1024
export const MOCK_MAX_VARIANTS = 20
export const MOCK_MAX_DELAY_MS = 60000

export type MockValidationCode =
  | MockErrorCode
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

const HOST_REG = /^(?:\*\.)?(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)(?::\d{1,5})?$/
// 嵌套量词启发式：拒绝 (a+)+、(.*)*、(a+){2,} 这类指数回溯模式，不承诺穷举
const UNSAFE_REGEX_RES = [
  /\((?:\\.|[^()])*[+*](?:\\.|[^()])*\)[+*{]/,
  /\(\?(?:[:=!><]|P<[^>]+>)(?:\\.|[^()])*[+*](?:\\.|[^()])*\)[+*{]/,
]

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

  if (record.match != null) {
    issues.push(...validateMatchRule(record.match))
  } else if (!record.url) {
    // 匹配条件与 URL 至少保留一个：仅有 match 时 url 可省略
    issues.push({ code: 'matchMissing', field: 'match' })
  }

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

function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(`^(?:${pattern})$`)
  } catch (err) {
    return null
  }
}

function validatePattern(pattern: string, field: string): MockValidationIssue[] {
  const issues: MockValidationIssue[] = []
  if (pattern.length > MOCK_MAX_PATTERN_LENGTH) {
    issues.push({ code: 'pathRegexTooLong', field })
    return issues
  }
  if (UNSAFE_REGEX_RES.some(reg => reg.test(pattern))) {
    issues.push({ code: 'pathRegexUnsafe', field })
    return issues
  }
  if (compilePattern(pattern) == null) {
    issues.push({ code: 'pathRegexInvalid', field })
  }
  return issues
}

function validateOperator(op: unknown, value: unknown, field: string,
  allowEmpty: boolean): MockValidationIssue[] {
  if (!MOCK_QUERY_OPERATORS.includes(op as MockQueryOperator)) {
    return [{ code: 'queryOperatorInvalid', field }]
  }
  if (op === 'exists' || op === 'notExists') return []
  if (value == null || (value === '' && !allowEmpty)) {
    return [{ code: 'queryValueMissing', field }]
  }
  if (typeof value !== 'string') {
    return [{ code: 'queryValueMissing', field }]
  }
  if (op === 'regex') return validatePattern(value, field)
  return []
}

/**
 * 保存、导入、迁移前统一校验：Method 白名单、Host 形态、Path 正则风险、
 * Query 操作符与值、Header 名与 CRLF、Body 模式、手动优先级。
 */
export function validateMatchRule(match: MockMatchRule, fieldPrefix: string = 'match'): MockValidationIssue[] {
  if (match == null) return [{ code: 'matchMissing', field: fieldPrefix }]

  const issues: MockValidationIssue[] = []
  const method = normalizeMethod(match.method)
  if (!(MOCK_METHODS as readonly string[]).includes(method)) {
    issues.push({ code: 'methodInvalid', field: `${fieldPrefix}.method` })
  }

  const host = normalizeHost(match.host)
  if (host !== '' && !HOST_REG.test(host)) {
    issues.push({ code: 'hostInvalid', field: `${fieldPrefix}.host` })
  }

  if (!(MOCK_PATH_TYPES as readonly string[]).includes(match.pathType)) {
    issues.push({ code: 'pathTypeInvalid', field: `${fieldPrefix}.pathType` })
  }
  if (typeof match.path !== 'string' || match.path.trim() === '') {
    issues.push({ code: 'pathEmpty', field: `${fieldPrefix}.path` })
  } else if (match.pathType === 'regex') {
    issues.push(...validatePattern(match.path, `${fieldPrefix}.path`))
  }

  const query = match.query
  if (query != null) {
    if (query.mode !== 'ignore' && query.mode !== 'match') {
      issues.push({ code: 'queryOperatorInvalid', field: `${fieldPrefix}.query.mode` })
    }
    if (query.multiValue !== 'any' && query.multiValue !== 'all') {
      issues.push({ code: 'queryOperatorInvalid', field: `${fieldPrefix}.query.multiValue` })
    }
    if (query.ignoreKeys != null && !Array.isArray(query.ignoreKeys)) {
      issues.push({ code: 'queryOperatorInvalid', field: `${fieldPrefix}.query.ignoreKeys` })
    }
    const conditions = Array.isArray(query.conditions) ? query.conditions : []
    if (!Array.isArray(query.conditions)) {
      issues.push({ code: 'queryOperatorInvalid', field: `${fieldPrefix}.query.conditions` })
    }
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i]
      const field = `${fieldPrefix}.query.conditions[${i}]`
      if (condition == null || typeof condition.key !== 'string' || condition.key.trim() === '') {
        issues.push({ code: 'queryValueMissing', field: `${field}.key` })
        continue
      }
      issues.push(...validateOperator(condition.op, condition.value, `${field}.value`, true))
    }
  } else {
    issues.push({ code: 'queryOperatorInvalid', field: `${fieldPrefix}.query` })
  }

  const headers = match.headers
  if (headers != null) {
    const conditions = Array.isArray(headers.conditions) ? headers.conditions : []
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i]
      const field = `${fieldPrefix}.headers.conditions[${i}]`
      if (condition == null || typeof condition.name !== 'string' || !HEADER_NAME_REG.test(condition.name)) {
        issues.push({ code: 'headerNameInvalid', field: `${field}.name` })
        continue
      }
      if (typeof condition.value === 'string' && /[\r\n]/.test(condition.value)) {
        issues.push({ code: 'headerValueInvalid', field: `${field}.value` })
      }
      issues.push(...validateOperator(condition.op, condition.value, `${field}.value`, true))
    }
  }

  if (match.body != null && match.body.mode !== 'ignore') {
    issues.push({ code: 'bodyModeUnsupported', field: `${fieldPrefix}.body.mode` })
  }

  if (match.priority != null && (!Number.isInteger(Number(match.priority)) || !Number.isFinite(Number(match.priority)))) {
    issues.push({ code: 'priorityInvalid', field: `${fieldPrefix}.priority` })
  }

  return issues
}

function pathForFingerprint(match: MockMatchRule): string {
  let path = match.pathIgnoreCase ? match.path.toLowerCase() : match.path
  if (match.ignoreTrailingSlash && path.length > 1 && path.endsWith('/')) {
    path = path.replace(/\/+$/, '') || '/'
  }
  return path
}

function tupleKey(tuple: Array<string | number>): string {
  return JSON.stringify(tuple)
}

/**
 * 顺序无关的规范串：只描述「匹配什么」，不包含 level / priority / enabled /
 * derivation / 名称 / 响应。主进程据此计算指纹（sha1）。
 */
export function canonicalMatch(match: MockMatchRule): string {
  const normalized = normalizeMatchRule(match)
  const queryConditions = normalized.query.conditions
    .map(it => [
      it.key,
      it.op,
      it.op === 'exists' || it.op === 'notExists' ? '' : it.value,
      it.ignoreCase ? 1 : 0,
    ] as Array<string | number>)
    .sort((a, b) => tupleKey(a) < tupleKey(b) ? -1 : tupleKey(a) > tupleKey(b) ? 1 : 0)
  const headerConditions = normalized.headers.conditions
    .map(it => [
      it.name.toLowerCase(),
      it.op,
      it.op === 'exists' || it.op === 'notExists' ? '' : it.value,
      it.ignoreCase ? 1 : 0,
    ] as Array<string | number>)
    .sort((a, b) => tupleKey(a) < tupleKey(b) ? -1 : tupleKey(a) > tupleKey(b) ? 1 : 0)
  const ignoreKeys = [...normalized.query.ignoreKeys].sort()

  return JSON.stringify([
    'mock-match-v1',
    normalized.method,
    normalized.host,
    normalized.pathType,
    pathForFingerprint(normalized),
    normalized.pathIgnoreCase ? 1 : 0,
    normalized.ignoreTrailingSlash ? 1 : 0,
    normalized.query.mode,
    normalized.query.allowExtra ? 1 : 0,
    normalized.query.multiValue,
    ignoreKeys,
    queryConditions,
    headerConditions,
    normalized.body.mode,
  ])
}

function normalizeQueryCondition(condition: Partial<MockQueryCondition>): MockQueryCondition {
  return {
    key: String(condition?.key ?? ''),
    op: (MOCK_QUERY_OPERATORS as readonly string[]).includes(condition?.op)
      ? condition.op
      : 'equals',
    value: condition?.value == null ? '' : String(condition.value),
    ignoreCase: !!condition?.ignoreCase,
    source: condition?.source,
  }
}

function normalizeHeaderCondition(condition: Partial<MockHeaderCondition>): MockHeaderCondition {
  return {
    name: String(condition?.name ?? ''),
    op: (MOCK_QUERY_OPERATORS as readonly string[]).includes(condition?.op)
      ? condition.op
      : 'equals',
    value: condition?.value == null ? '' : String(condition.value),
    ignoreCase: !!condition?.ignoreCase,
    source: condition?.source,
  }
}

function normalizeDerivation(derivation?: Partial<MockMatchDerivation>): MockMatchDerivation | undefined {
  if (derivation == null) return undefined
  const source = derivation.source
  return {
    source: source === 'recording' || source === 'migration' || source === 'import' ? source : 'manual',
    autoIgnoredKeys: uniqueStrings(derivation.autoIgnoredKeys).sort(),
    suggestions: Array.isArray(derivation.suggestions)
      ? derivation.suggestions
        .filter(it => it != null && it.key != null)
        .map(it => ({ key: String(it.key), evidence: it.evidence, reason: String(it.reason ?? '') }))
      : [],
    pathParameterized: !!derivation.pathParameterized,
    analyzedAt: Number.isFinite(Number(derivation.analyzedAt)) ? Number(derivation.analyzedAt) : 0,
  }
}

/** 补齐默认值，保证旧文档读出后可直接进入 Matcher */
export function normalizeMatchRule(match: Partial<MockMatchRule>): MockMatchRule {
  const query = match?.query
  const headers = match?.headers
  const parameterizedIndex = Number(match?.parameterizedSegmentIndex)

  return {
    version: 1,
    level: (MOCK_MATCH_LEVELS as readonly string[]).includes(match?.level) ? match.level : 'custom',
    method: normalizeMethod(match?.method),
    host: normalizeHost(match?.host),
    pathType: (MOCK_PATH_TYPES as readonly string[]).includes(match?.pathType) ? match.pathType : 'exact',
    path: match?.path == null ? '' : String(match.path),
    pathIgnoreCase: !!match?.pathIgnoreCase,
    ignoreTrailingSlash: match?.ignoreTrailingSlash !== false,
    query: {
      mode: query?.mode === 'match' ? 'match' : 'ignore',
      ignoreKeys: uniqueStrings(query?.ignoreKeys),
      conditions: Array.isArray(query?.conditions)
        ? query.conditions.map(it => normalizeQueryCondition(it))
        : [],
      // 标准档与历史迁移默认允许额外参数；严格档显式写入 false
      allowExtra: query?.allowExtra !== false,
      multiValue: query?.multiValue === 'all' ? 'all' : 'any',
    },
    headers: {
      ignoreKeys: uniqueStrings(headers?.ignoreKeys),
      conditions: Array.isArray(headers?.conditions)
        ? headers.conditions.map(it => normalizeHeaderCondition(it))
        : [],
    },
    body: { mode: 'ignore' },
    priority: match?.priority == null || !Number.isFinite(Number(match.priority)) ? null : Number(match.priority),
    enabled: match?.enabled !== false,
    derivation: normalizeDerivation(match?.derivation),
    pathOriginal: match?.pathOriginal == null ? undefined : String(match.pathOriginal),
    parameterizedSegmentIndex: Number.isInteger(parameterizedIndex) ? parameterizedIndex : null,
  }
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
    match: record?.match == null ? undefined : normalizeMatchRule(record.match),
    matchInvalid: record?.matchInvalid,
    matchFingerprint: record?.matchFingerprint,
    matchWarnings: record?.matchWarnings,
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
