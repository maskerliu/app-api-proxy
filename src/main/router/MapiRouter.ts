import { inject, injectable } from 'inversify'
import 'reflect-metadata'
import { IocTypes } from "../MainConst"
import { IMapiService } from "../service"
import { BaseRouter, ParamType } from "./BaseRouter"

@injectable()
export class MapiRouter extends BaseRouter {

  @inject(IocTypes.MapiService)
  private mapiService: IMapiService

  override initApiInfos(): void {

    console.log(this.mapiService)

    this.addApiInfo({
      method: 'post', path: '/login', func: 'login', target: 'mapiService',
      params: [
        { key: 'username', type: ParamType.Query },
        { key: 'password', type: ParamType.Query }]
    })

    this.addApiInfo({
      method: 'post', path: '/logout', func: 'logout', target: 'mapiService',
      params: [{ key: 'x-token', type: ParamType.Header }]
    })

    this.addApiInfo({
      method: 'post', path: '/register', func: 'register', target: 'mapiService',
      params: [
        { key: 'username', type: ParamType.Query },
        { key: 'password', type: ParamType.Query },
        { key: 'userInfo', type: ParamType.JsonBody }]
    })

    this.addApiInfo({
      method: 'get', path: '/user/:uid', func: 'getUserInfo', target: 'mapiService',
      params: [{ key: 'uid', type: ParamType.Path }]
    })
  }
}