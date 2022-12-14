import { Request, Response } from 'express'
import { Router } from 'lynx-express-mvc'
import { BizCode, BizResponse } from '../common/base.models'
import AbstractRouter from './common/AbstractRouter'

import './controller/default.controller'
import './test/test/TestController'
import './controller/iot.controller'
import './controller/fun.controller'

@Router()
export default class MainRouter extends AbstractRouter {

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
