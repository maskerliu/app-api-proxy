import { inject, injectable } from 'inversify'
import type { ProxyMock } from '@shared/proxy.models'
import type {
  MockLimitState, MockMatchExplain, MockMatchOrdering, MockMatchWarning, MockMissDiagnostic,
} from '@shared/mock.models'
import { recordLimitState } from '@shared/mock.models'
import { normalizeMockRecord } from '@shared/mock.validation'
import { IocTypes } from '../MainConst'
import { MockRecordChangeEvent, MockRecordSummary, MockRepo } from '../repository/mock.repo'
import { detectMatchWarnings } from './mock.conflict'
import { MEMO_CAPACITY, shouldRebuildSnapshot } from './mock.cache.policy'
import {
  CompiledMatchRecord, MatcherRequestInput, NormalizedRequest, compileRecord, diagnoseMiss,
  explainMatch, findBestMatch, normalizeRequest,
} from './mock.matcher'

// 匹配快照与响应缓存分离：快照只保留 match 相关字段，响应按需回源

const RESPONSE_MAX_BYTES = 64 * 1024 * 1024
const RESPONSE_MAX_ENTRIES = 2000
const RESPONSE_SKIP_BYTES = 2 * 1024 * 1024

const EMPTY_RESPONSE: ProxyMock.MockResponseDef = {
  statusCode: 200, headers: {}, body: '', bodyType: 'json', delayMs: 0,
}

interface MemoEntry {
  matched: boolean
  recordId?: string
  ordering?: MockMatchOrdering
  degraded?: boolean
  miss?: MockMissDiagnostic
}

interface RuleSnapshot {
  ruleId: string
  version: number
  baselineCount: number
  exactPathMap: Map<string, CompiledMatchRecord[]>
  prefixList: CompiledMatchRecord[]
  globList: CompiledMatchRecord[]
  regexList: CompiledMatchRecord[]
  all: CompiledMatchRecord[]
  byId: Map<string, CompiledMatchRecord>
  ids: Set<string>
  // 迁移未完成或历史记录缺少 match 时的 URL 兜底
  unmigrated: Map<string, ProxyMock.MockRecord>
  headerNames: Set<string>
  memo: Map<string, MemoEntry>
  // 冲突扫描需要包含停用/无效记录，因此单独保留轻量记录
  records: Map<string, ProxyMock.MockRecord>
  warningVersion: number
  warnings: MockMatchWarning[]
  compiledAt: number
}

export interface CacheMatchOptions {
  explain?: boolean
}

export interface CacheMatchResult {
  matched: boolean
  recordId?: string
  record?: ProxyMock.MockRecord
  ordering?: MockMatchOrdering
  degraded?: boolean
  explain?: MockMatchExplain
  miss?: MockMissDiagnostic
  elapsedMs: number
}

export interface MockCacheStats {
  compiledBuilds: number
  incrementalUpserts: number
  memoHits: number
  memoMisses: number
  responseHits: number
  responseMisses: number
  responseSkipped: number
  hitWithIgnoredKeys: number
  snapshotCount: number
}

function now(): number {
  return Number(performance.now())
}

function stripTrailing(path: string): string {
  if (path.length <= 1) return path
  return path.replace(/\/+$/, '') || '/'
}

function urlKey(url: string): string {
  try {
    const parsed = new URL(String(url), 'http://placeholder.local')
    return `${parsed.pathname}${parsed.search}`
  } catch (err) {
    return String(url ?? '')
  }
}

function estimateBytes(record: ProxyMock.MockRecord): number {
  const response = record.response
  const bodyBytes = Buffer.byteLength(response?.body ?? '')
  const headerBytes = Buffer.byteLength(JSON.stringify(response?.headers ?? {}))
  const variantBytes = (record.variants ?? [])
    .reduce((sum, it) => sum + Buffer.byteLength(it?.body ?? ''), 0)
  return bodyBytes + headerBytes + variantBytes + 256
}

@injectable()
export class MockCache {

  @inject(IocTypes.MockRepo)
  private mockRepo: MockRepo

  private snapshots = new Map<string, RuleSnapshot>()
  private loading = new Map<string, Promise<RuleSnapshot>>()
  private responseCache = new Map<string, { record: ProxyMock.MockRecord; bytes: number }>()
  private responseBytes = 0
  private stats = {
    compiledBuilds: 0,
    incrementalUpserts: 0,
    memoHits: 0,
    memoMisses: 0,
    responseHits: 0,
    responseMisses: 0,
    responseSkipped: 0,
    hitWithIgnoredKeys: 0,
  }

  private initialized = false

