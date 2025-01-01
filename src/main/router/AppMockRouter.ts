import { Request, Response } from 'express'
import { inject, injectable } from 'inversify'
import 'reflect-metadata'
import { IocTypes } from '../MainConst'
import { ICommonService, IMockService, IProxyService, IPushService } from '../service'
import { BaseRouter, ParamType } from './BaseRouter'

@injectable()
export class AppMockRouter extends BaseRouter {

  @inject(IocTypes.CommonService)
  private commonService: ICommonService
  @inject(IocTypes.PushService)
  private pushService: IPushService
  @inject(IocTypes.MocksService)
  private mockService: IMockService
  @inject(IocTypes.ProxyService)
  private proxyService: IProxyService

  constructor() {
    super()

    this.router.post('/register', async (req: any, resp: Response) => {
      let paramInfos = [{ key: 'uid', val: ParamType.Query }]
      await this.route(req, resp, this.commonService.register, this.commonService, paramInfos)
    })

    this.router.get('/getAllPushClients', (req: any, resp: Response) => {
      this.route(req, resp, this.pushService.getAllPushClients, this.pushService, [])
    })

    this.router.get('/getServerConfig', (req: Request, resp: Response) => {
      this.route(req, resp, this.commonService.getServerConfig, this.commonService, [])
    })

    this.router.post('/saveProxyConfig', (req: any, resp: Response) => {
      let paramInfos = [{ key: 'uid', val: ParamType.Query }, { key: 'config', val: ParamType.JsonBody }]
      this.route(req, resp, this.proxyService.saveProxyConfig, this.proxyService, paramInfos)
    })

    this.router.get('/searchMockRules', (req: any, resp: Response) => {
      let paramInfos = [{ key: 'uid', val: ParamType.Query }, { key: 'keyword', val: ParamType.Query }]
      this.route(req, resp, this.mockService.searchMockRules, this.mockService, paramInfos)
    })

    this.router.get('/getMockRuleDetail', (req: Request, resp: Response) => {
      let paramInfos = [{ key: 'uid', val: ParamType.Query }, { key: 'ruleId', val: ParamType.Query }]
      this.route(req, resp, this.mockService.getMockRuleDetail, this.mockService, paramInfos)
    })

    this.router.post('/saveMockRule', (req: Request, resp: Response) => {
      let paramInfos = [
        { key: 'uid', val: ParamType.Query },
        { key: 'onlySnap', val: ParamType.Query },
        { key: 'rule', val: ParamType.JsonBody }
      ]
      this.route(req, resp, this.mockService.saveMockRule, this.mockService, paramInfos)
    })

    this.router.post('/deleteMockRule', (req: any, resp: Response) => {
      let paramInfos = [{ key: 'uid', val: ParamType.Query }, { key: 'ruleId', val: ParamType.Query }]
      this.route(req, resp, this.mockService.deleteMockRule, this.mockService, paramInfos)
    })
  }
}