
import bodyParser from 'body-parser'
import compression from 'compression'
import cors, { CorsOptions } from 'cors'
import { app } from 'electron'
import express, { Application, Response } from 'express'
import fs from 'fs'
import fileUpload from 'express-fileupload'
import { Autowired, Component } from 'lynx-express-mvc'
import path from 'path'

import MainRouter from './MainRouter'
import CommonService from './service/common.service'
import IOTDeviceMgrService from './service/iot.deviceMgr.service'
import ProxyService from './service/proxy.service'
import PushService from './service/push.service'

import si from 'systeminformation'
import { USER_DATA_DIR } from './common/Const'

@Component()
class LocalServer {
  private buildConfig = JSON.parse(process.env.BUILD_CONFIG)

  private httpServer: any
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

  private corsOpt: CorsOptions = {
    credentials: true,
    optionsSuccessStatus: 200,
  }
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
    this.corsOpt.origin = [
      `${this.buildConfig.protocol}://localhost:${this.commonService.serverConfig.port}`,
      `${this.buildConfig.protocol}://localhost:9080`,
      `${this.buildConfig.protocol}://localhost:9081`,
      `${this.buildConfig.protocol}://${this.commonService.serverConfig.ip}:${this.commonService.serverConfig.port}`,
      `${this.buildConfig.protocol}://${this.commonService.serverConfig.ip}:9080`,
      `${this.buildConfig.protocol}://${this.commonService.serverConfig.ip}:9081`,
      'https://maskerliu-turbo-palm-tree-jrjxv9xq6gfqpgv-8884.preview.app.github.dev/',
      'https://maskerliu-turbo-palm-tree-jrjxv9xq6gfqpgv-9080.preview.app.github.dev/',
      'https://maskerliu-turbo-palm-tree-jrjxv9xq6gfqpgv-9081.preview.app.github.dev/'
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
    console.log(this.buildConfig, baseDir)
    if (this.buildConfig.protocol == 'https') {
      HTTP = await import('https')
      var key = fs.readFileSync(baseDir + 'cert/private.key')
      var cert = fs.readFileSync(baseDir + 'cert/mydomain.crt')
      let opt = { key, cert }
      this.httpServer = HTTP.createServer(opt, this.httpApp)
    } else {
      HTTP = await import('http')
      this.httpServer = HTTP.createServer(this.httpApp)
      this.pushService.bindServer(this.httpServer)
    }

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

export default localServer as LocalServer