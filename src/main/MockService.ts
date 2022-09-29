import { app } from 'electron'
import { Request, Response } from 'express'
import path from 'path'
import PouchDB from 'pouchdb'
import PouchDBFind from 'pouchdb-find'
import { BizCode, BizResponse, MockRule, PorxyType, ProxyRequestRecord } from '../common/models/DataModels'
import pushService from './PushService'

const JSONBigInt = require('json-bigint')

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

  public async mockRequestData(sessionId: number, req: Request, resp: Response, startTime: number, delay: number) {

    let uid = req.header('mock-uid')
    if (uid == null || !this.clientMockStatus.has(uid)) {
      return false
    }

    try {
      let ruleId = this.clientMockStatus.get(uid)
      let rule = await this.localDB.get<MockRule>(ruleId, { attachments: true })

      let record = rule.jsonRequests[req.url]
      if (record == null) return false

      setTimeout(() => {
        let statusCode: number = record.statusCode || 200
        resp.status(statusCode)
        resp.json(record.responseData)
        resp.end()

        let data: ProxyRequestRecord = {
          id: sessionId,
          type: PorxyType.REQUEST_END,
          statusCode: statusCode,
          headers: !!record.responseHeaders ? record.responseHeaders : null,
          responseData: !!record.responseData ? JSON.stringify(record.responseData) : null,
          time: new Date().getTime() - startTime,
          isMock: true,
        }
        pushService.sendProxyMessage(uid, data)
      }, delay)
      return true
    } catch (err) {
      return false
    }
  }

  public async searchMockRules(req: Request, resp: Response) {
    let uid = req.query['uid'] as string
    let keyword: any = req.query['keyword'] as string
    let bizResp = new BizResponse<Array<MockRule>>()

    let selector = { _id: { $ne: /_design\/idx/ } }
    if (keyword != null && keyword != undefined) {
      selector = Object.assign(selector, {
        name: { $regex: new RegExp(`${keyword}`) },
      })
    } else {
      // selector = Object.assign(selector, { name: { $ne: keyword } })
    }

    let findOptions = { selector: selector, limit: 15, fields: ['_id', 'name', 'desc'], }
    let result = await this.localDB.find(findOptions)
    let rules = new Array<MockRule>()
    try {
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
      resp.json(bizResp)
      resp.end()
    }
  }

  public async getMockRuleDetail(req: Request, resp: Response) {
    let uid = req.query['uid'] as string
    let ruleId = req.query["ruleId"] as string
    let bizResp = new BizResponse<MockRule>()

    try {
      let result = await this.localDB.get<MockRule>(ruleId, { attachments: true })
      result.isMock = this.clientMockStatus.has(uid) && this.clientMockStatus.get(uid) == result._id
      bizResp = { code: BizCode.SUCCESS, data: result }
    } catch (err) {
      bizResp = { code: BizCode.ERROR, msg: "err" }
    } finally {
      resp.json(bizResp);
      resp.end();
    }
  }

  public async saveMockRule(req: Request, resp: Response) {
    let uid = req.query['uid'] as string
    let onlySnap: boolean = req.query['onlySnap'] == 'true'

    try {
      let rule: MockRule = JSONBigInt.parse(req.body)
      let isMock = rule.isMock
      if (rule.isMock) {
        this.clientMockStatus.set(uid, rule._id)
      }
      delete rule.isMock

      if (rule._id === null || rule._id === undefined) {
        await this.insertMockRule(resp, rule, uid, isMock)
      } else {
        await this.updateMockRule(resp, rule, onlySnap, uid, isMock)
      }

    } catch (err) {
      console.error('saveMockRule', err)
      resp.json({ code: BizCode.ERROR, msg: "err" })
      resp.end()
    }
  }

  private async insertMockRule(resp: Response, rule: MockRule, uid: string, isMock: boolean) {
    let bizResp = new BizResponse<string>()
    try {
      let result = await this.localDB.post(rule)
      bizResp = result.ok ? { code: BizCode.SUCCESS, data: result.id } : { code: BizCode.FAIL, data: '插入失败' }
      this.updateMockSettings(uid, result.id, isMock)
    } catch (err) {
      console.error('insertMockRule', err)
      bizResp = { code: BizCode.ERROR, msg: "err" }
    } finally {
      resp.json(bizResp)
      resp.end()
    }
  }

  private async updateMockRule(resp: Response, rule: MockRule, onlySnap: boolean, uid: string, isMock: boolean) {
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
      resp.json(bizResp)
      resp.end()
    }
  }

  public async deleteMockRule(req: Request, resp: Response) {
    let uid = req.query['uid'] as string
    let ruleId: any = req.query['ruleId'] as string
    let bizResp = new BizResponse<string>()

    try {
      let mockRule = await this.localDB.get<MockRule>(ruleId)
      let removeResult = await this.localDB.remove(mockRule)
      this.updateMockSettings(uid, ruleId, false)
      bizResp = removeResult.ok ? { code: BizCode.SUCCESS, data: '成功删除记录' } : { code: BizCode.FAIL, data: 'Mock规则删除失败' }
    } catch (err) {
      console.error('deleteMockRule', err)
      bizResp = { code: BizCode.ERROR, msg: 'err' }
    } finally {
      resp.json(bizResp)
      resp.end
    }
  }

  public async uploadMockRule(req: Request, resp: Response) {
    let ruleId: any = req.query['ruleId']
    let bizResp = new BizResponse<string>()
    try {
      await this.localDB.get(ruleId, { attachments: true })
      bizResp = { code: BizCode.SUCCESS, data: '上传成功' }
    } catch (err) {
      console.error('uploadMockRule', err)
      bizResp = { code: BizCode.ERROR, msg: 'err' }
    } finally {
      resp.json(bizResp)
      resp.end()
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

export default new MockService()