import { app } from 'electron'
import { Autowired, Service } from 'lynx-express-mvc'
import path from 'path'
import PouchDBFind from 'pouchdb-find'
import PouchDB from 'pouchdb-node'
import { BizCode, BizResponse } from '../../common/base.models'
import { ProxyMock } from '../../common/proxy.models'
import PushService from './push.service'

@Service()
export default class MockService {
  private localDB: PouchDB.Database
  private clientMockStatus: Map<string, string> = new Map()

  @Autowired()
  pushService: PushService

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
    let rule = await this.localDB.get<ProxyMock.MockRule>(ruleId, { attachments: true })

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
    let bizResp: BizResponse<Array<ProxyMock.MockRule>>

    let request: PouchDB.Find.FindRequest<ProxyMock.MockRule> = {
      selector: {
        _id: { $ne: /_design\/idx/ },
      },
      limit: 15,
      fields: ['_id', 'name', 'desc']
    }

    if (keyword != null && keyword != undefined) {
      request.selector['name'] = { $regex: new RegExp(`${keyword}`) }
    }
    try {
      let result = await this.localDB.find(request)
      let rules = new Array<ProxyMock.MockRule>()
      result.docs.forEach(it => {
        let rule = it as unknown as ProxyMock.MockRule
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
    let bizResp: BizResponse<ProxyMock.MockRule>

    try {
      let result = await this.localDB.get<ProxyMock.MockRule>(ruleId, { attachments: true })
      result.isMock = this.clientMockStatus.has(uid) && this.clientMockStatus.get(uid) == result._id
      bizResp = { code: BizCode.SUCCESS, data: result }
    } catch (err) {
      bizResp = { code: BizCode.ERROR, msg: "err" }
    } finally {
      return bizResp
    }
  }

  async saveMockRule(uid: string, onlySnap: boolean, rule?: ProxyMock.MockRule) {

    let bizResp: BizResponse<string>
    try {
      let isMock = rule.isMock
      if (rule.isMock) {
        this.clientMockStatus.set(uid, rule._id)
      }
      delete rule.isMock

      let result = null
      if (rule._id === null || rule._id === undefined) {
        result = await this.localDB.post(rule)
      } else {
        let getResult = await this.localDB.get<ProxyMock.MockRule>(rule._id)
        rule._rev = getResult._rev
        if (onlySnap) rule.requests = getResult.requests
        result = await this.localDB.put(rule)
      }

      this.updateMockSettings(uid, result.id, isMock)

      bizResp = result.ok ? { code: BizCode.SUCCESS, data: result.id } : { code: BizCode.FAIL, data: '插入失败' }
    } catch (err) {
      console.error('saveMockRule', err)
      bizResp = { code: BizCode.ERROR, msg: "保存规则失败" + err }
    } finally {
      return bizResp
    }
  }

  async deleteMockRule(uid: string, ruleId: string) {
    let bizResp: BizResponse<string>

    try {
      let mockRule = await this.localDB.get<ProxyMock.MockRule>(ruleId)
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