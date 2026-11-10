import type { ProxyMock } from '@shared/proxy.models'
import type {
  MockExplainCondition, MockExplainDimension, MockExplainIgnoredKey, MockHeaderCondition, MockMatchDimensionName,
  MockMatchExplain, MockMatchOrdering, MockMatchRule, MockMissDiagnostic, MockMissFailure, MockMissSuggestion,
  MockQueryCondition, MockQueryOperator,
} from '@shared/mock.models'
import {
  MOCK_ANY_METHOD, MOCK_MAX_PATH_LENGTH, MOCK_SENSITIVE_KEYS, normalizeHost,
} from '@shared/mock.models'
import { normalizeMatchRule } from '@shared/mock.validation'
import { headerValuesOf, MOCK_HOST_HEADER } from '@shared/http-header'
import {
  decodeQueryPart, normalizePathname, pathSegments, PLACEHOLDER_BASE, queryParts, splitHostPort,
  stripTrailingSlash,
} from '@shared/url'

// Matcher：只做 CPU 计算，不读库、不写库、不抛业务异常。
// 热路径（testMatch / compare）不构造字符串；只有最终命中与 top-1 诊断才物化文案。

export interface NormalizedQueryValue {
  values: string[]
  // 该键的每次出现都带 '='；?a 与 ?a= 因此在 equals '' 时可区分
  hasEquals: boolean
}

export interface NormalizedRequest {
  method: string
  host: string
  port: number | null
  path: string
  query: Map<string, NormalizedQueryValue>
  headers: Map<string, string[]>
  rawUrl: string
}

export interface MatcherRequestInput {
  method?: string
  url: string
  headers?: Record<string, string | string[] | undefined>
}

interface PreparedCondition {
  key: string
  op: MockQueryOperator
  value: string
  ignoreCase: boolean
  regex: RegExp | null
}

export interface CompiledMatchRecord {
  recordId: string
  record: ProxyMock.MockRecord
  match: MockMatchRule
  method: string
  host: string
  pathType: MockMatchRule['pathType']
  specificity: number
  conditionCount: number
  priority: number | null
  updatedAt: number
  testPath: (path: string) => boolean
  queryConditions: PreparedCondition[]
  headerConditions: PreparedCondition[]
}

export interface MatchedCandidate {
  compiled: CompiledMatchRecord
  ordering: MockMatchOrdering
}

export interface MatchRecordsOptions {
  explain?: boolean
  elapsedMs?: number
}

const SENSITIVE_KEY_SET = new Set<string>(MOCK_SENSITIVE_KEYS)
const PATH_SPECIFICITY: Record<MockMatchRule['pathType'], number> = {
  exact: 4,
  prefix: 3,
  glob: 2,
  regex: 1,
}
const REGEX_CACHE_LIMIT = 512
const REGEX_CACHE = new Map<string, RegExp | null>()

export function pathSpecificity(type: MockMatchRule['pathType']): number {
  return PATH_SPECIFICITY[type] ?? 0
}

export function isSensitiveKey(key: string): boolean {
  const lower = String(key ?? '').toLowerCase()
  return SENSITIVE_KEY_SET.has(lower) || lower === 'access_token' || lower.endsWith('_token')
}

export function maskValue(key: string, value: string): string {
  return isSensitiveKey(key) ? '***' : value
}

// ---------------- 归一化 ----------------

function parseQuery(rawUrl: string): Map<string, NormalizedQueryValue> {
  const result = new Map<string, NormalizedQueryValue>()

  for (const part of queryParts(rawUrl)) {
    const eq = part.indexOf('=')
    const rawKey = eq < 0 ? part : part.slice(0, eq)
    const key = decodeQueryPart(rawKey)
    const hasEquals = eq >= 0
    const value = hasEquals ? decodeQueryPart(part.slice(eq + 1)) : ''

    const entry = result.get(key)
    if (entry == null) {
      result.set(key, { values: [value], hasEquals })
    } else {
      entry.values.push(value)
      entry.hasEquals = entry.hasEquals && hasEquals
    }
  }
  return result
}

