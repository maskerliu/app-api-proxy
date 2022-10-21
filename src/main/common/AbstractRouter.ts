import { Request, Response } from "express"
import { __Controllers, __RouteMap } from "./decorators/WebMVC.decorators"

export default abstract class AbstractRouter {


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

  abstract error(req: Request, resp: Response, err: any)
  
}