  public init() {
    // 服务可能随配置变更多次 start，重复订阅会让同一事件被处理多次
    if (this.initialized) return
    this.initialized = true
    this.mockRepo.onRecordChanged(event => this.onRecordChanged(event))
  }

  public async match(ruleId: string, input: MatcherRequestInput,
    options?: CacheMatchOptions): Promise<CacheMatchResult> {
    const started = now()
    if (ruleId == null) return { matched: false, elapsedMs: 0 }

    const snapshot = await this.ensureSnapshot(ruleId)
    const request = normalizeRequest(input)
    const memoKey = this.memoKey(snapshot, request)

    if (options?.explain !== true) {
      const memo = snapshot.memo.get(memoKey)
      if (memo != null) {
        snapshot.memo.delete(memoKey)
        snapshot.memo.set(memoKey, memo)
        this.stats.memoHits++
        return { ...memo, elapsedMs: Number((now() - started).toFixed(3)) }
      }
      this.stats.memoMisses++
    }

    const candidates = this.collectCandidates(snapshot, request.path)
    const hit = findBestMatch(candidates, request)
    const elapsedMs = Number((now() - started).toFixed(3))

    if (hit != null) {
      const ignoredKeys = hit.compiled.match.query.ignoreKeys ?? []
      if (ignoredKeys.length > 0) this.stats.hitWithIgnoredKeys++
      const result: CacheMatchResult = {
        matched: true,
        recordId: hit.compiled.recordId,
        ordering: hit.ordering,
        degraded: false,
        explain: options?.explain === true
          ? explainMatch(hit.compiled, request, hit.ordering, elapsedMs)
          : undefined,
        elapsedMs,
      }
      this.storeMemo(snapshot, memoKey, result)
      return result
    }

    // 迁移未完成：未编译记录按录制 URL 兜底，必须标记 degraded
    const fallback = this.findUnmigrated(snapshot, input.url)
    if (fallback != null) {
      const result: CacheMatchResult = {
        matched: true,
        recordId: fallback.id,
        record: fallback,
        degraded: true,
        elapsedMs,
      }
      this.storeMemo(snapshot, memoKey, result)
      return result
    }

    const miss = diagnoseMiss(snapshot.all, request)
    const result: CacheMatchResult = { matched: false, miss, elapsedMs }
    this.storeMemo(snapshot, memoKey, result)
    return result
  }

  public async getCompiled(ruleId: string): Promise<RuleSnapshot> {
    return this.ensureSnapshot(ruleId)
  }

  public async getLimitState(ruleId: string): Promise<MockLimitState> {
    const snapshot = await this.ensureSnapshot(ruleId)
    return recordLimitState(snapshot.ids.size)
  }

  /** 冲突提示按快照版本懒计算；只提示不自动禁用 */
  public async getWarnings(ruleId: string): Promise<MockMatchWarning[]> {
    if (ruleId == null) return []
    const snapshot = await this.ensureSnapshot(ruleId)
    if (snapshot.warningVersion !== snapshot.version) {
      snapshot.warnings = detectMatchWarnings([...snapshot.records.values()])
      snapshot.warningVersion = snapshot.version
    }
    return snapshot.warnings
  }

  public upsert(record: ProxyMock.MockRecord) {
    if (record?.ruleId == null) return
    // 保存后响应体可能已变化，必须让下一次命中回源
    this.invalidateResponse(record.id)

    const snapshot = this.snapshots.get(record.ruleId)
    if (snapshot == null) return

    this.removeCompiled(snapshot, record.id)
    this.dropUnmigrated(snapshot, record.id)
    snapshot.ids.add(record.id)
    this.stats.incrementalUpserts++

    const nextCount = snapshot.ids.size
    if (shouldRebuildSnapshot(snapshot.baselineCount, nextCount)) {
      // 记录规模变化超过 10% 时交给下一次请求全量重建，避免增量维护成本超过重建
      this.invalidate(record.ruleId)
      return
    }

    this.addRecord(snapshot, record)
    snapshot.version++
    snapshot.memo.clear()
  }

  public remove(ruleId: string, recordId: string) {
    this.invalidateResponse(recordId)
    if (ruleId == null) return
    const snapshot = this.snapshots.get(ruleId)
    if (snapshot == null) return

    this.removeCompiled(snapshot, recordId)
    this.dropUnmigrated(snapshot, recordId)
    snapshot.ids.delete(recordId)
    snapshot.version++
    snapshot.memo.clear()
  }

  public invalidate(ruleId: string) {
    if (ruleId == null) return
    this.snapshots.delete(ruleId)
    this.invalidateResponsesOfRule(ruleId)
  }