export function normalizeRequest(input: MatcherRequestInput): NormalizedRequest {
  const rawUrl = String(input?.url ?? '')
  const method = String(input?.method ?? '').trim().toUpperCase()

  let pathname = '/'
  try {
    pathname = new URL(rawUrl, PLACEHOLDER_BASE).pathname
  } catch (err) {
    const question = rawUrl.indexOf('?')
    const hash = rawUrl.indexOf('#')
    const end = [question, hash].filter(it => it >= 0).sort((a, b) => a - b)[0]
    pathname = end == null ? rawUrl : rawUrl.slice(0, end)
  }
  const path = normalizePathname(pathname)

  const headers = new Map<string, string[]>()
  const sourceHeaders = input?.headers ?? {}
  for (const name of Object.keys(sourceHeaders)) {
    const values = headerValuesOf(sourceHeaders[name])
    if (values != null) headers.set(name.toLowerCase(), values)
  }

  const rawHost = (headers.get(MOCK_HOST_HEADER)?.[0] ?? headers.get('host')?.[0] ?? '').trim()
  const parsedHost = splitHostPort(normalizeHost(rawHost))

  return {
    method,
    host: parsedHost.host,
    port: parsedHost.port,
    path,
    query: parseQuery(rawUrl),
    headers,
    rawUrl,
  }
}

// ---------------- Path / 条件编译 ----------------

function escapeRegExpChar(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function globToPattern(glob: string): string {
  let result = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '\\') {
      i++
      if (i < glob.length) result += escapeRegExpChar(glob[i])
      continue
    }
    if (ch === '*') {
      result += '.*'
      continue
    }
    if (ch === '?') {
      result += '[^/]'
      continue
    }
    result += escapeRegExpChar(ch)
  }
  return result
}

function compileRegex(pattern: string, flags: string): RegExp | null {
  const key = `${flags}/${pattern}`
  if (REGEX_CACHE.has(key)) {
    const cached = REGEX_CACHE.get(key)
    REGEX_CACHE.delete(key)
    REGEX_CACHE.set(key, cached)
    return cached
  }

  let compiled: RegExp | null = null
  try {
    compiled = new RegExp(`^(?:${pattern})$`, flags)
  } catch (err) {
    // 运行期编译失败按不命中处理，绝不让请求链路崩溃
    compiled = null
  }

  REGEX_CACHE.set(key, compiled)
  while (REGEX_CACHE.size > REGEX_CACHE_LIMIT) {
    const oldest = REGEX_CACHE.keys().next().value
    REGEX_CACHE.delete(oldest)
  }
  return compiled
}

function pathForCompare(path: string, ignoreCase: boolean, ignoreTrailingSlash: boolean): string {
  const value = ignoreCase ? path.toLowerCase() : path
  return ignoreTrailingSlash ? stripTrailingSlash(value, true) : value
}

function createPathTester(match: MockMatchRule): (path: string) => boolean {
  const ignoreCase = !!match.pathIgnoreCase
  const ignoreSlash = match.ignoreTrailingSlash !== false
  const pattern = pathForCompare(match.path, ignoreCase, ignoreSlash)

  switch (match.pathType) {
    case 'exact':
      return path => pathForCompare(path, ignoreCase, ignoreSlash) === pattern
    case 'prefix':
      return path => pathForCompare(path, ignoreCase, ignoreSlash).startsWith(pattern)
    case 'glob': {
      const reg = compileRegex(globToPattern(pattern), ignoreCase ? 'i' : '')
      if (reg == null) return () => false
      return path => reg.test(pathForCompare(path.slice(0, MOCK_MAX_PATH_LENGTH), ignoreCase, ignoreSlash))
    }
    case 'regex': {
      const reg = compileRegex(match.path, ignoreCase ? 'i' : '')
      if (reg == null) return () => false
      return path => reg.test(path.slice(0, MOCK_MAX_PATH_LENGTH))
    }
    default:
      return () => false
  }
}

function prepareConditions(conditions?: Array<MockQueryCondition | MockHeaderCondition>,
  lowerCaseKey: boolean = false): PreparedCondition[] {
  return (conditions ?? []).map(condition => {
    const rawKey = 'key' in condition ? condition.key : condition.name
    const key = String(rawKey ?? '')
    const ignoreCase = !!condition.ignoreCase
    return {
      key: lowerCaseKey ? key.toLowerCase() : key,
      op: condition.op,
      value: condition.value == null ? '' : String(condition.value),
      ignoreCase,
      regex: condition.op === 'regex'
        ? compileRegex(String(condition.value ?? ''), ignoreCase ? 'i' : '')
        : null,
    }
  })
}

