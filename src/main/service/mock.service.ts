import { inject, injectable } from 'inversify'
import { ProxyMock } from '@shared/proxy.models'
import { IocTypes } from "../MainConst"
import { MockRepo } from '../repository/mock.repo'
import { PushService } from './push.service'


@injectable()
export class MockService {

  @inject(IocTypes.PushService)
  private pushService: PushService

  @inject(IocTypes.MockRepo)
  private mockRepo: MockRepo

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

    // 失败请求的 statusCode 可能是 -100 或空值，非法状态码会让 Express 直接抛 RangeError
    const rawStatus = Number(record.statusCode)
    const statusCode = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : 200
    const responseHeaders = record.responseHeaders ?? null
    const data: ProxyMock.ProxyRequestRecord = {
      id: sessionId,
      type: ProxyMock.PorxyType.REQUEST_END,
      url: url,
      statusCode: statusCode,
      responseHeaders: responseHeaders,
      responseData: record.responseData == null ? null : JSON.stringify(record.responseData),
      time: new Date().getTime() - startTime,
      isMock: true,
    }
    this.pushService.sendProxyMessage(uid, data)
    return { statusCode, headers: responseHeaders, data: record.responseData }
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

  async saveMockRecord(ruleId: string, recordKey: string, record: ProxyMock.ProxyRequestRecord) {
    if (ruleId == null) throw new Error('Mock规则不存在')
    if (record?.url == null) throw new Error('请求数据缺少url字段')
    return this.mockRepo.saveRecord(ruleId, recordKey ?? record.url, record)
  }

  async deleteMockRecord(ruleId: string, recordKey: string) {
    if (ruleId == null || recordKey == null) throw new Error('Mock记录不存在')
    return this.mockRepo.removeRecord(ruleId, recordKey)
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