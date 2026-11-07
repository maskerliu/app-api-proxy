import type { ProxyMock } from './proxy.models'

// 纯模型层：匹配契约与常量。主进程、渲染层共用，不得依赖 Node / axios / vant。

/** Method 哨兵值：表示任意方法，禁止用空串表达 */
export const MOCK_ANY_METHOD = 'ANY'
export const MOCK_METHODS = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export const MOCK_PATH_TYPES = ['exact', 'prefix', 'glob', 'regex'] as const
export const MOCK_MATCH_LEVELS = ['loose', 'standard', 'strict', 'custom'] as const
export const MOCK_QUERY_OPERATORS = ['equals', 'regex', 'exists', 'notExists'] as const

/** 正则 pattern 长度上限；运行期被匹配 Path 截断到 2,048 字符 */
export const MOCK_MAX_PATTERN_LENGTH = 200
export const MOCK_MAX_PATH_LENGTH = 2048

/** 规模护栏：只提示 / 拒绝启用（禁止静默截断） */
export const MOCK_RECORD_WARN_LIMIT = 5000
export const MOCK_RECORD_REJECT_LIMIT = 10000

/** E2：请求级噪声，自动忽略 */
export const MOCK_HIGH_RISK_KEYS = [
  'ts', 'timestamp', '_t', 'nonce', 'sign', 'signature', 'requestId', 'traceId', 'spanId',
  'sessionId', 'token', 'access_token', 'deviceId', 'device_id', 'udid', 'imei', 'oaid', 'idfa',
] as const

/** E5：业务语义键，永不自动忽略（优先级高于 E1/E2） */
export const MOCK_SEMANTIC_KEYS = [
  'version', 'v', 'tenant', 'tenantId', 'role', 'exp', 'user_id', 'uid', 'time',
  'page', 'size', 'cursor', 'status', 'type', 'lang', 'locale',
] as const

/** 解释、诊断中必须脱敏的敏感键名（小写比较） */
export const MOCK_SENSITIVE_KEYS = ['sign', 'token', 'authorization', 'cookie'] as const

export type MockMatchLevel = typeof MOCK_MATCH_LEVELS[number]
export type PathMatchType = typeof MOCK_PATH_TYPES[number]
export type MockQueryOperator = typeof MOCK_QUERY_OPERATORS[number]
export type MockMultiValueMode = 'any' | 'all'

export type MockMatchDimensionName = 'method' | 'host' | 'path' | 'query' | 'header'
export type MockMatchOrdering =
  | 'manual-priority'
  | 'path-specificity'
  | 'condition-count'
  | 'updated-at'
  | 'record-id'
export type MockEvidence = 'E1' | 'E2' | 'E3' | 'E4' | 'E5'
export type MockIgnoreEvidence = MockEvidence | 'manual' | 'migration'
export type MockDerivationSource = 'recording' | 'migration' | 'import' | 'manual'
export type MockConditionSource = 'recording' | 'migration' | 'import' | 'manual'
export type MockMissSuggestion = 'ignore-key' | 'edit-record' | 'loosen'
export type MockMatchWarningType = 'duplicate' | 'shadowed' | 'unreachable' | 'invalid'

export interface MockQueryCondition {
  key: string
  op: MockQueryOperator
  value: string
  ignoreCase?: boolean
  source?: MockConditionSource
}

export interface MockQueryMatch {
  mode: 'ignore' | 'match'
  ignoreKeys: string[]
  conditions: MockQueryCondition[]
  allowExtra: boolean
  multiValue: MockMultiValueMode
}

export interface MockHeaderCondition {
  name: string
  op: MockQueryOperator
  value: string
  ignoreCase?: boolean
  source?: MockConditionSource
}

export interface MockHeaderMatch {
  ignoreKeys: string[]
  conditions: MockHeaderCondition[]
}

/** 本期固定不参与匹配，保留结构给后续演进 */
export interface MockBodyMatch {
  mode: 'ignore'
}

export interface MockMatchSuggestion {
  key: string
  evidence: MockEvidence
  reason: string
}

export interface MockMatchDerivation {
  source: MockDerivationSource
  autoIgnoredKeys: string[]
  suggestions: MockMatchSuggestion[]
  pathParameterized: boolean
  analyzedAt: number
}

