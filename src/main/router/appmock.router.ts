import { Request, Response } from 'express'
import { inject, injectable } from 'inversify'
import { API_URL } from '@shared/api.const'
import { emptyToNull, MOCK_UID_HEADER, pickHeader } from '@shared/http-header'
import {
  MockPackIssue, emptyMockPackImportResult, emptyMockPackPreviewResult,
  toMockPackFlag, toMockPackImportMode,
} from '@shared/mock.pack'
import { ProxyMock } from '@shared/proxy.models'
import { IOC_TYPES } from '../constants'
import { BizNetwork } from '../misc/utils'
import {
  CommonService, DiagnosticService, MockPackService, MockService, ProxyService, PushService,
  SocketProxyService,
} from '../service'
import { BaseRouter, ParamType } from './base.router'

interface ReqResp {
  req: Request
  resp: Response
  connId: string
}

@injectable()
export class AppMockRouter extends BaseRouter {

  @inject(IOC_TYPES.CommonService)
  private commonService: CommonService
  @inject(IOC_TYPES.PushService)
  private pushService: PushService
  @inject(IOC_TYPES.MocksService)
  private mockService: MockService
  @inject(IOC_TYPES.MockPackService)
  private mockPackService: MockPackService
  @inject(IOC_TYPES.ProxyService)
  private proxyService: ProxyService
  @inject(IOC_TYPES.SocketProxyService)
  private socketProxyService: SocketProxyService
  @inject(IOC_TYPES.DiagnosticService)
  private diagnosticService: DiagnosticService

  private _clients: Map<string, ReqResp> = new Map()
  private _heartbeat: ReturnType<typeof setInterval> = null
  // 连接号与事件号只在 SSE 演示通道内自增，用于演示里的 Last-Event-ID 与在线连接标识
  private _connSeq = 0
  private _eventSeq = 0

  private static readonly HEARTBEAT_INTERVAL = 15000
  private static readonly RETRY_INTERVAL = 3000

  constructor() {
    super()

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
      this._clients.set(uid, { req, resp, connId: `sse-${++this._connSeq}` })
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

  // 定向：与 PushService.sendMessage 同构——IM 带 to，只投给这一条连接
  private pushDemoDirect(uid: string): string {
    const msg: ProxyMock.PushMsg<string> = {
      type: ProxyMock.PushMsgType.TXT,
      from: 'appmock',
      to: uid,
      payload: {
        type: ProxyMock.BizType.IM,
        content: `direct message at ${new Date().toISOString()}`
      }
    }
    return this.pushEvent(uid, 'im', msg) ? `pushed to ${uid}` : `no sse client for ${uid}`
  }

  // 广播：与 PushService.broadcastClientInfos 同构——在线连接清单发给每一条连接
  private broadcastDemoClients(from: string): string {
    const clients: ProxyMock.ClientInfo[] = []
    this._clients.forEach((it, uid) => {
      clients.push({
        connId: it.connId,
        uid,
        ip: it.req.socket?.remoteAddress ?? '-',
        port: it.req.socket?.remotePort ?? 0,
        kind: 'viewer'
      })
    })

    const msg: ProxyMock.PushMsg<ProxyMock.ClientInfo[]> = {
      type: ProxyMock.PushMsgType.TXT,
      from,
      payload: { type: ProxyMock.BizType.ClientInfos, content: clients }
    }
    return `broadcast ${clients.length} client(s) to ${this.pushToAll('client_infos', msg)} connection(s)`
  }

  // data 用与 /echo 完全相同的 PushMsg 信封，接收方按同一套 type/payload 解析即可
  private pushEvent(uid: string, event: string, msg: ProxyMock.PushMsg<any>): boolean {
    const client = this._clients.get(uid)
    if (client == null) return false
    if (client.resp.writableEnded || client.resp.destroyed) {
      this._clients.delete(uid)
      return false
    }
    try {
      client.resp.write(`event: ${event}\nid: ${++this._eventSeq}\ndata: ${JSON.stringify(msg)}\n\n`)
      return true
    } catch (err) {
      console.warn(`sse push failed: ${uid}`, err)
      this._clients.delete(uid)
      return false
    }
  }

  private pushToAll(event: string, msg: ProxyMock.PushMsg<any>): number {
    let delivered = 0
    // 写失败的连接在 pushEvent 里删掉；Map 遍历中删除当前键不会跳过后续键
    this._clients.forEach((_, uid) => {
      if (this.pushEvent(uid, event, msg)) delivered++
    })
    this.stopHeartbeatIfIdle()
    return delivered
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
    // SSE 演示通道的两个动作端点；流本身要裸写 resp，留在构造函数里注册
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: `${API_URL.SsePush}/:uid`,
      params: [{ key: 'uid', type: ParamType.Path }],
      handler: (uid) => this.pushDemoDirect(uid)
    })
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: `${API_URL.SseBroadcast}/:uid`,
      params: [{ key: 'uid', type: ParamType.Path }],
      handler: (uid) => this.broadcastDemoClients(uid)
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

