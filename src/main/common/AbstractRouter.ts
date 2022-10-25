import { Request, Response } from "express"
import { Route } from "./decorators/webmvc.decorators"

export default abstract class AbstractRouter {



  // public route(req: Request, resp: Response) {
  //   let ctrls: Array<any> = Reflect.has(this, __Controllers) ? Reflect.get(this, __Controllers) : new Array()
  //   for (let i = 0; i < ctrls.length; ++i) {
  //     let controller = ctrls[i]
  //     let routeMap = Reflect.get(controller, __RouteMap) as Map<string, string>
  //     if (routeMap.has(req.path)) {
  //       Reflect.apply(Reflect.get(controller, routeMap.get(req.path)), controller, [req, resp])
  //       break
  //     }
  //   }
  // }

  @Route()
  route(...args: any): boolean { return true }

  abstract error(req: Request, resp: Response, err: any)

  init() { }

}