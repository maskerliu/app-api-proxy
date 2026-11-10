import { randomUUID } from 'crypto'
import { injectable } from 'inversify'
import path from 'path'
import PouchDB from 'pouchdb-node'
import { ProxyMock } from '@shared/proxy.models'
import type { MockMatchRule } from '@shared/mock.models'
import { MockError } from '@shared/mock.errors'
import { normalizeMatchRule, normalizeMockRecord } from '@shared/mock.validation'
import { USER_DATA_DIR } from '../MainConst'
import { analyzeMatchStability, createMatchFromUrl } from '../service/mock.derive'
import type {
  DocMeta, MockMetaDoc, MockRecordDoc, MockRecordSummary, MockRuleDoc,
} from './mock.docs'
import {
  CONFLICT_RETRY, DELETE_BATCH, META_ID, RECORD_PREFIX, RECORD_SUMMARY_FIELDS, RECORD_TYPE, RULE_TYPE,
  SCHEMA_VERSION, assertBulkOk, docToRecord, fingerprintOf, toCompatRecord,
} from './mock.docs'
import BaseRepo from './base.repo'

const RULE_SEARCH_LIMIT = 15
const RULE_SCAN_LIMIT = 1000
const RECORD_PAGE_LIMIT = 100
const MAX_RECORD_PAGE_LIMIT = 500
const RECORD_COUNT_PAGE_LIMIT = 1000
const RECORD_ID_COUNT_PAGE_LIMIT = 2000

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

  /** 建索引；重复调用只执行一次。schema 迁移由 MockMigrationRunner.run 承担 */
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

  // ---- 迁移闸门：状态与写入队列同属仓库层，只由 MockMigrationRunner 驱动 ----

  /** 迁移进行中或失败时挡住尚未处理完的规则写入 */
  public blockMigrationWrites(): void {
    this.migrationPending = true
  }

  public unblockMigrationWrites(): void {
    this.migrationPending = false
  }

  /** 逐规则迁移开始前登记待处理集合 */
  public beginMigrationGuard(ruleIds: Iterable<string>): void {
    this.migrationRuleIds = new Set(ruleIds)
    this.migratedRules = new Set()
  }

  public markRuleMigrated(ruleId: string): void {
    this.migratedRules.add(ruleId)
  }

  /** 迁移全部完成：解除闸门、清状态，并广播缓存整体重建 */
  public completeMigration(): void {
    this.migrationPending = false
    this.migrationRuleIds.clear()
    this.migratedRules.clear()
    this.notifyRecordChanged({ type: 'reset' })
  }

  private isRuleBlocked(ruleId: string): boolean {
    return this.migrationPending && this.migrationRuleIds.has(ruleId) && !this.migratedRules.has(ruleId)
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
          limit: RECORD_COUNT_PAGE_LIMIT,
        }
        if (bookmark != null) request.bookmark = bookmark
        const page = await this.pouchdb.find(request)
        count += page.docs.length
        if (page.docs.length < RECORD_COUNT_PAGE_LIMIT) return count
        bookmark = (page as any).bookmark
        if (bookmark == null) return count
      }
    }

    let count = 0
    let startkey = RECORD_PREFIX
    while (true) {
      const options: any = { startkey, endkey: `${RECORD_PREFIX}\ufff0`, limit: RECORD_ID_COUNT_PAGE_LIMIT }
      if (startkey !== RECORD_PREFIX) options.skip = 1
      const page = await this.pouchdb.allDocs(options)
      count += page.rows.length
      if (page.rows.length < RECORD_ID_COUNT_PAGE_LIMIT) return count
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
      for (const doc of page.docs as unknown as MockRecordDoc[]) await visitor(docToRecord(doc))
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
      items: docs.slice(0, size).map(it => docToRecord(it)),
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
    return docToRecord(doc)
  }

  public async getRecordById(recordId: string): Promise<ProxyMock.MockRecord> {
    if (recordId == null) return null
    const doc = await this.getDoc<MockRecordDoc>(recordId)
    if (doc == null || doc.type !== RECORD_TYPE) return null
    return docToRecord(doc)
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
      if (this.isRuleBlocked(ruleId)) {
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
        this.notifyRecordChanged({ type: 'upsert', ruleId, recordId: doc._id, record: docToRecord(doc) })
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
          doc.record = toCompatRecord(normalized)
        }

        try {
          await this.pouchdb.put(doc)
          this.notifyRecordChanged({ type: 'upsert', ruleId, recordId: doc._id, record: docToRecord(doc) })
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

  private pickFields(doc: any, fields: Array<string>): any {
    const result: any = {}
    for (const key of fields) result[key] = doc[key]
    return result
  }

  public async getDoc<T extends DocMeta>(id: string): Promise<T> {
    try {
      return await this.pouchdb.get<T>(id)
    } catch (err: any) {
      if (err?.status === 404) return null
      throw err
    }
  }

  // ---- 以下写入原语供迁移 runner 复用：PouchDB 句柄不出仓库层 ----

  public async putDoc<T extends DocMeta>(doc: T): Promise<PouchDB.Core.Response> {
    return this.pouchdb.put(doc as any)
  }

  public async bulkSave(docs: any[]): Promise<any[]> {
    return await this.pouchdb.bulkDocs(docs as any) as any[]
  }

  public async readDocs(options: any): Promise<any> {
    return this.pouchdb.allDocs(options)
  }

  public async putWithRetry(doc: MockRecordDoc, attempt: number = 0): Promise<void> {
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
      assertBulkOk(results, '删除记录')
      if (docs.length < DELETE_BATCH) return
    }
    throw new Error('删除规则记录超时')
  }

  public async getMeta(): Promise<MockMetaDoc> {
    return this.getDoc<MockMetaDoc>(META_ID)
  }

  public async markRecordInvalid(recordId: string, reason: string) {
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
        record: docToRecord(current),
      })
    })
  }

  /** 迁移前备份一次；失败只记录日志，不阻塞启动 */
  public async backupOnce() {
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

  public async saveMeta(patch: Partial<MockMetaDoc>) {
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
