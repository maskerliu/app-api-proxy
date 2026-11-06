import { inject, injectable } from 'inversify'
import { ProxyMock } from '@shared/proxy.models'
import { sanitizeResponseHeaders, validateMockRecord } from '@shared/mock.validation'
import { IocTypes } from "../MainConst"
import { MockRepo } from '../repository/mock.repo'
import { DiagnosticService } from './diagnostic.service'
import { PushService } from './push.service'


@injectable()
export class MockService {

  @inject(IocTypes.PushService)
  private pushService: PushService

  @inject(IocTypes.MockRepo)
  private mockRepo: MockRepo

  @inject(IocTypes.DiagnosticService)
  private diagnosticService: DiagnosticService

  private clientMockStatus: Map<string, string> = new Map()

  public async init() {
    await this.mockRepo.init()
  }

  public async mock(sessionId: number, uid: string, url: string, startTime: number, delay: number): Promise<ProxyMock.MockResponse> {

    // Mock 开关由 viewer 控制；设备请求沿用其所属 viewer 的启用状态
    const ownerUid = uid == null ? null : this.pushService.resolveOwnerUid(uid)
    if (ownerUid == null || !this.clientMockStatus.has(ownerUid)) {
      throw new Error('no match mock rule')
    }

    // 按 ruleId + url 直接定位单条记录，不再加载整条规则
    const ruleId = this.clientMockStatus.get(ownerUid)
    const record = await this.mockRepo.getRecord(ruleId, url)
    if (record == null) throw new Error('no match mock rule')
    this.diagnosticService.markMockHit(sessionId)

    const response = ProxyMock.effectiveResponse(record)
    // 失败请求的 statusCode 可能是 -100 或空值，非法状态码会让 Express 直接抛 RangeError
    const rawStatus = Number(response.statusCode)
    const statusCode = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : 200
    const responseHeaders = sanitizeResponseHeaders(response.headers)
    const data = this.resolveBody(response)
    const effectiveDelay = response.delayMs > 0 ? response.delayMs : delay

    const pushed: ProxyMock.ProxyRequestRecord = {
      id: sessionId,
      type: ProxyMock.PorxyType.REQUEST_END,
      url: url,
      statusCode: statusCode,
      responseHeaders: responseHeaders,
      responseData: this.toDisplayBody(response),
      time: new Date().getTime() - startTime,
      isMock: true,
    }
    this.pushService.sendProxyMessage(uid, pushed)
    return { statusCode, headers: responseHeaders, data, delay: effectiveDelay }
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
    let isMock = this.clientMockStatus.has(uid)
    try {
      let rules = await this.mockRepo.search('name', keyword, ['_id', 'name', 'desc'])
      rules.forEach(it => {
        it.isMock = isMock && this.clientMockStatus.get(uid) == it._id
      })
      return rules
    } catch (err) {
      console.error('searchMockRules', err)
      throw '服务查询失败'
    }
  }

  async getActiveMockRule(uid: string) {
    return this.clientMockStatus.get(uid) ?? ''
  }

  getActiveMockCount(): number {
    return this.clientMockStatus.size
  }

  async getMockRuleDetail(uid: string, ruleId: string) {
    let result = await this.mockRepo.getRule(ruleId)
    if (result == null) throw new Error('Mock规则不存在')
    result.isMock = this.clientMockStatus.has(uid) && this.clientMockStatus.get(uid) == result._id
    return result
  }

  async getMockRecords(ruleId: string, offset?: string, limit?: string) {
    const pageOffset = Number.parseInt(String(offset ?? '0'))
    const pageSize = Number.parseInt(String(limit ?? '100'))
    return this.mockRepo.listRecords(ruleId,
      Number.isFinite(pageOffset) ? pageOffset : 0,
      Number.isFinite(pageSize) ? pageSize : 100)
  }

  async saveMockRule(uid: string, rule?: ProxyMock.MockRule) {
    let isMock = rule.isMock
    if (rule.isMock) {
      this.clientMockStatus.set(uid, rule._id)
    }
    delete rule.isMock

    let result = await this.mockRepo.save(rule)
    this.updateMockSettings(uid, result, isMock)
    return result
  }

  async saveMockRecord(record: ProxyMock.MockRecord, expectedUpdatedAt?: number | string) {
    if (record?.ruleId == null) throw new Error('Mock规则不存在')
    const issues = validateMockRecord(record)
    if (issues.length > 0) {
      const error: any = new Error(issues[0].code)
      error.code = issues[0].code
      error.issues = issues
      throw error
    }
    // Query 参数到这里还是字符串，直接比较会让每次保存都判定为冲突
    const expected = expectedUpdatedAt == null || expectedUpdatedAt === '' ? null : Number(expectedUpdatedAt)
    if (expected != null && !Number.isFinite(expected)) throw new Error('expectedUpdatedAt 非法')
    return this.mockRepo.saveRecord(record, expected)
  }

  async deleteMockRecord(recordId: string) {
    if (recordId == null) throw new Error('Mock记录不存在')
    return this.mockRepo.removeRecord(recordId)
  }

  async deleteMockRule(uid: string, ruleId: string) {
    let removeResult = await this.mockRepo.delete(ruleId)
    this.updateMockSettings(uid, ruleId, false)
    return removeResult ? '成功删除记录' : 'Mock规则删除失败'
  }

  public clearClientState(uid: string) {
    this.clientMockStatus.delete(uid)
  }

  private updateMockSettings(uid: string, ruleId: string, isMock: boolean) {
    if (isMock) {
      this.clientMockStatus.set(uid, ruleId)
    } else {
      if (this.clientMockStatus.has(uid) && this.clientMockStatus.get(uid) == ruleId) {
        this.clientMockStatus.delete(uid)
      }
    }
  }
}