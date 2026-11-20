import { randomUUID } from 'crypto'
import { injectable } from 'inversify'
import path from 'path'
import PouchDB from 'pouchdb-node'
import { ProxyMock } from '@shared/proxy.models'
import { MockError } from '@shared/mock.errors'
import { MOCK_RECORD_REJECT_LIMIT } from '@shared/mock.models'
import { MOCK_PACK_WRITE_BATCH, packTimestampOf } from '@shared/mock.pack'
import { USER_DATA_DIR } from '../constants'
import type {
  DocMeta, MockMetaDoc, MockRecordDoc, MockRecordFields, MockRecordStamps, MockRecordSummary, MockRuleDoc,
} from './mock.docs'
import {
  CONFLICT_RETRY, DELETE_BATCH, META_ID, RECORD_PREFIX, RECORD_SUMMARY_FIELDS, RECORD_TYPE, RULE_TYPE,
  SCHEMA_VERSION, assertBulkOk, docToRecord, recordFieldsOf, toRecordDoc,
} from './mock.docs'
import BaseRepo from './base.repo'

const RULE_SEARCH_LIMIT = 15
const RULE_SCAN_LIMIT = 1000
const RECORD_PAGE_LIMIT = 100
const MAX_RECORD_PAGE_LIMIT = 500
const RECORD_COUNT_PAGE_LIMIT = 1000
const RECORD_ID_COUNT_PAGE_LIMIT = 2000

export interface MockRecordChangeEvent {
  type: 'upsert' | 'remove' | 'reset' | 'invalidate'
  ruleId?: string
  recordId?: string
  /** upsert 时携带最新记录，缓存据此做增量编译，避免回读 */
  record?: ProxyMock.MockRecord
}

/**
 * `importRecords` 的单条落点。`index` 是入参下标：调用方要拿它回指包内「第几个场景的第几条」，
 * 结果页的明细只有带着坐标才有用（同 R4C-13 的「明细要能指回文件里那一行」）。
 */
export interface MockRecordImportOutcome {
  index: number
  status: 'created' | 'updated' | 'duplicate' | 'failed'
  /** created/updated：实际落库的 `_id`（可能与包内 id 不同）；duplicate：占住指纹的那条；failed：null */
  id: string | null
  /** `duplicate`/`failed` 的成因：能对上错误码就用错误码，PouchDB 自己的失败回它的 reason */
  reason?: string
}

export interface MockRecordImportResult {
  /** 与入参同序、每条都有值：跳过的那条也要有交代，否则调用方分不清「没写」和「没数」 */
  outcomes: MockRecordImportOutcome[]
  created: string[]
  updated: string[]
  /**
   * 取消在批与批之间生效：`created`/`updated` 只含已落库的那些，没写的逐条以
   * `packWriteAborted` 记在 `outcomes` 里（同上一条契约：「没数」和「没写」要分得开）。
   */
  aborted: boolean
}

/** 导入路径独有的一组写入语义（普通 `saveRecord` 永远取不到这些） */
export interface MockRecordImportOptions {
  /**
   * Q3 已裁决的口径：新建与复制取包内时间戳，合并覆盖取**库内原值**（不是包值）。
   * 不给或 `false` 就是整批一个写入时刻——`updatedAt` 是列表与匹配排序的兜底键，
   * 不注入就无法复现源机的相对优先级（AC-R4-01 据此成立），注入了也不许拿它判断「这条刚改过」。
   */
  preserveTimestamps?: boolean
  /**
   * 取消的检查点只放在这一层：批次循环只有这里有，服务层再切一遍就是两套批次口径。
   * 只在批与批之间看，批内不看不等于批内能断——`bulkDocs` 的原子单位就是这一批。
   */
  signal?: AbortSignal
  /** 每写完一批报一次（已写批数 / 本次调用的总批数）：§6.5 定的是按批次计量，不按字节 */
  onBatch?: (written: number, total: number) => void
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

  /**
   * 规则元信息全量遍历。导出与统计只能用它：`search` 的 RULE_SEARCH_LIMIT 是列表 UI 的
   * 命中上限，拿它导全场景会静默漏掉第 16 个之后的场景。
   */
  public async listRules(): Promise<ProxyMock.MockRule[]> {
    // 规则数量远小于记录数量，先按 type 取规则文档再在内存中过滤，避免 regex 扫描全库
    return this.find({
      selector: { type: RULE_TYPE },
      limit: RULE_SCAN_LIMIT
    } as any) as unknown as ProxyMock.MockRule[]
  }

