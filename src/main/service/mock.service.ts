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

  public async mock(sessionId: number, uid: string, url: string, startTime: number, delay: number): Promise<ProxyMock.MockResponse> {

    // Mock 开关由 viewer 控制；设备请求沿用其所属 viewer 的启用状态
    const ownerUid = uid == null ? null : this.pushService.resolveOwnerUid(uid)
    if (ownerUid == null || !this.clientMockStatus.has(ownerUid)) {
      throw new Error('no match mock rule')
    }

    const ruleId = this.clientMockStatus.get(ownerUid)
    const rule = await this.mockRepo.get('_id', ruleId)
    if (rule == null) {
      // 规则已被删除或索引失效，清掉客户端的启用状态
      this.clientMockStatus.delete(ownerUid)
      throw new Error('mock rule not found')
    }

    const record = rule.jsonRequests?.[url]
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
    let result = await this.mockRepo.get('_id', ruleId)
    if (result == null) throw new Error('Mock规则不存在')
    result.isMock = this.clientMockStatus.has(uid) && this.clientMockStatus.get(uid) == result._id
    return result
  }

  async saveMockRule(uid: string, onlySnap: boolean, rule?: ProxyMock.MockRule) {
    let isMock = rule.isMock
    if (rule.isMock) {
      this.clientMockStatus.set(uid, rule._id)
    }
    delete rule.isMock

    let result = await this.mockRepo.save(rule, onlySnap)
    this.updateMockSettings(uid, result, isMock)
    return result
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