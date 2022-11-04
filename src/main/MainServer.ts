
import bodyParser from 'body-parser'
import compression from 'compression'
import cors from 'cors'
import express, { Application, Response } from 'express'
import { createServer, Server } from 'http'
import { Autowired, Component } from 'lynx-express-mvc'
import path from 'path'

import MainRouter from './MainRouter'
import CommonService from './service/common.service'
import IOTDeviceMgrService from './service/iot.deviceMgr.service'
import ProxyService from './service/proxy.service'
import PushService from './service/push.service'


import si from 'systeminformation'

const CorsOptions = {
  credentials: true,
  optionsSuccessStatus: 200
}

@Component()
class LocalServer {
  private httpServer: Server
  private httpApp: Application

  @Autowired()
  mainRouter: MainRouter

  @Autowired()
  commonService: CommonService

  @Autowired()
  proxyService: ProxyService

  @Autowired()
  pushService: PushService

  @Autowired()
  iotDeviceMgrService: IOTDeviceMgrService

  public async start() {

   let info = await si.baseboard()
   console.log(info)

    this.mainRouter.init()
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
        `http://${this.commonService.serverConfig.ip}:${this.commonService.serverConfig.port}`,
        `https://${this.commonService.serverConfig.ip}:${this.commonService.serverConfig.port}`,
        `http://${this.commonService.serverConfig.ip}:9080`,
        `http://${this.commonService.serverConfig.ip}:9081`,
        `http://localhost:9080`,
        `http://localhost:9081`,
        `http://localhost:${this.commonService.serverConfig.port}`,
      ]
    }, CorsOptions)
    this.httpApp.use(cors(corsOpts))
    this.httpApp.use(compression())
    this.httpApp.use(express.static(path.resolve(__dirname, '../web')))
    this.httpApp.use(bodyParser.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }))
    this.httpApp.use(bodyParser.text({ type: 'application/json', limit: '50mb' }))
    this.httpApp.use(bodyParser.json())
    this.httpApp.all('*', (req: any, resp: Response) => { this.handleRequest(req, resp) })
  }

  private startHttpServer() {
    this.httpApp.addListener
    this.httpServer = createServer(this.httpApp)
    this.pushService.bindServer(this.httpServer)
    this.httpServer.listen(
      this.commonService.serverConfig.port,
      '0.0.0.0',
      () => console.log(`--启动本地代理Http服务--[${this.commonService.serverConfig.port}]`)
    )
  }

  private handleRequest(req: any, resp: Response) {
    if (/^\/burying-point\//.test(req.path)) {
      let buf = []
      req.on('data', (data: any) => { buf.push(data) })
      req.on('end', () => {
        req.rawbody = Buffer.concat(buf)
        this.proxyService.handleStatRequest(req, resp)
      })
    } else if (this.mainRouter.route(req, resp)) {
      return
    } else {
      this.proxyService.handleRequest(req, resp)
    }
  }

}

const localServer: any = new LocalServer()
localServer.init()

export default localServer