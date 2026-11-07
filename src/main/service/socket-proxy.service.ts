import http from 'http'
import type { IncomingMessage } from 'http'
import { Duplex } from 'stream'
import { inject, injectable } from 'inversify'
import { RawData, WebSocket, WebSocketServer } from 'ws'
import { ProxyMock } from '@shared/proxy.models'
import { IocTypes } from '../MainConst'
import { DiagnosticService } from './diagnostic.service'
import { ProxyService } from './proxy.service'
import { PushService } from './push.service'
import {
  buildUpstreamHeaders, encodeFramePayload, headerValue, isProxyPath, isSendableCloseCode,
  mapUpstreamError, MOCK_HOST_HEADER, MOCK_UID_HEADER, mockQueryValue, parseProxyRequest,
  resolveTargetUrl, sanitizeHeaders, truncateReason, type ParsedProxyRequest, type ResolvedTarget,
} from './socket-proxy.contract'

const MAX_CONNECTIONS = 128
const MAX_STORED_FRAMES = 1000
const MAX_PENDING_FRAMES = 1000
const MAX_PENDING_BYTES = 4 * 1024 * 1024
const BATCH_INTERVAL = 100
const BATCH_FRAMES = 50
const BATCH_BYTES = 256 * 1024
const MAX_MESSAGE = 50 * 1024 * 1024
const MAX_BUFFERED = 8 * 1024 * 1024
const MAX_ERROR_BODY = 4096
const HANDSHAKE_TIMEOUT = 15000
// HTTP 代理的会话 ID 从 1 开始、打点记录使用时间戳，WS 用独立区间避免列表键冲突
const WS_ID_BASE = 1_000_000_000

interface SocketContext {
  id: number
  uid?: string
  url: string
  host: string
  startedAt: number
  socket: Duplex
  head: Buffer
  req: IncomingMessage
  upstream: WebSocket
  client?: WebSocket
  requestHeaders: Record<string, string | string[]>
  responseHeaders?: Record<string, string | string[]>
  subprotocol?: string
  opened: boolean
  ready: boolean
  closing: boolean
  closed: boolean
  timer?: NodeJS.Timeout
  frames: ProxyMock.SocketFrame[]
  pendingBytes: number
  deliveredFrames: number
  frameSeq: number
  frameCount: number
  droppedFrames: number
  bytesSent: number
  bytesReceived: number
  upstreamQueue: { data: Buffer, isBinary: boolean }[]
  upstreamQueueBytes: number
  errorCode?: string
  errorMessage?: string
  onSocketGone?: () => void
}

@injectable()
export class SocketProxyService {
  private connections: Map<number, SocketContext>
  private sessionId: number
  private server: any
  private upgradeListener: any
  private readonly wss: WebSocketServer

  @inject(IocTypes.PushService)
  private pushService: PushService

  @inject(IocTypes.DiagnosticService)
  private diagnosticService: DiagnosticService

  @inject(IocTypes.ProxyService)
  private proxyService: ProxyService

