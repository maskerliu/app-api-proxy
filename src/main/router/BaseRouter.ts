import express, { Request, Response, Router } from "express"
import JSONBig from 'json-bigint'
import { BizCode, BizContext, BizFail, BizResponse, UserDevice, UserNetwork } from "../../common/base.models"

const BIZ_HEADER_TOKEN = 'x-token'
const BIZ_HEADER_UA = 'x-ua'
const BIZ_HEADER_DEVICE = 'x-did'
const BIZ_HEADER_AUTH = 'x-auth'
const BIZ_HEADER_NETWORK = 'x-network'

export enum ParamType {
  Header,
  Path,
  Query,
  JsonBody,
  FileBody,
}

export interface ApiInfo {
  func: string,
  method: string,
  target: string,
  path: string
  desc?: string
  params?: Array<{ key: string, val: ParamType }>
}

export class BaseRouter {

  private _router: Router

  constructor() {
    this._router = express.Router()
  }

  public get router() { return this._router }

  protected async route(req: Request, resp: Response, func: string, target: any,
    paramInfos?: Array<{ key: string, val: ParamType }>, hasContext: boolean = false) {

    let params = paramInfos?.map(item => this.parseParam(req, item.key, item.val))
    if (params == null) params = []
    if (hasContext) { params.push(this.parseContext(req)) }
    let bizResp: BizResponse<any>
    try {
      let instance = await Reflect.get(this, target)
      let fun = await Reflect.get(instance, func)
      let result = await Reflect.apply(fun, instance, params)
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

    // let ua = 'mapi/1.0(Android 12;com.github.lynxchina.argus 1.0.1;vivo:V2171A;huaiwei)'
    let ua = req.headers[BIZ_HEADER_UA] as string
    let scheme: string, platform: string, appId: string, appVersion: string, deviceInfo: UserDevice, channel: string
    if (ua == null) {
      ua = req.headers['user-agent'] as string
      // Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.118 Electron/33.2.0 Safari/537.36
      // Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
      let regArr = ua.match(/([a-zA-Z]+\/[0-9.]+)\s\(([^)]+)\)\s([a-zA-Z]+\/[0-9.]+)\s\(([^)]+)\)(\s([a-zA-Z]+\/[0-9.]+))/)
      regArr = ua.match(/[\(]*[0-9A-Za-z;,_.\s\/]+[\)]*/g)
      scheme = regArr[0].trim() // Mozilla/5.0 
      const os = regArr[1].trim().substring(1, regArr[1].length - 1).split(';')[0] // (Windows NT 10.0; Win64; x64)
      const [brand, _] = regArr[4].trim().split(' ') // Chrome/131.0.0.0 Safari/537.36
      console.log(scheme, os, platform)
      deviceInfo = {
        os,
        version: '',
        brand,
        model: ''
      }
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
      case ParamType.JsonBody:
        value = this.parseBody(req, paramName)
        break
      case ParamType.FileBody:
        value = req.files[paramName]
        break
    }

    return value
  }

  protected parseBody(req: Request, name: string) {
    let contentType = req.headers['content-type']
    let body: any
    if (contentType.indexOf('multipart/form-data') !== -1) {
      try {
        body = JSONBig.parse(req.body[name]) // try parse as JSON object
      } catch (err) {
        body = req.body[name] // just as plain text
      }
    } else if (contentType.indexOf('application/json') !== -1) {
      body = JSONBig.parse(req.body)
    } else {
      body = null
    }

    return body
  }

}




