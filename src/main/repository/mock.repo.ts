import { createHash, randomUUID } from 'crypto'
import { injectable } from 'inversify'
import path from 'path'
import PouchDB from 'pouchdb-node'
import { ProxyMock } from '@shared/proxy.models'
import { pickHeader } from '@shared/http-header'
import type {
  MigrationReport, MockMigrationReportItem, MockMatchRule, RevertMockRequest, RevertMockResponse,
} from '@shared/mock.models'
import { MockError } from '@shared/mock.errors'
import {
  inferBodyType, normalizeMatchRule, normalizeMockRecord, sanitizeResponseHeaders
} from '@shared/mock.validation'
import { USER_DATA_DIR } from '../MainConst'
import { analyzeMatchStability, createMatchFromUrl, restoreStrict } from '../service/mock.derive'
import {
  MigrationPatch, applyMigrationPatch, fingerprintOf, planMigrationV4,
} from '../service/mock.migration'
import BaseRepo from './base.repo'

const RULE_TYPE = 'rule'
const RECORD_TYPE = 'record'
// PouchDB 只允许 _design/ 与 _local/ 作为下划线开头的保留 ID
const META_ID = 'mock_schema_meta'
const MIGRATION_REPORT_ID = 'mock_migration_report'
const MATCH_SCHEMA_VERSION = 1
// 2: 规则元信息与请求记录拆分为独立文档
// 3: 记录改为结构化响应模型，新记录使用 rec_<uuid>
// 4: 记录携带 match 条件与匹配指纹（R1 匹配引擎）
const LEGACY_SCHEMA_VERSION = 2
const RECORD_SCHEMA_VERSION = 3
const SCHEMA_VERSION = 4
const RECORD_PREFIX = 'rec_'

const RULE_SEARCH_LIMIT = 15
const RULE_SCAN_LIMIT = 1000
const RECORD_PAGE_LIMIT = 100
const MAX_RECORD_PAGE_LIMIT = 500
const DELETE_BATCH = 200
const CONFLICT_RETRY = 2
const MIGRATION_BATCH = 50
const MIGRATION_SYNC_LIMIT = 2000

interface DocMeta {
  _id: string
  _rev?: string
  _deleted?: boolean
}

interface MockRuleDoc extends DocMeta {
  type: typeof RULE_TYPE
  name: string
  desc: string
  createdAt: number
  updatedAt: number
}

interface MockRecordDoc extends DocMeta {
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

interface LegacyRuleDoc extends DocMeta {
  type?: string
  name?: string
  desc?: string
  createdAt?: number
  updatedAt?: number
  jsonRequests?: any
}

interface MockMetaDoc extends DocMeta {
  version: number
  backupVersion?: number
  mockSchemaVersion?: number
  migratedAt?: number
  migrationPending?: boolean
  migrationStatus?: MigrationReport['status']
  lastActiveRuleId?: string | null
  updatedAt: number
}

const RECORD_SUMMARY_FIELDS = [
  '_id', 'ruleId', 'url', 'name', 'match', 'matchFingerprint', 'matchInvalid',
  'source', 'createdAt', 'updatedAt',
]

interface MockMigrationReportDoc extends DocMeta, MigrationReport {
  type: 'migration-report'
}

export interface MockRecordChangeEvent {
  type: 'upsert' | 'remove' | 'reset'
  ruleId?: string
  recordId?: string
  /** upsert 时携带最新记录，缓存据此做增量编译，避免回读 */
  record?: ProxyMock.MockRecord
}

/**
 * Mock 规则存储：
 * - rule 文档：只存名称/描述等元信息
 * - record 文档：一条请求记录一个文档，新记录 _id = rec_<uuid>，历史记录保留 rec_<sha1>
 * - 列表按 createdAt 排序，分页加载
 */
@injectable()
export class MockRepo extends BaseRepo<ProxyMock.MockRule> {

  private initTask: Promise<void> = null
  private migrationTask: Promise<void> = null
  private migrationPending = false
  // 后台迁移时只阻止尚未迁移完成的规则写入，已处理规则可继续保存
  private migrationRuleIds = new Set<string>()
  private migratedRules = new Set<string>()
  private saveQueues = new Map<string, Promise<any>>()
  private recordListeners: Array<(event: MockRecordChangeEvent) => void> = []

  constructor() {
    super()
    this.pouchdb = new PouchDB(path.join(USER_DATA_DIR + '/biz_storage', 'Mock.Rules'))
  }

  /** 建索引并完成旧数据迁移；重复调用只执行一次 */
  public init(): Promise<void> {
    if (this.initTask == null) {
      this.initTask = this.initStorage().catch(err => {
        this.initTask = null
        throw err
      })
    }
    return this.initTask
  }