  public invalidateAll() {
    this.snapshots.clear()
    this.loading.clear()
    this.responseCache.clear()
    this.responseBytes = 0
  }

  public async getRecordForResponse(ruleId: string, recordId: string): Promise<ProxyMock.MockRecord> {
    if (recordId == null) return null
    const cached = this.responseCache.get(recordId)
    if (cached != null) {
      this.responseCache.delete(recordId)
      this.responseCache.set(recordId, cached)
      this.stats.responseHits++
      return cached.record
    }

    this.stats.responseMisses++
    const record = await this.mockRepo.getRecordById(recordId)
    if (record == null) return null

    const bytes = estimateBytes(record)
    if (bytes > RESPONSE_SKIP_BYTES) {
      // 单条超大响应不进入缓存，直接回源，避免内存被单条记录拖垮
      this.stats.responseSkipped++
      return record
    }

    this.putResponse(record, bytes)
    return record
  }

  public invalidateResponse(recordId: string) {
    if (recordId == null) return
    const cached = this.responseCache.get(recordId)
    if (cached == null) return
    this.responseCache.delete(recordId)
    this.responseBytes -= cached.bytes
  }

  public getStats(): MockCacheStats {
    return { ...this.stats, snapshotCount: this.snapshots.size }
  }

  private onRecordChanged(event: MockRecordChangeEvent) {
    if (event?.type === 'reset') {
      this.invalidateAll()
      return
    }
    if (event?.type === 'upsert' && event.record != null) {
      this.upsert(event.record)
      return
    }
    if (event?.type === 'remove') {
      if (event.recordId == null) {
        this.invalidate(event.ruleId)
        return
      }
      this.remove(event.ruleId, event.recordId)
    }
  }

  private async ensureSnapshot(ruleId: string): Promise<RuleSnapshot> {
    const existing = this.snapshots.get(ruleId)
    if (existing != null) return existing

    let loading = this.loading.get(ruleId)
    if (loading == null) {
      loading = this.loadSnapshot(ruleId)
      this.loading.set(ruleId, loading)
      loading.finally(() => this.loading.delete(ruleId)).catch(() => { })
    }
    return loading
  }

  private async loadSnapshot(ruleId: string): Promise<RuleSnapshot> {
    const summaries = await this.mockRepo.listRecordSummaries(ruleId)
    const snapshot = this.createSnapshot(ruleId, summaries.length)
    for (const summary of summaries) {
      snapshot.ids.add(summary._id)
      this.addSummary(snapshot, summary)
    }
    this.snapshots.set(ruleId, snapshot)
    this.stats.compiledBuilds++
    return snapshot
  }

  private createSnapshot(ruleId: string, count: number): RuleSnapshot {
    return {
      ruleId,
      version: 0,
      baselineCount: count,
      exactPathMap: new Map(),
      prefixList: [],
      globList: [],
      regexList: [],
      all: [],
      byId: new Map(),
      ids: new Set(),
      unmigrated: new Map(),
      headerNames: new Set(),
      memo: new Map(),
      records: new Map(),
      warningVersion: -1,
      warnings: [],
      compiledAt: Date.now(),
    }
  }

  private addSummary(snapshot: RuleSnapshot, summary: MockRecordSummary) {
    const record = normalizeMockRecord({
      id: summary._id,
      ruleId: summary.ruleId,
      name: summary.name ?? '',
      url: summary.url ?? summary.source?.url ?? '',
      match: summary.match,
      matchInvalid: summary.matchInvalid,
      source: summary.source,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    })
    this.addRecord(snapshot, record)
  }

  private addRecord(snapshot: RuleSnapshot, record: ProxyMock.MockRecord) {
    // 快照不持有响应体，响应统一由 LRU 提供
    const light: ProxyMock.MockRecord = {
      ...record,
      response: EMPTY_RESPONSE,
      variants: [],
      activeVariantId: null,
    }
    snapshot.records.set(light.id, light)

    const compiled = compileRecord(light)
    if (compiled == null) {
      if (record.match == null && record.url) snapshot.unmigrated.set(urlKey(record.url), record)
      return
    }
    this.insertCompiled(snapshot, compiled)
  }

  private insertCompiled(snapshot: RuleSnapshot, compiled: CompiledMatchRecord) {
    snapshot.byId.set(compiled.recordId, compiled)
    snapshot.all.push(compiled)

    const match = compiled.match
    if (match.pathType === 'exact') {
      for (const key of this.exactKeys(match.path, match.pathIgnoreCase, match.ignoreTrailingSlash)) {
        const list = snapshot.exactPathMap.get(key) ?? []
        list.push(compiled)
        snapshot.exactPathMap.set(key, list)
      }
    } else if (match.pathType === 'prefix') {
      snapshot.prefixList.push(compiled)
    } else if (match.pathType === 'glob') {
      snapshot.globList.push(compiled)
    } else {
      snapshot.regexList.push(compiled)
    }

    for (const condition of compiled.headerConditions) snapshot.headerNames.add(condition.key)
  }

