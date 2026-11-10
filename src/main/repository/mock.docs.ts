import { createHash } from 'crypto'
import { ProxyMock } from '@shared/proxy.models'
import { pickHeader } from '@shared/http-header'
import type { MigrationReport, MockMatchRule } from '@shared/mock.models'
import {
  canonicalMatch, inferBodyType, normalizeMockRecord, sanitizeResponseHeaders
} from '@shared/mock.validation'

/**
 * Mock 文档层：落库结构、schema 版本与文档↔记录映射。
 * 只做数据映射，不读库也不写库，因此仓库层与迁移 runner 都能依赖它，
 * 而 repository 不会反向 import service。
 */

export const RULE_TYPE = 'rule'
export const RECORD_TYPE = 'record'
// PouchDB 只允许 _design/ 与 _local/ 作为下划线开头的保留 ID
export const META_ID = 'mock_schema_meta'
export const MIGRATION_REPORT_ID = 'mock_migration_report'
export const MIGRATION_REPORT_TYPE = 'migration-report'
export const RECORD_PREFIX = 'rec_'
export const MATCH_SCHEMA_VERSION = 1
// 2: 规则元信息与请求记录拆分为独立文档
// 3: 记录改为结构化响应模型，新记录使用 rec_<uuid>
// 4: 记录携带 match 条件与匹配指纹（R1 匹配引擎）
export const LEGACY_SCHEMA_VERSION = 2
export const RECORD_SCHEMA_VERSION = 3
export const SCHEMA_VERSION = 4

// 写库重试与批量分片：仓库层与迁移 runner 共用同一套落库节奏
export const CONFLICT_RETRY = 2
export const DELETE_BATCH = 200

export interface DocMeta {
  _id: string
  _rev?: string
  _deleted?: boolean
}

export interface MockRuleDoc extends DocMeta {
  type: typeof RULE_TYPE
  name: string
  desc: string
  createdAt: number
  updatedAt: number
}

export interface MockRecordDoc extends DocMeta {
  type: typeof RECORD_TYPE
  ruleId: string
  // 展示与旧版本兼容字段；唯一性由 matchFingerprint 决定
  url?: string
  name: string
  match?: MockMatchRule
  matchFingerprint?: string
  matchInvalid?: string
  response: ProxyMock.MockResponseDef
  variants: ProxyMock.MockVariant[]
  activeVariantId: string | null
  source?: ProxyMock.MockRecordSource
  createdAt: number
  updatedAt: number
  // 旧版本回滚兼容：仅从 v2 迁移来的记录保留并同步更新，新记录不写该字段
  record?: ProxyMock.ProxyRequestRecord
}

// 迁移分析只需要匹配相关字段，避免把响应体整体读入内存
export interface MockRecordSummary {
  _id: string
  ruleId: string
  url?: string
  name?: string
  match?: MockMatchRule
  matchFingerprint?: string
  matchInvalid?: string
  source?: ProxyMock.MockRecordSource
  createdAt: number
  updatedAt: number
}

export interface LegacyRuleDoc extends DocMeta {
  type?: string
  name?: string
  desc?: string
  createdAt?: number
  updatedAt?: number
  jsonRequests?: any
}

export interface MockMetaDoc extends DocMeta {
  version: number
  backupVersion?: number
  mockSchemaVersion?: number
  migratedAt?: number
  migrationPending?: boolean
  migrationStatus?: MigrationReport['status']
  lastActiveRuleId?: string | null
  updatedAt: number
}

export interface MockMigrationReportDoc extends DocMeta, MigrationReport {
  type: typeof MIGRATION_REPORT_TYPE
}

// 与 MockRecordSummary 必须同增同减：多取一个字段就会把响应体带进内存
export const RECORD_SUMMARY_FIELDS = [
  '_id', 'ruleId', 'url', 'name', 'match', 'matchFingerprint', 'matchInvalid',
  'source', 'createdAt', 'updatedAt',
]

/** 匹配指纹是存储层的唯一性键：由 match 单向导出，不接受调用方传入 */
export function fingerprintOf(match: MockMatchRule): string {
  return createHash('sha1').update(canonicalMatch(match)).digest('hex')
}

export function isMigratedV4(meta: MockMetaDoc): boolean {
  return (meta?.version ?? 0) >= SCHEMA_VERSION
    && (meta?.mockSchemaVersion ?? 0) >= MATCH_SCHEMA_VERSION
}

