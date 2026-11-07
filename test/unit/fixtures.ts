import type { ProxyMock } from '@shared/proxy.models'
import { ProxyMock as ProxyModels } from '@shared/proxy.models'
import type {
  MockHeaderCondition, MockMatchRule, MockQueryCondition, MockQueryOperator,
} from '@shared/mock.models'
import { createDefaultMatch } from '@shared/mock.models'
import { normalizeMatchRule } from '@shared/mock.validation'

let sequence = 0

export interface MatchInput {
  method?: string
  host?: string
  path?: string
  pathType?: MockMatchRule['pathType']
  pathIgnoreCase?: boolean
  ignoreTrailingSlash?: boolean
  conditions?: MockQueryCondition[]
  ignoreKeys?: string[]
  allowExtra?: boolean
  multiValue?: 'any' | 'all'
  queryMode?: 'ignore' | 'match'
  headerConditions?: MockHeaderCondition[]
  priority?: number | null
  enabled?: boolean
  level?: MockMatchRule['level']
}

export function condition(key: string, value: string, op: MockQueryOperator = 'equals',
  ignoreCase: boolean = false): MockQueryCondition {
  return { key, op, value, ignoreCase }
}

export function headerCondition(name: string, value: string, op: MockQueryOperator = 'equals',
  ignoreCase: boolean = false): MockHeaderCondition {
  return { name, op, value, ignoreCase }
}

export function makeMatch(input: MatchInput = {}): MockMatchRule {
  const base = createDefaultMatch({
    method: input.method ?? 'GET',
    host: input.host ?? '',
    path: input.path ?? '/v1/users',
    pathType: input.pathType ?? 'exact',
    query: input.conditions ?? [],
    ignoreKeys: input.ignoreKeys ?? [],
    allowExtra: input.allowExtra,
    multiValue: input.multiValue,
    headerConditions: input.headerConditions ?? [],
    level: input.level,
    priority: input.priority ?? null,
  })

  const merged = normalizeMatchRule({
    ...base,
    pathIgnoreCase: input.pathIgnoreCase ?? false,
    ignoreTrailingSlash: input.ignoreTrailingSlash ?? true,
    query: input.queryMode === 'ignore'
      ? { mode: 'ignore', ignoreKeys: input.ignoreKeys ?? [], conditions: [], allowExtra: true, multiValue: 'any' }
      : {
        ...base.query,
        mode: (input.conditions?.length ?? 0) > 0 ? 'match' : 'ignore',
        allowExtra: input.allowExtra ?? true,
      },
    headers: { ignoreKeys: [], conditions: input.headerConditions ?? [] },
    priority: input.priority ?? null,
    enabled: input.enabled ?? true,
  })
  return merged
}

export interface RecordInput {
  id?: string
  ruleId?: string
  name?: string
  url?: string
  method?: string
  match?: MockMatchRule
  createdAt?: number
  updatedAt?: number
}

export function makeRecord(input: RecordInput = {}): ProxyMock.MockRecord {
  sequence += 1
  return {
    id: input.id ?? `rec_${sequence}`,
    ruleId: input.ruleId ?? 'rule-1',
    name: input.name ?? input.url ?? `record-${sequence}`,
    url: input.url ?? '',
    match: input.match,
    response: ProxyModels.defaultResponse(),
    variants: [],
    activeVariantId: null,
    createdAt: input.createdAt ?? 0,
    updatedAt: input.updatedAt ?? 0,
  }
}

/** 录制形态的旧记录：只有 url / source，没有 match，用于迁移与派生用例 */
export function legacyRecord(url: string, input: RecordInput = {}): ProxyMock.MockRecord {
  const record = makeRecord({ ...input, url })
  record.source = { url, method: input.method ?? 'GET' }
  return record
}

export function queryString(params: Record<string, string | string[]>): string {
  const search = new URLSearchParams()
  for (const key of Object.keys(params)) {
    const value = params[key]
    if (Array.isArray(value)) value.forEach(item => search.append(key, item))
    else search.append(key, value)
  }
  return search.toString()
}