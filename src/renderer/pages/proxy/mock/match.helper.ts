import { ProxyMock } from '@shared/proxy.models'
import type {
  MockMatchLevel, MockMatchOrdering, MockMatchRule, MockMatchWarningType, MockQueryCondition, MockQueryOperator,
} from '@shared/mock.models'
import {
  MOCK_ANY_METHOD, MOCK_HIGH_RISK_KEYS, MOCK_METHODS, MOCK_MATCH_LEVELS, MOCK_PATH_TYPES,
  MOCK_QUERY_OPERATORS, MOCK_SEMANTIC_KEYS, createDefaultMatch, levelOf, normalizeHost,
} from '@shared/mock.models'
import { normalizeMatchRule } from '@shared/mock.validation'
import { parseLooseUrl, PLACEHOLDER_HOSTNAME } from '@shared/url'

// 匹配 Tab 的纯展示工具：档位切换、摘要与差异预览都在渲染层完成，
// 执行仍以服务端 Matcher 为准（保存后由服务端重新编译）。

export const MATCH_LEVELS = MOCK_MATCH_LEVELS
export const MATCH_METHODS = MOCK_METHODS
export const PATH_TYPES = MOCK_PATH_TYPES
export const QUERY_OPERATORS = MOCK_QUERY_OPERATORS
export const RISK_KEYS = new Set<string>(MOCK_HIGH_RISK_KEYS)
export const SEMANTIC_KEYS = new Set<string>(MOCK_SEMANTIC_KEYS)

export interface MatchSummary {
  method: string
  host: string
  path: string
  level: MockMatchLevel
  ignoredKeys: string[]
  queryKeyCount: number
  headerKeyCount: number
}

export interface LevelPresetDiff {
  addedKeys: string[]
  removedKeys: string[]
  ignoredAdded: string[]
  ignoredRemoved: string[]
  allowExtraFrom: boolean
  allowExtraTo: boolean
  headersCleared: number
  pathChanged: boolean
  levelChanged: boolean
  empty: boolean
}

export interface LevelPresetPreview {
  level: MockMatchLevel
  match: MockMatchRule
  diff: LevelPresetDiff
  changed: boolean
  reason?: 'sourceMissing' | 'noChange'
}

export interface MatchTestSeed {
  method: string
  url: string
  headers?: Record<string, string>
}

function safeUrl(url: string): URL | null {
  const value = String(url ?? '').trim()
  return value === '' ? null : parseLooseUrl(value)
}

export function pathOfUrl(url: string): string {
  return safeUrl(url)?.pathname ?? ''
}

export function hostOfUrl(url: string): string {
  const parsed = safeUrl(url)
  if (parsed == null || parsed.hostname === PLACEHOLDER_HOSTNAME) return ''
  return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
}

/** 记录缺失 match 时，用录制来源补一份默认条件，保证匹配 Tab 可直接编辑 */
export function ensureRecordMatch(record: ProxyMock.MockRecord): MockMatchRule | null {
  if (record == null) return null
  if (record.match != null) return record.match

  const sourceUrl = record.source?.url ?? record.url ?? ''
  if (sourceUrl === '' && record.url == null) return null
  record.match = createDefaultMatch({
    method: record.source?.method,
    host: hostOfUrl(sourceUrl),
    path: pathOfUrl(sourceUrl || record.url),
    source: 'manual',
  })
  return record.match
}

export function summaryOf(record: ProxyMock.MockRecord): MatchSummary | null {
  const match = record?.match
  if (match == null) return null
  return {
    method: match.method === MOCK_ANY_METHOD ? MOCK_ANY_METHOD : match.method,
    host: normalizeHost(match.host),
    path: match.path,
    level: levelOf(match),
    ignoredKeys: [...(match.query?.ignoreKeys ?? [])],
    queryKeyCount: match.query?.conditions?.length ?? 0,
    headerKeyCount: match.headers?.conditions?.length ?? 0,
  }
}