export function docToRecord(doc: MockRecordDoc): ProxyMock.MockRecord {
  if (doc.response != null) {
    return normalizeMockRecord({
      id: doc._id,
      ruleId: doc.ruleId,
      name: doc.name,
      url: doc.url ?? doc.source?.url ?? '',
      match: doc.match,
      matchFingerprint: doc.matchFingerprint,
      matchInvalid: doc.matchInvalid,
      response: doc.response,
      variants: doc.variants,
      activeVariantId: doc.activeVariantId,
      source: doc.source,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    })
  }

  // 尚未完成 v3 迁移时按旧结构即时转换，避免读到空数据
  const legacy = (doc.record ?? {}) as ProxyMock.ProxyRequestRecord
  return normalizeMockRecord({
    id: doc._id,
    ruleId: doc.ruleId,
    name: doc.name ?? legacy.url ?? doc.url,
    url: doc.url,
    match: doc.match,
    matchFingerprint: doc.matchFingerprint,
    matchInvalid: doc.matchInvalid,
    response: responseFromLegacy(legacy),
    variants: [],
    activeVariantId: null,
    source: sourceFromLegacy(legacy, doc),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  })
}

export function summaryToRecord(summary: MockRecordSummary): ProxyMock.MockRecord {
  return normalizeMockRecord({
    id: summary._id,
    ruleId: summary.ruleId,
    name: summary.name ?? '',
    url: summary.url ?? summary.source?.url ?? '',
    match: summary.match,
    matchFingerprint: summary.matchFingerprint,
    matchInvalid: summary.matchInvalid,
    source: summary.source,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  })
}

export function responseFromLegacy(legacy: ProxyMock.ProxyRequestRecord): ProxyMock.MockResponseDef {
  const headers = sanitizeResponseHeaders(legacy?.responseHeaders ?? {})
  const contentType = pickHeader(headers, 'content-type') ?? ''
  const body = legacy?.responseData == null
    ? ''
    : typeof legacy.responseData === 'string'
      ? legacy.responseData
      : JSON.stringify(legacy.responseData)
  const inferred = inferBodyType(contentType)
  // 抓包记录里的二进制响应只有占位文本，按文本保存才能原样返回，不能当 base64 发送
  const bodyType = legacy?.responseData != null && typeof legacy.responseData !== 'string'
    ? 'json'
    : inferred === 'binary' ? 'text' : inferred

  return {
    statusCode: Number.isInteger(Number(legacy?.statusCode)) && Number(legacy.statusCode) >= 100 && Number(legacy.statusCode) <= 599
      ? Number(legacy.statusCode)
      : 200,
    headers,
    body,
    bodyType,
    delayMs: 0
  }
}

export function sourceFromLegacy(legacy: ProxyMock.ProxyRequestRecord,
  doc: Pick<MockRecordDoc, 'url' | 'createdAt'>): ProxyMock.MockRecordSource {
  return {
    method: legacy?.method,
    url: doc.url,
    statusCode: legacy?.statusCode,
    headers: legacy?.responseHeaders,
    capturedAt: doc.createdAt
  }
}

/** 迁移记录保留旧结构，回滚旧版本时仍能读取 */
export function toCompatRecord(record: ProxyMock.MockRecord): ProxyMock.ProxyRequestRecord {
  const response = ProxyMock.effectiveResponse(record)
  let responseData: any = response.body
  if (response.bodyType === 'json') {
    try {
      responseData = JSON.parse(response.body)
    } catch (err) {
      responseData = response.body
    }
  }
  return {
    id: 0,
    type: 0,
    url: record.url,
    method: record.source?.method,
    statusCode: response.statusCode,
    responseHeaders: response.headers,
    responseData
  }
}

export function legacyRecordsOf(doc: LegacyRuleDoc): Record<string, ProxyMock.ProxyRequestRecord> {
  let raw = doc.jsonRequests
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch (err) {
      return {}
    }
  }
  if (raw == null || typeof raw !== 'object') return {}
  return raw
}

export function legacyRecordId(ruleId: string, url: string): string {
  return `${RECORD_PREFIX}${createHash('sha1').update(`${ruleId}\n${url}`).digest('hex')}`
}

/** bulkDocs 结果检查：409 冲突由调用方按重试处理，不当作失败 */
export function assertBulkOk(results: any[], action: string): void {
  for (const result of results) {
    if (result?.error && result.status !== 409) {
      throw new Error(`${action}失败: ${result.message ?? result.name ?? 'unknown'}`)
    }
  }
}
