import express, { Request, Response, Router } from "express"
import { inject, injectable } from "inversify"
import * as JSONBigInt from 'json-bigint'
import { BizCode, BizResponse } from "../../common/base.models"
import { ProxyMock } from "../../common/proxy.models"
import { IocTypes } from "../common/Const"
import { CommonService } from '../service/common.service'
import { MockService } from '../service/mock.service'
import { ProxyService } from '../service/proxy.service'
import { PushService } from '../service/push.service'

export let appMockRouter = express.Router()

@injectable()
export class AppMockRouter {

  router: Router

  @inject(IocTypes.CommonService)
  private commonService: CommonService
  @inject(IocTypes.PushService)
  private pushService: PushService
  @inject(IocTypes.MocksService)
  private mockService: MockService
  @inject(IocTypes.ProxyService)
  private proxyService: ProxyService

  constructor() {
    this.router = express.Router()

    this.router.all("/_appmock/register", (req: any, resp: Response) => {
      let uid: string = req.query["uid"] as string
      resp.send(this.commonService.register(uid))
      resp.end()
    })

    this.router.all("/_appmock/getAllPushClients", (req: any, resp: Response) => {
      resp.send(this.pushService.getAllPushClients())
      resp.end()
    })

    this.router.all("/_appmock/getServerConfig", (req: any, resp: Response) => {
      resp.send(this.commonService.getServerConfig())
      resp.end()
    })

    this.router.all("/_appmock/setProxyDelay", (req: any, resp: Response) => {
      let uid: string = req.query["uid"] as string
      let delay: number = req.query["keyword"] as number
      resp.send(this.proxyService.setProxyDelay(uid, delay))
      resp.end()
    })

    this.router.all("/_appmock/searchMockRules", (req: any, resp: Response) => {
      let uid: string = req.query["uid"] as string
      let keyword: string = req.query["keyword"] as string
      resp.send(this.mockService.searchMockRules(uid, keyword))
      resp.end()
    })

    this.router.all("/_appmock/getMockRuleDetail", (req: Request, resp: Response) => {
      let uid: string = req.query["uid"] as string
      let ruleId: string = req.query["ruleId"] as string
      resp.send(this.mockService.getMockRuleDetail(uid, ruleId))
      resp.end()
    })

    this.router.all("/_appmock/saveMockRule", async (req: any, resp: Response) => {
      let uid: string = req.query["uid"] as string
      let onlySnap: string = req.query["onlySnap"] as string
      let rule: ProxyMock.MockRule = JSONBigInt.parse(req.body["rule"])
      let result = await this.mockService.saveMockRule(uid, onlySnap == 'true', rule)
      let bizResp: BizResponse<string>
      if (result == null) {
        bizResp = { code: BizCode.FAIL, msg: 'biz inner error, no result found' }
      } else {
        bizResp = { code: BizCode.SUCCESS, data: result }
      }
      resp.send(bizResp)
      resp.end()
    })

    this.router.all("/_appmock/deleteMockRule", (req: any, resp: Response) => {
      let uid: string = req.query["uid"] as string
      let ruleId: string = req.query["ruleId"] as string
      resp.send(this.mockService.deleteMockRule(uid, ruleId))
      resp.end()
    })
  }

}