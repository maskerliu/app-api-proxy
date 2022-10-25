import axios, { AxiosRequestConfig, AxiosRequestHeaders, Method } from "axios"
import { Request, Response } from "express"
import { IncomingHttpHeaders } from "http"
import zlib from "zlib"
import { BizCode, BizResponse, PorxyType, ProxyRequestRecord, ProxyStatRecord } from "../../common/models"
import { Autowired } from "../common/decorators/ioc.decorators"
import { Service } from "../common/decorators/webmvc.decorators"
import MockService from "./MockService"
import PushService from "./PushService"

const JSONBigInt = require("json-bigint")
let MockKey = null


export type ProxyPref = {
  dataServer?: string, // 数据代理服务器，可以指向开发自己的
  status: boolean,
  delay: number
}

@Service()
export default class ProxyService {
  private static PROXY_DEF_TIMEOUT: number = 1000 * 15 // 15s
  private _sessionId: number
  private proxyPrefs: Map<string, ProxyPref> = new Map()

  @Autowired()
  mockService: MockService

  @Autowired()
  pushService: PushService

  constructor() {
    this._sessionId = 0

    axios.get('https://test-gateway-web.yupaopao.com/openapi/mockKey/getMockKey').then(resp => {
      MockKey = resp.data
    }).catch(err => { console.error('FetchMockKey', err.cause) })
  }

  public getDataProxyServer(uid: string): ProxyPref {
    return this.proxyPrefs.get(uid)
  }

  public setDataProxyServer(uid: string, proxyPref: ProxyPref) {
    this.proxyPrefs.set(uid, proxyPref)
  }


  public setProxyDelay(uid: string, delay?: number) {
    this.proxyPrefs.get(uid).delay = delay
    let bizResp: BizResponse<string> = { code: BizCode.SUCCESS, data: "success" }
    return bizResp
  }

  public async handleStatRequest(req: any, resp: Response) {
    let data = Buffer.from(req.rawbody)
    zlib.unzip(data, async (err: any, buffer: any) => {
      if (!err) {
        let record: ProxyStatRecord = {
          id: ++this._sessionId,
          type: PorxyType.STATISTICS,
          timestamp: new Date().getSeconds(),
          statistics: JSON.parse(buffer.toString()),
        }
        this.pushService.sendProxyMessage(req.header("mock-uid"), record)

        let originHost = req.header("mock-host") != null ? req.header("mock-host") : req.header("host")
        let headers = Object.assign({}, req.headers)
        delete headers["host"]
        delete headers["mock-host"]
        delete headers["mock-uid"]

        let options = {
          url: originHost + req.path,
          method: req.method,
          headers: headers,
          data: data
        }
        await axios(options)
      } else {
        console.error("stat", err)
      }
    })
    resp.end()
  }

  public async handleRequest(req: Request, resp: Response) {
    let uid = req.header("mock-uid")
    // 清理无效配置
    if (!this.pushService.pushClients.has(uid)) this.proxyPrefs.delete(uid)

    let startTime = new Date().getTime()
    let sessionId = ++this._sessionId

    let requestData = null
    if (req.method === "GET") {
      requestData = !!req.query ? req.query : null
    } else {
      try {
        requestData = !!req.body && Object.keys(req.body).length > 0 ? JSONBigInt.parse(req.body) : null
      } catch (err) {
        console.error("handleRequest", err)
      }
    }
    let data: ProxyRequestRecord = {
      id: sessionId,
      type: PorxyType.REQUEST_START,
      url: req.url,
      method: req.method,
      headers: req.headers,
      requestData: requestData,
      timestamp: new Date().getSeconds(),
    }

    this.pushService.sendProxyMessage(uid, data)

    let delay = (this.proxyPrefs.has(uid) && this.proxyPrefs.get(uid).delay) ?
      this.proxyPrefs.get(uid).delay : 0

    let bizResp = null
    try {
      bizResp = await this.mockService.mock(sessionId, req.header['mock-uid'], req.url, startTime, delay)
    } catch (err) {
      bizResp = await this.proxy(sessionId, req, startTime, delay)
    } finally {
      setTimeout(() => {
        resp.send(bizResp)
        resp.end()
      }, delay)
    }
  }

  private async proxy(sessionId: number, req: Request, startTime: number, delay: number) {
    let uid = req.header("mock-uid")
    let originHost = req.header("mock-host") ? req.header("mock-host") : req.header("host")
    let headers = Object.assign({}, req.headers)

    headers["Mock-Key"] = MockKey
    delete headers["host"]
    delete headers["mock-host"]
    delete headers["mock-uid"]

    let axiosHeaders = {} as AxiosRequestHeaders
    let keys: keyof IncomingHttpHeaders
    for (keys in headers) {
      axiosHeaders[keys] = String(headers[keys])
    }

    let requestUrl = originHost + req.path
    if (this.proxyPrefs.has(uid)
      && this.proxyPrefs.get(uid).status
      && this.proxyPrefs.get(uid).dataServer != null) {
      requestUrl = this.proxyPrefs.get(uid).dataServer + req.path
    }

    let options: AxiosRequestConfig = {
      url: requestUrl,
      method: req.method as Method,
      headers: axiosHeaders,
      transformResponse: [
        (data: any) => {
          try {
            return JSONBigInt.parse(data)
          } catch (err) {
            console.error("proxyRequestData", err)
            console.error(data)
            return null
          }
        },
      ],
      timeout: ProxyService.PROXY_DEF_TIMEOUT,
    }

    if (JSON.stringify(req.query) !== "{}") {
      options["params"] = req.query
    }
    if (JSON.stringify(req.body) !== "{}") {
      options["data"] = req.body
    }

    let data: ProxyRequestRecord
    try {
      let resp: any = await axios(options)
      data = {
        id: sessionId,
        type: PorxyType.REQUEST_END,
        statusCode: resp.status,
        responseHeaders: !!resp.headers ? resp.headers : null,
        responseData: !!resp.data ? JSON.stringify(resp.data) : null,
        time: new Date().getTime() - startTime,
        isMock: false,
      }
      return resp.data
    } catch (err: any) {
      console.error("axios", err.code)
      let resp = err.response
      let respData = !!resp ? resp.data : err.message
      data = {
        id: sessionId,
        type: PorxyType.REQUEST_END,
        statusCode: -100,
        headers: !!resp && !!resp.headers ? resp.headers : null,
        responseData: !!resp && !!respData ? JSON.stringify(respData) : JSON.stringify(err),
        time: new Date().getTime() - startTime,
        isMock: false,
      }
    } finally {
      setTimeout(() => {
        this.pushService.sendProxyMessage(uid, data)
      }, delay)
    }
  }
}