  private async initStorage() {
    await this.pouchdb.createIndex({
      index: { fields: ['type', 'ruleId', 'createdAt'], name: 'idx-mock-record' }
    })
    await this.pouchdb.createIndex({ index: { fields: ['type'], name: 'idx-mock-type' } })
    await this.pouchdb.createIndex({
      index: { fields: ['type', 'ruleId', 'url'], name: 'idx-mock-record-url' }
    })
    await this.pouchdb.createIndex({
      index: { fields: ['type', 'ruleId', 'matchFingerprint'], name: 'idx-mock-record-fingerprint' }
    })
    await this.pouchdb.createIndex({
      index: { fields: ['type', 'ruleId', 'updatedAt'], name: 'idx-mock-record-updated' }
    })
    await this.backupOnce()
    await this.migrateLegacy()
    await this.migrateRecordsV3()
    await this.scheduleMigrationV4()
  }

  /** 大库标记 pending 后后台迁移，不阻塞启动 */
  private async scheduleMigrationV4() {
    const meta = await this.getMeta()
    if (this.isMigratedV4(meta)) {
      this.migrationPending = false
      return
    }

    const total = await this.countRecords()
    if (total > MIGRATION_SYNC_LIMIT) {
      this.migrationPending = true
      await this.saveMeta({ migrationPending: true, migrationStatus: 'pending' })
      this.migrationTask = this.migrateRecordsV4(total)
        .catch(err => {
          this.migrationPending = true
          console.error('mock v4 migration failed:', err)
          this.saveMeta({ migrationStatus: 'failed' }).catch(() => { })
        })
      return
    }

    try {
      await this.migrateRecordsV4(total)
    } catch (err) {
      // 迁移失败时阻止写入，读路径仍可按旧字段展示，避免应用无法启动
      this.migrationPending = true
      console.error('mock v4 migration failed:', err)
    }
  }

  private isMigratedV4(meta: MockMetaDoc): boolean {
    return (meta?.version ?? 0) >= SCHEMA_VERSION
      && (meta?.mockSchemaVersion ?? 0) >= MATCH_SCHEMA_VERSION
  }

  public isMigrationPending(): boolean {
    return this.migrationPending
  }

  /** 保存/删除/迁移完成后触发；回调异常不影响保存结果 */
  public onRecordChanged(listener: (event: MockRecordChangeEvent) => void): void {
    this.recordListeners.push(listener)
  }

  private notifyRecordChanged(event: MockRecordChangeEvent) {
    for (const listener of this.recordListeners) {
      try {
        listener(event)
      } catch (err) {
        console.warn('mock record change listener failed:', (err as Error)?.message ?? err)
      }
    }
  }

  private enqueueSave<T>(ruleId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.saveQueues.get(ruleId) ?? Promise.resolve()
    const next = previous.catch(() => { }).then(task)
    this.saveQueues.set(ruleId, next)
    next.finally(() => {
      if (this.saveQueues.get(ruleId) === next) this.saveQueues.delete(ruleId)
    }).catch(() => { })
    return next
  }

  public async search(field?: string, query?: string, returnFields?: Array<string>) {
    // 规则数量远小于记录数量，先按 type 取规则文档再在内存中过滤，避免 regex 扫描全库
    const rules = await this.find({
      selector: { type: RULE_TYPE },
      limit: RULE_SCAN_LIMIT
    } as any) as unknown as MockRuleDoc[]

    const keyword = query == null ? '' : String(query).toLowerCase()
    const key = field ?? 'name'
    const result: any[] = []
    for (const rule of rules) {
      if (keyword !== '' && String((rule as any)[key] ?? '').toLowerCase().indexOf(keyword) == -1) continue
      result.push(returnFields == null ? rule : this.pickFields(rule, returnFields))
      if (result.length >= RULE_SEARCH_LIMIT) break
    }
    return result as unknown as ProxyMock.MockRule[]
  }

  public async getRule(ruleId: string): Promise<ProxyMock.MockRule> {
    if (ruleId == null) return null
    const doc = await this.getDoc<MockRuleDoc>(ruleId)
    if (doc == null || doc.type !== RULE_TYPE) return null
    const rule = doc as unknown as ProxyMock.MockRule
    rule.requests = new Map()
    return rule
  }

  /** 只保存规则元信息，记录由 saveRecord / removeRecord 单独维护 */
  public async save(rule: ProxyMock.MockRule): Promise<string> {
    delete (rule as any).requests // Map 无法被 JSON 序列化，落盘会变成无意义的 {}
    delete (rule as any).jsonRequests // 旧字段，迁移后不再写入

    const now = Date.now()
    if (rule._id == null) {
      const doc: MockRuleDoc = {
        _id: `rule_${randomUUID()}`,
        type: RULE_TYPE,
        name: rule.name ?? '',
        desc: rule.desc ?? '',
        createdAt: now,
        updatedAt: now
      }
      const resp = await this.pouchdb.put(doc)
      return resp.id
    }

    for (let attempt = 0; ; attempt++) {
      const stored = await this.getDoc<MockRuleDoc>(rule._id)
      if (stored == null || stored.type !== RULE_TYPE) throw new Error('Mock规则不存在')
      stored.name = rule.name
      stored.desc = rule.desc
      stored.updatedAt = now
      try {
        const resp = await this.pouchdb.put(stored)
        return resp.id
      } catch (err: any) {
        if (err?.status === 409 && attempt < CONFLICT_RETRY) continue
        throw err
      }
    }
  }

