import axios, { AxiosRequestConfig, HttpStatusCode, Method } from 'axios'
import compression from 'compression'
import cors, { CorsOptions } from 'cors'
import express, { Application, Request, Response } from 'express'
import fs from 'fs'
import { Server } from 'http'
import http2express from 'http2-express'
import path from 'path'
import tcpPortUsed from 'tcp-port-used'
import { API_URL } from '@shared/api.const'
import { LocalServerConfig } from '@shared/base.models'
import { bizContainer } from './IocContainer'
import { IocTypes, IS_DEV, USER_DATA_DIR } from './MainConst'
import { AppMockRouter, MapiRouter, ProxyRouter } from './router'
import { CommonService, ProxyService, PushService } from './service'

export class MainServer {

  private buildConfig = JSON.parse(process.env.BUILD_CONFIG)

  private httpServer: Server
  private httpApp: Application

  private mapiRouter: MapiRouter
  private appmockRouter: AppMockRouter
  private proxyRouter: ProxyRouter
  private commonService: CommonService
  private proxyService: ProxyService
  private pushService: PushService

  bootstrap() {
    this.appmockRouter = bizContainer.get(IocTypes.AppMockRouter)
    this.mapiRouter = bizContainer.get(IocTypes.MapiRouter)
    this.proxyRouter = bizContainer.get(IocTypes.ProxyRouter)
    this.commonService = bizContainer.get(IocTypes.CommonService)
    this.pushService = bizContainer.get(IocTypes.PushService)
    this.proxyService = bizContainer.get(IocTypes.ProxyService)
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
    if (current.port !== config.port || current.protocol !== config.protocol) {
      this.commonService.saveServerConfig(config)
      await this.start()
      return
    }
    this.commonService.saveServerConfig(config)
  }

  public async stop(timeout: number = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.httpServer == null) {
        resolve()
        return
      }

      this.pushService.closeWebSocketServer()

      const timeoutId = setTimeout(() => {
        reject(new Error('shutdown timeout'))
      }, timeout)

      this.httpServer.close((err) => {
        clearTimeout(timeoutId)
        this.httpServer = null
        if (err) {
          console.log(`http server closed, ${err}`)
          reject(err)
        } else {
          console.log('http server closed')
          resolve()
        }
      })
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
    this.httpApp.use(express.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }))
    this.httpApp.use(express.text({ type: 'application/json', limit: '50mb' }))
    this.httpApp.use(express.json())

    this.httpApp.use(API_URL.AppMock, this.appmockRouter.router)
    this.httpApp.use(API_URL.MApi, this.mapiRouter.router)
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
      let options: AxiosRequestConfig = {
        url: target as string,
        method: req.method as Method
      }
      let proxyResp = await axios(options)
      Object.keys(proxyResp.headers).forEach(it => {
        if (it == 'content-length') return
        if (it == 'cache-control') return
        if (it == 'expires') return
        resp.setHeader(it, proxyResp.headers[it])
      })
      resp.status(proxyResp.status)

      let contentType = proxyResp.headers['content-type'] as string
      if (/image.*/.test(contentType)) {
        options.responseType = 'arraybuffer'
      } else if (/audio.*/.test(contentType)) {
        options.responseType = 'arraybuffer'
      } else if (/video.*/.test(contentType)) {
        options.responseType = 'arraybuffer'
      }

      proxyResp = await axios(options)

      switch (options.responseType) {
        case 'arraybuffer':
          resp.end(proxyResp.data)
          break
        case 'stream':
          proxyResp.data.pipe(resp)
          break
        default:
          resp.send(proxyResp.data)
          break
      }
    } catch (err) {
      resp.status(HttpStatusCode.InternalServerError)
      resp.send(err)
    } finally {
      resp.end()
    }
  }

}