export interface MockMatchRule {
  version: 1
  level: MockMatchLevel
  method: string
  host: string
  pathType: PathMatchType
  path: string
  pathIgnoreCase: boolean
  ignoreTrailingSlash: boolean
  query: MockQueryMatch
  headers: MockHeaderMatch
  body: MockBodyMatch
  priority: number | null
  enabled: boolean
  derivation?: MockMatchDerivation
  /** Path 参数化前的原文，用于精确还原（R1C-11） */
  pathOriginal?: string
  parameterizedSegmentIndex?: number | null
}

export interface MockExplainCondition {
  dimension: MockMatchDimensionName
  index: number
  key: string
  op: MockQueryOperator
  passed: boolean
  ignored: boolean
  expected?: string
  actual?: string
}

export interface MockExplainDimension {
  dimension: MockMatchDimensionName
  passed: boolean
  matchedCount?: number
  totalCount?: number
}

export interface MockExplainIgnoredKey {
  key: string
  evidence: MockIgnoreEvidence
}

export interface MockMatchExplain {
  recordId: string
  level: MockMatchLevel
  dimensions: MockExplainDimension[]
  conditions: MockExplainCondition[]
  ignoredKeys: MockExplainIgnoredKey[]
  ordering: MockMatchOrdering
  elapsedMs: number
  truncated?: boolean
}

export interface MockMissFailure {
  dimension: MockMatchDimensionName
  /** 失败条件对应的 Query/Header 键，供 UI 直接生成「忽略该参数」动作 */
  key?: string
  expected: string
  actual: string
  detail?: string
  suggestion?: MockMissSuggestion
}

/** 多窗口同步 Mock 开关状态 */
export interface MockStatusBroadcast {
  ruleId: string | null
  ruleName?: string
  enabled: boolean
}

export interface MockMissDiagnostic {
  recordId: string
  recordName: string
  /** 0 ~ 1，供 UI 判断是否展示灰标 */
  score: number
  failures: MockMissFailure[]
  suggestion?: MockMissSuggestion
  candidateCount: number
}

export interface MockMatchWarning {
  recordId: string
  type: MockMatchWarningType
  coveredBy?: string
  message?: string
}

/** REQUEST_END 携带的命中/未命中元数据，UI 字段与之一一对应 */
export interface MockHitMeta {
  hit: boolean
  recordId?: string
  level?: MockMatchLevel
  variantId?: string
  ignoredKeys?: string[]
  ordering?: MockMatchOrdering
  elapsedMs?: number
  degraded?: boolean
  miss?: MockMissDiagnostic
}

export interface MockMatchResult {
  matched: boolean
  recordId?: string
  record?: ProxyMock.MockRecord
  ordering?: MockMatchOrdering
  degraded?: boolean
  explain?: MockMatchExplain
  miss?: MockMissDiagnostic
}

export interface MockLimitState {
  count: number
  warn: boolean
  reject: boolean
  suggestion?: 'splitRecommended' | 'recordTooMany'
}

export interface MockDefaultMatchInput {
  method?: string
  host?: string
  path: string
  pathType?: PathMatchType
  query?: MockQueryCondition[]
  ignoreKeys?: string[]
  allowExtra?: boolean
  multiValue?: MockMultiValueMode
  headerConditions?: MockHeaderCondition[]
  level?: MockMatchLevel
  priority?: number | null
  source?: MockDerivationSource
}

// ---- API 契约（R1C-03） ----

export interface MatchMockRequest {
  ruleId?: string
  method?: string
  url: string
  headers?: Record<string, string | string[]>
}

export interface MatchMockResponse {
  matched: boolean
  meta: MockHitMeta
  recordId?: string
  record?: ProxyMock.MockRecord
  explain?: MockMatchExplain
}

export interface AnalyzeMockRequest {
  ruleId: string
  recordId?: string
  method?: string
  url?: string
}

export interface AnalyzeMockResponse {
  derivation: MockMatchDerivation
  autoIgnoredKeys: string[]
  suggestions: MockMatchSuggestion[]
  pathParameterized: boolean
  pathOriginal?: string
  pathSuggested?: string
}

export interface MockMigrationReportItem {
  recordId: string
  ruleId?: string
  name?: string
  autoIgnoredKeys: string[]
  pathParameterized: boolean
  invalidReason?: string
  revertedAt?: number
}

export interface MockMigrationDuplicate {
  fingerprint: string
  keptRecordId: string
  disabledRecordIds: string[]
}

