import { format } from 'date-fns'
import { Request, Response } from 'express'
import { inject, injectable } from 'inversify'
import 'reflect-metadata'
import { IocTypes } from '../MainConst'
import { BizNetwork } from '../misc/network.utils'
import { ICommonService, IMockService, IProxyService, IPushService } from '../service'
import { BaseRouter, ParamType } from './base.router'

interface ReqResp {
  req: Request
  resp: Response
}

function logDate(date: Date) {
  return format(date, 'yyyy-MM-dd hh:MM:ss')
}

@injectable()
export class AppMockRouter extends BaseRouter {

  @inject(IocTypes.CommonService)
  private commonService: ICommonService
  @inject(IocTypes.PushService)
  private pushService: IPushService
  @inject(IocTypes.MocksService)
  private mockService: IMockService
  @inject(IocTypes.ProxyService)
  private proxyService: IProxyService

  private _clients: Map<string, ReqResp> = new Map()

  constructor() {
    super()

    this.router.get('/sse/:uid', (req, resp) => {
      resp.setHeader('Content-Type', 'text/event-stream')
      resp.setHeader('Cache-Control', 'no-cache')
      // resp.setHeader('Connection', 'keep-alive')
      // resp.setHeader('Keep-Alive', 'max=10,timeout=15000')
      resp.setHeader('Access-Control-Allow-Origin', '*')
      resp.flushHeaders()

      let uid = req.headers['x-mock-uid'] as string
      if (this._clients.has(uid)) {
        // this._clients.get(uid).resp.end()
        this._clients.delete(uid)
        // console.log(`resp end: ${uid}`)
      } else {
        this._clients.set(uid, { req, resp })
      }

      req.on('error', (err: any) => {
        console.log(`${logDate(new Date())}\terror: ${err}`, err.code)
      })

      req.on('close', () => {
        console.log(`${logDate(new Date())}\treq close: ${uid}\t ${req.closed}`)
        this._clients.delete(uid)
      })
      console.log(`${logDate(new Date())}\t${req.headers['x-mock-uid']} connected\t ${req.closed}`)
    })

    this.router.get('/sse/broadcast/:uid', (req, resp) => {
      this._clients.forEach(it => {
        console.log(`send data from [${req.params['uid']}] to [${it.req.headers['x-mock-uid']}]`)
        it.resp.write(`event: warning\n`)
        it.resp.write(`id: ${new Date().getTime()}\n`)
        it.resp.write(`data: hello[${Math.random()} from ${req.params['uid']}]\n\n`)
      })
      resp.send(`${req.headers['uid']} broadcast success`)
      resp.end()
    })

  }

  override initApiInfos(): void {
    this.addApiInfo({
      method: BizNetwork.Method_Get, path: '/register/:uid', func: 'register', target: 'commonService',
      params: [{ key: 'uid', type: ParamType.Path }]
    })
    this.addApiInfo({
      method: BizNetwork.Method_Get, path: '/getAllPushClients', func: 'getAllPushClients', target: 'pushService'
    })
    this.addApiInfo({
      method: BizNetwork.Method_Get, path: '/getServerConfig', func: 'getServerConfig', target: 'commonService'
    })
    this.addApiInfo({
      method: 'post', path: '/saveProxyConfig', func: 'saveProxyConfig', target: 'proxyService',
      params: [{ key: 'uid', type: ParamType.Query }, { key: 'config', type: ParamType.FormBody }]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get, path: '/searchMockRules', func: 'searchMockRules', target: 'mockService',
      params: [{ key: 'uid', type: ParamType.Query }, { key: 'keyword', type: ParamType.Query }]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get, path: '/getMockRuleDetail', func: 'getMockRuleDetail', target: 'mockService',
      params: [{ key: 'uid', type: ParamType.Query }, { key: 'ruleId', type: ParamType.Query }]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post, path: '/saveMockRule', func: 'saveMockRule', target: 'mockService',
      params: [
        { key: 'uid', type: ParamType.Query },
        { key: 'onlySnap', type: ParamType.Query },
        { key: 'rule', type: ParamType.FormBody }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post, path: '/deleteMockRule', func: 'deleteMockRule', target: 'mockService',
      params: [{ key: 'uid', type: ParamType.Query }, { key: 'ruleId', type: ParamType.Query }]
    })

  }
}