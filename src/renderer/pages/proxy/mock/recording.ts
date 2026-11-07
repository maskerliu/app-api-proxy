import { getMockRecordByUrl, matchMockRecord, ProxyMock, saveMockRecord, saveMockRule } from '@shared'
import { normalizeErrorText } from './mock.errors'
import { cloneRecord, recordFromRequest } from './mock.record'

/** 打开规则管理器时的定位上下文；record 用于录制成功后的「查看」深链 */
export interface MockMgrTarget {
  ruleId: string
  record?: ProxyMock.MockRecord
}

export interface RecordRequestOptions {
  rule: ProxyMock.MockRule
  request: ProxyMock.ProxyRequestRecord
  enable: boolean
  existing?: ProxyMock.MockRecord | null
}

export interface RecordRequestResult {
  rule: ProxyMock.MockRule
  record: ProxyMock.MockRecord
  created: boolean
  enabled: boolean
  enableError?: string
  /** 覆盖前的记录快照，供录制历史撤销 */
  previous: ProxyMock.MockRecord | null
  /** 复用的是无 match 的历史记录，建议重新分析匹配条件 */
  degraded?: boolean
}

export interface RecordLookup {
  record: ProxyMock.MockRecord
  degraded: boolean
}

export async function findRecordByUrl(ruleId: string, url: string): Promise<ProxyMock.MockRecord> {
  if (ruleId == null || url == null || url === '') return null
  try {
    return await getMockRecordByUrl(ruleId, url, { silentError: true })
  } catch (err) {
    // 检测失败不阻塞录制，交给保存时的服务端校验兜底
    return null
  }
}

/**
 * 录制去重：先按匹配条件命中，未命中只对无 match 的历史记录回退 URL。
 * URL 相等不再是唯一判据，避免动态参数制造重复记录。
 */
export async function findRecordForRequest(ruleId: string,
  request: ProxyMock.ProxyRequestRecord): Promise<RecordLookup> {
  if (ruleId == null || request?.url == null || request.url === '') {
    return { record: null, degraded: false }
  }

  try {
    const headers = request.headers != null && typeof request.headers === 'object' ? request.headers : undefined
    const matched = await matchMockRecord({
      ruleId,
      method: request.method,
      url: request.url,
      headers,
    }, { silentError: true })
    if (matched?.matched && matched.record != null) {
      return { record: matched.record, degraded: matched.meta?.degraded === true }
    }
  } catch (err) {
    // 匹配失败不阻塞录制，继续走 URL 兜底
  }

  const fallback = await findRecordByUrl(ruleId, request.url)
  if (fallback?.match != null) return { record: null, degraded: false }
  return { record: fallback ?? null, degraded: fallback != null }
}

/**
 * 把一次抓包请求录制到规则：
 * - 同 url 已存在时更新该记录，保留 id / 变体 / 名称 / 创建时间
 * - enable 为真时启用规则；记录成功但启用失败会通过 enableError 返回，避免丢掉已保存结果
 */
export async function recordRequestToRule(options: RecordRequestOptions): Promise<RecordRequestResult> {
  const { rule, request, enable } = options
  let degraded = false
  let existing = options.existing
  if (existing === undefined) {
    const found = await findRecordForRequest(rule._id, request)
    existing = found.record
    degraded = found.degraded
  }

  const captured = recordFromRequest(rule._id, request)
  const previous = existing == null ? null : cloneRecord(existing)
  const record: ProxyMock.MockRecord = existing == null ? captured : {
    ...captured,
    id: existing.id,
    name: existing.name || captured.name,
    // 沿用既有匹配条件：录制只刷新响应，不应重算用户已调整过的条件
    match: existing.match,
    matchInvalid: existing.matchInvalid,
    matchFingerprint: existing.matchFingerprint,
    variants: existing.variants ?? [],
    activeVariantId: existing.activeVariantId ?? null,
    createdAt: existing.createdAt,
  }

  const saved = await saveMockRecord(record, existing?.updatedAt, { silentError: true })
  record.id = saved.id
  record.updatedAt = saved.updatedAt

  let enabled = false
  let enableError: string
  if (enable) {
    try {
      await saveMockRule({ ...rule, isMock: true })
      enabled = true
    } catch (err) {
      enableError = normalizeErrorText(err)
    }
  }

  return { rule, record, created: existing == null, enabled, enableError, previous, degraded }
}