  public async delete(ruleId: string): Promise<boolean> {
    const removed = await this.enqueueSave(ruleId, async () => {
      await this.removeRecords(ruleId)
      const rule = await this.getDoc<MockRuleDoc>(ruleId)
      if (rule == null || rule.type !== RULE_TYPE) return false
      const resp = await this.pouchdb.remove(rule._id, rule._rev!)
      return resp.ok
    })
    if (!removed) return false

    this.notifyRecordChanged({ type: 'remove', ruleId })
    await this.clearRuleFromReport(ruleId)
    if ((await this.getLastActiveRuleId()) === ruleId) await this.setLastActiveRuleId(null)
    return true
  }

  public async countRecords(ruleId?: string): Promise<number> {
    if (ruleId != null) {
      let count = 0
      let bookmark: string = null
      while (true) {
        const request: any = {
          selector: { type: RECORD_TYPE, ruleId },
          sort: ['type', 'ruleId', 'createdAt'],
          fields: ['_id'],
          limit: 1000,
        }
        if (bookmark != null) request.bookmark = bookmark
        const page = await this.pouchdb.find(request)
        count += page.docs.length
        if (page.docs.length < 1000) return count
        bookmark = (page as any).bookmark
        if (bookmark == null) return count
      }
    }

    let count = 0
    let startkey = RECORD_PREFIX
    while (true) {
      const options: any = { startkey, endkey: `${RECORD_PREFIX}\ufff0`, limit: 2000 }
      if (startkey !== RECORD_PREFIX) options.skip = 1
      const page = await this.pouchdb.allDocs(options)
      count += page.rows.length
      if (page.rows.length < 2000) return count
      startkey = page.rows[page.rows.length - 1].id
    }
  }

  /** 规则级元信息分页遍历：缓存编译只依赖 match，不带响应体 */
  public async listRecordSummaries(ruleId: string, pageSize: number = 500): Promise<MockRecordSummary[]> {
    const result: MockRecordSummary[] = []
    let bookmark: string = null
    while (true) {
      const request: any = {
        selector: { type: RECORD_TYPE, ruleId },
        sort: ['type', 'ruleId', 'createdAt'],
        fields: RECORD_SUMMARY_FIELDS,
        limit: pageSize,
      }
      if (bookmark != null) request.bookmark = bookmark
      const page = await this.pouchdb.find(request)
      result.push(...(page.docs as unknown as MockRecordSummary[]))
      if (page.docs.length < pageSize) return result
      bookmark = (page as any).bookmark
      if (bookmark == null) return result
    }
  }

  /** 迁移与派生只需匹配相关字段，分页读取避免整库响应体进内存 */
  public async listAllRecordSummaries(pageSize: number = 500): Promise<MockRecordSummary[]> {
    const result: MockRecordSummary[] = []
    let bookmark: string = null
    while (true) {
      const request: any = {
        selector: { type: RECORD_TYPE },
        sort: ['type'],
        fields: RECORD_SUMMARY_FIELDS,
        limit: pageSize,
      }
      if (bookmark != null) request.bookmark = bookmark
      const page = await this.pouchdb.find(request)
      result.push(...(page.docs as unknown as MockRecordSummary[]))
      if (page.docs.length < pageSize) return result
      bookmark = (page as any).bookmark
      if (bookmark == null) return result
    }
  }

  /** 命中缓存重建用：按创建时间稳定分页拿到规则下全部记录 */
  public async listAllRecords(ruleId: string, pageSize: number = 200): Promise<ProxyMock.MockRecord[]> {
    const result: ProxyMock.MockRecord[] = []
    await this.iterateRecords(ruleId, record => { result.push(record) }, pageSize)
    return result
  }

  /** 分页遍历规则下全部记录，不受列表 MAX_RECORD_PAGE_LIMIT 限制 */
  public async iterateRecords(ruleId: string,
    visitor: (record: ProxyMock.MockRecord) => Promise<void> | void,
    pageSize: number = 100): Promise<void> {
    if (ruleId == null) return
    let bookmark: string = null
    while (true) {
      const request: any = {
        selector: { type: RECORD_TYPE, ruleId },
        sort: ['type', 'ruleId', 'createdAt'],
        limit: pageSize,
      }
      if (bookmark != null) request.bookmark = bookmark
      const page = await this.pouchdb.find(request)
      for (const doc of page.docs as unknown as MockRecordDoc[]) await visitor(this.toRecord(doc))
      if (page.docs.length < pageSize) return
      bookmark = (page as any).bookmark
      if (bookmark == null) return
    }
  }

  public async getLastActiveRuleId(): Promise<string | null> {
    const meta = await this.getMeta()
    return meta?.lastActiveRuleId ?? null
  }

  public async setLastActiveRuleId(ruleId: string | null): Promise<void> {
    await this.saveMeta({ lastActiveRuleId: ruleId ?? null })
  }

