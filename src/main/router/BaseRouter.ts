import express, { Request, Response, Router } from "express"
import formidable from 'formidable'
import { readFileSync } from "fs"
import JSONBig from 'json-bigint'
import { BizCode, BizContext, BizFail, BizResponse, UserDevice, UserNetwork } from "../../common/base.models"

const BIZ_HEADER_TOKEN = 'x-token'
const BIZ_HEADER_UA = 'x-ua'
const BIZ_HEADER_DEVICE = 'x-did'
const BIZ_HEADER_AUTH = 'x-auth'
const BIZ_HEADER_NETWORK = 'x-network'
const BIZ_HEADER_MOCK_HOST = 'x-mock-host'
const BIZ_HEADER_MOCK_UID = 'x-mock-uid'

const MIME_MULTIPART = 'multipart/form-data'
const MIME_JSON = 'application/json'
const MIME_TEXT = 'text/plain'
const MIME_IMAGE = 'image/jpeg'
const MIME_FORM = 'application/x-www-form-urlencoded'

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

  protected abstract initApiInfos(): void

  protected addApiInfo(apiInfo: ApiInfo): void {
    this._apiInfos.push(apiInfo)
  }

  public get router() { return this._router }

  protected async route(req: Request, resp: Response, func: string, target: any,
    paramInfos?: Array<ParamInfo>, hasContext: boolean = false) {

    let params = []
    if (paramInfos != null) {
      for (const item of paramInfos) {
        let value = await this.parseParam(req, item.key, item.type)
        params.push(value)
      }
    }
    if (hasContext) { params.push(this.parseContext(req)) }
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

  private parseContext(req: Request): BizContext {

    let network = req.headers[BIZ_HEADER_NETWORK] as string
    network = network == null ? 'unknown' : network
    let netType = UserNetwork.UNKNOWN
    switch (network.toLowerCase()) {
      case '2g':
        netType = UserNetwork.G2
        break
      case '3g':
        netType = UserNetwork.G3
        break
      case '4g':
        netType = UserNetwork.G4
        break
      case '5g':
        netType = UserNetwork.G5
        break
      case 'wifi':
        netType = UserNetwork.WIFI
        break
      case 'ethernet':
        netType = UserNetwork.Ethernet
      default:
        netType = UserNetwork.UNKNOWN
    }

    let ua = req.headers[BIZ_HEADER_UA] as string
    let scheme: string, appId: string, appVersion: string, deviceInfo: UserDevice, channel: string
    if (ua == null) {
      ua = req.headers['user-agent'] as string
      let regArr = ua.match(/[\(]*[0-9A-Za-z;,_.\s\/]+[\)]*/g)
      scheme = regArr[0].trim()
      const os = regArr[1].trim().substring(1, regArr[1].length - 1).split(';')[0]
      const [brand, _] = regArr[4].trim().split(' ')
      deviceInfo = { os, version: '', brand, model: '' }
    } else {
      let regArr = ua.match(/[0-9A-Za-z\/\.\s:-]+/g)
      scheme = regArr[0]
      let [os, version] = regArr[1].split(' ')
      let [brand, model] = regArr[3].split(':')
      let [appId, appVersion] = regArr[2].split(' ')
      channel = regArr[4]
      deviceInfo = { os, version, brand, model }
    }
    let context: BizContext = {
      scheme,
      token: req.headers[BIZ_HEADER_TOKEN] as string,
      did: req.headers[BIZ_HEADER_DEVICE] as string,
      network: netType,
      deviceInfo,
      appId,
      version: appVersion,
      channel
    }
    return context
  }

  protected async parseParam(req: Request, paramName: string, type: ParamType) {
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
      case ParamType.FormBody:
        value = await this.parseBody(req, paramName)
        break
    }

    return value
  }

  protected async parseBody(req: Request, name: string) {
    let [contentType, charset, _] = req.headers['content-type'].match(/[\da-zA-Z\:\/\-\=]+/g)
    let body: any
    if (contentType == MIME_MULTIPART) {
      try {
        // let _form = formidable({ multiples: true })
        let [_, files] = await this._form.parse(req)
        this._form.once('end', () => { this._form.removeAllListeners() })
        let file = files[name][0]
        switch (file.mimetype) {
          case MIME_JSON:
            let data = readFileSync(file.filepath, 'utf-8')
            body = JSON.parse(data)
            break
          case MIME_TEXT:
            body = readFileSync(file.filepath, 'utf-8')
            break
          case MIME_IMAGE:
            body = file.filepath
            break
        }


        // console.log(name, body)
        // this._form.parse(req).then(([fields, files]) => {
        // })
      } catch (err) {
        console.log(err)
        body = req.body[name] // just as plain text
      }
    } else if (contentType == MIME_JSON) {
      body = JSONBig.parse(req.body)
    } else {
      body = null
    }

    return body
  }

}