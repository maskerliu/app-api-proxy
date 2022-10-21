
import bodyParser from 'body-parser'
import compression from 'compression'
import cors from 'cors'
import express, { Application, Response } from 'express'
import { createServer, Server } from 'http'
import path from 'path'
import mainRouter from './MainRouter'
import commonServie from './service/CommonService'
import proxyService from './service/ProxyService'
import pushService from './service/PushService'

const CorsOptions = {
  credentials: true,
  optionsSuccessStatus: 200
}

class LocalServer {
  private httpServer: Server
  private httpApp: Application

  constructor() {
    this.startProxyServer()
  }

  public startProxyServer() {
    this.initHttpServer()

    if (this.httpServer != null) {
      this.httpServer.close(() => { this.httpServer = null })
    }
    this.startHttpServer()

    // mainRouter.register()
  }

  private initHttpServer() {
    this.httpApp = express()
    let corsOpts = Object.assign({
      'origin': [
        `http://${commonServie.serverConfig.ip}:${commonServie.serverConfig.port}`,
        `https://${commonServie.serverConfig.ip}:${commonServie.serverConfig.port}`,
        `http://${commonServie.serverConfig.ip}:9080`,
        `http://${commonServie.serverConfig.ip}:9081`,
        `http://localhost:9080`,
        `http://localhost:9081`,
        `http://localhost:${commonServie.serverConfig.port}`,
      ]
    }, CorsOptions)
    this.httpApp.use(cors(corsOpts))
    this.httpApp.use(compression())
    this.httpApp.use(express.static(path.resolve(__dirname, '../web')))
    this.httpApp.use(bodyParser.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }))
    this.httpApp.use(bodyParser.text({ type: 'application/json', limit: '50mb' }))
    this.httpApp.use(bodyParser.json())
    this.httpApp.all('*', (req: any, resp: Response, next: Function) => { this.handleRequest(req, resp, next) })
  }

  private handleRequest(req: any, resp: Response, next: Function) {
    if (/^\/burying-point\//.test(req.path)) {
      let buf = []
      req.on('data', (data: any) => { buf.push(data) })
      req.on('end', () => {
        req.rawbody = Buffer.concat(buf)
        proxyService.handleStatRequest(req, resp)
      })
    } else if (/^\/appmock\//.test(req.path)) {
      mainRouter.route(req, resp)
    } else {
      proxyService.handleRequest(req, resp)
    }
  }

  private startHttpServer() {
    this.httpApp.addListener
    this.httpServer = createServer(this.httpApp)
    pushService.bindServer(this.httpServer)
    this.httpServer.listen(
      commonServie.serverConfig.port,
      '0.0.0.0',
      () => console.log(`--启动本地代理Http服务--[${commonServie.serverConfig.port}]`)
    )
  }

}

export default new LocalServer()