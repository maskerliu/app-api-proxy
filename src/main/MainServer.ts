import axios, { HttpStatusCode, Method } from 'axios'
import compression from 'compression'
import cors, { CorsOptions } from 'cors'
import express, { Application, Request, Response } from 'express'
import fs from 'fs'
import { Server } from 'http'
import http2express from 'http2-express'
import path from 'path'
import tcpPortUsed from 'tcp-port-used'
import { API_URL } from '@shared/api.const'
import type { LocalServerConfig } from '@shared/base.models'
import { bizContainer } from './IocContainer'
import { IocTypes, IS_DEV, USER_DATA_DIR } from './MainConst'
import { AppMockRouter, ProxyRouter } from './router'
import { CommonService, MockService, ProxyService, PushService, SocketProxyService } from './service'

export class MainServer {

  private httpServer: Server
  private httpApp: Application

  private appmockRouter: AppMockRouter
  private proxyRouter: ProxyRouter
  private commonService: CommonService
  private mockService: MockService
  private proxyService: ProxyService
  private pushService: PushService
  private socketProxyService: SocketProxyService

  bootstrap() {
    this.appmockRouter = bizContainer.get(IocTypes.AppMockRouter)
    this.proxyRouter = bizContainer.get(IocTypes.ProxyRouter)
    this.commonService = bizContainer.get(IocTypes.CommonService)
    this.pushService = bizContainer.get(IocTypes.PushService)
    this.proxyService = bizContainer.get(IocTypes.ProxyService)
    this.socketProxyService = bizContainer.get(IocTypes.SocketProxyService)
    this.mockService = bizContainer.get(IocTypes.MocksService)

    // uid 生命周期结束（断开/重新注册）时清掉该 uid 的代理与 Mock 状态，避免残留串到下一个客户端
    this.pushService.onClientClosed = (uid: string) => {
      this.proxyService.clearClientState(uid)
      this.mockService.clearClientState(uid)
      this.socketProxyService.clearClientState(uid)
    }
  }

  private corsOpt: CorsOptions = {
    credentials: true,
    optionsSuccessStatus: 200,
  }

  public async start() {
    const port = this.commonService.serverConfig.port
    const portUsed = await tcpPortUsed.check(port, '127.0.0.1')

    let config = this.commonService.serverConfig
    config.portValid = !portUsed
    this.commonService.saveServerConfig(config)

    await this.stop()
    await this.waitForPortRelease(port)

    try {
      await this.mockService.init()
    } catch (err) {
      // 迁移失败不阻塞服务启动，下次启动会重试
      console.error('mock storage init failed:', err)
    }

    this.initHttpApp()
    await this.startHttpServer()
  }

  private async waitForPortRelease(port: number, maxRetries: number = 10, delay: number = 500) {
    for (let i = 0; i < maxRetries; i++) {
      const isUsed = await tcpPortUsed.check(port, '127.0.0.1')
      if (!isUsed) {
        console.log(`port ${port} released`)
        return
      }
      console.log(`wait port ${port} release... (${i + 1}/${maxRetries})`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    console.warn(`port ${port} used, try start server`)
  }

  public getBizConfig() {
    return this.commonService.serverConfig
  }

  public async updateBizConfig(config: LocalServerConfig) {
    const current = this.commonService.serverConfig
    // 渲染层的端口可能来自输入框字符串，比较前统一成数字，避免每次保存都重启服务
    const nextPort = Number.parseInt(String(config.port ?? ''))
    const portChanged = Number.isFinite(nextPort) && nextPort !== current.port
    if (portChanged || current.protocol !== config.protocol) {
      this.commonService.saveServerConfig(config)
      await this.start()
      return
    }
    this.commonService.saveServerConfig(config)
  }

  public async stop(timeout: number = 5000): Promise<void> {
    // 长连接必须先关，否则 server.close() 会一直等到超时
    try {
      this.socketProxyService.closeAll()
    } catch (err) {
      console.warn('close socket proxy failed:', err)
    }

    const server = this.httpServer
    if (server == null) return
    this.httpServer = null

    try {
      this.pushService.closeWebSocketServer()
    } catch (err) {
      console.warn('close push server failed:', err)
    }

    // 重启/退出时不能因 keep-alive 连接或超时被 reject，否则后续 start() 直接失败
    await new Promise<void>((resolve) => {
      let settled = false
      let timer: NodeJS.Timeout
      const done = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }

      timer = setTimeout(() => {
        console.warn(`http server close timeout(${timeout}ms), force close connections`)
        ;(server as any).closeAllConnections?.()
        done()
      }, timeout)
      timer.unref()

      server.close((err) => {
        if (err) console.warn('http server close error:', err)
        else console.log('http server closed')
        done()
      })
      ;(server as any).closeIdleConnections?.()
    })
  }

  private initHttpApp() {
    this.httpApp = http2express(express)

    this.corsOpt.origin = [
      `${this.commonService.serverConfig.protocol}://localhost:${this.commonService.serverConfig.port}`,
      `${this.commonService.serverConfig.protocol}://localhost:9080`,
      `${this.commonService.serverConfig.protocol}://localhost:9081`,
      `${this.commonService.serverConfig.protocol}://${this.commonService.serverConfig.ip}:${this.commonService.serverConfig.port}`,
      `${this.commonService.serverConfig.protocol}://${this.commonService.serverConfig.ip}:9080`,
      `${this.commonService.serverConfig.protocol}://${this.commonService.serverConfig.ip}:9081`,
    ]

    if (!IS_DEV) this.httpApp.use(compression())

    this.httpApp.use((_req, resp, next) => {
      resp.header('Cross-Origin-Opener-Policy', 'same-origin')
      resp.header('Cross-Origin-Resource-Policy', 'cross-origin')
      resp.header('Access-Control-Allow-Origin', '*')
      next()
    })

    this.httpApp.use(express.static(path.resolve(__dirname, '../web')))
    this.httpApp.use('/_res', express.static(path.join(USER_DATA_DIR, './static')))
    this.httpApp.use(cors(this.corsOpt))

    const formParser = express.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 })
    const textJsonParser = express.text({ type: 'application/json', limit: '50mb' })
    const jsonParser = express.json({ limit: '50mb' })

