import { Request, Response } from 'express'
import { inject, injectable } from 'inversify'
import { API_URL } from '@shared/api.const'
import { emptyToNull, MOCK_UID_HEADER, pickHeader } from '@shared/http-header'
import {
  toMockPackConflictStrategy, toMockPackFlag, toMockPackImportMode,
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

    // R4 规则导入/导出四个端点：R4C-03 那一批先把它注册成桩、把参数表与响应形状钉死，让渲染层并行开发；
    // 到这里导出组装（R4C-06）、包级/条目级校验与归一化（R4C-10~12）、预览统计（R4C-13/20）、写入与生效（R4C-15~20）、
    // HAR 接线（R4C-35）都已换成真实现，四条里再没有假装「什么文件都收得下」的那一条。
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
        { key: 'mode', type: ParamType.Query },
        { key: 'targetRuleId', type: ParamType.Query }
      ],
      // 三阶段（R4C-10 包级 / R4C-11 条目级 / R4C-12 归一化）+ 统计与冲突（R4C-13）已全部接线，且全程只读：
      // 包级不过整包拒绝，条目级不过只跳那一条，明细与回落说明分页回传。
      // 上限口径（R4C-20）在同一个响应体的 `quota` 里，但只到「把两个数与档位摊出来」为止，
      // 真拦下来仍发生在写库那一步（`recordTooMany`），这里不改判。
      handler: (pack, mode, targetRuleId) => this.mockPackService.preview(pack, {
        mode: toMockPackImportMode(mode),
        targetRuleId: targetRuleId == null || targetRuleId === '' ? null : String(targetRuleId),
      })
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.IMPORT_MOCK_PACK,
      params: [
        { key: 'pack', type: ParamType.FormFileText },
        { key: 'mode', type: ParamType.Query },
        { key: 'targetRuleId', type: ParamType.Query },
        { key: 'conflict', type: ParamType.Query }
      ],
      // 写库已接线（R4C-18）：冲突三策略的落点在 `importMockPack`，时间戳按模式注入（R4C-16）而不是客户端开关。
      // 取消通道已就位（R4C-27，见下面的 `cancelMockPackImport`），进度仍没有通道：`getImportProgress()`
      // 回的是「当前场景第 K/M 批」，多场景包会来回重置，UI 要的是哪种口径属未裁决（详见技术设计 6.5 末段）。
      // 预览那一步现在有「库内已有 + 待写入」的合计口径了（R4C-20 的 `quota`），但判定仍只在写库那一步落地：
      // 这里报 `recordTooMany` 是最后一道闸，绕过 UI 直接打接口一样拦得住。
      handler: (pack, mode, targetRuleId, conflict) => this.mockPackService.import(pack, {
        mode: toMockPackImportMode(mode),
        targetRuleId: emptyToNull(targetRuleId),
        conflict: toMockPackConflictStrategy(conflict),
      })
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.IMPORT_HAR,
      params: [
        { key: 'pack', type: ParamType.FormFileText },
        { key: 'mode', type: ParamType.Query },
        { key: 'targetRuleId', type: ParamType.Query },
        { key: 'conflict', type: ParamType.Query },
        { key: 'includeStatic', type: ParamType.Query },
        { key: 'sceneName', type: ParamType.Query }
      ],
      // HAR 走的是另一种包（顶层没有 format），因此不吃规则包的包级闸门：它吃的是 `mock.har.ts` 的 `readHarText`
      // （R4C-21：选错 kind 时 detail 直接说破对方形状）。映射（R4C-22 字段、R4C-23 正文、R4C-24 上限与静态资源）
      // 之后交出的就是 `MockPackRecord`，从这里开始与规则包同一条链路（R4C-35）：
      // 条目校验、归一化、时间戳、写库、上限复核一件不重写，所以这里也没有 HAR 专属的写入分支。
      // `includeStatic` 默认关（js/css/图片逐条跳过），`sceneName` 是「一文件一场景、名称取文件名」的落点：
      // 文件名只有选文件那一侧知道，`FormFileText` 通道传回来的只是文本。
      // 没有预览那一步：HAR 的统计要在映射之后才有意义，而映射是写库的一半成本，属未裁决（见技术设计 §11）。
      handler: (pack, mode, targetRuleId, conflict, includeStatic, sceneName) => this.mockPackService.importHar(pack, {
        mode: toMockPackImportMode(mode),
        targetRuleId: emptyToNull(targetRuleId),
        conflict: toMockPackConflictStrategy(conflict),
        includeStatic: toMockPackFlag(includeStatic, false),
        sceneName: emptyToNull(sceneName),
      })
    })

    this.addApiInfo({
      method: BizNetwork.Method_Post,
      path: API_URL.CANCEL_MOCK_PACK_IMPORT,
      // 取消落在写库的批与批之间（`MockRepo.importRecords`），已写进去的一条不动、没写的逐条报
      // `packWriteAborted`；这里只负责把信号递给服务层那个单例，不自己判「有没有任务」——判据只有一处。
      // 回布尔而不是抛错：弹窗在等那次上传的回执，没有任务时这一次点击不是失败。
      handler: () => this.mockPackService.cancelImport()
    })

  }
}