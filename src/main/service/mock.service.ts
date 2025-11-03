import { inject, injectable } from 'inversify'
import { ProxyMock } from '../../common'
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

  public async mock(sessionId: number, uid: string, url: string, startTime: number, delay: number) {

    if (uid == null || !this.clientMockStatus.has(uid)) {
      throw 'no match mock rule'
    }

    let ruleId = this.clientMockStatus.get(uid)
    let rule = await this.mockRepo.get('_id', ruleId)
    let record = rule.jsonRequests[url]
    if (record == null) throw 'no match mock rule'

    let data: ProxyMock.ProxyRequestRecord = {
      id: sessionId,
      type: ProxyMock.PorxyType.REQUEST_END,
      statusCode: record.statusCode || 200,
      headers: !!record.responseHeaders ? record.responseHeaders : null,
      responseData: !!record.responseData ? JSON.stringify(record.responseData) : null,
      time: new Date().getTime() - startTime,
      isMock: true,
    }
    this.pushService.sendProxyMessage(uid, data)
    return record.responseData
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

  async getMockRuleDetail(uid: string, ruleId: string) {
    let result = await this.mockRepo.get('_id', ruleId)
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