function conditionSpecificityCount(match: MockMatchRule): number {
  let count = 0
  if (match.method !== MOCK_ANY_METHOD) count++
  if (match.host !== '') count++
  if (match.query.mode === 'match') {
    count += match.query.conditions.length
    if (match.query.allowExtra === false) count++
  }
  count += match.headers.conditions.length
  return count
}

export function compileRecord(record: ProxyMock.MockRecord): CompiledMatchRecord | null {
  if (record?.match == null || record.match.enabled === false || record.matchInvalid != null) return null
  const match = normalizeMatchRule(record.match)
  return {
    recordId: record.id,
    record,
    match,
    method: match.method,
    host: match.host,
    pathType: match.pathType,
    specificity: pathSpecificity(match.pathType),
    conditionCount: conditionSpecificityCount(match),
    priority: match.priority,
    updatedAt: record.updatedAt ?? 0,
    testPath: createPathTester(match),
    queryConditions: prepareConditions(match.query.conditions),
    headerConditions: prepareConditions(match.headers.conditions, true),
  }
}

// ---------------- 条件判定 ----------------

function hostMatches(conditionHost: string, request: NormalizedRequest): boolean {
  if (conditionHost === '') return true
  const parsed = splitHostPort(normalizeHost(conditionHost))
  if (parsed.host.startsWith('*.')) {
    const base = parsed.host.slice(2)
    if (parsed.host === '*') return true
    if (!request.host.endsWith(`.${base}`)) return false
  } else if (parsed.host !== request.host) {
    return false
  }
  return parsed.port == null || parsed.port === request.port
}

function methodMatches(conditionMethod: string, request: NormalizedRequest): boolean {
  if (conditionMethod === MOCK_ANY_METHOD || conditionMethod === '') return true
  return conditionMethod === request.method
}

function evaluateCondition(condition: PreparedCondition, entry: NormalizedQueryValue,
  multiValue: 'any' | 'all'): boolean {
  if (condition.op === 'exists') return entry != null
  if (condition.op === 'notExists') return entry == null
  if (entry == null) return false

  if (condition.op === 'equals') {
    const expected = condition.value
    const test = (value: string) => {
      if (expected === '' && !entry.hasEquals) return false
      return condition.ignoreCase ? value.toLowerCase() === expected.toLowerCase() : value === expected
    }
    return multiValue === 'all'
      ? entry.values.length > 0 && entry.values.every(test)
      : entry.values.some(test)
  }

  if (condition.regex == null) return false
  const test = (value: string) => condition.regex.test(value)
  return multiValue === 'all'
    ? entry.values.length > 0 && entry.values.every(test)
    : entry.values.some(test)
}

function testQuery(compiled: CompiledMatchRecord, request: NormalizedRequest): boolean {
  const match = compiled.match
  if (match.query.mode === 'ignore') return true

  const ignored = new Set(match.query.ignoreKeys ?? [])
  if (match.query.allowExtra === false) {
    const declared = new Set<string>()
    for (const condition of compiled.queryConditions) declared.add(condition.key)
    for (const key of request.query.keys()) {
      if (!ignored.has(key) && !declared.has(key)) return false
    }
  }

  const multiValue = match.query.multiValue === 'all' ? 'all' : 'any'
  for (const condition of compiled.queryConditions) {
    if (ignored.has(condition.key)) continue
    if (!evaluateCondition(condition, request.query.get(condition.key), multiValue)) return false
  }
  return true
}

function headerEntry(values: string[]): NormalizedQueryValue {
  return values == null ? null : { values, hasEquals: true }
}

function testHeaders(compiled: CompiledMatchRecord, request: NormalizedRequest): boolean {
  for (const condition of compiled.headerConditions) {
    if (!evaluateCondition(condition, headerEntry(request.headers.get(condition.key)), 'any')) return false
  }
  return true
}

export interface MatchCheck {
  passed: boolean
  method: boolean
  host: boolean
  path: boolean
  query: boolean
  header: boolean
}

