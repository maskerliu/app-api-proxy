import { createHash, randomUUID } from 'crypto'
import { injectable } from 'inversify'
import path from 'path'
import PouchDB from 'pouchdb-node'
import { ProxyMock } from '@shared/proxy.models'
import {
  inferBodyType, normalizeMockRecord, sanitizeResponseHeaders
} from '@shared/mock.validation'
import { USER_DATA_DIR } from '../MainConst'
import BaseRepo from './base.repo'

const RULE_TYPE = 'rule'
const RECORD_TYPE = 'record'
// PouchDB 只允许 _design/ 与 _local/ 作为下划线开头的保留 ID
const META_ID = 'mock_schema_meta'
// 2: 规则元信息与请求记录拆分为独立文档
// 3: 记录改为结构化响应模型，新记录使用 rec_<uuid>
const LEGACY_SCHEMA_VERSION = 2
const SCHEMA_VERSION = 3

const RULE_SEARCH_LIMIT = 15
const RULE_SCAN_LIMIT = 1000
const RECORD_PAGE_LIMIT = 100
const MAX_RECORD_PAGE_LIMIT = 500
const DELETE_BATCH = 200
const CONFLICT_RETRY = 2

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
  url: string
  name: string
  response: ProxyMock.MockResponseDef
  variants: ProxyMock.MockVariant[]
  activeVariantId: string | null
  source?: ProxyMock.MockRecordSource
  createdAt: number
  updatedAt: number
  // 旧版本回滚兼容：仅从 v2 迁移来的记录保留并同步更新，新记录不写该字段
  record?: ProxyMock.ProxyRequestRecord
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
  updatedAt: number
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
    await this.backupOnce()
    await this.migrateLegacy()
    await this.migrateRecordsV3()
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
    await this.removeRecords(ruleId)
    const rule = await this.getDoc<MockRuleDoc>(ruleId)
    if (rule == null || rule.type !== RULE_TYPE) return false
    const resp = await this.pouchdb.remove(rule._id, rule._rev!)
    return resp.ok
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

  /** Mock 命中路径：R1 匹配引擎接入前仍按 ruleId + url 取单条记录 */
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
   * expectedUpdatedAt 用于乐观锁，与当前 updatedAt 不一致时抛 409。
   */
  public async saveRecord(
    record: ProxyMock.MockRecord,
    expectedUpdatedAt?: number
  ): Promise<ProxyMock.MockRecordSaveResult> {
    if (record?.ruleId == null) throw new Error('Mock规则不存在')
    if (record?.url == null || record.url === '') throw new Error('请求数据缺少url字段')

    const normalized = normalizeMockRecord(record)
    const duplicate = await this.findByUrl(record.ruleId, normalized.url)
    if (duplicate != null && duplicate._id !== record.id) {
      throw new Error(`url [${normalized.url}] 已存在`)
    }

    const now = Date.now()
    if (normalized.id == null) {
      const doc: MockRecordDoc = {
        _id: `rec_${randomUUID()}`,
        type: RECORD_TYPE,
        ruleId: normalized.ruleId,
        url: normalized.url,
        name: normalized.name,
        response: normalized.response,
        variants: normalized.variants,
        activeVariantId: normalized.activeVariantId,
        source: normalized.source,
        createdAt: now,
        updatedAt: now
      }
      await this.pouchdb.put(doc)
      return { id: doc._id, updatedAt: now }
    }

    for (let attempt = 0; ; attempt++) {
      const current = await this.getDoc<MockRecordDoc>(normalized.id)
      if (current == null || current.type !== RECORD_TYPE) throw new Error('Mock记录不存在')
      if (current.ruleId !== normalized.ruleId) throw new Error('Mock记录不属于该规则')
      if (expectedUpdatedAt != null && current.updatedAt !== expectedUpdatedAt) {
        const conflict: any = new Error('记录已被其他人修改，请刷新后重试')
        conflict.status = 409
        throw conflict
      }

      const doc: MockRecordDoc = {
        _id: current._id,
        _rev: current._rev,
        type: RECORD_TYPE,
        ruleId: normalized.ruleId,
        url: normalized.url,
        name: normalized.name,
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
        return { id: doc._id, updatedAt: now }
      } catch (err: any) {
        if (err?.status === 409 && attempt < CONFLICT_RETRY) continue
        throw err
      }
    }
  }

  public async removeRecord(recordId: string): Promise<boolean> {
    if (recordId == null) return false
    const doc = await this.getDoc<MockRecordDoc>(recordId)
    if (doc == null || doc.type !== RECORD_TYPE) return false
    const resp = await this.pouchdb.remove(doc._id, doc._rev!)
    return resp.ok
  }

  private async findByUrl(ruleId: string, url: string): Promise<MockRecordDoc> {
    const docs = await this.find({
      selector: { type: RECORD_TYPE, ruleId, url },
      sort: ['type', 'ruleId', 'url'],
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
        url: doc.url,
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
    const contentType = this.headerValue(headers, 'content-type')
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

  private headerValue(headers: ProxyMock.MockResponseHeaders, name: string): string {
    for (const key of Object.keys(headers ?? {})) {
      if (key.toLowerCase() !== name) continue
      const value = headers[key]
      return Array.isArray(value) ? value[0] : value
    }
    return ''
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
    if ((meta?.version ?? 0) >= SCHEMA_VERSION) return

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

    await this.saveMeta({ version: SCHEMA_VERSION })
    console.log('mock schema migrated to v3')
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
    const meta = await this.getMeta()
    const doc: any = {
      _id: META_ID,
      version: meta?.version ?? 0,
      backupVersion: meta?.backupVersion ?? 0,
      updatedAt: Date.now(),
      ...patch
    }
    if (meta != null) doc._rev = meta._rev
    await this.pouchdb.put(doc)
  }
}