  private removeCompiled(snapshot: RuleSnapshot, recordId: string) {
    snapshot.records.delete(recordId)
    const compiled = snapshot.byId.get(recordId)
    if (compiled == null) return
    snapshot.byId.delete(recordId)
    snapshot.all = snapshot.all.filter(it => it.recordId !== recordId)
    snapshot.prefixList = snapshot.prefixList.filter(it => it.recordId !== recordId)
    snapshot.globList = snapshot.globList.filter(it => it.recordId !== recordId)
    snapshot.regexList = snapshot.regexList.filter(it => it.recordId !== recordId)
    snapshot.exactPathMap.forEach((list, key) => {
      const next = list.filter(it => it.recordId !== recordId)
      if (next.length === 0) snapshot.exactPathMap.delete(key)
      else if (next.length !== list.length) snapshot.exactPathMap.set(key, next)
    })
  }

  private dropUnmigrated(snapshot: RuleSnapshot, recordId: string) {
    snapshot.unmigrated.forEach((record, key) => {
      if (record.id === recordId) snapshot.unmigrated.delete(key)
    })
  }

  private exactKeys(path: string, ignoreCase: boolean, ignoreTrailingSlash: boolean): string[] {
    const values = new Set<string>([path])
    if (ignoreTrailingSlash) values.add(stripTrailing(path))
    if (ignoreCase) {
      for (const value of [...values]) values.add(value.toLowerCase())
    }
    return [...values]
  }

  private lookupKeys(path: string): string[] {
    const values = new Set<string>([path, stripTrailing(path)])
    for (const value of [...values]) values.add(value.toLowerCase())
    return [...values]
  }

  private collectCandidates(snapshot: RuleSnapshot, path: string): CompiledMatchRecord[] {
    const result: CompiledMatchRecord[] = []
    const seen = new Set<string>()
    const push = (list: CompiledMatchRecord[]) => {
      for (const compiled of list ?? []) {
        if (seen.has(compiled.recordId)) continue
        seen.add(compiled.recordId)
        result.push(compiled)
      }
    }

    for (const key of this.lookupKeys(path)) push(snapshot.exactPathMap.get(key))
    push(snapshot.prefixList)
    push(snapshot.globList)
    push(snapshot.regexList)
    return result
  }

  private findUnmigrated(snapshot: RuleSnapshot, url: string): ProxyMock.MockRecord {
    if (snapshot.unmigrated.size === 0) return null
    return snapshot.unmigrated.get(urlKey(url)) ?? null
  }

  private memoKey(snapshot: RuleSnapshot, request: NormalizedRequest): string {
    const query: string[] = []
    for (const key of [...request.query.keys()].sort()) {
      const entry = request.query.get(key)
      query.push(`${key}=${entry.hasEquals ? 1 : 0}:${entry.values.join(',')}`)
    }
    const headers: string[] = []
    for (const name of snapshot.headerNames) {
      const values = request.headers.get(name)
      if (values != null) headers.push(`${name}:${values.join(',')}`)
    }
    return `${request.method}|${request.host}|${request.port ?? ''}|${request.path}?${query.join('&')}#${headers.sort().join('&')}`
  }

  private storeMemo(snapshot: RuleSnapshot, key: string, value: MemoEntry) {
    snapshot.memo.delete(key)
    snapshot.memo.set(key, value)
    if (snapshot.memo.size > MEMO_CAPACITY) {
      const oldest = snapshot.memo.keys().next().value
      if (oldest != null) snapshot.memo.delete(oldest)
    }
  }

  private putResponse(record: ProxyMock.MockRecord, bytes: number) {
    this.invalidateResponse(record.id)
    while (this.responseCache.size >= RESPONSE_MAX_ENTRIES
      || this.responseBytes + bytes > RESPONSE_MAX_BYTES) {
      const oldest = this.responseCache.keys().next().value
      if (oldest == null) break
      this.invalidateResponse(oldest)
    }
    this.responseCache.set(record.id, { record, bytes })
    this.responseBytes += bytes
  }

  private invalidateResponsesOfRule(ruleId: string) {
    for (const [recordId, entry] of this.responseCache) {
      if (entry.record.ruleId === ruleId) this.invalidateResponse(recordId)
    }
  }
}