export function checkRecord(compiled: CompiledMatchRecord, request: NormalizedRequest): MatchCheck {
  const method = methodMatches(compiled.method, request)
  if (!method) return { passed: false, method, host: false, path: false, query: false, header: false }

  const host = hostMatches(compiled.host, request)
  if (!host) return { passed: false, method, host, path: false, query: false, header: false }

  const path = compiled.testPath(request.path)
  if (!path) return { passed: false, method, host, path, query: false, header: false }

  const query = testQuery(compiled, request)
  if (!query) return { passed: false, method, host, path, query, header: false }

  const header = testHeaders(compiled, request)
  return { passed: header, method, host, path, query, header }
}

// ---------------- 排序 ----------------

function compareCandidates(a: CompiledMatchRecord, b: CompiledMatchRecord): { order: number; ordering: MockMatchOrdering } {
  if (a.priority != null || b.priority != null) {
    if (a.priority == null) return { order: -1, ordering: 'manual-priority' }
    if (b.priority == null) return { order: 1, ordering: 'manual-priority' }
    if (a.priority !== b.priority) {
      return { order: a.priority > b.priority ? 1 : -1, ordering: 'manual-priority' }
    }
  }
  if (a.specificity !== b.specificity) {
    return { order: a.specificity > b.specificity ? 1 : -1, ordering: 'path-specificity' }
  }
  if (a.conditionCount !== b.conditionCount) {
    return { order: a.conditionCount > b.conditionCount ? 1 : -1, ordering: 'condition-count' }
  }
  if (a.updatedAt !== b.updatedAt) {
    return { order: a.updatedAt > b.updatedAt ? 1 : -1, ordering: 'updated-at' }
  }
  if (a.recordId !== b.recordId) {
    return { order: a.recordId < b.recordId ? 1 : -1, ordering: 'record-id' }
  }
  return { order: 0, ordering: 'record-id' }
}

export function findBestMatch(records: CompiledMatchRecord[], request: NormalizedRequest): MatchedCandidate | null {
  let best: CompiledMatchRecord = null
  let ordering: MockMatchOrdering = 'record-id'

  for (const compiled of records) {
    if (!checkRecord(compiled, request).passed) continue
    if (best == null) {
      best = compiled
      ordering = 'record-id'
      continue
    }
    const compared = compareCandidates(compiled, best)
    if (compared.order > 0) {
      best = compiled
      ordering = compared.ordering
    }
  }

  return best == null ? null : { compiled: best, ordering }
}

// ---------------- 命中解释 ----------------

function formatQueryActual(entry: NormalizedQueryValue): string {
  if (entry == null) return '(缺失)'
  if (entry.values.length === 0) return entry.hasEquals ? '' : '(无值)'
  return entry.values.join(', ')
}

function actualHeader(request: NormalizedRequest, name: string): string {
  const values = request.headers.get(name)
  return values == null ? '(缺失)' : values.join(', ')
}

export function explainMatch(compiled: CompiledMatchRecord, request: NormalizedRequest,
  ordering: MockMatchOrdering, elapsedMs: number): MockMatchExplain {
  const match = compiled.match
  const check = checkRecord(compiled, request)
  const maxPerDimension = 20
  const conditions: MockExplainCondition[] = []
  let truncated = false

  if (match.query.mode === 'match') {
    const prepared = compiled.queryConditions
    const ignored = new Set(match.query.ignoreKeys ?? [])
    const multiValue = match.query.multiValue === 'all' ? 'all' : 'any'
    prepared.slice(0, maxPerDimension).forEach((condition, index) => {
      const entry = request.query.get(condition.key)
      conditions.push({
        dimension: 'query',
        index,
        key: condition.key,
        op: condition.op,
        passed: ignored.has(condition.key) || evaluateCondition(condition, entry, multiValue),
        ignored: ignored.has(condition.key),
        expected: maskValue(condition.key, `${condition.key} ${condition.op} ${condition.value}`),
        actual: maskValue(condition.key, formatQueryActual(entry)),
      })
    })
    if (prepared.length > maxPerDimension) truncated = true
  }

  const headerPrepared = compiled.headerConditions
  headerPrepared.slice(0, maxPerDimension).forEach((condition, index) => {
    conditions.push({
      dimension: 'header',
      index,
      key: condition.key,
      op: condition.op,
      passed: evaluateCondition(condition, headerEntry(request.headers.get(condition.key)), 'any'),
      ignored: false,
      expected: maskValue(condition.key, `${condition.key} ${condition.op} ${condition.value}`),
      actual: maskValue(condition.key, actualHeader(request, condition.key)),
    })
  })
  if (headerPrepared.length > maxPerDimension) truncated = true

  const dimensions: MockExplainDimension[] = [
    { dimension: 'method', passed: check.method },
    { dimension: 'host', passed: check.host },
    { dimension: 'path', passed: check.path },
    {
      dimension: 'query',
      passed: check.query,
      matchedCount: conditions.filter(it => it.dimension === 'query' && it.passed).length,
      totalCount: conditions.filter(it => it.dimension === 'query').length,
    },
    {
      dimension: 'header',
      passed: check.header,
      matchedCount: conditions.filter(it => it.dimension === 'header' && it.passed).length,
      totalCount: conditions.filter(it => it.dimension === 'header').length,
    },
  ]

  const derivation = match.derivation
  const autoIgnored = new Set(derivation?.autoIgnoredKeys ?? [])
  const ignoredKeys: MockExplainIgnoredKey[] = (match.query.ignoreKeys ?? []).map(key => ({
    key,
    evidence: autoIgnored.has(key) ? (isSensitiveKey(key) ? 'E2' : 'E1') : 'manual',
  }))

  return {
    recordId: compiled.recordId,
    level: match.level,
    dimensions,
    conditions,
    ignoredKeys,
    ordering,
    elapsedMs,
    truncated,
  }
}

