import { inject, injectable } from 'inversify'
import { ProxyMock } from '@shared/proxy.models'
import type {
  AnalyzeMockRequest, AnalyzeMockResponse, MatchMockRequest, MatchMockResponse, MockHitMeta,
  MockMatchWarning, RevertMockRequest,
} from '@shared/mock.models'
import { MOCK_RECORD_REJECT_LIMIT, levelOf } from '@shared/mock.models'
import { MockError } from '@shared/mock.errors'
import { sanitizeResponseHeaders, validateMockRecord } from '@shared/mock.validation'
import { IocTypes } from "../MainConst"
import { MockRepo } from '../repository/mock.repo'
import { CacheMatchResult, MockCache } from './mock.cache'
import { analyzeMatchStability } from './mock.derive'
import { DiagnosticService } from './diagnostic.service'
import { PushService } from './push.service'


export interface MockAttemptRequest {
  method?: string
  url: string
  headers?: Record<string, string | string[] | undefined>
}

/** 代理链路结果：matched=false 表示继续转发，miss 供 REQUEST_END 展示 */
export interface MockAttemptResult {
  matched: boolean
  response?: ProxyMock.MockResponse
  meta: MockHitMeta
}

const NO_MATCH_META: MockHitMeta = { hit: false }


@injectable()
export class MockService {

  @inject(IocTypes.PushService)
  private pushService: PushService

  @inject(IocTypes.MockRepo)
  private mockRepo: MockRepo

  @inject(IocTypes.MockCache)
  private mockCache: MockCache

  @inject(IocTypes.DiagnosticService)
  private diagnosticService: DiagnosticService

  private clientMockStatus: Map<string, string> = new Map()
  // 重启后新 viewer 会拿到新 uid，用最后启用的场景兜底恢复
  private lastActiveRuleId: string = null

  public async init() {
    await this.mockRepo.init()
    this.mockCache.init()
    this.lastActiveRuleId = await this.mockRepo.getLastActiveRuleId()
  }

  public async mock(sessionId: number, uid: string, request: MockAttemptRequest,
    startTime: number, delay: number): Promise<MockAttemptResult> {

    // Mock 开关由 viewer 控制；设备请求沿用其所属 viewer 的启用状态
    const ownerUid = uid == null ? null : this.pushService.resolveOwnerUid(uid)
    const ruleId = this.activeRuleOf(ownerUid)
    if (ruleId == null) return { matched: false, meta: NO_MATCH_META }

    const result = await this.mockCache.match(ruleId, request)
    if (!result.matched) {
      return { matched: false, meta: { hit: false, miss: result.miss } }
    }

    const record = result.record ?? await this.mockCache.getRecordForResponse(ruleId, result.recordId)
    if (record == null) {
      // 快照与存储短暂不一致（例如记录刚被删除）：按未命中处理
      return { matched: false, meta: { hit: false, miss: result.miss } }
    }

    this.diagnosticService.markMockHit(sessionId)
    const response = ProxyMock.effectiveResponse(record)
    // 失败请求的 statusCode 可能是 -100 或空值，非法状态码会让 Express 直接抛 RangeError
    const rawStatus = Number(response.statusCode)
    const statusCode = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : 200
    const responseHeaders = sanitizeResponseHeaders(response.headers)
    const data = this.resolveBody(response)
    const effectiveDelay = response.delayMs > 0 ? response.delayMs : delay
    const meta = this.hitMeta(record, result)

    const pushed: ProxyMock.ProxyRequestRecord = {
      id: sessionId,
      type: ProxyMock.ProxyType.REQUEST_END,
      url: request.url,
      statusCode: statusCode,
      responseHeaders: responseHeaders,
      responseData: this.toDisplayBody(response),
      time: new Date().getTime() - startTime,
      isMock: true,
      mock: meta,
    }
    this.pushService.sendProxyMessage(uid, pushed)
    return { matched: true, response: { statusCode, headers: responseHeaders, data, delay: effectiveDelay }, meta }
  }

  /** 当前生效规则：本会话显式选择优先，尚未选择过时回退到上次持久化的启用规则 */
  private activeRuleOf(uid: string): string {
    if (uid != null && this.clientMockStatus.has(uid)) return this.clientMockStatus.get(uid)
    if (this.clientMockStatus.size === 0) return this.lastActiveRuleId
    return null
  }

  private hitMeta(record: ProxyMock.MockRecord, result: CacheMatchResult): MockHitMeta {
    const ignoredKeys = record.match?.query?.ignoreKeys ?? []
    return {
      hit: true,
      recordId: record.id,
      level: record.match != null ? levelOf(record.match) : undefined,
      variantId: record.activeVariantId ?? undefined,
      ignoredKeys: ignoredKeys.length > 0 ? ignoredKeys : undefined,
      ordering: result.ordering,
      elapsedMs: result.elapsedMs,
      degraded: result.degraded === true ? true : undefined,
    }
  }

