import axios, { AxiosRequestConfig, HttpStatusCode, Method, ResponseType } from 'axios'
import compression from 'compression'
import cors, { CorsOptions } from 'cors'
import express, { Application, Request, Response } from 'express'
import fileUpload from 'express-fileupload'
import fs from 'fs'
import { Server } from 'http'
import path from 'path'
import tcpPortUsed from 'tcp-port-used'
import { LocalServerConfig } from '../common/base.models'
import { bizContainer } from './IocContainer'
import { IocTypes, USER_DATA_DIR } from './MainConst'
import { AppMockRouter } from './router/AppMockRouter'
import { ICommonService, IProxyService, IPushService } from './service'

export class MainServer {

  private buildConfig = JSON.parse(process.env.BUILD_CONFIG)

  private httpServer: Server
  private httpApp: Application

  private appmockRouter: AppMockRouter
  private commonService: ICommonService
  private proxyService: IProxyService
  private pushService: IPushService

  bootstrap() {
    this.appmockRouter = bizContainer.get(IocTypes.AppMockRouter)
    this.commonService = bizContainer.get(IocTypes.CommonService)
    this.pushService = bizContainer.get(IocTypes.PushService)
    this.proxyService = bizContainer.get(IocTypes.ProxyService)
  }

  private corsOpt: CorsOptions = {
    credentials: true,
    optionsSuccessStatus: 200,
  }

  public async start() {

    let portUsed = await tcpPortUsed.check(this.commonService.serverConfig.port, '127.0.0.1')
    console.group("port used", portUsed)

    this.initHttpServer()

    if (this.httpServer != null) {
      this.httpServer.close(() => { this.httpServer = null })
    }

    this.startHttpServer()
  }

  public getSysSettings() {
    return this.commonService.getServerConfig()
  }

  public updateSysSettings(config: LocalServerConfig) {
    this.commonService.saveServerConfig(config)
  }

  public async stop() {
    this.httpServer.close()
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

    this.httpApp.use('/appmock', this.appmockRouter.router)

    this.httpApp.use('/mediaproxy', (req: any, resp: Response) => {
      this.proxyCorsMedia(req, resp)
    })

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
    }
    this.pushService.bindServer(this.httpServer)

    this.httpServer.addListener('close', () => {
      console.log('close http server')
    })

    this.httpServer.addListener('error', (err: Error) => {
      console.log(err)
    })

    this.httpServer.listen(
      this.commonService.serverConfig.port,
      '0.0.0.0',
      () => console.log(`--启动本地代理Http服务--[${this.commonService.serverConfig.port}]`)
    )

  }

  private handleRequest(req: any, resp: Response) {
    if (/^\/appmock\//.test(req.path)) return
    if (/^\/burying-point\//.test(req.path)) {
      let buf = []
      req.on('data', (data: any) => { buf.push(data) })
      req.on('end', () => {
        req.rawbody = Buffer.concat(buf)
        this.proxyService.handleStatRequest(req, resp)
      })
    } else {
      this.proxyService.handleRequest(req, resp)
    }
  }

  private async proxyCorsMedia(req: Request, resp: Response) {
    // req.pipe(request(req.query['target'])).pipe(resp)
    try {
      let target = req.query['target']
      let type = req.query['type'] as ResponseType
      console.log(`proxy media res: ${target}`)
      let options: AxiosRequestConfig = {
        url: target as string,
        method: req.method as Method,
        responseType: type
      }
      let proxyResp = await axios(options)

      Object.keys(proxyResp.headers).forEach(it => {
        // if (it !== 'content-length') 
        if (it == 'cache-control') return
        if (it == 'expires') return

        resp.setHeader(it, proxyResp.headers[it])
      })
      resp.status(proxyResp.status)
      switch (type) {
        case 'arraybuffer':
        case 'stream':
          resp.end(proxyResp.data.toString('binary'), 'binary')
          break
        // case 'stream':
        //   proxyResp.data.pipe(resp)
        //   break
        default:
          resp.end()
      }

      // resp.send(proxyResp.data)
      // proxyResp.data.pipe(resp)
    } catch (err) {
      console.error(err)
      resp.status(HttpStatusCode.InternalServerError)
      resp.send(err)
    } finally {
      resp.end()
    }
  }

}