import { ProxyMock } from '@shared/proxy.models'
import type {
  MockHeaderCondition, MockMatchLevel, MockMatchOrdering, MockMatchRule, MockMatchSuggestion, MockQueryCondition,
  MockQueryMatch, MockQueryOperator,
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

export interface QuerySuggestion {
  key: string
  value: string
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

// 无录制来源或来源 URL 解析不了才返回 null；有来源但没 Query 时返回空数组，两者语义不同
function queryConditionsFrom(sourceUrl: string): MockQueryCondition[] | null {
  const parsed = safeUrl(sourceUrl)
  if (parsed == null) return null
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

/** 档位预设的唯一实现：切档预览与本地应用共用，服务端只按保存后的条件匹配，不再另算一份 */
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
    const fromSource = queryConditionsFrom(sourceUrl)
    if (fromSource == null) {
      return { level, match: current, diff: emptyDiff(), changed: false, reason: 'sourceMissing' }
    }
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
  const conditions = (fromSource ?? current.query.conditions).filter(it => !ignored.has(it.key))
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
  // 回填实际档位：来源里没有稳定参数时条件为空，写死 standard 会和摘要上的档位打架
  next.level = levelOf(next)
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

/** 档位预览的差异文案：一条改动一句，顺序固定为「加条件 → 删条件 → 忽略 → 恢复参与匹配 → 多值 → Header → Path」 */
export function diffLinesOf(preview: LevelPresetPreview | null, t: (key: string, params?: any) => string): string[] {
  if (preview == null || preview.reason === 'sourceMissing') return []
  const diff = preview.diff
  const lines: string[] = []
  if (diff.addedKeys.length > 0) lines.push(t('mock.match.diffAdd', { keys: diff.addedKeys.join(', ') }))
  if (diff.removedKeys.length > 0) lines.push(t('mock.match.diffRemove', { keys: diff.removedKeys.join(', ') }))
  if (diff.ignoredAdded.length > 0) lines.push(t('mock.match.diffIgnore', { keys: diff.ignoredAdded.join(', ') }))
  if (diff.ignoredRemoved.length > 0) {
    lines.push(t('mock.match.diffIgnoreRemove', { keys: diff.ignoredRemoved.join(', ') }))
  }
  if (diff.allowExtraFrom !== diff.allowExtraTo) {
    lines.push(t('mock.match.diffAllowExtra', { value: diff.allowExtraTo ? 'ON' : 'OFF' }))
  }
  if (diff.headersCleared > 0) lines.push(t('mock.match.diffHeaders', { count: diff.headersCleared }))
  if (diff.pathChanged) lines.push(t('mock.match.diffPath'))
  return lines
}

// 忽略键来源：自动分析写入 vs 建议待应用 vs 手动添加
export type IgnoreSource = 'auto' | 'suggestion' | 'manual'

export function ignoreSourceOf(match: MockMatchRule | null | undefined, key: string): IgnoreSource {
  const derivation = match?.derivation
  if (derivation?.autoIgnoredKeys?.indexOf(key) >= 0) return 'auto'
  if (derivation?.suggestions?.some(it => it.key === key) === true) return 'suggestion'
  return 'manual'
}

// 档位应用与忽略写入两处都可能碰到整段缺失的老规则，补的是同一份空壳
function ensureQuery(match: MockMatchRule): MockQueryMatch {
  if (match.query == null) match.query = { mode: 'match', ignoreKeys: [], conditions: [], allowExtra: true, multiValue: 'any' }
  return match.query
}

/** 「+」加一行空条件：只插行、不动档位。空键名本来就不参与匹配，档位是忽略时新行置灰才对得上；
 *  面板头现在只有这一枚「+」，Query 与 Header 都从它出发，加 Header 行更不该被顺带改掉 Query 档位 */
export function addQueryCondition(match: MockMatchRule): MockQueryCondition {
  const query = ensureQuery(match)
  const condition: MockQueryCondition = { key: '', op: 'equals', value: '', source: 'manual' }
  // 新行插在顶部：条件之间是 AND，顺序无语义，排在最前才和「展开后第一眼就是它」对得上
  query.conditions.unshift(condition)
  return condition
}

/** 点录制里的键值对补条件：这是明确要按它匹配，档位随之切到匹配 */
export function applyQuerySuggestion(match: MockMatchRule, item: QuerySuggestion): MockQueryCondition {
  const condition = addQueryCondition(match)
  condition.key = item.key
  condition.value = item.value
  match.query.mode = 'match'
  return condition
}

/**
 * 把分析算出的自动忽略键并进 ignoreKeys：testQuery 只认 ignoreKeys，derivation.autoIgnoredKeys 本身不改变匹配。
 * 条件行留着不删——忽略名单优先于条件（matcher.ts 里命中即 continue），所以 ✕ 撤销把键摘掉就回到原状。
 */
export function applyAutoIgnoredKeys(match: MockMatchRule, keys: string[] | undefined): void {
  const query = ensureQuery(match)
  if (query.ignoreKeys == null) query.ignoreKeys = []
  for (const key of keys ?? []) {
    // 只补缺的、接在末尾：和忽略参数框的 push 同一口径，手动键的次序不会被分析结果打乱
    if (query.ignoreKeys.indexOf(key) === -1) query.ignoreKeys.push(key)
  }
}

/** 稳定性面板的建议行：Path 参数化另有自己的区块；E3/E4 已进忽略名单的不再摆出来，点它没有可发生的变化 */
export function stabilitySuggestionsOf(match: MockMatchRule | null | undefined): MockMatchSuggestion[] {
  const ignored = new Set(match?.query?.ignoreKeys ?? [])
  return (match?.derivation?.suggestions ?? []).filter(it => it.reason !== 'pathParameterizable'
    && (it.evidence === 'E5' || !ignored.has(it.key)))
}

// 一行放不下太多，且首屏能点到的键才是有用的键；超出部分仍可走「+」手输
const QUERY_SUGGEST_LIMIT = 8

/** 录制来源里尚未进条件的 Query 键值对：一键补条件用，已忽略的键不推荐，否则会和忽略状态自相矛盾 */
export function querySuggestionsOf(record: ProxyMock.MockRecord,
  match: MockMatchRule | null | undefined): QuerySuggestion[] {
  const fromSource = queryConditionsFrom(record?.source?.url ?? record?.url ?? '')
  if (fromSource == null) return []

  const used = new Set([
    ...(match?.query?.conditions ?? []).map(it => it.key),
    ...(match?.query?.ignoreKeys ?? []),
  ])
  const result: QuerySuggestion[] = []
  for (const it of fromSource) {
    // 同名键的第二个值不该再出现一次，queryConditionsFrom 按出现顺序给的是首个值
    if (used.has(it.key) || result.some(s => s.key === it.key)) continue
    result.push({ key: it.key, value: it.value })
    if (result.length >= QUERY_SUGGEST_LIMIT) break
  }
  return result
}

export type ConditionLocation = 'query' | 'header'

/** 合表后的一行视图模型：底层仍是 query.conditions 与 headers.conditions 两个数组，location 只决定读写哪一个 */
export interface ConditionRow {
  location: ConditionLocation
  condition: MockQueryCondition | MockHeaderCondition
  /** 两种「不参与」都要置灰：档位设为忽略时 testQuery 整段放行；档位是匹配时命中忽略名单的那一行被逐条跳过 */
  inert: boolean
}

export function conditionRowsOf(match: MockMatchRule | null | undefined): ConditionRow[] {
  if (match == null) return []
  const query = match.query
  const inertAll = query?.mode === 'ignore'
  const ignored = new Set(query?.ignoreKeys ?? [])
  const queryRows = (query?.conditions ?? []).map(condition => ({
    location: 'query' as ConditionLocation, condition, inert: inertAll || ignored.has(condition.key),
  }))
  const headerRows = (match.headers?.conditions ?? []).map(condition => ({
    location: 'header' as ConditionLocation, condition, inert: false,
  }))
  return [...queryRows, ...headerRows]
}

// 只有键名的载体不同：Query 条件用 key，Header 条件用 name
export function conditionName(row: ConditionRow): string {
  return row.location === 'query'
    ? (row.condition as MockQueryCondition).key
    : (row.condition as MockHeaderCondition).name
}

export function setConditionName(row: ConditionRow, value: string): void {
  if (row.location === 'query') (row.condition as MockQueryCondition).key = value
  else (row.condition as MockHeaderCondition).name = value
}

/** 切换位置即把整行搬到另一个数组：op/value/来源原样带走，落在新组的开头 */
export function relocateCondition(match: MockMatchRule, row: ConditionRow, next: ConditionLocation): void {
  if (next === row.location) return
  const name = conditionName(row)
  const { op, value, ignoreCase, source } = row.condition
  removeCondition(match, row)
  if (next === 'query') match.query.conditions.unshift({ key: name, op, value, ignoreCase, source })
  else match.headers.conditions.unshift({ name, op, value, ignoreCase, source })
}

// 两个数组的元素类型不同，先同宽成 A|B 再按对象身份定位，否则 indexOf 的参数会被推成交集
export function removeCondition(match: MockMatchRule, row: ConditionRow): void {
  const list: Array<MockQueryCondition | MockHeaderCondition> = row.location === 'query'
    ? match.query.conditions
    : match.headers.conditions
  const index = list.indexOf(row.condition)
  if (index >= 0) list.splice(index, 1)
}

export function addHeaderCondition(match: MockMatchRule, name: string = ''): MockHeaderCondition {
  if (match.headers == null) match.headers = { ignoreKeys: [], conditions: [] }
  const condition: MockHeaderCondition = { name, op: 'equals', value: '', source: 'manual' }
  // 与 addQueryCondition 同款：合表后两类新行都落在列表开头，切换位置也才有同一归宿
  match.headers.conditions.unshift(condition)
  return condition
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