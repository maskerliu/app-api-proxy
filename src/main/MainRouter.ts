import { Request, Response } from 'express'
import { BizCode, BizResponse } from '../common/models'
import AbstractRouter from './common/AbstractRouter'
import { Router } from './common/decorators/webmvc.decorators'

import './controller/DefaultController'
import './test/test/TestController'

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
