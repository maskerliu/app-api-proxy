import { inject, injectable } from "inversify"
import { IOC_TYPES } from "../constants"
import { ProxyService } from "../service"
import { BaseRouter } from "./base.router"

@injectable()
export class ProxyRouter extends BaseRouter {

  @inject(IOC_TYPES.ProxyService)
  private proxyService: ProxyService

  constructor() {
    super()

    this.router.all(/.*/, async (req, resp) => {
      await this.proxyService.handleRequest(req, resp)
    })
  }

  protected initApiInfos() { }
}