import { inject, injectable } from 'inversify'
import 'reflect-metadata'
import { IocTypes } from '../MainConst'
import { BizNetwork } from '../misc/network.utils'
import { ICommonService, IMockService, IProxyService, IPushService } from '../service'
import { BaseRouter, ParamType } from './base.router'

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

  override initApiInfos(): void {
    this.addApiInfo({
      method: BizNetwork.Method_Get, path: '/register', func: 'register', target: 'commonService',
      params: [{ key: 'uid', type: ParamType.Query }]
    })
    this.addApiInfo({
      method: BizNetwork.Method_Get, path: '/getAllPushClients', func: 'getAllPushClients', target: 'pushService'
    })
    this.addApiInfo({
      method: BizNetwork.Method_Get, path: '/getServerConfig', func: 'getServerConfig', target: 'commonService'
    })
    this.addApiInfo({
      method: 'post', path: '/saveProxyConfig', func: 'saveProxyConfig', target: 'proxyService',
      params: [{ key: 'uid', type: ParamType.Query }, { key: 'config', type: ParamType.FormBody }]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get, path: '/searchMockRules', func: 'searchMockRules', target: 'mockService',
      params: [{ key: 'uid', type: ParamType.Query }, { key: 'keyword', type: ParamType.Query }]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get, path: '/getMockRuleDetail', func: 'getMockRuleDetail', target: 'mockService',
      params: [{ key: 'uid', type: ParamType.Query }, { key: 'ruleId', type: ParamType.Query }]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post, path: '/saveMockRule', func: 'saveMockRule', target: 'mockService',
      params: [
        { key: 'uid', type: ParamType.Query },
        { key: 'onlySnap', type: ParamType.Query },
        { key: 'rule', type: ParamType.FormBody }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post, path: '/deleteMockRule', func: 'deleteMockRule', target: 'mockService',
      params: [{ key: 'uid', type: ParamType.Query }, { key: 'ruleId', type: ParamType.Query }]
    })

  }
}