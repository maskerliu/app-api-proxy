import { ProxyMock } from '@shared'
import type { MockMatchWarning, MockMatchWarningType } from '@shared/mock.models'
import type { TagType } from '../../../common/tag'
import type { MatchSummary } from './match'
import { summaryOf } from './match'

// 记录列表的视图层：行模型、标签配色、关键字筛选与排序都在这里，模板里不做条件拼装。
// 匹配档位本身的推导在 match.ts，这一层只负责展示口径。
// 方法色块的配色不在这张表里——代理记录列表也用同一枚方块，见 common/tag.ts 的 methodTagType。

export interface RecordRow {
  record: ProxyMock.MockRecord
  summary: MatchSummary | null
  title: string
  titleHint: string
  ignoreKeys: string[]
  variantCount: number
  servesVariant: boolean
  servingVariantName: string
  servingLabelKey: string
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
  const serving = record.variants?.find(it => it?.id === record.activeVariantId)
  const servingName = serving?.name ?? ''
  return {
    record,
    summary,
    ignoreKeys: summary?.ignoredKeys ?? [],
    variantCount: record.variants?.length ?? 0,
    // 「变体应答」不是开关：activeVariantId 命中时用该变体应答，否则回退『响应』页基础响应。
    // 徽标直接带变体名，名字过长由样式层截断，完整说明在 tooltip 里。
    servesVariant: record.activeVariantId != null,
    servingVariantName: servingName,
    // 没命名（或 activeVariantId 指向已删变体）时退回不带名字的标签，
    // 免得徽标写成「应答：变体名称」这种像占位符的句子
    servingLabelKey: servingName === '' ? 'mock.editor.servesVariant' : 'mock.editor.servesVariantName',
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
