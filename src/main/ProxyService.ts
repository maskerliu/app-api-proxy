import axios, { AxiosRequestConfig, AxiosRequestHeaders, Method } from "axios"
import { Request, Response } from "express"
import { IncomingHttpHeaders } from "http"
import zlib from "zlib"
import { BizCode, BizResponse, PorxyType, ProxyRequestRecord, ProxyStatRecord } from "../common/models/DataModels"
import mockService from "./MockService"
import pushService from "./PushService"

const JSONBigInt = require("json-bigint")
let MockKey = null

export type ProxyPref = { server?: string, status: boolean, delay: number }

class ProxyService {
  private static PROXY_DEF_TIMEOUT: number = 1000 * 15 // 15s
  private _sessionId: number

  private proxyPrefs: Map<string, ProxyPref> = new Map()

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

  public setProxyDelay(req: Request, resp: Response) {
    let uid = req.query["uid"] as string
    let delay = Number.parseInt(req.query["delay"] as string)

    this.proxyPrefs.get(uid).delay = delay

    let bizResp: BizResponse<string> = { code: BizCode.SUCCESS, data: "success" }
    resp.json(bizResp)
    resp.end()
  }

  public handleStatRequest(req: any, resp: Response) {
    let data = Buffer.from(req.rawbody)
    zlib.unzip(data, (err: any, buffer: any) => {
      if (!err) {
        let record: ProxyStatRecord = {
          id: ++this._sessionId,
          type: PorxyType.STATISTICS,
          timestamp: new Date().getSeconds(),
          statistics: JSON.parse(buffer.toString()),
        }


        let originHost = req.header("mock-host")
        if (originHost == null) {
          originHost = req.header("host")
        }

        pushService.sendProxyMessage(req.header("mock-uid"), record)
        let headers = Object.assign({}, req.headers)
        delete headers["host"]
        delete headers["mock-host"]
        delete headers["mock-uid"]

        let requestUrl = originHost + req.path
        let options = {
          url: requestUrl,
          method: req.method,
          headers: headers,
          data: data
        }
        axios(options).then((resp: any) => {
          // console.log("stat", requestUrl, resp.status, new Date().getSeconds())
        }).catch((err: any) => {
          // console.error("stat", err)
        })
      } else {
        console.error("stat", err)
      }
    })
    resp.end()
  }

  public async handleRequest(req: Request, resp: Response) {
    let uid = req.header("mock-uid")
    // 清理无效配置
    if (!pushService.pushClients.has(uid)) this.proxyPrefs.delete(uid)

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

    pushService.sendProxyMessage(uid, data)

    let delay = (this.proxyPrefs.has(uid) && this.proxyPrefs.get(uid).delay) ?
      this.proxyPrefs.get(uid).delay : 0

    let isMock = await mockService.mockRequestData(sessionId, req, resp, startTime, delay)
    if (!isMock) this.proxyRequestData(sessionId, req, resp, startTime, delay)
  }

  private async proxyRequestData(
    sessionId: number,
    req: Request,
    proxyResp: Response,
    startTime: number,
    delay: number) {
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
      && this.proxyPrefs.get(uid).server != null) {
      requestUrl = this.proxyPrefs.get(uid).server + req.path
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

    axios(options).then((resp: any) => {
      setTimeout(() => {
        let data: ProxyRequestRecord = {
          id: sessionId,
          type: PorxyType.REQUEST_END,
          statusCode: resp.status,
          responseHeaders: !!resp.headers ? resp.headers : null,
          responseData: !!resp.data ? JSON.stringify(resp.data) : null,
          time: new Date().getTime() - startTime,
          isMock: false,
        }
        pushService.sendProxyMessage(uid, data)
        proxyResp.send(resp.data)
        proxyResp.end()
      }, delay)
    }).catch((err: any) => {
      console.error("axios", err.code)
      let resp = err.response
      let respData = !!resp ? resp.data : err.message
      let data: ProxyRequestRecord = {
        id: sessionId,
        type: PorxyType.REQUEST_END,
        statusCode: -100,
        headers: !!resp && !!resp.headers ? resp.headers : null,
        responseData: !!resp && !!respData ? JSON.stringify(respData) : JSON.stringify(err),
        time: new Date().getTime() - startTime,
        isMock: false,
      }
      pushService.sendProxyMessage(uid, data)
      proxyResp.send(err.message)
      proxyResp.end()
    })
  }
}

export default new ProxyService()