import { Request, Response } from 'express'
import { inject, injectable } from 'inversify'
import { API_URL } from '@shared/api.const'
import { IocTypes } from '../MainConst'
import { BizNetwork } from '../misc/utils'
import {
  CommonService, DiagnosticService, MockService, ProxyService, PushService, SocketProxyService,
} from '../service'
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
  @inject(IocTypes.SocketProxyService)
  private socketProxyService: SocketProxyService
  @inject(IocTypes.DiagnosticService)
  private diagnosticService: DiagnosticService

  private _clients: Map<string, ReqResp> = new Map()
  private _heartbeat: ReturnType<typeof setInterval> = null

  private static readonly HEARTBEAT_INTERVAL = 15000
  private static readonly RETRY_INTERVAL = 3000

  constructor() {
    super()

    this.router.get('/sse/broadcast/:uid', (req, resp) => {
      const from = req.params['uid']
      const chunk = `event: warning\nid: ${Date.now()}\ndata: hello[${Math.random()} from ${from}]\n\n`

      this._clients.forEach((it, uid) => {
        if (it.resp.writableEnded || it.resp.destroyed) {
          this._clients.delete(uid)
          return
        }
        try {
          it.resp.write(chunk)
        } catch (err) {
          console.warn(`sse broadcast failed: ${uid}`, err)
          this._clients.delete(uid)
        }
      })
      this.stopHeartbeatIfIdle()

      resp.send(`broadcast success from ${from}`)
    })

    this.router.get('/sse/:uid', (req, resp) => {
      const uid = (req.headers['x-mock-uid'] as string) || req.params['uid']
      if (!uid) {
        resp.status(400).end()
        return
      }

      resp.status(200)
      resp.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      resp.setHeader('Cache-Control', 'no-cache, no-transform')
      // HTTP/2 下不能带 Connection/Keep-Alive 这类连接级头，否则会抛 ERR_HTTP2_INVALID_CONNECTION_HEADERS
      // 关闭 nginx 等反向代理的响应缓冲，否则事件会被攒着一起发
      resp.setHeader('X-Accel-Buffering', 'no')
      resp.setHeader('Access-Control-Allow-Origin', '*')
      resp.flushHeaders()

      const previous = this._clients.get(uid)
      if (previous != null && previous.resp !== resp) this.closeClient(previous.resp)
      this._clients.set(uid, { req, resp })
      this.startHeartbeat()

      const cleanup = () => {
        // 只清理自己这条连接，重连后的新连接不能被旧连接的 close 事件删掉
        if (this._clients.get(uid)?.resp !== resp) return
        this._clients.delete(uid)
        this.stopHeartbeatIfIdle()
      }

      req.on('error', () => cleanup())
      req.on('close', cleanup)
      resp.on('close', cleanup)
      resp.on('error', cleanup)

      try {
        // 告知客户端断线后的重连间隔
        resp.write(`retry: ${AppMockRouter.RETRY_INTERVAL}\n\n`)
      } catch (err) {
        console.warn(`sse handshake failed: ${uid}`, err)
        cleanup()
      }
    })

  }

  private closeClient(resp: Response) {
    try {
      if (!resp.writableEnded) resp.end()
    } catch (err) {
      console.warn('close previous sse failed:', err)
    }
  }

  // 心跳注释行，避免空闲连接被浏览器/系统/代理判定超时
  private startHeartbeat() {
    if (this._heartbeat != null) return

    this._heartbeat = setInterval(() => {
      this._clients.forEach((it, uid) => {
        if (it.resp.writableEnded || it.resp.destroyed) {
          this._clients.delete(uid)
          return
        }
        try {
          it.resp.write(': ping\n\n')
        } catch (err) {
          console.warn(`sse heartbeat failed: ${uid}`, err)
          this._clients.delete(uid)
        }
      })
      this.stopHeartbeatIfIdle()
    }, AppMockRouter.HEARTBEAT_INTERVAL)
    this._heartbeat.unref?.()
  }

  private stopHeartbeatIfIdle() {
    if (this._clients.size > 0 || this._heartbeat == null) return
    clearInterval(this._heartbeat)
    this._heartbeat = null
  }

  override initApiInfos(): void {
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: `${API_URL.MockRegister}/:uid`, func: 'registerDevice', target: 'commonService',
      params: [{ key: 'uid', type: ParamType.Path }]
    })
    // 兼容历史二维码地址 .../register?uid=xxx
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.MockRegister, func: 'registerDevice', target: 'commonService',
      params: [{ key: 'uid', type: ParamType.Query }]
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
      method: BizNetwork.Method_Get,
      path: API_URL.Health, func: 'getHealth', target: 'commonService'
    })
    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.Diagnose, func: 'diagnose', target: 'diagnosticService',
      params: [{ key: 'target', type: ParamType.Query }]
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

    // 新窗口/刷新后恢复仍在进行的 WS 连接，5030 徽标与列表共用
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetSocketConnections, func: 'getActiveConnections', target: 'socketProxyService'
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
      method: BizNetwork.Method_Get,
      path: API_URL.GetMockRecords, func: 'getMockRecords', target: 'mockService',
      params: [
        { key: 'ruleId', type: ParamType.Query },
        { key: 'offset', type: ParamType.Query },
        { key: 'limit', type: ParamType.Query }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetMockRecord, func: 'getMockRecord', target: 'mockService',
      params: [{ key: 'recordId', type: ParamType.Query }]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetMockRecordByUrl, func: 'getMockRecordByUrl', target: 'mockService',
      params: [
        { key: 'ruleId', type: ParamType.Query },
        { key: 'url', type: ParamType.Query }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.SaveMockRule, func: 'saveMockRule', target: 'mockService',
      params: [
        { key: BizNetwork.BIZ_HEADER_MOCK_UID, type: ParamType.Header },
        { key: 'rule', type: ParamType.FormBody }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.SaveMockRecord, func: 'saveMockRecord', target: 'mockService',
      params: [
        { key: 'record', type: ParamType.FormBody },
        { key: 'expectedUpdatedAt', type: ParamType.Query }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.DeleteMockRecord, func: 'deleteMockRecord', target: 'mockService',
      params: [
        { key: 'recordId', type: ParamType.Query }
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

    // R1 匹配引擎接口：框架统一返回 HTTP 200，桩以 { code: 'notImplemented' } 表达
    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.MATCH_MOCK_RECORD, func: 'matchMockRecord', target: 'mockService',
      params: [{ key: 'request', type: ParamType.FormBody }]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.ANALYZE_MOCK_MATCH, func: 'analyzeMockMatch', target: 'mockService',
      params: [
        { key: BizNetwork.BIZ_HEADER_MOCK_UID, type: ParamType.Header },
        { key: 'request', type: ParamType.FormBody }
      ]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GET_MOCK_MIGRATION_REPORT, func: 'getMockMigrationReport', target: 'mockService'
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.REVERT_MOCK_MATCH, func: 'revertMockMatch', target: 'mockService',
      params: [{ key: 'request', type: ParamType.FormBody }]
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GET_MOCK_MATCH_WARNINGS, func: 'getMockMatchWarnings', target: 'mockService',
      params: [{ key: 'ruleId', type: ParamType.Query }]
    })

  }
}