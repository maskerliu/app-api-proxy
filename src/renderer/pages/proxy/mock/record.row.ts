import { MOCK_ANY_METHOD, ProxyMock } from '@shared'
import type { MockMatchWarning } from '@shared/mock.models'
import type { MatchSummary } from './match.helper'
import { summaryOf } from './match.helper'

// 记录列表的行视图模型：一次算好标题、副标题与标签配色，模板里不做条件拼装。

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