export interface MigrationReport {
  migratedAt: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  totalRecords: number
  processedRecords?: number
  autoRelaxedRecords: number
  autoIgnoredKeyCount: number
  parameterizedPathCount: number
  invalidRecords: number
  items: MockMigrationReportItem[]
  duplicates: MockMigrationDuplicate[]
  errors?: Array<{ recordId: string; reason: string }>
  /** 迁移耗时与主进程堆峰值，供复核页与压测报告展示 */
  durationMs?: number
  peakHeapUsedMb?: number
}

export interface RevertMockRequest {
  scope: 'record' | 'all'
  recordId?: string
  ruleId?: string
}

export interface RevertMockResponse {
  reverted: number
  failed: Array<{ recordId: string; reason: string }>
  duplicateDisabled?: string[]
}

export function normalizeMethod(method?: string): string {
  const value = String(method ?? '').trim().toUpperCase()
  return value === '' ? MOCK_ANY_METHOD : value
}

/** 去协议、路径与查询，保留端口；用于条件与归一化后的 Host */
export function normalizeHost(host?: string): string {
  let value = String(host ?? '').trim().toLowerCase()
  if (value === '') return ''
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  value = value.replace(/[/?#].*$/, '')
  return value
}

export function uniqueStrings(values?: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of values ?? []) {
    const value = String(item ?? '').trim()
    if (value === '' || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

export function createDefaultMatch(input: MockDefaultMatchInput): MockMatchRule {
  const conditions = (input?.query ?? []).map(it => ({
    key: String(it.key ?? ''),
    op: it.op ?? 'equals',
    value: it.value == null ? '' : String(it.value),
    ignoreCase: !!it.ignoreCase,
    source: it.source,
  }))
  const ignoreKeys = uniqueStrings(input?.ignoreKeys)
  const hasQuery = conditions.length > 0

  return {
    version: 1,
    level: input?.level ?? (hasQuery ? 'standard' : 'loose'),
    method: normalizeMethod(input?.method),
    host: normalizeHost(input?.host),
    pathType: input?.pathType ?? 'exact',
    path: input?.path ?? '',
    pathIgnoreCase: false,
    ignoreTrailingSlash: true,
    query: {
      mode: hasQuery ? 'match' : 'ignore',
      ignoreKeys,
      conditions,
      allowExtra: input?.allowExtra !== false,
      multiValue: input?.multiValue === 'all' ? 'all' : 'any',
    },
    headers: {
      ignoreKeys: [],
      conditions: (input?.headerConditions ?? []).map(it => ({ ...it, name: String(it.name ?? '') })),
    },
    body: { mode: 'ignore' },
    priority: input?.priority ?? null,
    enabled: true,
    derivation: {
      source: input?.source ?? 'manual',
      autoIgnoredKeys: [...ignoreKeys],
      suggestions: [],
      pathParameterized: false,
      analyzedAt: 0,
    },
  }
}

/**
 * 结构上是否仍是某个预设档位；手动改条件后返回 custom。
 * 档位只用于展示与批量操作，执行始终按实际条件。
 */
export function levelOf(match?: MockMatchRule | null): MockMatchLevel {
  if (match == null) return 'custom'
  const queryMode = match.query?.mode ?? 'ignore'
  const headerCount = match.headers?.conditions?.length ?? 0

  if (queryMode === 'ignore') {
    if (match.pathType === 'exact' && headerCount === 0) return 'loose'
    return 'custom'
  }
  if (match.query?.allowExtra === false) return 'strict'
  if (headerCount > 0) return 'custom'
  if (match.pathType === 'exact' || match.pathType === 'glob') return 'standard'
  return 'custom'
}

export function isMatchEnabled(record?: ProxyMock.MockRecord | null): boolean {
  return record?.match != null && record.match.enabled !== false && record.matchInvalid == null
}

export function recordLimitState(count: number): MockLimitState {
  const total = Number.isFinite(count) ? Math.max(0, count) : 0
  return {
    count: total,
    warn: total > MOCK_RECORD_WARN_LIMIT,
    reject: total > MOCK_RECORD_REJECT_LIMIT,
    suggestion: total > MOCK_RECORD_REJECT_LIMIT
      ? 'recordTooMany'
      : total > MOCK_RECORD_WARN_LIMIT ? 'splitRecommended' : undefined,
  }
}