/** 列表/详情共用的一行摘要：`POST api.example.com /v1/orders · 标准 · 忽略 ts,sign` */
export function summaryText(record: ProxyMock.MockRecord, t: (key: string, params?: any) => string): string {
  const summary = summaryOf(record)
  if (summary == null) {
    return record?.url ?? t('mock.match.noMatchYet')
  }
  const parts: string[] = []
  if (summary.method !== MOCK_ANY_METHOD) parts.push(summary.method)
  if (summary.host !== '') parts.push(summary.host)
  parts.push(summary.path)
  parts.push(t(`mock.match.level.${summary.level}`))
  if (summary.ignoredKeys.length > 0) {
    parts.push(t('mock.match.summaryIgnored', { keys: summary.ignoredKeys.join(',') }))
  }
  return parts.join(' ')
}

function queryConditionsFrom(sourceUrl: string): MockQueryCondition[] {
  const parsed = safeUrl(sourceUrl)
  if (parsed == null) return []
  const conditions: MockQueryCondition[] = []
  parsed.searchParams.forEach((value, key) => {
    conditions.push({ key, op: 'equals', value, source: 'recording' })
  })
  return conditions
}

function conditionKeys(match: MockMatchRule): Set<string> {
  return new Set((match.query?.conditions ?? []).map(it => it.key))
}

function diffKeys(before: Set<string>, after: Set<string>): string[] {
  return [...after].filter(it => !before.has(it)).sort()
}

/** 档位预设：与服务端 applyLevel 语义一致，切档预览与本地应用共用 */
export function previewLevel(level: MockMatchLevel, record: ProxyMock.MockRecord): LevelPresetPreview {
  const current = normalizeMatchRule(record?.match)
  const sourceUrl = record?.source?.url ?? record?.url ?? ''

  if (level === 'custom') {
    const next = normalizeMatchRule({ ...current, level: 'custom' })
    next.level = 'custom'
    return { level, match: next, diff: emptyDiff(), changed: current.level !== 'custom', reason: 'noChange' }
  }

  if (level === 'loose') {
    const next = normalizeMatchRule({
      ...current,
      query: { mode: 'ignore', ignoreKeys: [], conditions: [], allowExtra: true, multiValue: 'any' },
      headers: { ignoreKeys: current.headers.ignoreKeys, conditions: [] },
      derivation: current.derivation == null ? undefined : { ...current.derivation, autoIgnoredKeys: [] },
    })
    next.level = 'loose'
    return { level, match: next, diff: diffOf(current, next), changed: true }
  }

  if (level === 'strict') {
    const parsed = safeUrl(sourceUrl)
    if (parsed == null) {
      return { level, match: current, diff: emptyDiff(), changed: false, reason: 'sourceMissing' }
    }
    const fromSource = queryConditionsFrom(sourceUrl)
    const next = normalizeMatchRule({
      ...current,
      query: { mode: 'match', ignoreKeys: [], conditions: fromSource, allowExtra: false, multiValue: current.query.multiValue },
      headers: { ignoreKeys: current.headers.ignoreKeys, conditions: current.headers.conditions },
      derivation: {
        source: 'manual',
        autoIgnoredKeys: [],
        suggestions: current.derivation?.suggestions ?? [],
        pathParameterized: current.derivation?.pathParameterized ?? false,
        analyzedAt: current.derivation?.analyzedAt ?? 0,
      },
    })
    next.level = 'strict'
    return { level, match: next, diff: diffOf(current, next), changed: true }
  }

  // standard
  const ignored = new Set([
    ...(current.query?.ignoreKeys ?? []),
    ...(current.derivation?.autoIgnoredKeys ?? []),
  ])
  const fromSource = queryConditionsFrom(sourceUrl)
  const base = fromSource.length > 0 ? fromSource : current.query.conditions
  const conditions = base.filter(it => !ignored.has(it.key))
  const next = normalizeMatchRule({
    ...current,
    query: {
      mode: conditions.length > 0 ? 'match' : 'ignore',
      ignoreKeys: current.query.ignoreKeys,
      conditions,
      allowExtra: true,
      multiValue: current.query.multiValue,
    },
    headers: { ignoreKeys: current.headers.ignoreKeys, conditions: [] },
  })
  next.level = 'standard'
  return { level, match: next, diff: diffOf(current, next), changed: true }
}

function emptyDiff(): LevelPresetDiff {
  return {
    addedKeys: [], removedKeys: [], ignoredAdded: [], ignoredRemoved: [],
    allowExtraFrom: true, allowExtraTo: true, headersCleared: 0, pathChanged: false,
    levelChanged: false, empty: true,
  }
}

