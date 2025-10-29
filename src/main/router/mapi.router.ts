import { inject, injectable } from 'inversify'
import 'reflect-metadata'
import { IocTypes } from "../MainConst"
import { BizNetwork } from '../misc/network.utils'
import { MapiService } from "../service"
import { BaseRouter, ParamType } from "./base.router"

@injectable()
export class MapiRouter extends BaseRouter {

  @inject(IocTypes.MapiService)
  private mapiService: MapiService

  override initApiInfos(): void {
    this.addApiInfo({
      method: BizNetwork.Method_Get, path: '/login', func: 'login', target: 'mapiService',
      params: [{ key: 'loginInfo', type: ParamType.FormBody }]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post, path: '/logout', func: 'logout', target: 'mapiService',
      params: [
        { key: 'name', type: ParamType.FormBody },
        { key: 'password', type: ParamType.FormBody }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post, path: '/register', func: 'register', target: 'mapiService',
      params: [
        { key: 'username', type: ParamType.FormBody },
        { key: 'password', type: ParamType.FormBody },
        { key: 'userInfo', type: ParamType.FormBody },
        { key: 'avatar', type: ParamType.FormBody }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get, path: '/user/:uid', func: 'getUserInfo', target: 'mapiService',
      params: [{ key: 'uid', type: ParamType.Path }]
    })
  }
}