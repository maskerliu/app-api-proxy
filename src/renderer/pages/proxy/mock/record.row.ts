import { MOCK_ANY_METHOD, ProxyMock } from '@shared'
import type { MockMatchWarning, MockMatchWarningType } from '@shared/mock.models'
import type { MatchSummary } from './match'
import { summaryOf } from './match'

// 记录列表的视图层：行模型、标签配色、关键字筛选与排序都在这里，模板里不做条件拼装。
// 匹配档位本身的推导在 match.ts，这一层只负责展示口径。

export type TagType = 'primary' | 'success' | 'warning' | 'danger' | 'default'

export interface RecordRow {
  record: ProxyMock.MockRecord
  summary: MatchSummary | null
  title: string
  titleHint: string
  subPath: string
  ignoreKeys: string[]
  variantCount: number
  active: boolean
  warning: MockMatchWarning | null
  statusCode: number
  statusOk: boolean
  warningExtra: number
}

export function recordRowOf(record: ProxyMock.MockRecord): RecordRow {
  const summary = summaryOf(record)
  const response = ProxyMock.effectiveResponse(record)
  const warnings = record.matchWarnings ?? []
  const path = summary?.path ?? ''
  const name = record.name ?? ''
  // 录制自动生成的名称就是「方法 + URL」，展示时改用干净的 path，避免和方法色块重复
  const autoName = summary != null && name.startsWith(`${summary.method} `)
  const title = autoName || name === '' ? (path || record.url || name) : name
  // 标题已经是 path 时，第二行只补 host，避免同一路径出现两次
  const subPath = summary == null ? '' : title === path ? summary.host : `${summary.host}${summary.path}`
  return {
    record,
    summary,
    subPath,
    ignoreKeys: summary?.ignoredKeys ?? [],
    variantCount: record.variants?.length ?? 0,
    active: record.activeVariantId != null,
    warning: warnings[0] ?? null,
    title,
    titleHint: record.url || name || path,
    statusCode: response.statusCode,
    statusOk: response.statusCode == 200,
    warningExtra: Math.max(0, warnings.length - 1),
  }
}

export function levelTagType(level: string): TagType {
  if (level === 'strict') return 'danger'
  if (level === 'standard') return 'primary'
  if (level === 'loose') return 'success'
  return 'warning'
}

// 方法用小色块区分，便于在列表中按请求类型快速扫读
export function methodTagType(method: string): TagType {
  const value = String(method ?? '').toUpperCase()
  if (value === 'GET') return 'primary'
  if (value === 'POST') return 'success'
  if (value === 'DELETE') return 'danger'
  if (MOCK_ANY_METHOD === value) return 'warning'
  return 'default'
}

export function warningTagType(type: string): TagType {
  if (type === 'duplicate') return 'danger'
  if (type === 'shadowed' || type === 'unreachable') return 'warning'
  return 'default'
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
