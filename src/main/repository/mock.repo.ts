import { createHash, randomUUID } from 'crypto'
import { injectable } from 'inversify'
import path from 'path'
import PouchDB from 'pouchdb-node'
import { ProxyMock } from '@shared/proxy.models'
import { USER_DATA_DIR } from '../MainConst'
import BaseRepo from './base.repo'

const RULE_TYPE = 'rule'
const RECORD_TYPE = 'record'
// PouchDB 只允许 _design/ 与 _local/ 作为下划线开头的保留 ID
const META_ID = 'mock_schema_meta'
// 2: 规则元信息与请求记录拆分为独立文档
const SCHEMA_VERSION = 2

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
  record: ProxyMock.ProxyRequestRecord
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
  updatedAt: number
}

/**
 * Mock 规则存储：
 * - rule 文档：只存名称/描述等元信息
 * - record 文档：一条请求记录一个文档，_id = sha1(ruleId + url)，单条读写 O(1)
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
    await this.migrateLegacy()
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

  /** Mock 命中路径：按 ruleId + url 直接取单条记录 */
  public async getRecord(ruleId: string, url: string): Promise<ProxyMock.ProxyRequestRecord> {
    if (ruleId == null || url == null) return null
    const doc = await this.getDoc<MockRecordDoc>(this.recordId(ruleId, url))
    if (doc == null || doc.type !== RECORD_TYPE || doc.ruleId !== ruleId || doc.url !== url) return null
    return this.toRecord(doc)
  }

  /** 新增或覆盖单条记录；recordKey 与 record.url 不同视为改 URL */
  public async saveRecord(ruleId: string, recordKey: string, record: ProxyMock.ProxyRequestRecord): Promise<string> {
    if (ruleId == null) throw new Error('Mock规则不存在')
    if (record?.url == null) throw new Error('请求数据缺少url字段')

    const newUrl = record.url
    const oldUrl = recordKey ?? newUrl
    const newId = this.recordId(ruleId, newUrl)
    const oldId = this.recordId(ruleId, oldUrl)
    const now = Date.now()

    let createdAt = now
    let rev: string = null

    const current = await this.getDoc<MockRecordDoc>(newId)
    if (current != null) {
      if (current.ruleId !== ruleId || current.url !== newUrl) throw new Error(`url [${newUrl}] 已存在`)
      createdAt = current.createdAt ?? now
      rev = current._rev
    } else if (newId !== oldId) {
      // 改 URL 时沿用原记录的创建时间，列表顺序保持稳定
      const previous = await this.getDoc<MockRecordDoc>(oldId)
      if (previous != null) createdAt = previous.createdAt ?? now
    }

    const doc: MockRecordDoc = {
      _id: newId,
      type: RECORD_TYPE,
      ruleId,
      url: newUrl,
      record,
      createdAt,
      updatedAt: now
    }
    if (rev != null) doc._rev = rev
    await this.putWithRetry(doc)

    if (newId !== oldId) {
      await this.removeDoc(oldId)
    }
    return newId
  }

  public async removeRecord(ruleId: string, recordKey: string): Promise<boolean> {
    if (ruleId == null || recordKey == null) return false
    const doc = await this.getDoc<MockRecordDoc>(this.recordId(ruleId, recordKey))
    if (doc == null || doc.type !== RECORD_TYPE || doc.ruleId !== ruleId || doc.url !== recordKey) return false
    const resp = await this.pouchdb.remove(doc._id, doc._rev!)
    return resp.ok
  }

  private recordId(ruleId: string, url: string): string {
    return `rec_${createHash('sha1').update(`${ruleId}\n${url}`).digest('hex')}`
  }

  private toRecord(doc: MockRecordDoc): ProxyMock.ProxyRequestRecord {
    return { ...(doc.record ?? {}), url: doc.url } as ProxyMock.ProxyRequestRecord
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

  /** 删除时若撞上并发写（409），重新取最新 _rev 再试 */
  private async removeDoc(id: string, attempt: number = 0): Promise<void> {
    const doc = await this.getDoc<MockRecordDoc>(id)
    if (doc == null) return
    try {
      await this.pouchdb.remove(doc._id, doc._rev!)
    } catch (err: any) {
      if (err?.status === 404) return
      if (err?.status === 409 && attempt < CONFLICT_RETRY) return this.removeDoc(id, attempt + 1)
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
    if ((meta?.version ?? 0) >= SCHEMA_VERSION) return

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

    await this.saveMeta()
  }

  private async migrateRule(doc: LegacyRuleDoc) {
    const records = this.legacyRecords(doc)
    const urls = Object.keys(records)
    const now = Date.now()

    const recordDocs: MockRecordDoc[] = urls.map((url, idx) => {
      const value = records[url]
      const record = value != null && typeof value === 'object' ? value : {}
      return {
        _id: this.recordId(doc._id, url),
        type: RECORD_TYPE,
        ruleId: doc._id,
        url,
        record: { ...record, url } as ProxyMock.ProxyRequestRecord,
        createdAt: now + idx,
        updatedAt: now + idx
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

  private async saveMeta() {
    const meta = await this.getMeta()
    const doc: any = { _id: META_ID, version: SCHEMA_VERSION, updatedAt: Date.now() }
    if (meta != null) doc._rev = meta._rev
    await this.pouchdb.put(doc)
  }
}
