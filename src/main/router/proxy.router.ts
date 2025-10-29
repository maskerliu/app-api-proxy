import { inject, injectable } from "inversify"
import { IocTypes } from "../MainConst"
import { ProxyService } from "../service"
import { BaseRouter } from "./base.router"

@injectable()
export class ProxyRouter extends BaseRouter {

  @inject(IocTypes.ProxyService)
  private proxyService: ProxyService

  constructor() {
    super()

    this.router.all(/.*/, async (req, resp) => {
      let instance = Reflect.get(this, 'proxyService')
      await Reflect.apply(Reflect.get(instance, 'handleRequest'), instance, [req, resp])
    })
  }

  protected initApiInfos() { }
}