  public async listRecords(ruleId: string, offset: number = 0, limit: number = RECORD_PAGE_LIMIT): Promise<ProxyMock.MockRecordPage> {
    if (ruleId == null) return { items: [], hasMore: false }

    const size = Math.min(Math.max(Math.floor(limit) || RECORD_PAGE_LIMIT, 1), MAX_RECORD_PAGE_LIMIT)
    const skip = Math.max(Math.floor(offset) || 0, 0)
    const docs = await this.find({
      selector: { type: RECORD_TYPE, ruleId, createdAt: { $gt: null } },
      sort: ['type', 'ruleId', 'createdAt'],
      limit: size + 1,
      skip
    } as any) as unknown as MockRecordDoc[]

    return {
      items: docs.slice(0, size).map(it => this.toRecord(it)),
      hasMore: docs.length > size
    }
  }

  /** @deprecated R1 匹配引擎接入后仅作历史兜底：按 ruleId + url 取单条记录 */
  public async getRecord(ruleId: string, url: string): Promise<ProxyMock.MockRecord> {
    if (ruleId == null || url == null) return null
    const docs = await this.find({
      selector: { type: RECORD_TYPE, ruleId, url },
      sort: ['type', 'ruleId', 'url'],
      limit: 1
    } as any) as unknown as MockRecordDoc[]
    const doc = docs[0]
    if (doc == null || doc.ruleId !== ruleId || doc.url !== url) return null
    return this.toRecord(doc)
  }

  public async getRecordById(recordId: string): Promise<ProxyMock.MockRecord> {
    if (recordId == null) return null
    const doc = await this.getDoc<MockRecordDoc>(recordId)
    if (doc == null || doc.type !== RECORD_TYPE) return null
    return this.toRecord(doc)
  }

  /**
   * 全量保存记录；record.id 为空时新建 UUID 文档。
   * 唯一性由匹配指纹决定（url 只用于展示与旧版本兼容）；
   * expectedUpdatedAt 用于乐观锁，与当前 updatedAt 不一致时抛 409。
   */
  public async saveRecord(
    record: ProxyMock.MockRecord,
    expectedUpdatedAt?: number
  ): Promise<ProxyMock.MockRecordSaveResult> {
    if (record?.ruleId == null) throw new MockError('ruleMissing')

    const normalized = normalizeMockRecord(record)
    const url = normalized.url || normalized.source?.url || ''
    // 旧编辑器只保存 url：写入时就派生 match（含 E2 噪声键忽略），避免游离开匹配引擎
    const match = normalized.match != null
      ? normalizeMatchRule(normalized.match)
      : this.deriveMatch(normalized, url)
    if (match == null && url === '') throw new MockError('matchMissing')
    const fingerprint = match == null ? null : fingerprintOf(match)
    const name = normalized.name || url || match?.path || ''
    const ruleId = normalized.ruleId

    // 同一规则的查重与写入串行化，避免并发保存绕过指纹唯一校验
    return this.enqueueSave(ruleId, async () => {
      if (this.migrationPending && this.migrationRuleIds.has(ruleId) && !this.migratedRules.has(ruleId)) {
        throw new MockError('migrationFailed', 'mock migration in progress')
      }

      if (fingerprint != null) {
        const duplicate = await this.findByFingerprint(ruleId, fingerprint)
        if (duplicate != null && duplicate._id !== normalized.id) {
          throw new MockError('matchDuplicate', undefined, duplicate._id)
        }
      }

      const now = Date.now()
      if (normalized.id == null) {
        const doc: MockRecordDoc = {
          _id: `${RECORD_PREFIX}${randomUUID()}`,
          type: RECORD_TYPE,
          ruleId,
          url,
          name,
          match,
          matchFingerprint: fingerprint,
          response: normalized.response,
          variants: normalized.variants,
          activeVariantId: normalized.activeVariantId,
          source: normalized.source,
          createdAt: now,
          updatedAt: now
        }
        await this.pouchdb.put(doc)
        this.notifyRecordChanged({ type: 'upsert', ruleId, recordId: doc._id, record: this.toRecord(doc) })
        return { id: doc._id, updatedAt: now }
      }

      for (let attempt = 0; ; attempt++) {
        const current = await this.getDoc<MockRecordDoc>(normalized.id)
        if (current == null || current.type !== RECORD_TYPE) throw new MockError('recordMissing')
        if (current.ruleId !== ruleId) throw new MockError('ruleMissing')
        if (expectedUpdatedAt != null && current.updatedAt !== expectedUpdatedAt) {
          const conflict: any = new Error('记录已被其他人修改，请刷新后重试')
          conflict.status = 409
          throw conflict
        }

        const doc: MockRecordDoc = {
          _id: current._id,
          _rev: current._rev,
          type: RECORD_TYPE,
          ruleId,
          url,
          name,
          match,
          matchFingerprint: fingerprint,
          response: normalized.response,
          variants: normalized.variants,
          activeVariantId: normalized.activeVariantId,
          source: normalized.source,
          createdAt: current.createdAt ?? now,
          updatedAt: now
        }
        // 迁移记录保留旧结构，回滚旧版本时仍能读取
        if (current.record != null) {
          doc.record = this.toCompatRecord(normalized)
        }

        try {
          await this.pouchdb.put(doc)
          this.notifyRecordChanged({ type: 'upsert', ruleId, recordId: doc._id, record: this.toRecord(doc) })
          return { id: doc._id, updatedAt: now }
        } catch (err: any) {
          if (err?.status === 409 && attempt < CONFLICT_RETRY) continue
          throw err
        }
      }
    })
  }