  constructor() {
    this.connections = new Map()
    this.sessionId = WS_ID_BASE
    this.wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: MAX_MESSAGE,
      // handleUpgrade 前把上游实际选择的子协议挂到 req 上
      handleProtocols: (_protocols, req: any) => req.__wsProtocol ?? false,
    })
  }

  public bindServer(server: any) {
    this.unbindServer()
    this.server = server
    this.upgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      this.onUpgrade(req, socket, head)
    }
    server.on('upgrade', this.upgradeListener)
  }

  public closeAll(code: number = 1001, reason: string = 'proxy closed') {
    const contexts = [...this.connections.values()]
    for (const ctx of contexts) {
      if (ctx.closed) continue
      ctx.closing = true
      try {
        if (ctx.client != null) ctx.client.close(code, reason)
        else if (!ctx.socket.destroyed) ctx.socket.destroy()
      } catch (err) {
        // ignore
      }
      try {
        ctx.upstream.terminate()
      } catch (err) {
        // ignore
      }
      this.finish(ctx, 'proxy', code, reason)
    }
    this.connections.clear()
  }

  // viewer/device 离线后不再为该 uid 累积待推送帧，但不断开业务长连接
  public clearClientState(uid: string) {
    for (const ctx of this.connections.values()) {
      if (ctx.uid !== uid) continue
      ctx.frames = []
      ctx.pendingBytes = 0
      if (ctx.timer != null) {
        clearTimeout(ctx.timer)
        ctx.timer = null
      }
    }
  }

  public getActiveConnections(): ProxyMock.SocketRecord[] {
    const result: ProxyMock.SocketRecord[] = []
    for (const ctx of this.connections.values()) {
      if (!ctx.ready || ctx.closed) continue
      result.push({
        id: ctx.id,
        wsId: ctx.id,
        type: ProxyMock.PorxyType.SOCKET,
        wsPhase: 'open',
        method: 'WS',
        url: ctx.url,
        timestamp: ctx.startedAt,
        statusCode: 101,
        subprotocol: ctx.subprotocol,
        requestHeaders: ctx.requestHeaders,
        responseHeaders: ctx.responseHeaders,
        bytesSent: ctx.bytesSent,
        bytesReceived: ctx.bytesReceived,
        frameCount: ctx.frameCount,
        droppedFrames: ctx.droppedFrames,
      })
    }
    return result
  }

  private unbindServer() {
    if (this.server == null || this.upgradeListener == null) return
    try {
      this.server.removeListener('upgrade', this.upgradeListener)
    } catch (err) {
      // ignore
    }
    this.server = null
    this.upgradeListener = null
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const rawUrl = req.url ?? ''
    if (!isProxyPath(rawUrl)) return

    socket.on('error', () => { /* 由业务侧统一关闭，避免未捕获错误 */ })

    if (String(req.headers['upgrade'] ?? '').toLowerCase() !== 'websocket') {
      this.rejectHandshake(req, socket, 426, ProxyMock.SocketErrorCode.UNSUPPORTED_VERSION,
        'WebSocket upgrade required')
      return
    }
    if (req.method !== 'GET') {
      this.rejectHandshake(req, socket, 405, ProxyMock.SocketErrorCode.UNSUPPORTED_VERSION,
        'Method Not Allowed')
      return
    }
    if (this.connections.size >= MAX_CONNECTIONS) {
      this.rejectHandshake(req, socket, 503, ProxyMock.SocketErrorCode.TOO_MANY_CONNECTIONS,
        `too many websocket connections (${MAX_CONNECTIONS})`)
      return
    }

    void this.handleUpgrade(req, socket, head ?? Buffer.alloc(0))
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const parsed = parseProxyRequest(req)
    const uid = parsed.uid
    const startedAt = Date.now()
    const id = ++this.sessionId

    let target: ResolvedTarget
    try {
      target = this.resolveTarget(parsed)
    } catch (err: any) {
      const code = err?.wsCode ?? ProxyMock.SocketErrorCode.MISSING_TARGET
      const status = err?.status ?? 400
      this.failConnection({
        id, uid, startedAt, url: req.url ?? '', host: '',
        status, code, message: err?.message ?? 'invalid websocket target',
        requestHeaders: sanitizeHeaders(req.headers),
      })
      this.writeHttpFailure(socket, status, err?.message ?? 'invalid websocket target', code)
      return
    }

    this.diagnosticService.recordRequest({
      sessionId: id,
      at: startedAt,
      uid: uid ?? '',
      method: 'WS',
      url: req.url ?? '',
      host: target.host,
      uidKnown: uid != null && this.pushService.hasClient(uid),
    })

    const headers = buildUpstreamHeaders(req)
    const upstream = new WebSocket(target.url, parsed.protocols, {
      headers,
      perMessageDeflate: false,
      handshakeTimeout: HANDSHAKE_TIMEOUT,
      maxPayload: MAX_MESSAGE,
      followRedirects: false,
      rejectUnauthorized: true,
    })

    const ctx: SocketContext = {
      id,
      uid,
      url: target.url,
      host: target.host,
      startedAt,
      socket,
      head,
      req,
      upstream,
      requestHeaders: sanitizeHeaders(req.headers),
      opened: false,
      ready: false,
      closing: false,
      closed: false,
      frames: [],
      pendingBytes: 0,
      deliveredFrames: 0,
      frameSeq: 0,
      frameCount: 0,
      droppedFrames: 0,
      bytesSent: 0,
      bytesReceived: 0,
      upstreamQueue: [],
      upstreamQueueBytes: 0,
    }
    this.connections.set(id, ctx)

    // 客户端在等待上游握手时断开，直接放弃这次连接
    const onSocketGone = () => {
      if (ctx.ready || ctx.closed) return
      ctx.closed = true
      ctx.closing = true
      this.connections.delete(ctx.id)
      try {
        upstream.terminate()
      } catch (err) {
        // ignore
      }
    }
    ctx.onSocketGone = onSocketGone
    socket.once('close', onSocketGone)
    socket.once('error', onSocketGone)

    upstream.on('upgrade', (response: IncomingMessage) => {
      ctx.responseHeaders = sanitizeHeaders(response.headers)
    })

    upstream.on('open', () => {
      void this.onUpstreamOpen(ctx, target.delay)
    })

    upstream.on('unexpected-response', (_request: http.ClientRequest, response: IncomingMessage) => {
      this.onUpstreamRejected(ctx, response)
    })

    upstream.on('message', (data: RawData, isBinary: boolean) => {
      if (ctx.closed) return
      const buffer = rawToBuffer(data)
      if (!ctx.ready) {
        // 上游握手成功到客户端 101 完成之间可能有欢迎帧，先缓存避免丢失
        if (ctx.upstreamQueue.length >= MAX_PENDING_FRAMES
          || ctx.upstreamQueueBytes + buffer.length > MAX_PENDING_BYTES) {
          this.abortUpstreamBeforeBridge(ctx, 'too many frames before client handshake')
          return
        }
        ctx.upstreamQueue.push({ data: buffer, isBinary })
        ctx.upstreamQueueBytes += buffer.length
        return
      }
      this.relayToClient(ctx, buffer, isBinary)
    })

    upstream.on('ping', (data: Buffer) => {
      if (!ctx.ready) return
      this.recordFrame(ctx, 's2c', 'ping', data)
    })

    upstream.on('pong', (data: Buffer) => {
      if (!ctx.ready) return
      this.recordFrame(ctx, 's2c', 'pong', data)
    })

    upstream.on('close', (code: number, reason: Buffer) => {
      this.onUpstreamClose(ctx, code, reason)
    })

    upstream.on('error', (err: Error) => {
      this.onUpstreamError(ctx, err)
    })
  }

  private async onUpstreamOpen(ctx: SocketContext, delay: number) {
    if (ctx.closed) return
    ctx.opened = true

    const protocol = ctx.upstream.protocol || ''
    if (protocol !== '' && !ctx.req.headers['sec-websocket-protocol']?.toString()
      .split(',').map(it => it.trim()).includes(protocol)) {
      this.failActiveHandshake(ctx, 502, ProxyMock.SocketErrorCode.SUBPROTOCOL_MISMATCH,
        `upstream selected unsupported subprotocol: ${protocol}`)
      return
    }

    if (delay > 0) {
      await sleep(delay)
      if (ctx.closed) return
    }

    ctx.subprotocol = protocol
    ;(ctx.req as any).__wsProtocol = protocol || false

    try {
      this.wss.handleUpgrade(ctx.req, ctx.socket as any, ctx.head, (client: WebSocket) => {
        if (ctx.closed) {
          try {
            client.terminate()
          } catch (err) {
            // ignore
          }
          return
        }
        ctx.client = client
        this.bridge(ctx)
      })
    } catch (err: any) {
      this.failActiveHandshake(ctx, 502, ProxyMock.SocketErrorCode.INTERNAL_ERROR,
        `client handshake failed: ${err?.message ?? err}`)
    }
  }

  private bridge(ctx: SocketContext) {
    const client = ctx.client
    const upstream = ctx.upstream
    ctx.ready = true

    if (ctx.onSocketGone != null) {
      ctx.socket.removeListener('close', ctx.onSocketGone)
      ctx.socket.removeListener('error', ctx.onSocketGone)
      ctx.onSocketGone = null
    }

    this.sendOpen(ctx)

    // 连接建立前的上游消息按原顺序补发并记录
    const queued = ctx.upstreamQueue
    ctx.upstreamQueue = []
    ctx.upstreamQueueBytes = 0
    for (const item of queued) this.relayToClient(ctx, item.data, item.isBinary)

    client.on('message', (data: RawData, isBinary: boolean) => {
      if (ctx.closed) return
      const buffer = rawToBuffer(data)
      this.recordFrame(ctx, 'c2s', isBinary ? 'binary' : 'text', buffer)
      ctx.bytesSent += buffer.length
      try {
        upstream.send(buffer, { binary: isBinary })
      } catch (err: any) {
        this.failActiveConnection(ctx, ProxyMock.SocketErrorCode.INTERNAL_ERROR,
          `send to upstream failed: ${err?.message ?? err}`)
        return
      }
      if (upstream.bufferedAmount > MAX_BUFFERED) {
        this.closeForBackpressure(ctx, 'upstream')
      }
    })

    client.on('ping', (data: Buffer) => {
      if (!ctx.closed) this.recordFrame(ctx, 'c2s', 'ping', data)
    })

    client.on('pong', (data: Buffer) => {
      if (!ctx.closed) this.recordFrame(ctx, 'c2s', 'pong', data)
    })

    client.on('close', (code: number, reason: Buffer) => {
      this.onEndpointClose(ctx, 'client', code, reason)
    })

    client.on('error', (err: Error) => {
      this.failActiveConnection(ctx, ProxyMock.SocketErrorCode.INTERNAL_ERROR,
        `client error: ${err.message}`)
    })
  }

  private relayToClient(ctx: SocketContext, buffer: Buffer, isBinary: boolean) {
    this.recordFrame(ctx, 's2c', isBinary ? 'binary' : 'text', buffer)
    ctx.bytesReceived += buffer.length
    const client = ctx.client
    if (client == null || client.readyState !== WebSocket.OPEN) return
    try {
      client.send(buffer, { binary: isBinary })
    } catch (err: any) {
      this.failActiveConnection(ctx, ProxyMock.SocketErrorCode.INTERNAL_ERROR,
        `send to client failed: ${err?.message ?? err}`)
      return
    }
    if (client.bufferedAmount > MAX_BUFFERED) {
      this.closeForBackpressure(ctx, 'client')
    }
  }

  private onUpstreamRejected(ctx: SocketContext, response: IncomingMessage) {
    if (ctx.closed) return
    ctx.closed = true
    this.connections.delete(ctx.id)
    this.clearPending(ctx)

    const status = response.statusCode ?? 502
    const chunks: Buffer[] = []
    let collected = 0
    let settled = false
    const timer = setTimeout(() => finish(), 5000)
    timer.unref?.()

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const message = `upstream rejected handshake: ${status}`
      this.failConnection({
        id: ctx.id, uid: ctx.uid, startedAt: ctx.startedAt, url: ctx.url, host: ctx.host,
        status, code: ProxyMock.SocketErrorCode.UPSTREAM_REJECTED, message,
        requestHeaders: ctx.requestHeaders, responseHeaders: ctx.responseHeaders,
      })
      this.writeHttpFailure(ctx.socket, status, message,
        ProxyMock.SocketErrorCode.UPSTREAM_REJECTED, Buffer.concat(chunks as unknown as Uint8Array[]))
      try {
        ctx.upstream.terminate()
      } catch (err) {
        // ignore
      }
    }

    response.on('data', (chunk: Buffer) => {
      if (collected >= MAX_ERROR_BODY) return
      const keep = Math.min(chunk.length, MAX_ERROR_BODY - collected)
      chunks.push(chunk.subarray(0, keep))
      collected += keep
    })
    response.on('end', finish)
    response.on('error', finish)
  }

  private onUpstreamClose(ctx: SocketContext, code: number, reason: Buffer) {
    if (ctx.closed) return
    if (!ctx.ready) {
      this.abortUpstreamBeforeBridge(ctx, `upstream closed before handshake (${code})`)
      return
    }
    this.onEndpointClose(ctx, 'upstream', code, reason)
  }

  private onUpstreamError(ctx: SocketContext, err: Error) {
    if (ctx.closed) return
    const mapped = mapUpstreamError(err)
    if (!ctx.ready) {
      this.failActiveHandshake(ctx, mapped.status, mapped.code, err.message)
      return
    }
    this.failActiveConnection(ctx, mapped.code, err.message)
  }

  private onEndpointClose(ctx: SocketContext, by: ProxyMock.SocketCloseBy,
    code: number, reason: Buffer) {
    if (ctx.closed) return
    ctx.closing = true
    const text = Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason ?? '')
    const peer = by === 'client' ? ctx.upstream : ctx.client

    if (peer != null && peer.readyState !== WebSocket.CLOSED) {
      try {
        if (!isSendableCloseCode(code)) peer.terminate()
        else if (peer.readyState === WebSocket.OPEN) peer.close(code, truncateReason(text))
        else peer.terminate()
      } catch (err) {
        // ignore
      }
    }

    this.finish(ctx, by, code, text)
  }

  private abortUpstreamBeforeBridge(ctx: SocketContext, message: string) {
    if (ctx.closed) return
    ctx.closed = true
    this.connections.delete(ctx.id)
    this.clearPending(ctx)
    this.failConnection({
      id: ctx.id, uid: ctx.uid, startedAt: ctx.startedAt, url: ctx.url, host: ctx.host,
      status: 502, code: ProxyMock.SocketErrorCode.CONNECT_FAILED, message,
      requestHeaders: ctx.requestHeaders, responseHeaders: ctx.responseHeaders,
    })
    this.writeHttpFailure(ctx.socket, 502, message, ProxyMock.SocketErrorCode.CONNECT_FAILED)
    try {
      ctx.upstream.terminate()
    } catch (err) {
      // ignore
    }
  }

  private failActiveHandshake(ctx: SocketContext, status: number, code: string, message: string) {
    if (ctx.closed) return
    ctx.closed = true
    ctx.closing = true
    this.connections.delete(ctx.id)
    this.clearPending(ctx)
    this.failConnection({
      id: ctx.id, uid: ctx.uid, startedAt: ctx.startedAt, url: ctx.url, host: ctx.host,
      status, code, message,
      requestHeaders: ctx.requestHeaders, responseHeaders: ctx.responseHeaders,
    })
    this.writeHttpFailure(ctx.socket, status, message, code)
    try {
      ctx.upstream.terminate()
    } catch (err) {
      // ignore
    }
  }

  private failActiveConnection(ctx: SocketContext, code: string, message: string) {
    if (ctx.closed) return
    ctx.errorCode = code
    ctx.errorMessage = message
    this.diagnosticService.recordError({
      uid: ctx.uid ?? '', url: ctx.url, host: ctx.host, error: `[${code}] ${message}`,
    })
    try {
      ctx.client?.terminate()
    } catch (err) {
      // ignore
    }
    try {
      ctx.upstream.terminate()
    } catch (err) {
      // ignore
    }
    this.finish(ctx, 'proxy', 1011, message, code, message)
  }

  private closeForBackpressure(ctx: SocketContext, side: 'client' | 'upstream') {
    if (ctx.closed) return
    const message = `backpressure exceeded ${MAX_BUFFERED} bytes on ${side}`
    ctx.errorCode = ProxyMock.SocketErrorCode.INTERNAL_ERROR
    ctx.errorMessage = message
    this.diagnosticService.recordError({
      uid: ctx.uid ?? '', url: ctx.url, host: ctx.host, error: `[WS-E12] ${message}`,
    })
    try {
      ctx.client?.close(1013, 'backpressure')
    } catch (err) {
      // ignore
    }
    try {
      ctx.upstream.terminate()
    } catch (err) {
      // ignore
    }
    this.finish(ctx, 'proxy', 1013, 'backpressure', ProxyMock.SocketErrorCode.INTERNAL_ERROR, message)
  }

  private finish(ctx: SocketContext, by: ProxyMock.SocketCloseBy, code: number,
    reason: string, errorCode?: string, errorMessage?: string) {
    if (ctx.closed) return
    ctx.closed = true
    this.flushFrames(ctx)
    this.connections.delete(ctx.id)

    const record: ProxyMock.SocketRecord = {
      id: ctx.id,
      wsId: ctx.id,
      type: ProxyMock.PorxyType.SOCKET,
      wsPhase: 'close',
      method: 'WS',
      url: ctx.url,
      timestamp: ctx.startedAt,
      statusCode: 101,
      subprotocol: ctx.subprotocol,
      requestHeaders: ctx.requestHeaders,
      responseHeaders: ctx.responseHeaders,
      closeCode: code,
      closeReason: reason,
      closeBy: by,
      bytesSent: ctx.bytesSent,
      bytesReceived: ctx.bytesReceived,
      frameCount: ctx.frameCount,
      droppedFrames: ctx.droppedFrames,
      time: Date.now() - ctx.startedAt,
      errorCode: errorCode ?? ctx.errorCode,
      errorMessage: errorMessage ?? ctx.errorMessage,
    }
    this.sendSocket(ctx, record)
  }

  private sendOpen(ctx: SocketContext) {
    const record: ProxyMock.SocketRecord = {
      id: ctx.id,
      wsId: ctx.id,
      type: ProxyMock.PorxyType.SOCKET,
      wsPhase: 'open',
      method: 'WS',
      url: ctx.url,
      timestamp: ctx.startedAt,
      statusCode: 101,
      subprotocol: ctx.subprotocol,
      requestHeaders: ctx.requestHeaders,
      responseHeaders: ctx.responseHeaders,
      bytesSent: 0,
      bytesReceived: 0,
      frameCount: 0,
      droppedFrames: 0,
    }
    this.sendSocket(ctx, record)
  }

  private recordFrame(ctx: SocketContext, dir: ProxyMock.SocketDirection,
    opcode: ProxyMock.SocketOpcode, data: Buffer) {
    if (ctx.closed) return
    ctx.frameSeq++
    ctx.frameCount++

    if (ctx.deliveredFrames + ctx.frames.length >= MAX_STORED_FRAMES) {
      ctx.droppedFrames++
      return
    }

    const encoded = encodeFramePayload(data, opcode)
    const frame: ProxyMock.SocketFrame = {
      seq: ctx.frameSeq,
      dir,
      opcode,
      at: Date.now() - ctx.startedAt,
      size: encoded.size,
      data: encoded.data,
      encoding: encoded.encoding,
      truncated: encoded.truncated || undefined,
    }

    ctx.frames.push(frame)
    ctx.pendingBytes += frame.data.length

    while (ctx.frames.length > MAX_PENDING_FRAMES || ctx.pendingBytes > MAX_PENDING_BYTES) {
      const dropped = ctx.frames.shift()
      if (dropped == null) break
      ctx.pendingBytes -= dropped.data.length
      ctx.droppedFrames++
    }

    if (ctx.frames.length >= BATCH_FRAMES || ctx.pendingBytes >= BATCH_BYTES) {
      this.flushFrames(ctx)
      return
    }
    if (ctx.timer == null) {
      ctx.timer = setTimeout(() => this.flushFrames(ctx), BATCH_INTERVAL)
      ctx.timer.unref?.()
    }
  }

  private flushFrames(ctx: SocketContext) {
    if (ctx.timer != null) {
      clearTimeout(ctx.timer)
      ctx.timer = null
    }
    if (ctx.frames.length === 0) return
    if (!ctx.ready) {
      ctx.frames = []
      ctx.pendingBytes = 0
      return
    }

    const frames = ctx.frames
    ctx.frames = []
    ctx.pendingBytes = 0
    ctx.deliveredFrames += frames.length

    const record: ProxyMock.SocketRecord = {
      id: ctx.id,
      wsId: ctx.id,
      type: ProxyMock.PorxyType.SOCKET,
      wsPhase: 'frames',
      method: 'WS',
      url: ctx.url,
      timestamp: ctx.startedAt,
      statusCode: 101,
      frames,
      frameCount: ctx.frameCount,
      droppedFrames: ctx.droppedFrames,
      bytesSent: ctx.bytesSent,
      bytesReceived: ctx.bytesReceived,
    }
    this.sendSocket(ctx, record)
  }

  private clearPending(ctx: SocketContext) {
    ctx.frames = []
    ctx.pendingBytes = 0
    if (ctx.timer != null) {
      clearTimeout(ctx.timer)
      ctx.timer = null
    }
  }

  private sendSocket(ctx: SocketContext, record: ProxyMock.SocketRecord) {
    if (ctx.uid == null || ctx.uid === '') return
    if (!this.pushService.hasClient(ctx.uid)) return
    this.pushService.sendProxyMessage(ctx.uid, record)
  }

  private failConnection(opts: {
    id: number
    uid?: string
    startedAt: number
    url: string
    host: string
    status: number
    code: string
    message: string
    requestHeaders?: Record<string, string | string[]>
    responseHeaders?: Record<string, string | string[]>
  }) {
    this.diagnosticService.recordError({
      uid: opts.uid ?? '',
      url: opts.url,
      host: opts.host,
      error: `[${opts.code}] ${opts.message}`,
    })
    if (opts.uid == null || opts.uid === '' || !this.pushService.hasClient(opts.uid)) return

    const record: ProxyMock.SocketRecord = {
      id: opts.id,
      wsId: opts.id,
      type: ProxyMock.PorxyType.SOCKET,
      wsPhase: 'close',
      method: 'WS',
      url: opts.url,
      timestamp: opts.startedAt,
      statusCode: opts.status,
      requestHeaders: opts.requestHeaders,
      responseHeaders: opts.responseHeaders,
      closeBy: 'proxy',
      time: Date.now() - opts.startedAt,
      frameCount: 0,
      droppedFrames: 0,
      bytesSent: 0,
      bytesReceived: 0,
      errorCode: opts.code,
      errorMessage: opts.message,
    }
    this.pushService.sendProxyMessage(opts.uid, record)
  }

  // 缺少可推送 uid 时也要把握手失败原因写回原始 socket
  private rejectHandshake(req: IncomingMessage, socket: Duplex, status: number,
    code: string, message: string) {
    const uid = headerValue(req.headers[MOCK_UID_HEADER])
      ?? mockQueryValue(req.url, '__mock_uid')
    const startedAt = Date.now()
    this.failConnection({
      id: ++this.sessionId,
      uid,
      startedAt,
      url: req.url ?? '',
      host: '',
      status,
      code,
      message,
    })
    this.writeHttpFailure(socket, status, message, code)
  }

  private writeHttpFailure(socket: Duplex, status: number, message: string,
    code?: string, body?: Buffer) {
    if (socket.destroyed) return
    const statusText = http.STATUS_CODES[status] ?? 'Error'
    const payload = body != null && body.length > 0 ? body : Buffer.from(message, 'utf8')
    const lines = [
      `HTTP/1.1 ${status} ${statusText}`,
      'Connection: close',
      'Content-Type: text/plain; charset=utf-8',
      `Content-Length: ${payload.length}`,
    ]
    if (code != null) lines.push(`x-mock-ws-error: ${code}`)
    try {
      socket.write(`${lines.join('\r\n')}\r\n\r\n`)
      socket.end(payload as any)
    } catch (err) {
      try {
        socket.destroy()
      } catch (destroyErr) {
        // ignore
      }
    }
    const timer = setTimeout(() => {
      try {
        socket.destroy()
      } catch (err) {
        // ignore
      }
    }, 1000)
    timer.unref?.()
  }

  private resolveTarget(parsed: ParsedProxyRequest): ResolvedTarget {
    const config = parsed.uid != null ? this.proxyService.getProxyConfig(parsed.uid) : null
    return resolveTargetUrl(parsed, config)
  }
}

function rawToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data as any)
  return Buffer.from(data as ArrayBuffer)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}