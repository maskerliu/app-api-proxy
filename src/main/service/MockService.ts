import { app } from 'electron'
import path from 'path'
import PouchDB from 'pouchdb'
import PouchDBFind from 'pouchdb-find'
import { BizCode, BizResponse, MockRule, PorxyType, ProxyRequestRecord } from '../../common/models'
import { Service } from '../common/decorators/WebMVC.decorators'

import pushService from './PushService'

@Service()
class MockService {
  private localDB: PouchDB.Database
  private clientMockStatus: Map<string, string> = new Map()

  constructor() {
    this.initDB()
  }

  private async initDB() {
    PouchDB.plugin(PouchDBFind)
    this.localDB = new PouchDB(path.join(app.getPath('userData'), 'MockRuleDB'))
    try {
      await this.localDB.createIndex({ index: { fields: ['name'] }, })
    } catch (err) {
      console.error('initDB', err)
    }
  }

  public async mock(sessionId: number, uid: string, url: string, startTime: number, delay: number) {

    if (uid == null || !this.clientMockStatus.has(uid)) {
      throw 'no match mock rule'
    }
    let ruleId = this.clientMockStatus.get(uid)
    let rule = await this.localDB.get<MockRule>(ruleId, { attachments: true })

    let record = rule.jsonRequests[url]
    if (record == null) throw 'no match mock rule'

    let data: ProxyRequestRecord = {
      id: sessionId,
      type: PorxyType.REQUEST_END,
      statusCode: record.statusCode || 200,
      headers: !!record.responseHeaders ? record.responseHeaders : null,
      responseData: !!record.responseData ? JSON.stringify(record.responseData) : null,
      time: new Date().getTime() - startTime,
      isMock: true,
    }
    pushService.sendProxyMessage(uid, data)
    return record.responseData
  }

  async searchMockRules(uid: string, keyword: string) {
    let bizResp = new BizResponse<Array<MockRule>>()

    let selector = { _id: { $ne: /_design\/idx/ } }
    if (keyword != null && keyword != undefined) {
      selector = Object.assign(selector, {
        name: { $regex: new RegExp(`${keyword}`) },
      })
    } else {
      // selector = Object.assign(selector, { name: { $ne: keyword } })
    }

    try {
      let findOptions = { selector: selector, limit: 15, fields: ['_id', 'name', 'desc'], }
      let result = await this.localDB.find(findOptions)
      let rules = new Array<MockRule>()
      result.docs.forEach(it => {
        let rule: MockRule = it as unknown as MockRule
        rule.isMock = this.clientMockStatus.has(uid) && this.clientMockStatus.get(uid) == rule._id
        rules.push(rule)
      })
      bizResp = { code: BizCode.SUCCESS, data: rules }
    } catch (err) {
      console.error('searchMockRules', err)
      bizResp = { code: BizCode.ERROR, msg: '服务查询失败' }
    } finally {
      return bizResp
    }
  }

  async getMockRuleDetail(uid: string, ruleId: string) {
    let bizResp = new BizResponse<MockRule>()

    try {
      let result = await this.localDB.get<MockRule>(ruleId, { attachments: true })
      result.isMock = this.clientMockStatus.has(uid) && this.clientMockStatus.get(uid) == result._id
      bizResp = { code: BizCode.SUCCESS, data: result }
    } catch (err) {
      bizResp = { code: BizCode.ERROR, msg: "err" }
    } finally {
      return bizResp
    }
  }

  async saveMockRule(uid: string, onlySnap: boolean, rule?: MockRule) {

    try {
      let isMock = rule.isMock
      if (rule.isMock) {
        this.clientMockStatus.set(uid, rule._id)
      }
      delete rule.isMock

      if (rule._id === null || rule._id === undefined) {
        return await this.insertMockRule(uid, rule, isMock)
      } else {
        return await this.updateMockRule(uid, rule, isMock, onlySnap)
      }

    } catch (err) {
      console.error('saveMockRule', err)
      return { code: BizCode.ERROR, msg: "err" }
    }
  }

  private async insertMockRule(uid: string, rule: MockRule, isMock: boolean) {
    let bizResp = new BizResponse<string>()
    try {
      let result = await this.localDB.post(rule)
      bizResp = result.ok ? { code: BizCode.SUCCESS, data: result.id } : { code: BizCode.FAIL, data: '插入失败' }
      this.updateMockSettings(uid, result.id, isMock)
    } catch (err) {
      console.error('insertMockRule', err)
      bizResp = { code: BizCode.ERROR, msg: "err" }
    } finally {
      return bizResp
    }
  }

  private async updateMockRule(uid: string, rule: MockRule, isMock: boolean, onlySnap: boolean) {
    let bizResp = new BizResponse<string>()
    try {
      let getResult = await this.localDB.get<MockRule>(rule._id)
      let newRule = Object.assign(rule, { _rev: getResult._rev })
      if (onlySnap) newRule.requests = getResult.requests
      let putResult = await this.localDB.put(newRule)
      this.updateMockSettings(uid, rule._id, isMock)
      bizResp = putResult.ok ? { code: BizCode.SUCCESS, data: putResult.id } : { code: BizCode.FAIL, data: '插入失败' }
    } catch (err) {
      console.error('updateMockRule', err)
      bizResp = { code: BizCode.ERROR, msg: "err" }
    } finally {
      return bizResp
    }
  }

  async deleteMockRule(uid: string, ruleId: string) {
    let bizResp = new BizResponse<string>()

    try {
      let mockRule = await this.localDB.get<MockRule>(ruleId)
      let removeResult = await this.localDB.remove(mockRule)
      this.updateMockSettings(uid, ruleId, false)
      bizResp = removeResult.ok ? { code: BizCode.SUCCESS, data: '成功删除记录' }
        : { code: BizCode.FAIL, data: 'Mock规则删除失败' }
    } catch (err) {
      console.error('deleteMockRule', err)
      bizResp = { code: BizCode.ERROR, msg: 'err' }
    } finally {
      return bizResp
    }
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

const mockService = new MockService()

export default mockService