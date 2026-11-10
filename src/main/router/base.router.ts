import express, { Request, Response, Router } from "express"
import formidable, { Files } from 'formidable'
import { BizCode, BizFail, BizResponse } from "@shared/base.models"
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
  method: string,
  path: string,
  params?: Array<ParamInfo>
  // 目标服务方法由子类用闭包给出：方法名写错编译期就报错，不再按字符串反射查找
  handler: (...args: Array<any>) => any
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
        this.route(req, resp, item.handler, item.params)
      })
    }
  }

  public get router() { return this._router }

  protected abstract initApiInfos(): void

  protected addApiInfo(apiInfo: ApiInfo): void {
    this._apiInfos.push(apiInfo)
  }

  protected async route(req: Request, resp: Response, handler: (...args: Array<any>) => any,
    paramInfos?: Array<ParamInfo>) {

    let bizResp: BizResponse<any>
    try {
      let params = [], contentType: string = null, _: any, jsonBody: JSON
      if (paramInfos != null) {

        if (req.method.toLowerCase() == 'post') {
          // console.log('content-type', req.headers['content-type'])
          // let matchs = req.headers['content-type']?.match(/[\da-zA-Z\:\/\-\=]+/g)
          // console.log(matchs)
          // if (req.)
          [contentType, _] = req.headers['content-type']?.match(/[\da-zA-Z\:\/\-\=]+/g) ?? []
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

      params.push(parseContext(req))
      let result = await handler(...params)
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
        // Error.toString() 会带 "Error: " 前缀，直接展示给用户时去掉
        bizResp = { code: BizCode.ERROR, msg: err instanceof Error ? err.message : String(err) }
        // Mock 匹配引擎的结构化错误：错误码与冲突记录 ID 供 UI 定位，不改变原有 msg 行为
        const extra = err as any
        if (extra?.name === 'MockError') {
          bizResp.errorCode = extra.code
          if (extra.detail != null) bizResp.detail = extra.detail
          if (extra.existingRecordId != null) bizResp.existingRecordId = extra.existingRecordId
        }
        if (Array.isArray(extra?.issues)) bizResp.issues = extra.issues
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