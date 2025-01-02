import { Request, Response } from 'express'
import { inject, injectable } from 'inversify'
import 'reflect-metadata'
import { IocTypes } from "../MainConst"
import { IMapiService } from "../service"
import { ApiInfo, BaseRouter, ParamType } from "./BaseRouter"

@injectable()
export class MapiRouter extends BaseRouter {

  @inject(IocTypes.MapiService)
  private mapiService: IMapiService

  private apiInfos: Array<ApiInfo> = [
    {
      method: 'post', path: '/login', func: 'login', target: 'mapiService',
      params: [
        { key: 'username', val: ParamType.Query },
        { key: 'password', val: ParamType.Query }]
    },
    {
      method: 'post', path: '/logout', func: 'logout', target: 'mapiService',
      params: [{ key: 'x-token', val: ParamType.Header }]
    },
    {
      method: 'post', path: '/register', func: 'register', target: 'mapiService',
      params: [
        { key: 'username', val: ParamType.Query },
        { key: 'password', val: ParamType.Query },
        { key: 'userInfo', val: ParamType.JsonBody }]
    },
    {
      method: 'get', path: '/user/:uid', func: 'getUserInfo', target: 'mapiService',
      params: [{ key: 'uid', val: ParamType.Path }]
    }
  ]


  constructor() {
    super()


    this.apiInfos.forEach(item => {
      this.router[item.method](item.path, (req: Request, resp: Response) => {
        this.route(req, resp, item.func, this.mapiService, item.params, true)
      })
    })
  }
}