function diffOf(before: MockMatchRule, after: MockMatchRule): LevelPresetDiff {
  const beforeKeys = conditionKeys(before)
  const afterKeys = conditionKeys(after)
  const beforeIgnored = new Set(before.query?.ignoreKeys ?? [])
  const afterIgnored = new Set(after.query?.ignoreKeys ?? [])
  const addedKeys = diffKeys(beforeKeys, afterKeys)
  const removedKeys = diffKeys(afterKeys, beforeKeys)
  const ignoredAdded = diffKeys(beforeIgnored, afterIgnored)
  const ignoredRemoved = diffKeys(afterIgnored, beforeIgnored)
  const allowExtraFrom = before.query?.allowExtra !== false
  const allowExtraTo = after.query?.allowExtra !== false
  const headersCleared = Math.max(0,
    (before.headers?.conditions?.length ?? 0) - (after.headers?.conditions?.length ?? 0))
  const pathChanged = before.path !== after.path || before.pathType !== after.pathType
  const levelChanged = before.level !== after.level

  return {
    addedKeys, removedKeys, ignoredAdded, ignoredRemoved,
    allowExtraFrom, allowExtraTo, headersCleared, pathChanged, levelChanged,
    empty: addedKeys.length === 0 && removedKeys.length === 0
      && ignoredAdded.length === 0 && ignoredRemoved.length === 0
      && allowExtraFrom === allowExtraTo && headersCleared === 0 && !pathChanged && !levelChanged,
  }
}

export function addQueryCondition(match: MockMatchRule): MockQueryCondition {
  if (match.query == null) match.query = { mode: 'match', ignoreKeys: [], conditions: [], allowExtra: true, multiValue: 'any' }
  match.query.mode = 'match'
  const condition: MockQueryCondition = { key: '', op: 'equals', value: '', source: 'manual' }
  match.query.conditions.push(condition)
  return condition
}

export function addHeaderCondition(match: MockMatchRule, name: string = ''): void {
  if (match.headers == null) match.headers = { ignoreKeys: [], conditions: [] }
  match.headers.conditions.push({ name, op: 'equals', value: '', source: 'manual' })
}

export function operatorNeedsValue(op: MockQueryOperator): boolean {
  return op !== 'exists' && op !== 'notExists'
}

/** 测试匹配默认填充录制时的 Method + URL */
export function testSeedOf(record: ProxyMock.MockRecord): MatchTestSeed {
  const url = record?.source?.url ?? record?.url ?? ''
  const method = record?.source?.method ?? record?.match?.method ?? MOCK_ANY_METHOD
  return { method, url, headers: record?.source?.headers as Record<string, string> }
}

export function orderingLabelKey(ordering: MockMatchOrdering): string {
  const known: MockMatchOrdering[] = ['manual-priority', 'path-specificity', 'condition-count', 'updated-at', 'record-id']
  return known.indexOf(ordering) >= 0 ? `mock.ordering.${ordering}` : 'mock.ordering.updated-at'
}

export function warningLabelKey(type: MockMatchWarningType): string {
  return `mock.list.warning.${type}`
}

export function sortRecords(records: ProxyMock.MockRecord[], sort: 'updated' | 'created' | 'priority'): ProxyMock.MockRecord[] {
  const list = [...(records ?? [])]
  if (sort === 'created') return list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  if (sort === 'priority') {
    return list.sort((a, b) => {
      const left = a.match?.priority
      const right = b.match?.priority
      if (left == null && right == null) return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
      if (left == null) return 1
      if (right == null) return -1
      // 与 Matcher 一致：优先级数值越大越优先
      return right - left || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    })
  }
  return list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export function matchesKeyword(record: ProxyMock.MockRecord, keyword: string): boolean {
  const text = String(keyword ?? '').trim().toLowerCase()
  if (text === '') return true
  const summary = summaryOf(record)
  const fields = [
    record.name,
    record.url,
    summary?.method,
    summary?.host,
    summary?.path,
    summary?.ignoredKeys?.join(','),
  ]
  return fields.some(it => String(it ?? '').toLowerCase().includes(text))
}