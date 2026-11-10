import type { ProxyMock } from '@shared/proxy.models'
import type {
  MockDerivationSource, MockMatchDerivation, MockMatchLevel, MockMatchRule, MockMatchSuggestion,
  MockQueryCondition,
} from '@shared/mock.models'
import {
  MOCK_ANY_METHOD, MOCK_HIGH_RISK_KEYS, MOCK_SEMANTIC_KEYS, createDefaultMatch, levelOf,
} from '@shared/mock.models'
import { normalizeMatchRule, normalizeMockRecord } from '@shared/mock.validation'
import { MOCK_HOST_HEADER } from '@shared/http-header'
import { parseLooseUrl, pathSegments } from '@shared/url'
import { normalizeRequest } from './mock.matcher'

// 录制派生：纯函数、无 IO。同一输入多次运行输出完全一致（时间由调用方注入）。

const HIGH_RISK_KEYS = new Set<string>(MOCK_HIGH_RISK_KEYS)
const SEMANTIC_KEYS = new Set<string>(MOCK_SEMANTIC_KEYS)
const UUID_REG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LONG_HEX_REG = /^[0-9a-f]{16,}$/i
const VERSION_SEGMENT_REG = /^v\d+$/i
const FILE_EXTENSION_REG = /\.[a-z0-9]{1,8}$/i

export interface StabilityOptions {
  source?: MockDerivationSource
  analyzedAt?: number
}

export interface StabilityResult {
  recordId: string
  match?: MockMatchRule
  derivation?: MockMatchDerivation
  autoIgnoredKeys: string[]
  suggestions: MockMatchSuggestion[]
  pathParameterized: boolean
  pathOriginal?: string
  pathSuggested?: string
}

export interface LevelChange {
  match: MockMatchRule
  changed: boolean
  reason?: 'sourceMissing'
}

interface PreparedRecord {
  record: ProxyMock.MockRecord
  base: MockMatchRule
  url: string
  segments: string[]
  groupKey: string
}

interface KeyStat {
  present: number
  values: Set<string>
}

interface GroupAnalysis {
  keyStats: Map<string, KeyStat>
  size: number
  parameterizedPositions: Set<number>
  pathTemplate: string
  singleRecordSuggestion?: string
  singleRecordSuggestionIndex?: number
}

function isIdLikeSegment(segment: string): boolean {
  if (segment === '' || segment === '*') return false
  if (VERSION_SEGMENT_REG.test(segment)) return false
  if (FILE_EXTENSION_REG.test(segment)) return false
  if (/^\d{3,}$/.test(segment)) return true
  return UUID_REG.test(segment) || LONG_HEX_REG.test(segment)
}

function pathOfSegments(segments: string[]): string {
  return `/${segments.join('/')}`
}

function looksDynamicValue(value: string): boolean {
  if (value == null || value === '') return false
  if (/^\d{10,13}$/.test(value)) return true
  if (UUID_REG.test(value)) return true
  if (LONG_HEX_REG.test(value)) return true
  if (value.length >= 24 && /^[A-Za-z0-9+/=_-]+$/.test(value)) return true
  return false
}

function queryEntriesOf(match: MockMatchRule): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const condition of match.query?.conditions ?? []) {
    const list = result.get(condition.key) ?? []
    list.push(condition.value)
    result.set(condition.key, list)
  }
  for (const key of match.query?.ignoreKeys ?? []) {
    if (!result.has(key)) result.set(key, [])
  }
  return result
}

function parseRecordUrl(record: ProxyMock.MockRecord): string {
  return String(record.url || record.source?.url || '')
}

function queryEntriesOfRecord(record: ProxyMock.MockRecord, match: MockMatchRule, url: string): Map<string, string[]> {
  if (url !== '') {
    const normalized = normalizeRequest({ method: match.method, url })
    const result = new Map<string, string[]>()
    normalized.query.forEach((entry, key) => result.set(key, [...entry.values]))
    if (result.size > 0) return result
  }
  return queryEntriesOf(match)
}

/**
 * 从一条录制 URL 生成标准档初始条件（PRD 6.3）：
 * 有 Query 为 match，无 Query 为 ignore；Host 取录制时的 host 头。
 */