  public async removeRecord(recordId: string): Promise<boolean> {
    if (recordId == null) return false
    const doc = await this.getDoc<MockRecordDoc>(recordId)
    if (doc == null || doc.type !== RECORD_TYPE) return false

    const removed = await this.enqueueSave(doc.ruleId, async () => {
      const current = await this.getDoc<MockRecordDoc>(recordId)
      if (current == null || current.type !== RECORD_TYPE) return false
      const resp = await this.pouchdb.remove(current._id, current._rev!)
      return resp.ok
    })
    if (removed) this.notifyRecordChanged({ type: 'remove', ruleId: doc.ruleId, recordId })
    return removed
  }

  private deriveMatch(record: ProxyMock.MockRecord, url: string): MockMatchRule | null {
    if (url === '') return null
    const draft: ProxyMock.MockRecord = { ...record, url, id: record.id ?? 'draft' }
    const analyzed = analyzeMatchStability([draft], {
      source: record.source != null ? 'recording' : 'manual',
      analyzedAt: Date.now(),
    })
    return analyzed[0]?.match ?? createMatchFromUrl(url, {
      method: record.source?.method,
      source: record.source != null ? 'recording' : 'manual',
    })
  }

  private async findByFingerprint(ruleId: string, fingerprint: string): Promise<MockRecordDoc> {
    const docs = await this.find({
      selector: { type: RECORD_TYPE, ruleId, matchFingerprint: fingerprint },
      limit: 1
    } as any) as unknown as MockRecordDoc[]
    return docs[0] ?? null
  }

