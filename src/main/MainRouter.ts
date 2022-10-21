import { Request, Response } from 'express'
import { BizCode, BizResponse } from '../common/models'
import AbstractRouter from './common/AbstractRouter'
import { Scan, __Controllers, __RouteMap } from './common/decorators/WebMVC.decorators'


@Scan('./controller', './test/test')
class MainRouter extends AbstractRouter {

  public route(req: Request, resp: Response) {
    let ctrls: Array<any> = Reflect.has(this, __Controllers) ? Reflect.get(this, __Controllers) : new Array()
    for (let i = 0; i < ctrls.length; ++i) {
      let controller = ctrls[i]
      let routeMap = Reflect.get(controller, __RouteMap) as Map<string, string>
      if (routeMap.has(req.path)) {
        Reflect.apply(Reflect.get(controller, routeMap.get(req.path)), controller, [req, resp])
        break
      }
    }
  }

  error(req: Request, resp: Response, err: any) {
    // resp.writeHead(400, DEFAULT_HEADER)
    let bizResp: BizResponse<string> = {
      code: BizCode.ERROR,
      message: err.message
    }
    resp.json(bizResp)
    resp.end()
  }
}

export default new MainRouter()
