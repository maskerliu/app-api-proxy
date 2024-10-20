
import { NestFactory } from '@nestjs/core'
import compression from 'compression'
import cors, { CorsOptions } from 'cors'
import express, { Application, Response } from 'express'
import fileUpload from 'express-fileupload'
import fs from 'fs'
import path from 'path'
import si from 'systeminformation'
import { USER_DATA_DIR } from './common/Const'
import { CommonService, ProxyService, PushService } from './service'

import { MainModule } from './MainModule'
import { INestApplication } from '@nestjs/common'

export class MainServer {
  private buildConfig = JSON.parse(process.env.BUILD_CONFIG)

  private app: INestApplication
  private httpServer: any
  private httpApp: Application

  // constructor(
  //   private readonly commonService: CommonService,
  //   private readonly proxyService: ProxyService,
  //   private readonly pushService: PushService
  // ) {
  // }

  async bootstrap() {
    this.app = await NestFactory.create(MainModule)
    // await app.listen(process.env.PORT ?? 3000)
  }

  private corsOpt: CorsOptions = {
    credentials: true,
    optionsSuccessStatus: 200,
  }

  public async start() {

    let info = await si.baseboard()
    console.log(info)

    this.initHttpServer()

    if (this.httpServer != null) {
      this.httpServer.close(() => { this.httpServer = null })
    }
    this.startHttpServer()
  }

  private initHttpServer() {
    this.httpApp = express()

    console.log("server ip", this.app.get(CommonService).serverConfig.ip)
    this.corsOpt.origin = [
      `${this.buildConfig.protocol}://localhost:${this.app.get(CommonService).serverConfig.port}`,
      `${this.buildConfig.protocol}://localhost:9080`,
      `${this.buildConfig.protocol}://localhost:9081`,
      `${this.buildConfig.protocol}://${this.app.get(CommonService).serverConfig.ip}:${this.app.get(CommonService).serverConfig.port}`,
      `${this.buildConfig.protocol}://${this.app.get(CommonService).serverConfig.ip}:9080`,
      `${this.buildConfig.protocol}://${this.app.get(CommonService).serverConfig.ip}:9081`,
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
    this.httpApp.all('*', (req: any, resp: Response) => { this.handleRequest(req, resp) })
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
      this.app.get(PushService).bindServer(this.httpServer)
    }
    this.app.get(PushService).bindServer(this.httpServer)
    this.httpServer.listen(
      this.app.get(CommonService).serverConfig.port,
      '0.0.0.0',
      () => console.log(`--启动本地代理Http服务--[${this.app.get(CommonService).serverConfig.port}]`)
    )
  }

  private handleRequest(req: any, resp: Response) {
    if (/^\/burying-point\//.test(req.path)) {
      let buf = []
      req.on('data', (data: any) => { buf.push(data) })
      req.on('end', () => {
        req.rawbody = Buffer.concat(buf)
        this.app.get(ProxyService).handleStatRequest(req, resp)
      })
    } else {
      this.app.get(ProxyService).handleRequest(req, resp)
    }
  }

}