// ---------------- 未命中诊断（两阶段） ----------------

function sharedSegmentCount(a: string[], b: string[]): number {
  let shared = 0
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++
  return shared
}

function pathSimilarity(a: string, b: string): number {
  const sa = pathSegments(a)
  const sb = pathSegments(b)
  if (sa.length === 0 || sb.length === 0) return a === b ? 1 : 0

  const shared = sharedSegmentCount(sa, sb)
  const prefixRatio = shared / Math.max(sa.length, sb.length)
  const setB = new Set(sb)
  const intersection = sa.filter(it => setB.has(it)).length
  const union = new Set([...sa, ...sb]).size
  const jaccard = union === 0 ? 0 : intersection / union
  const first = sa[0] === sb[0] ? 1 : 0
  return 0.4 * first + 0.35 * prefixRatio + 0.25 * jaccard
}

function normalizedEditDistance(a: string, b: string): number {
  const left = a.slice(0, 512)
  const right = b.slice(0, 512)
  const max = Math.max(left.length, right.length)
  if (max === 0) return 0

  let previous = new Array(right.length + 1)
  let current = new Array(right.length + 1)
  for (let j = 0; j <= right.length; j++) previous[j] = j

  for (let i = 1; i <= left.length; i++) {
    current[0] = i
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
    }
    const swap = previous
    previous = current
    current = swap
  }
  return previous[right.length] / max
}

function failureSuggestion(dimension: MockMatchDimensionName): MockMissSuggestion {
  if (dimension === 'query' || dimension === 'header') return 'ignore-key'
  if (dimension === 'method' || dimension === 'host' || dimension === 'path') return 'edit-record'
  return 'loosen'
}