  private toRecord(doc: MockRecordDoc): ProxyMock.MockRecord {
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
      response: this.responseFromLegacy(legacy),
      variants: [],
      activeVariantId: null,
      source: this.sourceFromLegacy(legacy, doc),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    })
  }

  private responseFromLegacy(legacy: ProxyMock.ProxyRequestRecord): ProxyMock.MockResponseDef {
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

  private sourceFromLegacy(legacy: ProxyMock.ProxyRequestRecord, doc: MockRecordDoc): ProxyMock.MockRecordSource {
    return {
      method: legacy?.method,
      url: doc.url,
      statusCode: legacy?.statusCode,
      headers: legacy?.responseHeaders,
      capturedAt: doc.createdAt
    }
  }

  private toCompatRecord(record: ProxyMock.MockRecord): ProxyMock.ProxyRequestRecord {
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

  private pickFields(doc: any, fields: Array<string>): any {
    const result: any = {}
    for (const key of fields) result[key] = doc[key]
    return result
  }

  private async getDoc<T extends DocMeta>(id: string): Promise<T> {
    try {
      return await this.pouchdb.get<T>(id)
    } catch (err: any) {
      if (err?.status === 404) return null
      throw err
    }
  }

  private async putWithRetry(doc: MockRecordDoc, attempt: number = 0): Promise<void> {
    try {
      await this.pouchdb.put(doc)
    } catch (err: any) {
      if (err?.status === 409 && attempt < CONFLICT_RETRY) {
        const current = await this.getDoc<MockRecordDoc>(doc._id)
        if (current != null) doc._rev = current._rev
        return this.putWithRetry(doc, attempt + 1)
      }
      throw err
    }
  }

  private async removeRecords(ruleId: string) {
    if (ruleId == null) return
    for (let round = 0; round < 10000; round++) {
      const docs = await this.find({
        selector: { type: RECORD_TYPE, ruleId },
        fields: ['_id', '_rev'],
        limit: DELETE_BATCH
      } as any) as unknown as MockRecordDoc[]
      if (docs.length === 0) return

      const results = await this.pouchdb.bulkDocs(
        docs.map(it => ({ _id: it._id, _rev: it._rev, _deleted: true })) as any
      ) as any[]
      this.assertBulk(results, '删除记录')
      if (docs.length < DELETE_BATCH) return
    }
    throw new Error('删除规则记录超时')
  }

  private assertBulk(results: any[], action: string) {
    for (const result of results) {
      if (result?.error && result.status !== 409) {
        throw new Error(`${action}失败: ${result.message ?? result.name ?? 'unknown'}`)
      }
    }
  }

  private async getMeta(): Promise<MockMetaDoc> {
    return this.getDoc<MockMetaDoc>(META_ID)
  }

  private async migrateLegacy() {
    const meta = await this.getMeta()
    if ((meta?.version ?? 0) >= LEGACY_SCHEMA_VERSION) return

    let startkey: string = null
    while (true) {
      const options: any = { include_docs: true, limit: 20 }
      if (startkey != null) {
        options.startkey = startkey
        options.skip = 1
      }
      const page = await this.pouchdb.allDocs(options)
      if (page.rows.length === 0) break
      startkey = page.rows[page.rows.length - 1].id

      for (const row of page.rows) {
        const doc = row.doc as LegacyRuleDoc
        if (doc == null) continue
        if (doc._id === META_ID || doc._id.startsWith('_design/')) continue
        if (doc.type === RECORD_TYPE || doc.type === RULE_TYPE) continue
        await this.migrateRule(doc)
      }
    }

    await this.saveMeta({ version: LEGACY_SCHEMA_VERSION })
  }

  /** v2 -> v3：旧记录补齐结构化响应字段，保留 _id 与 record 兼容字段 */
  private async migrateRecordsV3() {
    const meta = await this.getMeta()
    if ((meta?.version ?? 0) >= RECORD_SCHEMA_VERSION) return

    let startkey: string = null
    while (true) {
      const options: any = { include_docs: true, limit: 50 }
      if (startkey != null) {
        options.startkey = startkey
        options.skip = 1
      }
      const page = await this.pouchdb.allDocs(options)
      if (page.rows.length === 0) break
      startkey = page.rows[page.rows.length - 1].id

      for (const row of page.rows) {
        const doc = row.doc as MockRecordDoc
        if (doc == null) continue
        if (doc._id === META_ID || doc._id.startsWith('_design/')) continue
        if (doc.type !== RECORD_TYPE || doc.response != null) continue

        const legacy = (doc.record ?? {}) as ProxyMock.ProxyRequestRecord
        const upgraded: MockRecordDoc = {
          ...doc,
          name: doc.name ?? legacy.url ?? doc.url,
          response: this.responseFromLegacy(legacy),
          variants: [],
          activeVariantId: null,
          source: doc.source ?? this.sourceFromLegacy(legacy, doc)
        }
        await this.putWithRetry(upgraded)
      }
    }

    await this.saveMeta({ version: RECORD_SCHEMA_VERSION })
    console.log('mock schema migrated to v3')
  }

  /**
   * v3 -> v4：按规则做稳定性分析生成匹配条件与指纹。
   * - 已有 match.version=1 的记录不覆盖，只补指纹
   * - URL 无法解析的记录标记 matchInvalid 并停用
   * - 指纹重复保留 updatedAt 最新，其余标记 duplicateAfterMigration
   * 报告先落库再写 meta，失败可重入。
   */
  private async migrateRecordsV4(total: number) {
    const meta = await this.getMeta()
    if (this.isMigratedV4(meta)) return

    const startedAt = Date.now()
    const summaries = await this.listAllRecordSummaries()
    const byRule = new Map<string, MockRecordSummary[]>()
    for (const summary of summaries) {
      if (summary.ruleId == null) continue
      const list = byRule.get(summary.ruleId) ?? []
      list.push(summary)
      byRule.set(summary.ruleId, list)
    }

    const report: MigrationReport = {
      migratedAt: startedAt,
      status: 'running',
      totalRecords: total || summaries.length,
      processedRecords: 0,
      autoRelaxedRecords: 0,
      autoIgnoredKeyCount: 0,
      parameterizedPathCount: 0,
      invalidRecords: 0,
      items: [],
      duplicates: [],
      errors: [],
    }
    this.migrationRuleIds = new Set(byRule.keys())
    this.migratedRules = new Set()

    try {
      for (const [ruleId, list] of byRule) {
        const plan = planMigrationV4(
          list.map(summary => ({
            record: this.summaryToRecord(summary),
            keepMatch: summary.match?.version === 1,
            name: summary.name,
          })),
          startedAt,
        )

        report.autoRelaxedRecords += plan.autoRelaxedRecords
        report.autoIgnoredKeyCount += plan.autoIgnoredKeyCount
        report.parameterizedPathCount += plan.parameterizedPathCount
        report.invalidRecords += plan.invalidRecords
        report.items.push(...plan.items)
        report.duplicates.push(...plan.duplicates)

        await this.applyMatchPatches(plan.patches, report)
        this.migratedRules.add(ruleId)
        report.processedRecords += list.length
      }

      report.status = 'completed'
      report.migratedAt = Date.now()
      report.processedRecords = summaries.length
      report.durationMs = report.migratedAt - startedAt
      report.peakHeapUsedMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
      await this.saveMigrationReport(report)
      await this.saveMeta({
        version: SCHEMA_VERSION,
        mockSchemaVersion: MATCH_SCHEMA_VERSION,
        migratedAt: report.migratedAt,
        migrationPending: false,
        migrationStatus: 'completed',
      })
      this.migrationPending = false
      this.migrationRuleIds.clear()
      this.migratedRules.clear()
      this.notifyRecordChanged({ type: 'reset' })
      console.log(`mock schema migrated to v4: ${summaries.length} records`)
    } catch (err) {
      report.status = 'failed'
      report.errors = [{ recordId: '', reason: (err as Error)?.message ?? String(err) }]
      await this.saveMigrationReport(report).catch(() => { })
      await this.saveMeta({ migrationStatus: 'failed' }).catch(() => { })
      throw err
    }
  }

  private summaryToRecord(summary: MockRecordSummary): ProxyMock.MockRecord {
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

  private async applyMatchPatches(patches: MigrationPatch[], report?: MigrationReport) {
    for (let i = 0; i < patches.length; i += MIGRATION_BATCH) {
      const chunk = patches.slice(i, i + MIGRATION_BATCH)
      const patchById = new Map(chunk.map(it => [it.recordId, it]))
      const rows = await this.pouchdb.allDocs({
        keys: chunk.map(it => it.recordId),
        include_docs: true,
      })
      const docs: MockRecordDoc[] = []
      for (const row of rows.rows) {
        const doc = (row as any).doc as MockRecordDoc
        if (doc == null) continue
        const patch = patchById.get(doc._id)
        if (patch == null) continue

        applyMigrationPatch(doc, patch)
        docs.push(doc)
      }
      if (docs.length === 0) continue

      const results = await this.pouchdb.bulkDocs(docs as any) as any[]
      const retry: MockRecordDoc[] = []
      for (let index = 0; index < results.length; index++) {
        const result = results[index]
        if (result?.error == null) continue
        if (result.status === 409) {
          // 迁移期间可能被外部进程修改：重新取 rev 后单条重试
          if (docs[index] != null) retry.push(docs[index])
          continue
        }
        report?.errors.push({
          recordId: result.id ?? docs[index]?._id ?? '',
          reason: result.message ?? result.name ?? 'writeFailed',
        })
      }
      for (const doc of retry) {
        try {
          await this.putWithRetry(doc)
        } catch (err) {
          report?.errors.push({
            recordId: doc._id,
            reason: (err as Error)?.message ?? String(err),
          })
        }
      }
    }
  }

  public async getMigrationReport(): Promise<MigrationReport | null> {
    const doc = await this.getDoc<MockMigrationReportDoc>(MIGRATION_REPORT_ID)
    if (doc == null) return null
    const { _id, _rev, type, ...report } = doc as any
    return report as MigrationReport
  }

  public async revertMatch(request: RevertMockRequest): Promise<RevertMockResponse> {
    const result: RevertMockResponse = { reverted: 0, failed: [], duplicateDisabled: [] }
    const report = await this.getMigrationReport()
    const now = Date.now()
    const targets: Array<{ recordId: string; item?: MockMigrationReportItem }> = []

    if (request?.scope === 'all') {
      for (const item of report?.items ?? []) {
        if (item.invalidReason != null || item.revertedAt != null) continue
        if (request.ruleId != null && item.ruleId !== request.ruleId) continue
        targets.push({ recordId: item.recordId, item })
      }
    } else {
      if (request?.recordId == null) throw new MockError('recordMissing')
      targets.push({
        recordId: request.recordId,
        item: report?.items?.find(it => it.recordId === request.recordId),
      })
    }

    for (const target of targets) {
      const record = await this.getRecordById(target.recordId)
      if (record == null) {
        result.failed.push({ recordId: target.recordId, reason: 'recordMissing' })
        continue
      }
      const reverted = await this.revertRecord(record, now, result)
      if (reverted && target.item != null) target.item.revertedAt = now
    }

    if (report != null && targets.some(it => it.item != null)) {
      await this.saveMigrationReport(report)
    }
    return result
  }

  private async revertRecord(record: ProxyMock.MockRecord, analyzedAt: number,
    result: RevertMockResponse): Promise<boolean> {
    if (record.match == null) {
      result.failed.push({ recordId: record.id, reason: 'matchMissing' })
      return false
    }

    const restored = restoreStrict(record, analyzedAt)
    if (restored.match == null || restored.reason != null) {
      result.failed.push({ recordId: record.id, reason: restored.reason ?? 'sourceMissing' })
      return false
    }

    try {
      // 撤销是显式迁移动作，不受 UI 乐观锁影响
      await this.saveRecord({ ...record, match: restored.match, matchInvalid: undefined })
      result.reverted++
      return true
    } catch (err) {
      if (err instanceof MockError && err.code === 'matchDuplicate') {
        // 撤销后与另一条记录条件相同：按最新优先停用本条并写回报告
        await this.markRecordInvalid(record.id, 'duplicateAfterRevert')
        result.failed.push({ recordId: record.id, reason: 'matchDuplicate' })
        result.duplicateDisabled.push(record.id)
        return false
      }
      result.failed.push({ recordId: record.id, reason: (err as Error)?.message ?? String(err) })
      return false
    }
  }

  private async markRecordInvalid(recordId: string, reason: string) {
    const doc = await this.getDoc<MockRecordDoc>(recordId)
    if (doc == null || doc.type !== RECORD_TYPE) return
    await this.enqueueSave(doc.ruleId, async () => {
      const current = await this.getDoc<MockRecordDoc>(recordId)
      if (current == null) return
      current.matchInvalid = reason
      if (current.match != null) current.match.enabled = false
      await this.pouchdb.put(current)
      this.notifyRecordChanged({
        type: 'upsert', ruleId: current.ruleId, recordId,
        record: this.toRecord(current),
      })
    })
  }

  private async saveMigrationReport(report: MigrationReport) {
    for (let attempt = 0; ; attempt++) {
      const existing = await this.getDoc<MockMigrationReportDoc>(MIGRATION_REPORT_ID)
      const doc: any = { _id: MIGRATION_REPORT_ID, type: 'migration-report', ...report }
      if (existing != null) doc._rev = existing._rev
      try {
        await this.pouchdb.put(doc)
        return
      } catch (err: any) {
        if (err?.status === 409 && attempt < CONFLICT_RETRY) continue
        throw err
      }
    }
  }

  /** 删除规则时同步清理迁移报告中的条目，避免复核页出现悬空记录 */
  private async clearRuleFromReport(ruleId: string) {
    const report = await this.getMigrationReport()
    if (report?.items == null) return
    const next = report.items.filter(it => it.ruleId !== ruleId)
    if (next.length === report.items.length) return
    report.items = next
    await this.saveMigrationReport(report)
  }

  private async migrateRule(doc: LegacyRuleDoc) {
    const records = this.legacyRecords(doc)
    const urls = Object.keys(records)
    const now = Date.now()

    const recordDocs: MockRecordDoc[] = urls.map((url, idx) => {
      const value = records[url]
      const record = value != null && typeof value === 'object' ? value : {}
      const legacyRecord = { ...record, url } as ProxyMock.ProxyRequestRecord
      return {
        _id: this.legacyRecordId(doc._id, url),
        type: RECORD_TYPE,
        ruleId: doc._id,
        url,
        name: url,
        response: this.responseFromLegacy(legacyRecord),
        variants: [],
        activeVariantId: null,
        source: this.sourceFromLegacy(legacyRecord, { url, createdAt: now + idx } as MockRecordDoc),
        createdAt: now + idx,
        updatedAt: now + idx,
        record: legacyRecord
      }
    })

    // 先写记录再改规则文档，中途失败可重入；已存在的记录文档按冲突忽略
    for (let i = 0; i < recordDocs.length; i += DELETE_BATCH) {
      const results = await this.pouchdb.bulkDocs(recordDocs.slice(i, i + DELETE_BATCH) as any) as any[]
      this.assertBulk(results, '迁移记录')
    }

    const ruleDoc: MockRuleDoc = {
      _id: doc._id,
      _rev: doc._rev,
      type: RULE_TYPE,
      name: doc.name ?? '',
      desc: doc.desc ?? '',
      createdAt: doc.createdAt ?? now,
      updatedAt: doc.updatedAt ?? now
    }
    await this.pouchdb.put(ruleDoc)
    console.log(`mock schema migrated: rule ${doc._id}, ${recordDocs.length} records`)
  }

  private legacyRecords(doc: LegacyRuleDoc): Record<string, ProxyMock.ProxyRequestRecord> {
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

  private legacyRecordId(ruleId: string, url: string): string {
    return `rec_${createHash('sha1').update(`${ruleId}\n${url}`).digest('hex')}`
  }

  /** 迁移前备份一次；失败只记录日志，不阻塞启动 */
  private async backupOnce() {
    const meta = await this.getMeta()
    if ((meta?.backupVersion ?? 0) >= SCHEMA_VERSION) return
    const info = await this.pouchdb.info()
    if ((info?.doc_count ?? 0) === 0) {
      await this.saveMeta({ backupVersion: SCHEMA_VERSION })
      return
    }

    try {
      const backup = new PouchDB(`${this.pouchdb.name}.v${SCHEMA_VERSION}.bak`)
      await this.pouchdb.replicate.to(backup)
      await backup.close()
      await this.saveMeta({ backupVersion: SCHEMA_VERSION })
    } catch (err) {
      console.warn('mock schema backup failed:', (err as Error)?.message ?? err)
    }
  }

  private async saveMeta(patch: Partial<MockMetaDoc>) {
    for (let attempt = 0; ; attempt++) {
      const meta = await this.getMeta()
      // 保留未在本次 patch 中出现的字段（migrationPending / lastActiveRuleId 等）
      const doc: any = {
        ...(meta ?? {}),
        _id: META_ID,
        version: meta?.version ?? 0,
        backupVersion: meta?.backupVersion ?? 0,
        updatedAt: Date.now(),
        ...patch,
      }
      delete doc._rev
      if (meta != null) doc._rev = meta._rev
      try {
        await this.pouchdb.put(doc)
        return
      } catch (err: any) {
        if (err?.status === 409 && attempt < CONFLICT_RETRY) continue
        throw err
      }
    }
  }
}
