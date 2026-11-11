import { Request, Response } from 'express'
import { inject, injectable } from 'inversify'
import { API_URL } from '@shared/api.const'
import { emptyToNull, MOCK_UID_HEADER, pickHeader } from '@shared/http-header'
import { IOC_TYPES } from '../constants'
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

  @inject(IOC_TYPES.CommonService)
  private commonService: CommonService
  @inject(IOC_TYPES.PushService)
  private pushService: PushService
  @inject(IOC_TYPES.MocksService)
  private mockService: MockService
  @inject(IOC_TYPES.ProxyService)
  private proxyService: ProxyService
  @inject(IOC_TYPES.SocketProxyService)
  private socketProxyService: SocketProxyService
  @inject(IOC_TYPES.DiagnosticService)
  private diagnosticService: DiagnosticService

  private _clients: Map<string, ReqResp> = new Map()
  private _heartbeat: ReturnType<typeof setInterval> = null

  private static readonly HEARTBEAT_INTERVAL = 15000
  private static readonly RETRY_INTERVAL = 3000

  constructor() {
    super()

    this.router.get(`${API_URL.Broadcast}/:uid`, (req, resp) => {
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

    this.router.get(`${API_URL.Sse}/:uid`, (req, resp) => {
      const uid = emptyToNull(pickHeader(req.headers, MOCK_UID_HEADER)) ?? req.params['uid']
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
    // handler 的入参顺序与 params 表一一对应；末尾的 BizContext 只交给真正需要它的方法
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: `${API_URL.MockRegister}/:uid`,
      params: [{ key: 'uid', type: ParamType.Path }],
      handler: (ownerUid) => this.commonService.registerDevice(ownerUid)
    })
    // 兼容历史二维码地址 .../register?uid=xxx
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.MockRegister,
      params: [{ key: 'uid', type: ParamType.Query }],
      handler: (ownerUid) => this.commonService.registerDevice(ownerUid)
    })
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetAllPushClients,
      handler: () => this.pushService.getAllPushClients()
    })
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetServerConfig,
      handler: () => this.commonService.getServerConfig()
    })
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.Health,
      handler: () => this.commonService.getHealth()
    })
    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.Diagnose,
      params: [{ key: 'target', type: ParamType.Query }],
      handler: (target) => this.diagnosticService.diagnose(target)
    })
    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.SaveProxyConfig,
      params: [
        // 目标客户端由查询参数指定，请求头 x-mock-uid 始终是当前界面自身的 uid
        { key: 'uid', type: ParamType.Query },
        { key: 'config', type: ParamType.FormBody }
      ],
      handler: (uid, config) => this.proxyService.saveProxyConfig(uid, config)
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetProxyConfig,
      params: [{ key: 'uid', type: ParamType.Query }],
      handler: (uid) => this.proxyService.getProxyConfig(uid)
    })

    // 新窗口/刷新后恢复仍在进行的 WS 连接，5030 徽标与列表共用
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetSocketConnections,
      handler: () => this.socketProxyService.getActiveConnections()
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.SearchMockRules,
      params: [
        { key: MOCK_UID_HEADER, type: ParamType.Header },
        { key: 'keyword', type: ParamType.Query }
      ],
      handler: (uid, keyword) => this.mockService.searchMockRules(uid, keyword)
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetMockRuleDetail,
      params: [
        { key: MOCK_UID_HEADER, type: ParamType.Header },
        { key: 'ruleId', type: ParamType.Query }
      ],
      handler: (uid, ruleId) => this.mockService.getMockRuleDetail(uid, ruleId)
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetActiveMockRule,
      params: [{ key: MOCK_UID_HEADER, type: ParamType.Header }],
      handler: (uid) => this.mockService.getActiveMockRule(uid)
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetMockRecords,
      params: [
        { key: 'ruleId', type: ParamType.Query },
        { key: 'offset', type: ParamType.Query },
        { key: 'limit', type: ParamType.Query }
      ],
      handler: (ruleId, offset, limit) => this.mockService.getMockRecords(ruleId, offset, limit)
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetMockRecord,
      params: [{ key: 'recordId', type: ParamType.Query }],
      handler: (recordId) => this.mockService.getMockRecord(recordId)
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GetMockRecordByUrl,
      params: [
        { key: 'ruleId', type: ParamType.Query },
        { key: 'url', type: ParamType.Query }
      ],
      handler: (ruleId, url) => this.mockService.getMockRecordByUrl(ruleId, url)
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.SaveMockRule,
      params: [
        { key: MOCK_UID_HEADER, type: ParamType.Header },
        { key: 'rule', type: ParamType.FormBody }
      ],
      handler: (uid, rule) => this.mockService.saveMockRule(uid, rule)
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.SaveMockRecord,
      params: [
        { key: 'record', type: ParamType.FormBody },
        { key: 'expectedUpdatedAt', type: ParamType.Query }
      ],
      handler: (record, expectedUpdatedAt) => this.mockService.saveMockRecord(record, expectedUpdatedAt)
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.DeleteMockRecord,
      params: [
        { key: 'recordId', type: ParamType.Query }
      ],
      handler: (recordId) => this.mockService.deleteMockRecord(recordId)
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.DeleteMockRule,
      params: [
        { key: MOCK_UID_HEADER, type: ParamType.Header },
        { key: 'ruleId', type: ParamType.Query }
      ],
      handler: (uid, ruleId) => this.mockService.deleteMockRule(uid, ruleId)
    })

    // R1 匹配引擎接口：框架统一返回 HTTP 200，桩以 { code: 'notImplemented' } 表达
    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.MATCH_MOCK_RECORD,
      params: [{ key: 'request', type: ParamType.FormBody }],
      handler: (request) => this.mockService.matchMockRecord(request)
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.ANALYZE_MOCK_MATCH,
      params: [
        { key: MOCK_UID_HEADER, type: ParamType.Header },
        { key: 'request', type: ParamType.FormBody }
      ],
      handler: (uid, request) => this.mockService.analyzeMockMatch(uid, request)
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GET_MOCK_MIGRATION_REPORT,
      handler: () => this.mockService.getMockMigrationReport()
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.REVERT_MOCK_MATCH,
      params: [{ key: 'request', type: ParamType.FormBody }],
      handler: (request) => this.mockService.revertMockMatch(request)
    })

    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.GET_MOCK_MATCH_WARNINGS,
      params: [{ key: 'ruleId', type: ParamType.Query }],
      handler: (ruleId) => this.mockService.getMockMatchWarnings(ruleId)
    })

  }
}