    this.httpApp.use(API_URL.AppMock, formParser, textJsonParser, jsonParser, this.appmockRouter.router)
    // 代理不能经过任何 body parser：需保留原始字节与 Content-Encoding，由 ProxyService 自行读取请求流
    this.httpApp.use(API_URL.Proxy, this.proxyRouter.router)
    this.httpApp.use(API_URL.CorsMediaProxy, this.proxyCorsMedia)

    this.httpApp.use((err: Error, _req: Request, resp: Response, _next: any) => {
      resp.status(HttpStatusCode.InternalServerError).json({
        code: 9000,
        msg: err.message || 'Internal Server Error',
      })
    })
  }

  private async startHttpServer() {
    let HTTP: any
    const baseDir = IS_DEV ? path.join(__dirname, '../../') : path.join(__dirname, './')
    if (this.commonService.serverConfig.protocol == 'https') {
      HTTP = await import('http2')
      const key = fs.readFileSync(baseDir + 'cert/server.key')
      const cert = fs.readFileSync(baseDir + 'cert/server.crt')
      const opt = { key, cert, allowHTTP1: true }
      this.httpServer = HTTP.createSecureServer(opt, this.httpApp)
    } else {
      HTTP = await import('http')
      this.httpServer = HTTP.createServer(this.httpApp)
    }
    this.pushService.bindServer(this.httpServer)
    this.socketProxyService.bindServer(this.httpServer)

    this.httpServer.addListener('close', () => {
      console.log('close http server')
    })

    this.httpServer.addListener('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`port[${this.commonService.serverConfig.port}] ${e.code}`)
        const config = this.commonService.serverConfig
        config.portValid = false
        this.commonService.saveServerConfig(config)
        this.httpServer?.close()
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.httpServer.listen(this.commonService.serverConfig.port, () => {
        console.log(`    http server bootstrap[${this.commonService.serverConfig.port}]`)
        const config = this.commonService.serverConfig
        config.portValid = true
        this.commonService.saveServerConfig(config)
        resolve()
      })
      this.httpServer.once('error', reject)
    })
  }

  private async proxyCorsMedia(req: Request, resp: Response) {
    try {
      let target = req.query['target']
      let headers: Record<string, string> = {}
      // 透传范围请求，音视频才能边下边播、拖动进度
      if (req.headers.range) headers['range'] = req.headers.range as string
      if (req.headers['if-range']) headers['if-range'] = req.headers['if-range'] as string

      let proxyResp = await axios({
        url: target as string,
        method: req.method as Method,
        headers,
        responseType: 'stream',
        // 原样透传字节，避免与转发的 content-encoding/content-length 不一致
        decompress: false
      })

      Object.keys(proxyResp.headers).forEach(it => {
        // 传输层头由本服务重新生成，直接转发会出错
        if (['transfer-encoding', 'connection', 'keep-alive'].includes(it)) return
        resp.setHeader(it, proxyResp.headers[it])
      })
      resp.status(proxyResp.status)

      let upstream: any = proxyResp.data
      upstream.on('error', () => {
        if (resp.headersSent) resp.end()
        else resp.status(HttpStatusCode.InternalServerError).end()
      })
      // 关闭预览时停止下载
      resp.on('close', () => upstream.destroy())
      upstream.pipe(resp)
    } catch (err) {
      let data = (err as any)?.response?.data
      if (data?.destroy) data.destroy()
      resp.status(HttpStatusCode.InternalServerError)
      resp.send((err as Error)?.message ?? err)
    }
  }

}
