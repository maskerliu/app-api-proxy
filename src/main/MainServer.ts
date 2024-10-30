
import compression from 'compression'
import cors, { CorsOptions } from 'cors'
import express, { Application, Response } from 'express'
import fileUpload from 'express-fileupload'
import fs from 'fs'
import { Container } from 'inversify'
import path from 'path'
import si from 'systeminformation'
import { IocTypes, USER_DATA_DIR } from './common/Const'
import { IMockRepo, MockRepo } from './repository/mock.repo'
import { AppMockRouter } from './router/AppMockRouter'
import { CommonService, ICommonService } from './service/common.service'
import { IMockService, MockService } from './service/mock.service'
import { IProxyService, ProxyService } from './service/proxy.service'
import { IPushService, PushService } from './service/push.service'
import { bizContainer } from './IocContainer'
export class MainServer {

  private iocContainer = new Container()

  private buildConfig = JSON.parse(process.env.BUILD_CONFIG)

  private httpServer: any
  private httpApp: Application

  private commonService: CommonService
  private proxyService: ProxyService
  private pushService: PushService

  bootstrap() {

    // console.log("hello", bizContainer.get<CommonService>(IocTypes.CommonService))
    this.commonService = bizContainer.get<CommonService>(IocTypes.CommonService)
    this.pushService = bizContainer.get<PushService>(IocTypes.PushService)
    this.proxyService = bizContainer.get<ProxyService>(IocTypes.ProxyService)
  }

  private corsOpt: CorsOptions = {
    credentials: true,
    optionsSuccessStatus: 200,
  }

  public async start() {
    try {
      let info = await si.baseboard()
      console.log(info)
    } catch (err) { console.error(err) }


    this.initHttpServer()

    if (this.httpServer != null) {
      this.httpServer.close(() => { this.httpServer = null })
    }
    this.startHttpServer()
  }

  private initHttpServer() {
    this.httpApp = express()

    console.log("server ip", this.commonService.serverConfig.ip)
    this.corsOpt.origin = [
      `${this.buildConfig.protocol}://localhost:${this.commonService.serverConfig.port}`,
      `${this.buildConfig.protocol}://localhost:9080`,
      `${this.buildConfig.protocol}://localhost:9081`,
      `${this.buildConfig.protocol}://${this.commonService.serverConfig.ip}:${this.commonService.serverConfig.port}`,
      `${this.buildConfig.protocol}://${this.commonService.serverConfig.ip}:9080`,
      `${this.buildConfig.protocol}://${this.commonService.serverConfig.ip}:9081`,
    ]

    this.httpApp.use(express.static(path.resolve(__dirname, '../web'), {
      setHeaders: (res, path: string, stat: any) => {
        if (path.indexOf('static') == -1) {
          res.header('Cross-Origin-Embedder-Policy', 'require-corp')
          res.header('Cross-Origin-Opener-Policy', 'same-origin')
        } else {
          res.header('Cross-Origin-Opener-Policy', 'same-origin')
          res.header('Cross-Origin-Resource-Policy', 'cross-origin')
          res.header('Access-Control-Allow-Origin', '*')
        }
      }
    }))

    this.httpApp.use('/_res', express.static(path.join(USER_DATA_DIR, './static'), {
      setHeaders: (res, path: string, stat: any) => {
        res.header('Cross-Origin-Opener-Policy', 'same-origin')
        res.header('Cross-Origin-Resource-Policy', 'cross-origin')
        res.header('Access-Control-Allow-Origin', '*')
      }
    }))


    this.httpApp.use(cors(this.corsOpt))
    this.httpApp.use(compression())
    this.httpApp.use(express.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }))
    this.httpApp.use(express.text({ type: 'application/json', limit: '50mb' }))
    this.httpApp.use(express.json())
    this.httpApp.use(fileUpload())

    this.httpApp.use("/_appmock/*", new AppMockRouter().router)

    this.httpApp.use("*", (req: any, resp: Response) => {
      this.proxyService.handleStatRequest(req, resp)
    })
  }

  private async startHttpServer() {
    let HTTP: any
    let baseDir = process.env.NODE_ENV == 'development' ? '' : __dirname + '/'
    // console.log(this.buildConfig, baseDir)
    if (this.buildConfig.protocol == 'https') {
      HTTP = await import('https')
      var key = fs.readFileSync(baseDir + 'cert/private.key')
      var cert = fs.readFileSync(baseDir + 'cert/mydomain.crt')
      let opt = { key, cert }
      this.httpServer = HTTP.createServer(opt, this.httpApp)
    } else {
      HTTP = await import('http')
      this.httpServer = HTTP.createServer(this.httpApp)
    }
    this.pushService.bindServer(this.httpServer)
    this.httpServer.listen(
      this.commonService.serverConfig.port,
      '0.0.0.0',
      () => console.log(`--启动本地代理Http服务--[${this.commonService.serverConfig.port}]`)
    )
  }

  private handleRequest() {

    // this.httpApp.all("/^\/burying-point\//", (req: any, resp: Response) => {
    //   let buf = []
    //   req.on('data', (data: any) => { buf.push(data) })
    //   req.on('end', () => {
    //     req.rawbody = Buffer.concat(buf)
    //     this.app.get(ProxyService).handleStatRequest(req, resp)
    //   })
    // })
  }

}