export function createMatchFromUrl(url: string, options?: {
  method?: string
  host?: string
  pathType?: MockMatchRule['pathType']
  source?: MockDerivationSource
  analyzedAt?: number
}): MockMatchRule | null {
  if (url == null || String(url).trim() === '') return null
  if (parseLooseUrl(String(url)) == null) return null

  const normalized = normalizeRequest({ method: options?.method, url })
  const conditions: MockQueryCondition[] = []
  let multiValue: 'any' | 'all' = 'any'
  normalized.query.forEach((entry, key) => {
    if (entry.values.length > 1) multiValue = 'any'
    conditions.push({
      key,
      op: 'equals',
      value: entry.values[0] ?? '',
      ignoreCase: false,
      source: 'recording',
    })
  })

  const host = options?.host
    ?? normalized.headers.get(MOCK_HOST_HEADER)?.[0]
    ?? normalized.headers.get('host')?.[0]
    ?? ''

  return createDefaultMatch({
    method: options?.method,
    host,
    path: normalized.path,
    pathType: options?.pathType ?? 'exact',
    query: conditions,
    allowExtra: true,
    multiValue,
    level: conditions.length > 0 ? 'standard' : 'loose',
    source: options?.source ?? 'recording',
    priority: null,
  })
}

function prepareRecord(record: ProxyMock.MockRecord): PreparedRecord | null {
  if (record == null) return null
  const normalized = normalizeMockRecord(record)
  const url = parseRecordUrl(normalized)
  const base = normalized.match != null
    ? normalizeMatchRule(normalized.match)
    : createMatchFromUrl(url, { method: normalized.source?.method })
  if (base == null) return null

  const segments = pathSegments(base.path)
  const groupSegments = segments.map((segment, index) => {
    if (index === 0) return segment
    return isIdLikeSegment(segment) ? '*' : segment
  })

  return {
    record: normalized,
    base,
    url,
    segments,
    groupKey: `${base.method}\u0000${pathOfSegments(groupSegments)}`,
  }
}

function buildGroupAnalysis(entries: PreparedRecord[]): GroupAnalysis {
  const keyStats = new Map<string, KeyStat>()
  // 分组内每条录制都算一次「键是否出现」，无 Query 的记录同样计入
  const size = entries.length

  for (const entry of entries) {
    const queryEntries = queryEntriesOfRecord(entry.record, entry.base, entry.url)
    queryEntries.forEach((values, key) => {
      const stat = keyStats.get(key) ?? { present: 0, values: new Set<string>() }
      stat.present++
      const joined = values.length === 0 ? '' : values.join('\u0000')
      stat.values.add(joined)
      keyStats.set(key, stat)
    })
  }

  const parameterizedPositions = new Set<number>()
  const maxSegments = Math.max(0, ...entries.map(it => it.segments.length))
  for (let index = 1; index < maxSegments; index++) {
    if (entries.some(it => it.segments[index] === '*')) continue
    const allIdLike = entries.every(it => it.segments[index] == null || isIdLikeSegment(it.segments[index]))
    if (!allIdLike) continue
    const values = new Set(entries.map(it => it.segments[index]).filter(it => it != null))
    if (values.size >= 2) parameterizedPositions.add(index)
  }

  const templateSegments = entries[0].segments.map((segment, index) =>
    parameterizedPositions.has(index) ? '*' : segment)
  const pathTemplate = pathOfSegments(templateSegments)

  let singleRecordSuggestion: string
  let singleRecordSuggestionIndex: number
  if (entries.length === 1) {
    const index = entries[0].segments.findIndex((segment, position) =>
      position > 0 && isIdLikeSegment(segment))
    if (index > 0) {
      singleRecordSuggestionIndex = index
      singleRecordSuggestion = pathOfSegments(entries[0].segments.map((segment, position) =>
        position === index ? '*' : segment))
    }
  }

  return {
    keyStats, size, parameterizedPositions, pathTemplate,
    singleRecordSuggestion, singleRecordSuggestionIndex,
  }
}

function buildSuggestions(group: GroupAnalysis): { autoIgnoredKeys: string[]; suggestions: MockMatchSuggestion[] } {
  const autoIgnoredKeys: string[] = []
  const suggestions: MockMatchSuggestion[] = []
  const keys = [...group.keyStats.keys()].sort()

  for (const key of keys) {
    const stat = group.keyStats.get(key)
    const lower = key.toLowerCase()
    const semantic = SEMANTIC_KEYS.has(lower)
    const highRisk = HIGH_RISK_KEYS.has(lower)
    const varies = stat.present >= 2 && stat.values.size >= 2
    const optional = group.size > 0 && stat.present < group.size
    const dynamicShape = [...stat.values].some(looksDynamicValue)

    // E5 优先于 E1/E2：语义键永不自动忽略
    if (semantic) {
      suggestions.push({ key, evidence: 'E5', reason: 'semanticKey' })
      continue
    }
    if (varies || highRisk) {
      autoIgnoredKeys.push(key)
      continue
    }
    if (dynamicShape) {
      suggestions.push({ key, evidence: 'E3', reason: 'dynamicValueShape' })
      continue
    }
    if (optional) {
      suggestions.push({ key, evidence: 'E4', reason: 'optionalKey' })
    }
  }

  return { autoIgnoredKeys, suggestions }
}