function buildFailures(compiled: CompiledMatchRecord, request: NormalizedRequest, check: MatchCheck): MockMissFailure[] {
  const match = compiled.match
  const failures: MockMissFailure[] = []

  if (!check.method) {
    failures.push({
      dimension: 'method',
      expected: compiled.method,
      actual: request.method === '' ? MOCK_ANY_METHOD : request.method,
      suggestion: failureSuggestion('method'),
    })
  }
  if (!check.host) {
    failures.push({
      dimension: 'host',
      expected: compiled.host,
      actual: request.host === '' ? '(空)' : request.host,
      suggestion: failureSuggestion('host'),
    })
  }
  if (!check.path) {
    failures.push({
      dimension: 'path',
      expected: `${match.pathType} ${match.path}`,
      actual: request.path,
      suggestion: failureSuggestion('path'),
    })
  }
  if (!check.query && match.query.mode === 'match') {
    const multiValue = match.query.multiValue === 'all' ? 'all' : 'any'
    const ignored = new Set(match.query.ignoreKeys ?? [])
    const prepared = compiled.queryConditions
    const failed = prepared.find(condition => {
      if (ignored.has(condition.key)) return false
      return !evaluateCondition(condition, request.query.get(condition.key), multiValue)
    })
    if (failed != null) {
      failures.push({
        dimension: 'query',
        key: failed.key,
        expected: maskValue(failed.key, `${failed.key} ${failed.op} ${failed.value}`),
        actual: maskValue(failed.key, formatQueryActual(request.query.get(failed.key))),
        detail: 'conditionMismatch',
        suggestion: 'ignore-key',
      })
    } else {
      const declared = new Set(prepared.map(it => it.key))
      const extra = [...request.query.keys()].filter(key => !ignored.has(key) && !declared.has(key))
      failures.push({
        dimension: 'query',
        expected: '(不允许额外参数)',
        actual: extra.slice(0, 10).join(', '),
        detail: 'extraKeys',
        suggestion: 'loosen',
      })
    }
  }
  if (!check.header) {
    const prepared = compiled.headerConditions
    const failed = prepared.find(condition =>
      !evaluateCondition(condition, headerEntry(request.headers.get(condition.key)), 'any'))
    if (failed != null) {
      failures.push({
        dimension: 'header',
        key: failed.key,
        expected: maskValue(failed.key, `${failed.key} ${failed.op} ${failed.value}`),
        actual: maskValue(failed.key, actualHeader(request, failed.key)),
        detail: 'conditionMismatch',
        suggestion: 'ignore-key',
      })
    }
  }
  return failures
}

interface ScoredCandidate {
  compiled: CompiledMatchRecord
  score: number
  check: MatchCheck
}

/**
 * 两阶段：先用 Path 分段 + 维度通过数做廉价评分，
 * 只对少量高分候选计算编辑距离并物化失败原因。
 */
export function diagnoseMiss(records: CompiledMatchRecord[], request: NormalizedRequest): MockMissDiagnostic | null {
  if (records.length === 0) return null

  const scored: ScoredCandidate[] = []
  for (const compiled of records) {
    const check = checkRecord(compiled, request)
    const similarity = pathSimilarity(compiled.match.path, request.path)
    let score = similarity * 0.4
    if (check.method) score += 0.2
    if (check.host) score += 0.15
    if (check.query) score += 0.15
    if (check.header) score += 0.1
    scored.push({ compiled, score: Math.min(1, score), check })
  }

  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, 5)

  let best: ScoredCandidate = null
  for (const candidate of top) {
    const sourceSegments = pathSegments(candidate.compiled.match.path)
    const requestSegments = pathSegments(request.path)
    const shared = sharedSegmentCount(sourceSegments, requestSegments)
    const sharesFirstTwo = shared >= 2 || (sourceSegments.length < 2 && shared === sourceSegments.length)
    const distance = normalizedEditDistance(candidate.compiled.match.path, request.path)
    if (sharesFirstTwo || distance <= 0.35) {
      best = candidate
      break
    }
  }

  if (best == null) return null

  const failures = buildFailures(best.compiled, request, best.check)
  const suggestion = failures.find(it => it.dimension === 'query' || it.dimension === 'header')?.suggestion
    ?? 'edit-record'

  return {
    recordId: best.compiled.recordId,
    recordName: best.compiled.record.name || best.compiled.match.path,
    score: Number(best.score.toFixed(3)),
    failures,
    suggestion,
    candidateCount: records.length,
  }
}

// ---------------- 对外入口 ----------------

export function matchRecords(records: ProxyMock.MockRecord[], request: NormalizedRequest,
  options?: MatchRecordsOptions): { matched: boolean; record?: ProxyMock.MockRecord; recordId?: string; ordering?: MockMatchOrdering; explain?: MockMatchExplain; miss?: MockMissDiagnostic } {
  const compiled = (records ?? []).map(compileRecord).filter(it => it != null)
  const hit = findBestMatch(compiled, request)
  if (hit == null) {
    return { matched: false, miss: diagnoseMiss(compiled, request) }
  }

  const elapsedMs = options?.elapsedMs ?? 0
  return {
    matched: true,
    record: hit.compiled.record,
    recordId: hit.compiled.recordId,
    ordering: hit.ordering,
    explain: options?.explain
      ? explainMatch(hit.compiled, request, hit.ordering, elapsedMs)
      : undefined,
  }
}