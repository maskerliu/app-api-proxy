import axios from 'axios'
import { Request, Response } from 'express'
import http from 'http'
import https from 'https'
import { inject, injectable } from 'inversify'
import JSONBig from 'json-bigint'
import zlib from 'zlib'
import type { MockHitMeta, MockMissDiagnostic } from '@shared/mock.models'
import {
  HOP_BY_HOP_HEADERS, isHeaderName, MOCK_HOST_HEADER, MOCK_UID_HEADER, pickHeader,
  splitConnectionTokens,
} from '@shared/http-header'
import { ProxyMock } from '@shared/proxy.models'
import { IocTypes } from '../MainConst'
import { BizNetwork } from '../misc/utils'
import { DiagnosticService } from './diagnostic.service'
import { MockService } from './mock.service'
import { PushService } from './push.service'

let MockKey = null


@injectable()
export class ProxyService {
  private static PROXY_DEF_TIMEOUT: number = 1000 * 15 // 15s
  private static MAX_REQUEST_BODY: number = 50 * 1024 * 1024
  private static MAX_RECORD_BODY: number = 1024 * 1024
  private _sessionId: number
  private proxyConfigs: Map<string, ProxyMock.ProxyConfig>

  @inject(IocTypes.MocksService)
  private mockService: MockService

  @inject(IocTypes.PushService)
  private pushService: PushService

  @inject(IocTypes.DiagnosticService)
  private diagnosticService: DiagnosticService

  constructor() {
    this._sessionId = 0

    this.proxyConfigs = new Map()
  }

  public getDataProxyServer(uid: string): ProxyMock.ProxyConfig {
    return this.proxyConfigs.get(uid)
  }

  public setDataProxyServer(uid: string, proxyPref: ProxyMock.ProxyConfig) {
    this.proxyConfigs.set(uid, proxyPref)
  }

  public getProxyConfig(uid: string): ProxyMock.ProxyConfig {
    return this.proxyConfigs.get(uid) ?? { dataServer: null, status: false, delay: 0 }
  }

  public saveProxyConfig(uid: string, config: ProxyMock.ProxyConfig) {
    if (uid == null || config == null) return 'success'
    const uConfig = this.getProxyConfig(uid)
    if (config.delay != null) uConfig.delay = config.delay
    if (config.dataServer != null) uConfig.dataServer = config.dataServer
    if (config.status != null) uConfig.status = config.status
    this.proxyConfigs.set(uid, uConfig)
    return 'success'
  }

  public clearClientState(uid: string) {
    this.proxyConfigs.delete(uid)
  }