function applyAnalysis(entry: PreparedRecord, group: GroupAnalysis, options: StabilityOptions): StabilityResult {
  const base = entry.base
  const { autoIgnoredKeys, suggestions } = buildSuggestions(group)
  const ignored = new Set<string>([
    ...(base.query.ignoreKeys ?? []),
    ...autoIgnoredKeys,
  ])

  const sourceConditions = queryEntriesOfRecord(entry.record, base, entry.url)
  const conditions: MockQueryCondition[] = []
  const sourceKeys = [...sourceConditions.keys()].sort()
  for (const key of sourceKeys) {
    if (ignored.has(key)) continue
    const values = sourceConditions.get(key)
    conditions.push({
      key,
      op: 'equals',
      value: values?.[0] ?? '',
      ignoreCase: false,
      source: options.source === 'manual' ? 'manual' : (options.source ?? 'recording'),
    })
  }

  const parameterized = group.parameterizedPositions.size > 0
  const path = parameterized ? group.pathTemplate : base.path
  const firstParameterized = group.parameterizedPositions.size > 0
    ? Math.min(...group.parameterizedPositions)
    : null

  const next = normalizeMatchRule({
    ...base,
    pathType: parameterized ? 'glob' : base.pathType,
    path,
    pathOriginal: parameterized ? base.path : undefined,
    parameterizedSegmentIndex: firstParameterized,
    query: {
      mode: conditions.length > 0 ? 'match' : 'ignore',
      ignoreKeys: [...ignored].sort(),
      conditions,
      allowExtra: true,
      multiValue: base.query.multiValue === 'all' ? 'all' : 'any',
    },
    derivation: {
      source: options.source ?? base.derivation?.source ?? 'recording',
      autoIgnoredKeys: [...autoIgnoredKeys].sort(),
      suggestions,
      pathParameterized: parameterized,
      analyzedAt: options.analyzedAt ?? 0,
    },
  })
  next.level = levelOf(next)

  // 参数化时把模板作为建议 Path 返回，UI 需要它才能立即应用；单条记录建议同理
  const pathSuggested = parameterized ? group.pathTemplate : group.singleRecordSuggestion
  if (pathSuggested != null) {
    next.derivation.suggestions = [
      ...next.derivation.suggestions,
      {
        key: `path[${parameterized ? firstParameterized : group.singleRecordSuggestionIndex}]`,
        evidence: 'E3',
        reason: 'pathParameterizable',
      },
    ]
  }

  return {
    recordId: entry.record.id,
    match: next,
    derivation: next.derivation,
    autoIgnoredKeys: next.derivation.autoIgnoredKeys,
    suggestions: next.derivation.suggestions,
    pathParameterized: parameterized,
    pathOriginal: next.pathOriginal,
    pathSuggested,
  }
}

/**
 * 对同一场景的记录做稳定性分析：E1/E2 自动忽略、E3/E4/E5 仅建议、
 * Path ID 段参数化为 glob。分组依据 Method + 参数化后的 Path 模板。
 */
export function analyzeMatchStability(records: ProxyMock.MockRecord[],
  options?: StabilityOptions): StabilityResult[] {
  const prepared = (records ?? []).map(prepareRecord)
  const results = new Map<string, StabilityResult>()

  const groups = new Map<string, PreparedRecord[]>()
  for (const entry of prepared) {
    if (entry == null) continue
    const group = groups.get(entry.groupKey)
    if (group == null) groups.set(entry.groupKey, [entry])
    else group.push(entry)
  }

  groups.forEach(entries => {
    const group = buildGroupAnalysis(entries)
    for (const entry of entries) {
      results.set(entry.record.id, applyAnalysis(entry, group, options ?? {}))
    }
  })

  return (records ?? [])
    .map(record => results.get(record?.id))
    .filter(it => it != null)
}

// ---------------- 档位预设 ----------------

function levelConditionsFromSource(source?: ProxyMock.MockRecordSource): MockQueryCondition[] {
  if (source?.url == null) return null
  const built = createMatchFromUrl(source.url, { method: source.method, source: 'recording' })
  return built?.query.conditions ?? null
}

function markLevel(match: MockMatchRule, level: MockMatchLevel): MockMatchRule {
  const next = normalizeMatchRule({ ...match, level })
  next.level = level
  return next
}

/**
 * 档位切换只改条件，不改变响与变体。
 * strict 需要录制来源；缺失时返回 sourceMissing，不猜测条件。
 */
