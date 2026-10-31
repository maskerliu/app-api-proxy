import { Request, Response } from 'express'
import { inject, injectable } from 'inversify'
import { API_URL } from '@shared/api.const'
import { IocTypes } from '../MainConst'
import { BizNetwork } from '../misc/utils'
import { CommonService, MockService, ProxyService, PushService } from '../service'
import { BaseRouter, ParamType } from './base.router'

interface ReqResp {
  req: Request
  resp: Response
}

@injectable()
export class AppMockRouter extends BaseRouter {

  @inject(IocTypes.CommonService)
  private commonService: CommonService
  @inject(IocTypes.PushService)
  private pushService: PushService
  @inject(IocTypes.MocksService)
  private mockService: MockService
  @inject(IocTypes.ProxyService)
  private proxyService: ProxyService

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

      const uid = (req.headers['x-mock-uid'] as string) ?? req.params['uid']
      if (uid == null) {
        resp.end()
        return
      }

      const previous = this._clients.get(uid)
      if (previous != null && previous.resp !== resp) {
        try {
          previous.resp.end()
        } catch (err) {
          console.warn(`close previous sse failed: ${uid}`, err)
        }
      }
      this._clients.set(uid, { req, resp })

      const cleanup = () => {
        // 只清理自己这条连接，重连后的新连接不能被旧连接的 close 事件删掉
        if (this._clients.get(uid)?.resp === resp) this._clients.delete(uid)
      }

      req.on('error', (err: any) => {
        console.log(`${new Date()}\terror: ${err}`, err.code)
        cleanup()
      })

      req.on('close', () => {
        console.log(`${new Date()}\treq close: ${uid}\t ${req.closed}`)
        cleanup()
      })
      resp.on('close', cleanup)
      // console.log(`${logDate(new Date())}\t${req.headers['x-mock-uid']} connected\t ${req.closed}`)
    })

    this.router.get('/sse/broadcast/:uid', (req, resp) => {
      this._clients.forEach(it => {
        console.log(`send data from [${req.params['uid']}] to [${it.req.headers['x-mock-uid']}]`)
        try {
          it.resp.write(`event: warning\n`)
          it.resp.write(`id: ${new Date().getTime()}\n`)
          it.resp.write(`data: hello[${Math.random()} from ${req.params['uid']}]\n\n`)
        } catch (err) {
          console.warn(`sse broadcast failed: ${req.params['uid']}`, err)
        }
      })
      resp.send(`${req.headers['uid']} broadcast success`)
      resp.end()
    })

  }

  override initApiInfos(): void {
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: `${API_URL.MockRegister}/:uid`, func: 'register', target: 'commonService',
      params: [{ key: 'uid', type: ParamType.Path }]
    })
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetAllPushClients, func: 'getAllPushClients', target: 'pushService'
    })
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetServerConfig, func: 'getServerConfig', target: 'commonService'
    })
    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.SaveProxyConfig, func: 'saveProxyConfig', target: 'proxyService',
      params: [
        // 目标客户端由查询参数指定，请求头 x-mock-uid 始终是当前界面自身的 uid
        { key: 'uid', type: ParamType.Query },
        { key: 'config', type: ParamType.FormBody }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetProxyConfig, func: 'getProxyConfig', target: 'proxyService',
      params: [{ key: 'uid', type: ParamType.Query }]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.SearchMockRules, func: 'searchMockRules', target: 'mockService',
      params: [
        { key: BizNetwork.BIZ_HEADER_MOCK_UID, type: ParamType.Header },
        { key: 'keyword', type: ParamType.Query }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetMockRuleDetail, func: 'getMockRuleDetail', target: 'mockService',
      params: [
        { key: BizNetwork.BIZ_HEADER_MOCK_UID, type: ParamType.Header },
        { key: 'ruleId', type: ParamType.Query }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetActiveMockRule, func: 'getActiveMockRule', target: 'mockService',
      params: [{ key: BizNetwork.BIZ_HEADER_MOCK_UID, type: ParamType.Header }]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.SaveMockRule, func: 'saveMockRule', target: 'mockService',
      params: [
        { key: BizNetwork.BIZ_HEADER_MOCK_UID, type: ParamType.Header },
        { key: 'onlySnap', type: ParamType.Query },
        { key: 'rule', type: ParamType.FormBody }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.DeleteMockRule, func: 'deleteMockRule', target: 'mockService',
      params: [
        { key: BizNetwork.BIZ_HEADER_MOCK_UID, type: ParamType.Header },
        { key: 'ruleId', type: ParamType.Query }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: '/upload', func: 'upload', target: 'mockService',
      params: [
        { key: BizNetwork.BIZ_HEADER_MOCK_UID, type: ParamType.Header },
        { key: 'file', type: ParamType.FormBody }
      ]
    })

  }
}