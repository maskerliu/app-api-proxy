import { Request, Response } from 'express'
import { inject, injectable } from 'inversify'
import 'reflect-metadata'
import { IocTypes } from '../MainConst'
import { ICommonService, IMockService, IProxyService, IPushService } from '../service'
import { ApiInfo, BaseRouter, ParamType } from './BaseRouter'

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


  private apiInfo: Array<ApiInfo> = [
    {
      method: 'post', path: '/register', func: 'register', target: 'commonService',
      params: [{ key: 'uid', val: ParamType.Query }]
    },
    { method: 'get', path: '/getAllPushClients', func: 'getAllPushClients', target: 'pushService' },
    { method: 'get', path: '/getServerConfig', func: 'getServerConfig', target: 'commonService' },
    {
      method: 'post', path: '/saveProxyConfig', func: 'saveProxyConfig', target: 'proxyService',
      params: [{ key: 'uid', val: ParamType.Query }, { key: 'config', val: ParamType.JsonBody }]
    },
    {
      method: 'get', path: '/searchMockRules', func: 'searchMockRules', target: 'mockService',
      params: [{ key: 'uid', val: ParamType.Query }, { key: 'keyword', val: ParamType.Query }]
    },
    {
      method: 'get', path: '/getMockRuleDetail', func: 'getMockRuleDetail', target: 'mockService',
      params: [{ key: 'uid', val: ParamType.Query }, { key: 'ruleId', val: ParamType.Query }]
    },
    {
      method: 'post', path: '/saveMockRule', func: 'saveMockRule', target: 'mockService',
      params: [
        { key: 'uid', val: ParamType.Query },
        { key: 'onlySnap', val: ParamType.Query },
        { key: 'rule', val: ParamType.JsonBody }
      ]
    },
    {
      method: 'post', path: '/deleteMockRule', func: 'deleteMockRule', target: 'mockService',
      params: [{ key: 'uid', val: ParamType.Query }, { key: 'ruleId', val: ParamType.Query }]
    },
  ]

  constructor() {
    super()

    this.apiInfo.forEach(item => {
      this.router[item.method](item.path, (req: Request, resp: Response) => {
        this.route(req, resp, item.func, item.target, item.params, false)
      })
    })
  }
}