export function applyLevel(level: MockMatchLevel, match: MockMatchRule,
  source?: ProxyMock.MockRecordSource): LevelChange {
  const current = normalizeMatchRule(match)

  if (level === 'custom') {
    return { match: markLevel(current, 'custom'), changed: current.level !== 'custom' }
  }

  if (level === 'loose') {
    const next = normalizeMatchRule({
      ...current,
      query: { mode: 'ignore', ignoreKeys: [], conditions: [], allowExtra: true, multiValue: 'any' },
      headers: { ignoreKeys: current.headers.ignoreKeys, conditions: [] },
      derivation: current.derivation == null ? undefined : {
        ...current.derivation,
        autoIgnoredKeys: [],
      },
    })
    next.level = 'loose'
    return { match: next, changed: true }
  }

  if (level === 'standard') {
    const ignored = new Set([
      ...(current.query?.ignoreKeys ?? []),
      ...(current.derivation?.autoIgnoredKeys ?? []),
    ])
    const fromSource = levelConditionsFromSource(source)
    const conditions = fromSource == null
      ? (current.query.conditions ?? []).filter(it => !ignored.has(it.key))
      : fromSource.filter(it => !ignored.has(it.key))

    const next = normalizeMatchRule({
      ...current,
      query: {
        mode: conditions.length > 0 ? 'match' : 'ignore',
        ignoreKeys: current.query?.ignoreKeys ?? [],
        conditions,
        allowExtra: true,
        multiValue: current.query?.multiValue ?? 'any',
      },
      headers: { ignoreKeys: current.headers?.ignoreKeys ?? [], conditions: [] },
    })
    next.level = levelOf(next)
    return { match: next, changed: true }
  }

  // strict
  const fromSource = levelConditionsFromSource(source)
  if (fromSource == null) {
    return { match: markLevel(current, current.level), changed: false, reason: 'sourceMissing' }
  }
  const next = normalizeMatchRule({
    ...current,
    query: {
      mode: 'match',
      ignoreKeys: [],
      conditions: fromSource,
      allowExtra: false,
      multiValue: current.query?.multiValue ?? 'any',
    },
    headers: {
      ignoreKeys: current.headers?.ignoreKeys ?? [],
      conditions: current.headers?.conditions ?? [],
    },
    derivation: {
      source: 'manual',
      autoIgnoredKeys: [],
      suggestions: current.derivation?.suggestions ?? [],
      pathParameterized: current.derivation?.pathParameterized ?? false,
      analyzedAt: current.derivation?.analyzedAt ?? 0,
    },
  })
  next.level = 'strict'
  return { match: next, changed: true }
}

export function detectLevel(match: MockMatchRule): MockMatchLevel {
  return levelOf(normalizeMatchRule(match))
}

/**
 * 恢复录制精确匹配：从 source.url 重建全 Query + allowExtra=false，
 * 保留响应、变体、Header 条件与手动优先级。来源缺失时返回失败原因。
 */
export function restoreStrict(record: ProxyMock.MockRecord, analyzedAt: number = 0): LevelChange {
  const normalized = normalizeMockRecord(record)
  const source: ProxyMock.MockRecordSource = normalized.source?.url != null
    ? normalized.source
    : normalized.url != null ? { url: normalized.url } : null

  if (source?.url == null) {
    return { match: normalized.match, changed: false, reason: 'sourceMissing' }
  }

  const built = createMatchFromUrl(source.url, { method: source.method, source: 'manual' })
  if (built == null) {
    return { match: normalized.match, changed: false, reason: 'sourceMissing' }
  }

  built.query.allowExtra = false
  built.query.mode = 'match'
  built.query.ignoreKeys = []
  built.headers = {
    ignoreKeys: normalized.match?.headers?.ignoreKeys ?? [],
    conditions: normalized.match?.headers?.conditions ?? [],
  }
  built.priority = normalized.match?.priority ?? null
  built.enabled = normalized.match?.enabled !== false
  built.derivation = {
    source: 'manual',
    autoIgnoredKeys: [],
    suggestions: [],
    pathParameterized: false,
    analyzedAt,
  }
  built.level = 'strict'
  return { match: built, changed: true }
}

/** 供录制结果展示：把 match 压成一行摘要所需的结构化字段 */
export function matchSummaryParts(match: MockMatchRule): {
  method: string
  host: string
  path: string
  level: MockMatchLevel
  ignoredKeys: string[]
} {
  const normalized = normalizeMatchRule(match)
  return {
    method: normalized.method === MOCK_ANY_METHOD ? 'ANY' : normalized.method,
    host: normalized.host,
    path: normalized.path,
    level: normalized.level,
    ignoredKeys: normalized.query.ignoreKeys,
  }
}