
import bodyParser from 'body-parser'
import compression from 'compression'
import cors from 'cors'
import express, { Application, Request, Response } from 'express'
import { createServer, Server } from 'http'
import path from 'path'
import { BizCode, BizResponse, LocalServerConfig } from '../common/models/DataModels'
import proxyService from './ProxyService'
import pushService from './PushService'
import { getLocalIPs } from './utils/NetworkUtils'
import webService from './WebService'

const CorsOptions = {
  credentials: true,
  optionsSuccessStatus: 200
}

class LocalServer {
  private serverConfig: LocalServerConfig
  private httpServer: Server
  private httpApp: Application

  constructor() {
    this.serverConfig = {
      ip: getLocalIPs()[0].address,
      port: 8885,
      ips: getLocalIPs()
    }

    this.startProxyServer()
  }

  public getLocalServerConfig(req: Request, resp: Response): LocalServerConfig {
    return this.serverConfig
  }

  public setLocalServerConfig(config: LocalServerConfig): void {
    Object.assign(this.serverConfig, config)
    if (config.port != this.serverConfig.port) {
      this.startProxyServer()
    }
  }

  public startProxyServer() {
    this.initHttpServer()

    if (this.httpServer != null) {
      this.httpServer.close(() => { this.httpServer = null })
    }
    this.startHttpServer()
  }

  private initHttpServer() {
    this.httpApp = express()
    let corsOpts = Object.assign({
      'origin': [
        `http://${this.serverConfig.ip}:${this.serverConfig.port}`,
        `https://${this.serverConfig.ip}:${this.serverConfig.port}`,
        `http://${this.serverConfig.ip}:9080`,
        `http://${this.serverConfig.ip}:9081`,
        `http://localhost:9080`,
        `http://localhost:9081`
      ]
    }, CorsOptions)
    this.httpApp.use(cors(corsOpts))
    this.httpApp.use(compression())
    this.httpApp.use(express.static(path.resolve(__dirname, '../web')))
    this.httpApp.use(bodyParser.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }))
    this.httpApp.use(bodyParser.text({ type: 'application/json', limit: '50mb' }))
    this.httpApp.use(bodyParser.json())
    this.httpApp.all('*', (req: any, resp: Response, next: Function) => { this.proxyHandler(req, resp, next) })
  }

  private proxyHandler(req: any, resp: Response, next: Function) {
    if (/^\/burying-point\//.test(req.url)) {
      let buf = []
      req.on('data', (data: any) => {
        buf.push(data)
      })
      req.on('end', () => {
        req.rawbody = Buffer.concat(buf)
        proxyService.handleStatRequest(req, resp)
      })
    } else if (/^\/appmock\//.test(req.url)) {
      if (req.url.indexOf('/getServerConfig') != -1) {
        let bizResp: BizResponse<LocalServerConfig> = {
          code: BizCode.SUCCESS,
          data: this.serverConfig
        }
        resp.json(bizResp)
        resp.end()
      } else if (req.url.indexOf('/saveServerConfig') != -1) {
        let config: LocalServerConfig = JSON.parse(req.body)
        let uid = req.query['uid'] as string
        proxyService.setDataProxyServer(uid, { server: config.server, status: config.status, delay: 0 })
        this.setLocalServerConfig(config)
        let bizResp: BizResponse<LocalServerConfig> = {
          code: BizCode.SUCCESS,
          data: Object.assign(this.serverConfig, proxyService.getDataProxyServer(uid))
        }
        resp.json(bizResp)
        resp.end()
      } else {
        webService.filter(req, resp)
      }
    } else {
      proxyService.handleRequest(req, resp)
    }
  }

  private startHttpServer() {
    this.httpServer = createServer(this.httpApp)
    pushService.bindServer(this.httpServer)
    this.httpServer.listen(
      this.serverConfig.port,
      this.serverConfig.ip,
      () => console.log(`--启动本地代理Http服务--[${this.serverConfig.port}]`)
    )
  }

}

export default new LocalServer()