    // R4 规则导入/导出的桩端点（R4C-03）：先把参数表与响应形状钉死，渲染层得以并行开发；
    // 导出组装已在 R4C-06 落地，写入与生效在 N3 逐张卡替换实现。
    // 包级校验已在 R4C-10 接线：这两个桩不再假装「什么文件都收得下」，坏包拿到的是错误码而不是一个成功的空结果。
    // 上传通道本身由 test/unit/form-file.test.ts 守住。
    // 导出组装（R4C-06）：回的是包文本，不是包对象。桌面端拿它直接写盘、Web 端包成 Blob，
    // 若在这里回对象，主进程流式拼好的字符串还要再解析 + 序列化一遍，省下的内存等于还回去了。
    this.addApiInfo({
      method: BizNetwork.Method_Get,
      path: API_URL.EXPORT_MOCK_PACK,
      params: [
        { key: 'scope', type: ParamType.Query },
        { key: 'ruleId', type: ParamType.Query },
        { key: 'includeSource', type: ParamType.Query },
        { key: 'redact', type: ParamType.Query },
        { key: 'includeVariants', type: ParamType.Query }
      ],
      handler: (scope, ruleId, includeSource, redact, includeVariants) => this.mockPackService.export({
        scope: scope === 'all' ? 'all' : 'rule',
        ruleId: emptyToNull(ruleId),
        includeSource: toMockPackFlag(includeSource, true),
        redact: toMockPackFlag(redact, true),
        includeVariants: toMockPackFlag(includeVariants, true),
      })
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.PREVIEW_MOCK_PACK,
      params: [
        { key: 'pack', type: ParamType.FormFileText },
        { key: 'mode', type: ParamType.Query }
      ],
      // 两阶段校验已接线（R4C-10 包级 + R4C-11 条目级）：包级不过整包拒绝，条目级不过只跳那一条。
      // 坏包不再被当成「预览成功、0 条」；跳过的明细现在算出来就丢掉——回传是 R4C-13 预览统计的事，
      // 这里不假装已经在报明细。
      handler: (pack) => {
        this.mockPackService.readPack(pack)
        return emptyMockPackPreviewResult()
      }
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.IMPORT_MOCK_PACK,
      params: [
        { key: 'pack', type: ParamType.FormFileText },
        { key: 'mode', type: ParamType.Query },
        { key: 'targetRuleId', type: ParamType.Query }
      ],
      handler: (pack, mode) => {
        this.mockPackService.readPack(pack)
        return emptyMockPackImportResult(toMockPackImportMode(mode))
      }
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.IMPORT_HAR,
      params: [
        { key: 'pack', type: ParamType.FormFileText },
        { key: 'mode', type: ParamType.Query },
        { key: 'targetRuleId', type: ParamType.Query }
      ],
      // HAR 走的是另一种包（顶层没有 format），因此不吃规则包的包级闸门；
      // 「按内容分派两种包」是 R4C-21，entry 上限 harEntryLimit 是 R4C-24。
      handler: (_pack, mode) => ({
        ...emptyMockPackImportResult(toMockPackImportMode(mode)),
        suggestions: [] as MockPackIssue[]
      })
    })

  }
}