  public async handleStatRequest(req: any, resp: Response) {
    zlib.unzip(Buffer.from(req.rawbody) as any, async (err: any, buffer: any) => {
      if (!err) {
        let record: ProxyMock.ProxyStatRecord = {
          id: new Date().getTime(),
          type: ProxyMock.PorxyType.STATISTICS,
          timestamp: new Date().getSeconds(),
          statistics: JSON.parse(buffer.toString()),
        }
        this.pushService.sendProxyMessage(req.header(MOCK_UID_HEADER), record)

        let originHost = req.header(MOCK_HOST_HEADER) != null ? req.header(MOCK_HOST_HEADER) : req.header('host')
        let headers = Object.assign({}, req.headers)
        delete headers['host']
        delete headers[MOCK_HOST_HEADER]
        delete headers[MOCK_UID_HEADER]

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
    const uid = pickHeader(req.headers, MOCK_UID_HEADER)
    // 清理无效配置（viewer 与通过注册地址接入的设备都算有效客户端）
    if (!this.pushService.hasClient(uid)) this.proxyConfigs.delete(uid)

    const startTime = new Date().getTime()
    const sessionId = ++this._sessionId
    const delay = this.proxyConfigs.get(uid)?.delay ?? 0
    const host = pickHeader(req.headers, MOCK_HOST_HEADER) ?? ''
    // 接入向导依赖这里判断请求是否来自已注册的设备
    this.diagnosticService.recordRequest({
      sessionId,
      at: startTime,
      uid: uid ?? '',
      method: req.method,
      url: req.url,
      host,
      uidKnown: uid != null && this.pushService.hasClient(uid),
    })

    let rawBody: Buffer
    try {
      rawBody = await this.readRequestBody(req)
    } catch (err: any) {
      this.diagnosticService.recordError({ uid: uid ?? '', url: req.url, host, error: err?.message ?? 'request body error' })
      if (!resp.headersSent) {
        resp.status(413).json({ code: 9000, msg: err.message || 'request body error' })
      }
      return
    }

    let requestData = null
    if (req.method.toLocaleLowerCase() === 'get' && Object.keys(req.query).length > 0) {
      requestData = req.query
    }

    const data: ProxyMock.ProxyRequestRecord = {
      id: sessionId,
      type: ProxyMock.PorxyType.REQUEST_START,
      url: req.url,
      method: req.method,
      headers: req.headers,
      requestData: requestData,
      data: this.parseBody(req, rawBody),
      timestamp: new Date().getSeconds(),
    }

    this.pushService.sendProxyMessage(uid, data)

    let miss: MockMissDiagnostic = null
    try {
      const attempt = await this.mockService.mock(sessionId, uid,
        { method: req.method, url: req.url, headers: req.headers }, startTime, delay)
      if (attempt.matched) {
        this.sendMockResponse(resp, attempt.response, delay)
        return
      }
      // 未命中不抛异常：诊断信息随 REQUEST_END 一起推给 UI
      miss = attempt.meta?.miss ?? null
    } catch (err: any) {
      // 匹配引擎异常不能让请求失败，继续转发
      console.warn('mock failed, fallback to proxy:', err?.message ?? err)
    }
    await this.proxy(sessionId, req, resp, startTime, delay, rawBody, miss)
  }

  private sendMockResponse(resp: Response, mockResp: ProxyMock.MockResponse, delay: number) {
    // 变体延迟 > 0 时覆盖设备级延迟（不叠加）
    const effectiveDelay = mockResp.delay != null ? mockResp.delay : delay
    setTimeout(() => {
      if (resp.headersSent || resp.writableEnded || resp.destroyed) return

      resp.status(mockResp.statusCode ?? 200)
      const headers = mockResp.headers ?? {}
      for (const name of Object.keys(headers)) {
        const key = name.toLowerCase()
        if (!isHeaderName(key)) continue
        if (HOP_BY_HOP_HEADERS.includes(key)) continue
        // mock 数据已解码，不能再透传压缩/长度相关头
        if (key === 'content-length' || key === 'content-encoding') continue
        const value = headers[name]
        if (value != null) resp.setHeader(name, value as any)
      }

      if (mockResp.data == null) resp.end()
      else resp.send(mockResp.data)
    }, effectiveDelay)
  }

  private proxy(sessionId: number, req: Request, resp: Response, startTime: number, delay: number,
    rawBody?: Buffer, miss?: MockMissDiagnostic) {
    const uid = pickHeader(req.headers, MOCK_UID_HEADER)
    const state = { responded: false, finished: false, clientGone: false }

    return new Promise<void>((resolve) => {
      const complete = () => {
        if (state.finished) return
        state.finished = true
        resolve()
      }

      const fail = (err: Error) => {
        if (state.responded) {
          complete()
          return
        }
        console.error('proxy request failed:', err.message)
        this.diagnosticService.recordError({
          uid: uid ?? '',
          url: req.url,
          host: pickHeader(req.headers, MOCK_HOST_HEADER) ?? '',
          error: err.message,
        })
        const record: ProxyMock.ProxyRequestRecord = {
          id: sessionId,
          url: req.url,
          type: ProxyMock.PorxyType.REQUEST_END,
          statusCode: -100,
          responseHeaders: null,
          responseData: JSON.stringify({ error: err.message }),
          time: new Date().getTime() - startTime,
          isMock: false,
          mock: this.missMeta(miss),
        }
        setTimeout(() => {
          this.pushService.sendProxyMessage(uid, record)
          if (!resp.headersSent) {
            resp.status(502).json({ code: 9000, msg: `proxy error: ${err.message}` })
          }
          complete()
        }, delay)
      }

      let upstreamReq: http.ClientRequest
      try {
        const target = this.resolveTarget(req, uid)
        const headers = this.buildUpstreamHeaders(req, rawBody, target.host)
        const transport = target.protocol === 'https:' ? https : http
        upstreamReq = transport.request({
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          method: req.method,
          path: target.path,
          headers,
          timeout: ProxyService.PROXY_DEF_TIMEOUT,
        }, (upstreamResp) => {
          state.responded = true
          this.relayResponse(uid, sessionId, req, resp, startTime, delay, upstreamResp, state, complete, miss)
        })
      } catch (err: any) {
        fail(err)
        return
      }

      upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('proxy timeout')))
      upstreamReq.on('error', (err) => fail(err))

      resp.on('close', () => {
        if (resp.writableEnded) return
        state.clientGone = true
        upstreamReq.destroy()
      })

      if (rawBody != null) upstreamReq.end(rawBody)
      else upstreamReq.end()
    })
  }

  private relayResponse(
    uid: string,
    sessionId: number,
    req: Request,
    resp: Response,
    startTime: number,
    delay: number,
    upstreamResp: http.IncomingMessage,
    state: { responded: boolean, finished: boolean, clientGone: boolean },
    complete: () => void,
    miss?: MockMissDiagnostic,
  ) {
    const status = upstreamResp.statusCode ?? 502
    const headers = upstreamResp.headers
    const skip = this.skipResponseHeaders(headers)
    const chunks: Buffer[] = []
    let collected = 0
    let received = 0
    let truncated = false
    let timer: NodeJS.Timeout

    upstreamResp.pause()
    upstreamResp.on('data', (chunk: Buffer) => {
      received += chunk.length
      const keep = ProxyService.MAX_RECORD_BODY - collected
      if (keep <= 0) {
        truncated = true
        return
      }
      if (chunk.length > keep) {
        chunks.push(chunk.subarray(0, keep))
        collected += keep
        truncated = true
      } else {
        chunks.push(chunk)
        collected += chunk.length
      }
    })

    upstreamResp.on('end', () => {
      const record: ProxyMock.ProxyRequestRecord = {
        id: sessionId,
        url: req.url,
        type: ProxyMock.PorxyType.REQUEST_END,
        statusCode: status,
        responseHeaders: headers ?? null,
        responseData: this.formatRecordData(Buffer.concat(chunks as unknown as Uint8Array[]), headers, truncated, received),
        time: new Date().getTime() - startTime,
        isMock: false,
        mock: this.missMeta(miss),
      }
      this.pushService.sendProxyMessage(uid, record)
      complete()
    })

    upstreamResp.on('error', (err) => {
      clearTimeout(timer)
      this.diagnosticService.recordError({
        uid,
        url: req.url,
        host: pickHeader(req.headers, MOCK_HOST_HEADER) ?? '',
        error: state.clientGone ? 'client closed' : err.message,
      })
      const record: ProxyMock.ProxyRequestRecord = {
        id: sessionId,
        url: req.url,
        type: ProxyMock.PorxyType.REQUEST_END,
        statusCode: -100,
        responseHeaders: headers ?? null,
        responseData: JSON.stringify({ error: state.clientGone ? 'client closed' : err.message }),
        time: new Date().getTime() - startTime,
        isMock: false,
        mock: this.missMeta(miss),
      }
      this.pushService.sendProxyMessage(uid, record)
      if (state.clientGone) {
        complete()
        return
      }
      if (resp.headersSent) {
        resp.destroy(err)
      } else {
        resp.status(502).json({ code: 9000, msg: `proxy error: ${err.message}` })
      }
      complete()
    })

    timer = setTimeout(() => {
      if (resp.headersSent || state.clientGone) return

      if (req.httpVersionMajor < 2 && upstreamResp.statusMessage) resp.statusMessage = upstreamResp.statusMessage
      resp.statusCode = status
      for (const name in headers) {
        if (skip.has(name.toLowerCase())) continue
        const value = headers[name]
        if (value != null) resp.setHeader(name, value as any)
      }
      upstreamResp.pipe(resp)
      upstreamResp.resume()
    }, delay)
  }

  private resolveTarget(req: Request, uid: string) {
    const proxyConfig = this.proxyConfigs.get(uid)
    let base = pickHeader(req.headers, MOCK_HOST_HEADER)
    if (proxyConfig?.status && proxyConfig.dataServer != null) base = proxyConfig.dataServer
    // 不能用代理自身的 host 兜底，否则会转发给自己，客户端只能拿到代理页面 404
    if (base == null || base.length === 0) throw new Error('missing x-mock-host header')
    // 裸 host（无协议）按原始逻辑走 http，不能沿用代理侧的 https
    if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(base)) base = `http://${base}`

    const url = new URL(base)
    const basePath = url.pathname.replace(/\/+$/, '')
    return {
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[(.*)\]$/, '$1'),
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: basePath + (req.url.startsWith('/') ? req.url : `/${req.url}`),
      host: url.host,
    }
  }

  private buildUpstreamHeaders(req: Request, rawBody: Buffer, host: string): http.OutgoingHttpHeaders {
    const skip = new Set([
      ...HOP_BY_HOP_HEADERS, ...splitConnectionTokens(req.headers['connection']),
      'host', 'content-length', MOCK_HOST_HEADER, MOCK_UID_HEADER,
    ])

    const headers: http.OutgoingHttpHeaders = {}
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i]
      const key = name.toLowerCase()
      // http2 伪头（:method/:path/:scheme/:authority）不是合法 HTTP/1.1 头，必须丢弃
      if (key.startsWith(':') || !isHeaderName(key)) continue
      if (skip.has(key)) continue
      const value = req.rawHeaders[i + 1]
      const existing = headers[key]
      if (existing == null) headers[key] = value
      else if (Array.isArray(existing)) existing.push(value)
      else headers[key] = [existing as string, value]
    }

    headers['host'] = host
    const chunked = req.headers['transfer-encoding'] != null
    if (rawBody != null) {
      // 原始请求为 chunked 时继续以 chunked 发送，保持分帧一致（Node 对 end(buffer) 会自行补 Content-Length）
      if (chunked) headers['transfer-encoding'] = 'chunked'
      else headers['content-length'] = String(rawBody.length)
    } else if (req.headers['content-length'] != null) {
      headers['content-length'] = String(req.headers['content-length'])
    }
    if (MockKey != null) headers['Mock-Key'] = MockKey
    return headers
  }

  private skipResponseHeaders(headers: http.IncomingHttpHeaders): Set<string> {
    return new Set([...HOP_BY_HOP_HEADERS, ...splitConnectionTokens(headers['connection'])])
  }

  private formatRecordData(data: any, headers: any, truncated = false, totalBytes?: number): string {
    if (data == null) return null

    const body = Buffer.isBuffer(data) ? data : Buffer.from(data)
    if (body.length === 0 && !truncated) return null

    const total = totalBytes ?? body.length
    const contentType = String(headers?.['content-type'] ?? '').toLowerCase()
    const encoding = String(headers?.['content-encoding'] ?? '').trim().toLowerCase()

    // 转发的是原始字节，记录展示前需自行解码，否则压缩响应会显示为乱码
    if (encoding && encoding !== 'identity') {
      if (truncated) return JSON.stringify(`[${encoding} ${total} bytes, truncated]`)
      try {
        return this.formatDecodedRecord(this.decodeContent(body, encoding), contentType, false, total)
      } catch (err) {
        return JSON.stringify(`[binary ${total} bytes, ${encoding}]`)
      }
    }

    return this.formatDecodedRecord(body, contentType, truncated, total)
  }

  private formatDecodedRecord(body: Buffer, contentType: string, truncated: boolean, total: number): string {
    const text = this.decodeText(body, contentType)
    if (contentType.includes('json')) {
      if (truncated) return JSON.stringify(`${text}\n...[truncated ${total} bytes]`)
      try {
        return JSONBig.stringify(JSONBig.parse(text))
      } catch (err) {
        return JSON.stringify(text)
      }
    }
    if (contentType.startsWith('text/') || contentType.includes('xml')
      || contentType.includes('javascript') || contentType.includes('urlencoded')
      || contentType.startsWith('multipart/')) {
      return JSON.stringify(truncated ? `${text}\n...[truncated ${total} bytes]` : text)
    }
    return JSON.stringify(`[binary ${total} bytes${truncated ? ', truncated' : ''}]`)
  }

  private decodeContent(body: Buffer, encoding: string): Buffer {
    const z = zlib as any
    const options = { maxOutputLength: ProxyService.MAX_RECORD_BODY * 4 }
    return encoding.split(',').map(it => it.trim()).filter(Boolean).reverse()
      .reduce((payload, it) => {
        switch (it) {
          case 'gzip':
          case 'x-gzip':
            return z.gunzipSync(payload, options)
          case 'deflate':
            try {
              return z.inflateSync(payload, options)
            } catch (err) {
              return z.inflateRawSync(payload, options)
            }
          case 'br':
            return z.brotliDecompressSync(payload, options)
          case 'zstd':
            if (typeof z.zstdDecompressSync !== 'function') throw new Error('zstd unsupported')
            return z.zstdDecompressSync(payload, options)
          case 'identity':
            return payload
          default:
            throw new Error(`unsupported content-encoding: ${it}`)
        }
      }, body)
  }

  private decodeText(body: Buffer, contentType: string): string {
    const charset = /charset\s*=\s*"?([^;"\s]+)/i.exec(contentType)?.[1]?.trim().toLowerCase()
    if (charset && charset !== 'utf-8' && charset !== 'utf8') {
      try {
        return new TextDecoder(charset).decode(body)
      } catch (err) {
        // 未知字符集时退回 utf-8
      }
    }
    return body.toString('utf-8')
  }

  private parseBody(req: Request, rawBody?: Buffer) {
    const body = rawBody ?? req.body
    if (body == null) return null
    if (!Buffer.isBuffer(body)) return body
    return this.formatRecordData(body, req.headers)
  }

  private readRequestBody(req: Request): Promise<Buffer> {
    if (Buffer.isBuffer(req.body)) {
      return Promise.resolve(req.body.length > 0 ? req.body : undefined)
    }

    // HTTP/2 没有 Content-Length/Transfer-Encoding 分帧，请求体以 END_STREAM 结束
    const hasBody = req.httpVersionMajor >= 2
      || req.headers['transfer-encoding'] != null
      || req.headers['content-length'] != null
    if (!hasBody || req.readableEnded) return Promise.resolve(undefined)

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      let tooLarge = false

      req.on('data', (chunk: Buffer) => {
        if (tooLarge) return
        size += chunk.length
        if (size > ProxyService.MAX_REQUEST_BODY) {
          tooLarge = true
          chunks.length = 0
          reject(new Error('request body too large'))
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (tooLarge) return
        resolve(size > 0 ? Buffer.concat(chunks as unknown as Uint8Array[]) : undefined)
      })
      req.on('error', reject)
    })
  }

  /** 未命中时只带诊断，避免 UI 把普通转发误判为命中 */
  private missMeta(miss?: MockMissDiagnostic): MockHitMeta {
    return miss != null ? { hit: false, miss } : undefined
  }
}