  /** 变体/基础响应里的 body 转为 Express send 可用的值 */
  private resolveBody(response: ProxyMock.MockResponseDef): any {
    if (response.body == null || response.body === '') return null
    if (response.bodyEncoding === 'base64' || response.bodyType === 'binary') {
      return Buffer.from(response.body, 'base64')
    }
    if (response.bodyType === 'json') {
      try {
        return JSON.parse(response.body)
      } catch (err) {
        // 非法 JSON 允许保存（用于测试异常解析），按原文返回
        return response.body
      }
    }
    return response.body
  }

  /** 推送给 UI 的响应体：JSON 还原为对象，二进制输出 base64 文本 */
  private toDisplayBody(response: ProxyMock.MockResponseDef): any {
    if (response.body == null || response.body === '') return null
    if (response.bodyEncoding === 'base64' || response.bodyType === 'binary') return response.body
    if (response.bodyType === 'json') {
      try {
        return JSON.parse(response.body)
      } catch (err) {
        return response.body
      }
    }
    return response.body
  }

  async searchMockRules(uid: string, keyword: string) {
    const activeRuleId = this.activeRuleOf(uid)
    try {
      let rules = await this.mockRepo.search('name', keyword, ['_id', 'name', 'desc'])
      rules.forEach(it => {
        it.isMock = activeRuleId != null && activeRuleId === it._id
      })
      return rules
    } catch (err) {
      console.error('searchMockRules', err)
      throw '服务查询失败'
    }
  }

  async getActiveMockRule(uid: string) {
    return this.activeRuleOf(uid) ?? ''
  }

  getActiveMockCount(): number {
    if (this.clientMockStatus.size > 0) return this.clientMockStatus.size
    return this.lastActiveRuleId != null ? 1 : 0
  }

  async getMockRuleDetail(uid: string, ruleId: string) {
    let result = await this.mockRepo.getRule(ruleId)
    if (result == null) throw new MockError('ruleMissing')
    result.isMock = this.activeRuleOf(uid) === result._id
    return Object.assign(result, { limitState: await this.mockCache.getLimitState(ruleId) })
  }

  async getMockRecords(ruleId: string, offset?: string, limit?: string) {
    const pageOffset = Number.parseInt(String(offset ?? '0'))
    const pageSize = Number.parseInt(String(limit ?? '100'))
    const page = await this.mockRepo.listRecords(ruleId,
      Number.isFinite(pageOffset) ? pageOffset : 0,
      Number.isFinite(pageSize) ? pageSize : 100)
    await this.attachWarnings(ruleId, page.items)
    return page
  }

  /** 列表接口附带冲突标记（重复 / 遮蔽 / 不可达 / 无效），不持久化 */
  private async attachWarnings(ruleId: string, items: ProxyMock.MockRecord[]) {
    if (items.length === 0) return
    const warnings = await this.mockCache.getWarnings(ruleId)
    if (warnings.length === 0) return

    const grouped = new Map<string, MockMatchWarning[]>()
    for (const warning of warnings) {
      const list = grouped.get(warning.recordId) ?? []
      list.push(warning)
      grouped.set(warning.recordId, list)
    }
    for (const item of items) {
      const list = grouped.get(item.id)
      if (list != null) item.matchWarnings = list
    }
  }

  // 深链定位与冲突恢复：按记录 id 取单条
  async getMockRecord(recordId: string) {
    return this.mockRepo.getRecordById(recordId)
  }

  // 录制前重复检测：规则内命中路径唯一
  async getMockRecordByUrl(ruleId: string, url: string) {
    return this.mockRepo.getRecord(ruleId, url)
  }

  async saveMockRule(uid: string, rule?: ProxyMock.MockRule) {
    if (rule == null) throw new MockError('ruleMissing')
    const isMock = rule.isMock === true

    // 规模护栏：超过 1 万条记录拒绝启用，禁止静默截断
    if (isMock && rule._id != null) {
      const count = await this.mockRepo.countRecords(rule._id)
      if (count > MOCK_RECORD_REJECT_LIMIT) {
        throw new MockError('recordTooMany', `records=${count}`)
      }
    }

    delete rule.isMock
    const result = await this.mockRepo.save(rule)
    await this.updateMockSettings(uid, result, isMock, rule.name)
    return result
  }

  async saveMockRecord(record: ProxyMock.MockRecord, expectedUpdatedAt?: number | string) {
    if (record?.ruleId == null) throw new MockError('ruleMissing')

    const issues = validateMockRecord(record)
    if (issues.length > 0) {
      const error = new MockError(issues[0].code as any, issues[0].detail)
      ;(error as any).issues = issues
      throw error
    }

    // Query 参数到这里还是字符串，直接比较会让每次保存都判定为冲突
    const expected = expectedUpdatedAt == null || expectedUpdatedAt === '' ? null : Number(expectedUpdatedAt)
    if (expected != null && !Number.isFinite(expected)) throw new MockError('matchMissing', 'expectedUpdatedAt')
    return this.mockRepo.saveRecord(record, expected)
  }

