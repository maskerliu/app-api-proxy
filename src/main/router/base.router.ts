import express, { Request, Response, Router } from "express"
import formidable, { Files } from 'formidable'
import { BizCode, BizFail, BizResponse } from "../../common/base.models"
import { BizNetwork, fetchFormFile, parseContext, parseJsonBody } from "../misc/utils"


export enum ParamType {
  Header,
  Path,
  Query,
  FormBody
}

export interface ParamInfo {
  key: string
  type: ParamType
}

export interface ApiInfo {
  func: string,
  method: string,
  target: string,
  path: string
  desc?: string
  params?: Array<ParamInfo>
}

export abstract class BaseRouter {

  private _router: Router
  private _apiInfos: Array<ApiInfo> = []
  private _form = formidable()

  constructor() {
    this._router = express.Router()
    this.initApiInfos()

    for (const item of this._apiInfos) {
      this.router[item.method](item.path, (req: Request, resp: Response) => {
        this.route(req, resp, item.func, item.target, item.params, true)
      })
    }
  }

  public get router() { return this._router }

  protected abstract initApiInfos(): void

  protected addApiInfo(apiInfo: ApiInfo): void {
    this._apiInfos.push(apiInfo)
  }

  protected async route(req: Request, resp: Response, func: string, target: any,
    paramInfos?: Array<ParamInfo>, hasContext: boolean = false) {

    let params = [], contentType: string = null, _: any, jsonBody: JSON
    if (paramInfos != null) {

      if (req.method.toLowerCase() == 'post') {
        // console.log('content-type', req.headers['content-type'])
        // let matchs = req.headers['content-type']?.match(/[\da-zA-Z\:\/\-\=]+/g)
        // console.log(matchs)
        // if (req.)
        [contentType, _] = req.headers['content-type']?.match(/[\da-zA-Z\:\/\-\=]+/g)
        if (contentType == BizNetwork.MIME_MULTIPART) {
          let [_, files] = await this._form.parse(req)
          req['files'] = files
        } else if (contentType == BizNetwork.MIME_JSON) {
          jsonBody = parseJsonBody(req)
        }
      }
      let filesBody = req['files'] as Files<string>
      for (const item of paramInfos) {
        if (item.type == ParamType.FormBody) {
          if (contentType == BizNetwork.MIME_MULTIPART) {
            params.push(fetchFormFile(filesBody[item.key][0]))
          } else if (contentType == BizNetwork.MIME_JSON) {
            params.push(jsonBody)
          } else if (contentType == BizNetwork.MIME_FORM) {
            params.push(req.body[item.key])
          } else {
            params.push(req.body)
          }
        } else {
          let value = this.parseParam(req, item.key, item.type)
          params.push(value)
        }
      }
    }

    if (hasContext) { params.push(parseContext(req)) }
    let bizResp: BizResponse<any>
    try {
      let instance = await Reflect.get(this, target)
      let result = await Reflect.apply(Reflect.get(instance, func), instance, params)
      if (result == null) {
        bizResp = { code: BizCode.FAIL, msg: 'biz inner error, no result found' }
      } else {
        bizResp = { code: BizCode.SUCCESS, data: result }
      }
    } catch (err) {
      console.error("error:", err)
      if (err instanceof BizFail) {
        bizResp = { code: err.code, msg: err.msg }
      } else {
        bizResp = { code: BizCode.ERROR, msg: err.toString() }
      }
    } finally {
      resp.json(bizResp)
      resp.end()
    }
  }

  protected parseParam(req: Request, paramName: string, type: ParamType) {
    let value: any
    switch (type) {
      case ParamType.Header:
        value = req.headers[paramName]
        break
      case ParamType.Path:
        value = req.params[paramName]
        break
      case ParamType.Query:
        value = req.query[paramName]
        break
    }
    return value
  }

}