  public async search(field?: string, query?: string, returnFields?: Array<string>) {
    const rules = await this.listRules()

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

    // 落库字段（url 回落、match 规范化、指纹、name 回落）只在 mock.docs 定义一次，导入路径接上后同走这里
    const fields = recordFieldsOf(record)
    const normalized = fields.normalized
    const ruleId = normalized.ruleId

    // 同一规则的查重与写入串行化，避免并发保存绕过指纹唯一校验
    return this.enqueueSave(ruleId, async () => {
      if (this.isRuleBlocked(ruleId)) {
        throw new MockError('migrationFailed', 'mock migration in progress')
      }

      if (fields.fingerprint != null) {
        const duplicate = await this.findByFingerprint(ruleId, fields.fingerprint)
        if (duplicate != null && duplicate._id !== normalized.id) {
          throw new MockError('matchDuplicate', undefined, duplicate._id)
        }
      }

      const now = Date.now()
      if (normalized.id == null) {
        const doc = toRecordDoc(fields, null, `${RECORD_PREFIX}${randomUUID()}`, now)
        await this.pouchdb.put(doc)
        this.notifyRecordChanged({ type: 'upsert', ruleId, recordId: doc._id, record: docToRecord(doc) })
        return { id: doc._id, updatedAt: now }
      }

      for (let attempt = 0; ; attempt++) {
        const current = await this.getDoc<MockRecordDoc>(normalized.id)
        if (current == null || current.type !== RECORD_TYPE) throw new MockError('recordMissing')
        if (current.ruleId !== ruleId) throw new MockError('ruleMissing')
        if (expectedUpdatedAt != null && current.updatedAt !== expectedUpdatedAt) {
          throw new MockError('saveConflict')
        }

        const doc = toRecordDoc(fields, current, current._id, now)

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

  /**
   * 批量写入（R4C-15）：`saveRecord` 的批量化，六步一步不少——归一化与指纹走 `recordFieldsOf`、
   * doc 走 `toRecordDoc`、`enqueueSave` 串行、迁移闸门、指纹查重、变更通知，只有落库换成 `bulkDocs`。
   * **不走 `bulkSave()`**：那是裸 `bulkDocs`，六步全跳，症状是「导入 5000 条成功、一条不命中、全程不报错」。
   *
   * 与单条保存不同的三处批语义：
   * - 一条坏数据不拖垮整批：`recordFieldsOf` 抛出的错误码记在那条的 `failed` 上；
   * - 指纹撞库内或撞同批前一条 → 那条不写、报 `duplicate`。跳过 / 覆盖 / 复制成三条策略是服务层的
   *   取舍（R4C-18），这一层只保证「指纹唯一」这条不变量不会因为改批量写而被绕过；
   * - 包内 `id` 只在它确实落在本场景时才当更新用（要续 `_rev`、要保住 `createdAt`），否则一律新分配
   *   `rec_<uuid>`：全盘接受的话，手改过的包能拿别的场景、甚至规则文档的 `_id` 盖掉库内那条。
   *
   * 取消接在这一层（`options.signal`，批与批之间生效，剩下的批次一条都不写）；回滚不接——
   * 批次之间抛错或取消时前面几批已经落库，要不要回收本场景由调用方按「本场景写进去几条」决定（§6.5）。
   * 时间戳默认整批共用一个 `now`；`preserveTimestamps` 是 R4C-16 只开给导入路径的注入口子——
   * 新建取包值、覆盖取库内原值（Q3 已裁决），包值不可用时仍回落 `now`。普通 `saveRecord` 取不到这个参数。
   */
  public async importRecords(ruleId: string,
    records: ProxyMock.MockRecord[], options?: MockRecordImportOptions): Promise<MockRecordImportResult> {
    if (ruleId == null) throw new MockError('ruleMissing')

    return this.enqueueSave(ruleId, async () => {
      if (this.isRuleBlocked(ruleId)) {
        throw new MockError('migrationFailed', 'mock import while migration in progress')
      }

      // 上限复核排在查重之前：先确认这批写得下，再花一次扫描建索引。
      // 更新分支并不新增条目，所以这是个偏保守的上界——拒绝档宁可多拦一次，也不能让库越过上限
      const total = await this.countRecords(ruleId)
      if (total + records.length > MOCK_RECORD_REJECT_LIMIT) {
        throw new MockError('recordTooMany', `records=${total + records.length}`)
      }

      // 一次摘要扫描建两张表：指纹归属（查重用）与本场景已有的 `_id`（判断包内 id 能不能当更新用）
      const fingerprintOwner = new Map<string, string>()
      const ownedIds = new Set<string>()
      for (const item of await this.listRecordSummaries(ruleId)) {
        ownedIds.add(item._id)
        if (item.matchFingerprint != null && !fingerprintOwner.has(item.matchFingerprint)) {
          fingerprintOwner.set(item.matchFingerprint, item._id)
        }
      }

      const outcomes: MockRecordImportOutcome[] = []
      const writes: Array<{ index: number; id: string; fields: MockRecordFields }> = []
      for (let index = 0; index < records.length; index++) {
        let fields: MockRecordFields
        try {
          // 目标场景由入参决定：包里那条带的 ruleId 指回的是导出的那个场景，照抄会把记录写进别的场景去
          fields = recordFieldsOf({ ...records[index], ruleId })
        } catch (err: any) {
          outcomes.push({
            index, status: 'failed', id: null,
            reason: err instanceof MockError ? err.code : String(err?.message ?? err)
          })
          continue
        }

        const packId = fields.normalized.id
        const id = packId != null && ownedIds.has(packId) ? packId : `${RECORD_PREFIX}${randomUUID()}`
        // 与单条保存同一句判断：撞到自己正要更新的那条不算重复
        const owner = fields.fingerprint == null ? null : fingerprintOwner.get(fields.fingerprint)
        if (owner != null && owner !== id) {
          outcomes.push({ index, status: 'duplicate', id: owner, reason: 'matchDuplicate' })
          continue
        }
        if (fields.fingerprint != null) fingerprintOwner.set(fields.fingerprint, id)
        writes.push({ index, id, fields })
      }

      // 更新分支要续 `_rev` 并保住 `createdAt`，而摘要里两个都没有：只回读这批真用得上的那几条
      const now = Date.now()
      const existingDocs = new Map<string, MockRecordDoc>()
      const updateIds = writes.filter(it => ownedIds.has(it.id)).map(it => it.id)
      for (let start = 0; start < updateIds.length; start += MOCK_PACK_WRITE_BATCH) {
        const page = await this.pouchdb.allDocs({
          keys: updateIds.slice(start, start + MOCK_PACK_WRITE_BATCH),
          include_docs: true
        } as any) as any
        for (const row of page.rows) {
          if (row.doc?.type === RECORD_TYPE) existingDocs.set(row.doc._id, row.doc as MockRecordDoc)
        }
      }

      const docs: Array<{ index: number; isUpdate: boolean; doc: MockRecordDoc }> = []
      for (const item of writes) {
        const existing = ownedIds.has(item.id) ? existingDocs.get(item.id) ?? null : null
        if (ownedIds.has(item.id) && existing == null) {
          outcomes.push({ index: item.index, status: 'failed', id: null, reason: 'recordMissing' })
          continue
        }
        // Q3：新建取包值、覆盖取库内原值。包值在归一化阶段就过了一遍 `packTimestampOf`，
        // 到这里的 0 与「包里没写」同义，所以两侧都再过一次只是为了兜住没经过那一层的调用方（HAR、直接调仓库的测试）
        let stamps: MockRecordStamps | undefined
        if (options?.preserveTimestamps === true) {
          stamps = existing == null
            ? {
              createdAt: packTimestampOf(item.fields.normalized.createdAt) ?? undefined,
              updatedAt: packTimestampOf(item.fields.normalized.updatedAt) ?? undefined
            }
            : { updatedAt: packTimestampOf(existing.updatedAt) ?? undefined }
        }
        docs.push({ index: item.index, isUpdate: existing != null, doc: toRecordDoc(item.fields, existing, item.id, now, stamps) })
      }

      const created: string[] = []
      const updated: string[] = []
      const totalBatches = Math.ceil(docs.length / MOCK_PACK_WRITE_BATCH)
      let aborted = false
      for (let start = 0, batch = 0; start < docs.length; start += MOCK_PACK_WRITE_BATCH, batch++) {
        if (options?.signal?.aborted === true) {
          // 批与批之间断：这一批一条都没写，但剩下的每条仍要有交代，不能留成「没数」
          for (let i = start; i < docs.length; i++) {
            outcomes.push({ index: docs[i].index, status: 'failed', id: null, reason: 'packWriteAborted' })
          }
          aborted = true
          break
        }
        const chunk = docs.slice(start, start + MOCK_PACK_WRITE_BATCH)
        const results = await this.pouchdb.bulkDocs(chunk.map(it => it.doc) as any) as any[]
        // 逐条判定而不是 `assertBulkOk`：一批里有一条被 PouchDB 顶住，不该把同批已经写进去的其余条目报成整批失败
        results.forEach((res, i) => {
          const item = chunk[i]
          if (res?.error === true) {
            outcomes.push({ index: item.index, status: 'failed', id: null, reason: String(res.reason ?? res.message ?? 'bulkDocs') })
            return
          }
          if (item.isUpdate) updated.push(item.doc._id)
          else created.push(item.doc._id)
          outcomes.push({ index: item.index, status: item.isUpdate ? 'updated' : 'created', id: item.doc._id })
        })
        // 按批作废整个场景的快照与响应缓存；「导入即生效」由 R4C-17 钉成集成断言
        this.notifyRecordChanged({ type: 'invalidate', ruleId })
        options?.onBatch?.(batch + 1, totalBatches)
      }

      return {
        outcomes: outcomes.sort((a, b) => a.index - b.index),
        created,
        updated,
        aborted
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