  async deleteMockRecord(recordId: string) {
    if (recordId == null) throw new MockError('recordMissing')
    return this.mockRepo.removeRecord(recordId)
  }

  // ---- R1 匹配引擎 API（R1C-19） ----

  /** 测试匹配与录制去重共用入口；未命中返回 miss，不抛业务异常 */
  async matchMockRecord(request: MatchMockRequest): Promise<MatchMockResponse> {
    if (request?.url == null) throw new MockError('matchMissing')

    const ruleId = request.ruleId ?? this.lastActiveRuleId
    if (ruleId == null) return { matched: false, meta: NO_MATCH_META }

    const result = await this.mockCache.match(ruleId, {
      method: request.method,
      url: request.url,
      headers: request.headers,
    }, { explain: true })

    if (!result.matched) return { matched: false, meta: { hit: false, miss: result.miss } }

    const record = result.record ?? await this.mockCache.getRecordForResponse(ruleId, result.recordId)
    if (record == null) return { matched: false, meta: { hit: false, miss: result.miss } }

    return {
      matched: true,
      recordId: record.id,
      record,
      explain: result.explain,
      meta: this.hitMeta(record, result),
    }
  }

  /** 预览单条请求的派生匹配条件（E1/E2 与 Path 参数化建议） */
  async analyzeMockMatch(_uid: string, request: AnalyzeMockRequest): Promise<AnalyzeMockResponse> {
    if (request?.ruleId == null) throw new MockError('ruleMissing')

    let record: ProxyMock.MockRecord
    if (request.recordId != null) {
      record = await this.mockRepo.getRecordById(request.recordId)
      if (record == null) throw new MockError('recordMissing')
    } else {
      if (request.url == null || String(request.url).trim() === '') throw new MockError('matchMissing')
      record = {
        id: 'draft',
        ruleId: request.ruleId,
        name: '',
        url: request.url,
        response: ProxyMock.defaultResponse(),
        variants: [],
        activeVariantId: null,
        source: { method: request.method, url: request.url },
        createdAt: 0,
        updatedAt: 0,
      }
    }

    const [analyzed] = analyzeMatchStability([record], { source: 'recording' })
    if (analyzed?.derivation == null) throw new MockError('matchMissing')
    return {
      derivation: analyzed.derivation,
      autoIgnoredKeys: analyzed.autoIgnoredKeys,
      suggestions: analyzed.suggestions,
      pathParameterized: analyzed.pathParameterized,
      pathOriginal: analyzed.pathOriginal,
      pathSuggested: analyzed.pathSuggested,
    }
  }

  async getMockMigrationReport() {
    return this.mockRepo.getMigrationReport()
  }

  async revertMockMatch(request: RevertMockRequest) {
    if (request?.scope !== 'record' && request?.scope !== 'all') throw new MockError('recordMissing')
    return this.mockRepo.revertMatch(request)
  }

  isMigrationPending(): boolean {
    return this.mockRepo.isMigrationPending()
  }

  async getMockMatchWarnings(ruleId: string): Promise<MockMatchWarning[]> {
    if (ruleId == null) throw new MockError('ruleMissing')
    return this.mockCache.getWarnings(ruleId)
  }

  async deleteMockRule(uid: string, ruleId: string) {
    const rule = await this.mockRepo.getRule(ruleId)
    let removeResult = await this.mockRepo.delete(ruleId)
    await this.updateMockSettings(uid, ruleId, false, rule?.name)
    return removeResult ? '成功删除记录' : 'Mock规则删除失败'
  }

  public clearClientState(uid: string) {
    this.clientMockStatus.delete(uid)
  }

  private async updateMockSettings(uid: string, ruleId: string, isMock: boolean, ruleName?: string) {
    if (isMock) {
      if (uid != null) this.clientMockStatus.set(uid, ruleId)
      await this.persistLastActiveRuleId(ruleId)
      this.pushService.broadcastMockStatus({ ruleId, ruleName, enabled: true })
      return
    }

    const owned = uid != null && this.clientMockStatus.get(uid) === ruleId
    if (owned) this.clientMockStatus.delete(uid)
    if (this.lastActiveRuleId === ruleId) await this.persistLastActiveRuleId(null)
    // 其他窗口仍在用的规则不广播关闭，避免把别人的开关一起关掉
    if (owned || this.lastActiveRuleId == null) {
      this.pushService.broadcastMockStatus({ ruleId: null, ruleName, enabled: false })
    }
  }

  /** 启用状态写入 meta，重启后 viewer 换新 uid 也能恢复 */
  private async persistLastActiveRuleId(ruleId: string | null) {
    const next = ruleId ?? null
    if (this.lastActiveRuleId === next) return
    this.lastActiveRuleId = next
    await this.mockRepo.setLastActiveRuleId(next)
  }
}