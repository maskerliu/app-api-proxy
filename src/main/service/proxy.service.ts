import axios, { AxiosRequestConfig, AxiosRequestHeaders, Method } from 'axios'
import { Request, Response } from 'express'
import { IncomingHttpHeaders } from 'http'
import { inject, injectable } from 'inversify'
import "reflect-metadata"
import zlib from 'zlib'
import { ProxyMock } from '../../common'
import { IocTypes } from '../MainConst'
import { IMockService } from './mock.service'
import { IPushService } from './push.service'

const JSONBigInt = require('json-bigint')
let MockKey = null

export interface IProxyService {
  getDataProxyServer(uid: string): ProxyMock.ProxyConfig
  setDataProxyServer(uid: string, proxyPref: ProxyMock.ProxyConfig): void
  saveProxyConfig(uid: string, config: ProxyMock.ProxyConfig): void
  handleStatRequest(req: any, resp: Response): Promise<void>
  handleRequest(req: Request, resp: Response): Promise<void>
}

@injectable()
export class ProxyService implements IProxyService {
  private static PROXY_DEF_TIMEOUT: number = 1000 * 15 // 15s
  private _sessionId: number
  private proxyConfigs: Map<string, ProxyMock.ProxyConfig>

  @inject(IocTypes.MocksService)
  private readonly mockService: IMockService

  @inject(IocTypes.PushService)
  private readonly pushService: IPushService

  constructor() {
    this._sessionId = 0
    this.proxyConfigs = new Map()
    // axios.get('https://test-gateway-web.yupaopao.com/openapi/mockKey/getMockKey').then(resp => {
    //   MockKey = resp.data
    //   console.log(MockKey)
    // }).catch(err => { console.error('FetchMockKey', err.cause) })
  }

  public getDataProxyServer(uid: string): ProxyMock.ProxyConfig {
    return this.proxyConfigs.get(uid)
  }

  public setDataProxyServer(uid: string, proxyPref: ProxyMock.ProxyConfig) {
    this.proxyConfigs.set(uid, proxyPref)
  }

  public saveProxyConfig(uid: string, config: ProxyMock.ProxyConfig) {
    if (this.proxyConfigs.has(uid)) {
      let uConfig = this.proxyConfigs.get(uid)
      if (config.delay) uConfig.delay = config.delay
      if (config.dataServer) uConfig.dataServer = config.dataServer
      if (config.status) uConfig.status = config.status
    } else {
      this.proxyConfigs.set(uid, config)
    }
    return 'success'
  }

  public async handleStatRequest(req: any, resp: Response) {
    zlib.unzip(Buffer.from(req.rawbody), async (err: any, buffer: any) => {
      if (!err) {
        let record: ProxyMock.ProxyStatRecord = {
          id: new Date().getTime(),
          type: ProxyMock.PorxyType.STATISTICS,
          timestamp: new Date().getSeconds(),
          statistics: JSON.parse(buffer.toString()),
        }
        this.pushService.sendProxyMessage(req.header('mock-uid'), record)

        let originHost = req.header('mock-host') != null ? req.header('mock-host') : req.header('host')
        let headers = Object.assign({}, req.headers)
        delete headers['host']
        delete headers['mock-host']
        delete headers['mock-uid']

        let options = {
          url: originHost + req.path,
          method: req.method,
          headers: headers,
          data: req.rawbody
        }
        await axios(options)
      } else {
        console.error('stat', err)
      }
    })
    resp.end()
  }

  public async handleRequest(req: Request, resp: Response) {
    let uid = req.header('mock-uid')
    // 清理无效配置
    if (!this.pushService.hasProxy(uid)) this.proxyConfigs.delete(uid)

    let startTime = new Date().getTime()
    let sessionId = startTime

    let requestData = null
    if (req.method === 'GET') {
      requestData = !!req.query ? req.query : null
    } else {
      try {
        requestData = !!req.body && Object.keys(req.body).length > 0 ? JSONBigInt.parse(req.body) : null
      } catch (err) {
        console.error('handleRequest', err)
      }
    }
    let data: ProxyMock.ProxyRequestRecord = {
      id: sessionId,
      type: ProxyMock.PorxyType.REQUEST_START,
      url: req.url,
      method: req.method,
      headers: req.headers,
      requestData: requestData,
      timestamp: new Date().getSeconds(),
    }

    this.pushService.sendProxyMessage(uid, data)

    let delay = this.proxyConfigs.has(uid) ? this.proxyConfigs.get(uid).delay : 0

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
    let uid = req.header('mock-uid')
    let originHost = req.header('mock-host') ? req.header('mock-host') : req.header('host')
    let headers = Object.assign({}, req.headers)

    headers['Mock-Key'] = MockKey
    delete headers['host']
    delete headers['mock-host']
    delete headers['mock-uid']

    let axiosHeaders = {} as AxiosRequestHeaders
    let keys: keyof IncomingHttpHeaders
    for (keys in headers) {
      axiosHeaders[keys] = String(headers[keys])
    }

    let requestUrl = originHost + req.path
    if (this.proxyConfigs.has(uid)
      && this.proxyConfigs.get(uid).status
      && this.proxyConfigs.get(uid).dataServer != null) {
      requestUrl = this.proxyConfigs.get(uid).dataServer + req.path
    }

    let options: AxiosRequestConfig = {
      url: requestUrl,
      method: req.method as Method,
      headers: axiosHeaders,
      transformResponse: [
        (data: any) => {
          return JSONBigInt.parse(data)
        },
      ],
      timeout: ProxyService.PROXY_DEF_TIMEOUT,
    }

    if (JSON.stringify(req.query) !== '{}') {
      options['params'] = req.query
    }
    if (JSON.stringify(req.body) !== '{}') {
      options['data'] = req.body
    }

    let data: ProxyMock.ProxyRequestRecord
    try {
      let resp = await axios(options)
      data = {
        id: sessionId,
        type: ProxyMock.PorxyType.REQUEST_END,
        statusCode: resp.status,
        responseHeaders: !!resp.headers ? resp.headers : null,
        responseData: !!resp.data ? JSON.stringify(resp.data) : null,
        time: new Date().getTime() - startTime,
        isMock: false,
      }
      return resp.data
    } catch (err: any) {
      // console.error('axios', err.code)
      let resp = err.response
      let respData = !!resp ? resp.data : err.message
      data = {
        id: sessionId,
        type: ProxyMock.PorxyType.REQUEST_END,
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