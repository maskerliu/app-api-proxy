import { Request, Response } from 'express'
import { inject, injectable } from 'inversify'
import 'reflect-metadata'
import { IocTypes } from "../MainConst"
import { IMapiService } from "../service"
import { BaseRouter, ParamType } from "./BaseRouter"

@injectable()
export class MapiRouter extends BaseRouter {

  @inject(IocTypes.MapiService)
  private mapiService: IMapiService

  constructor() {
    super()

    this.router.post('/login', (req: Request, resp: Response) => {
      let paramInfos = [{ key: 'username', val: ParamType.Query }, { key: 'password', val: ParamType.Query }]
      this.route(req, resp, this.mapiService.login, this.mapiService, paramInfos)
    })

    this.router.post('/logout', (req: Request, resp: Response) => {
      let paramInfos = [{ key: 'x-token', val: ParamType.Header }]
      this.route(req, resp, this.mapiService.logout, this.mapiService, paramInfos)
    })

    this.router.post('/register', (req: Request, resp: Response) => {
      let paramInfos = [
        { key: 'username', val: ParamType.Query },
        { key: 'password', val: ParamType.Query },
        { key: 'userInfo', val: ParamType.JsonBody }
      ]
      this.route(req, resp, this.mapiService.register, this.mapiService, paramInfos)
    })

    this.router.get('/user/:uid', (req: Request, resp: Response) => {
      let paramInfos = [{ key: 'uid', val: ParamType.Path }]
      this.route(req, resp, this.mapiService.getUserInfo, this.mapiService, paramInfos)
    })

  }

}