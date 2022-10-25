import { Request, Response } from "express"
import { Route } from "lynx-express-mvc"

export default abstract class AbstractRouter {
  
  @Route()
  route(...args: any): boolean { return true }

  abstract error(req: Request, resp: Response, err: any)

  init() { }

}