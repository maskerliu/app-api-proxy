import express, { Request, Response, Router } from "express"
import { inject, injectable } from "inversify"
import JSONBig from 'json-bigint'
import 'reflect-metadata'
import { BizCode, BizFail, BizResponse } from "../../common/base.models"
import { ProxyMock } from "../../common/proxy.models"
import { IocTypes } from "../MainConst"
import { ICommonService, IMockService, IProxyService, IPushService } from '../service'

@injectable()
export class AppMockRouter {

  router: Router

  @inject(IocTypes.CommonService)
  private commonService: ICommonService
  @inject(IocTypes.PushService)
  private pushService: IPushService
  @inject(IocTypes.MocksService)
  private mockService: IMockService
  @inject(IocTypes.ProxyService)
  private proxyService: IProxyService

  constructor() {
    this.router = express.Router()

    this.router.post("/register", async (req: any, resp: Response) => {
      let uid: string = req.query["uid"] as string
      await this.route(req, resp, this.commonService.register, this.commonService, [uid])
    })

    this.router.get("/getAllPushClients", (req: any, resp: Response) => {
      this.route(req, resp, this.pushService.getAllPushClients, this.pushService, [])
    })

    this.router.get("/getServerConfig", (req: Request, resp: Response) => {
      this.route(req, resp, this.commonService.getServerConfig, this.commonService, [])
    })

    this.router.post('/saveProxyConfig', (req: any, resp: Response) => {
      let uid: string = req.query["uid"] as string
      let config =  this.parseBody(req, 'config')
      this.route(req, resp, this.proxyService.saveProxyConfig, this.proxyService, [uid, config])
    })

    this.router.get("/searchMockRules", (req: any, resp: Response) => {
      let uid: string = req.query["uid"] as string
      let keyword: string = req.query["keyword"] as string
      this.route(req, resp, this.mockService.searchMockRules, this.mockService, [uid, keyword])
    })

    this.router.get("/getMockRuleDetail", (req: Request, resp: Response) => {
      let uid: string = req.query["uid"] as string
      let ruleId: string = req.query["ruleId"] as string
      this.route(req, resp, this.mockService.getMockRuleDetail, this.mockService, [uid, ruleId])
    })

    this.router.post("/saveMockRule", (req: Request, resp: Response) => {
      let uid: string = req.query["uid"] as string
      let onlySnap: string = req.query["onlySnap"] as string
      let rule: ProxyMock.MockRule = this.parseBody(req, 'rule')
      this.route(req, resp, this.mockService.saveMockRule, this.mockService, [uid, onlySnap == 'true', rule])
    })

    this.router.post("/deleteMockRule", (req: any, resp: Response) => {
      let uid: string = req.query["uid"] as string
      let ruleId: string = req.query["ruleId"] as string
      this.route(req, resp, this.mockService.deleteMockRule, this.mockService, [uid, ruleId])
    })
  }

  async route(req: Request, resp: Response, func: Function, target: any, args: any[]) {
    let bizResp: BizResponse<any>
    try {
      let result = await Reflect.apply(func, target, args)
      if (result == null) {
        bizResp = { code: BizCode.FAIL, msg: 'biz inner error, no result found' }
      } else {
        bizResp = { code: BizCode.SUCCESS, data: result }
      }
    } catch (err) {
      console.error("error:", err)
      if (err instanceof BizFail) {
        bizResp = { code: err.code, msg: err.msg }
      } else {
        bizResp = { code: BizCode.ERROR, msg: err.toString() }
      }
    } finally {
      resp.json(bizResp)
      resp.end()
    }
  }

  private parseBody(req: Request, name: string) {
    let contentType = req.headers['content-type']
    let body: any
    if (contentType.indexOf('multipart/form-data') !== -1) {
      try {
        body = JSONBig.parse(req.body[name]) // try parse as JSON object
      } catch (err) {
        body = req.body[name] // just as plain text
      }
    } else if (contentType.indexOf('application/json') !== -1) {
      body = JSONBig.parse(req.body)
    } else {
      body = null
    }

    return body
  }
}