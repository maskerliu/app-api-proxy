import { app, nativeTheme } from 'electron'
import { accessSync, readFileSync, writeFileSync } from 'fs'
import { inject, injectable } from 'inversify'
import path from 'path'
import 'reflect-metadata'
import { LocalServerConfig, ProxyMock } from '../../common'
import { IocTypes, Lynx_Mqtt_Broker, USER_DATA_DIR } from '../MainConst'
import { getLocalIPs } from '../misc/network.utils'
import { ProxyService, PushService } from './'

interface ICommonService {
  get serverConfig(): LocalServerConfig
  set serverConfig(config: LocalServerConfig)

  register(uid: string): string

  getServerConfig(): LocalServerConfig

  saveServerConfig(config: LocalServerConfig): void
}

@injectable()
export class CommonService implements ICommonService {

  private _serverConfig: LocalServerConfig

  get serverConfig() {
    return this._serverConfig
  }

  set serverConfig(config: LocalServerConfig) {
    this._serverConfig = config
  }

  @inject(IocTypes.ProxyService)
  private proxyService: ProxyService
  @inject(IocTypes.PushService)
  private pushService: PushService

  constructor() {
    let filePath = path.join(USER_DATA_DIR, 'local.config.json')
    try {
      accessSync(filePath)
    } catch (err) {
      console.log('file not exist')
      writeFileSync(filePath, process.env.BUILD_CONFIG, 'utf-8')
    } finally {
      let data = readFileSync(filePath, 'utf-8')
      let config = JSON.parse(data)
      this.serverConfig = {
        appVersion: app.getVersion(),
        theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
        locales: app.getLocale(),
        platform: process.platform,
        arch: process.arch,
        updateServer: config.updateServer,
        protocol: config.protocol ? config.protocol : 'http',
        ip: getLocalIPs()[0]?.address,
        port: config.port ? config.port : 8884,
        portValid: config.portValid,
        domain: config.domain,
        ips: getLocalIPs(),
        mqttBroker: Lynx_Mqtt_Broker
      }
    }
  }
  getServerConfig(): LocalServerConfig {
    return this._serverConfig
  }

  public register(uid: string) {
    if (uid != null) {
      let data: ProxyMock.PushMsg<any> = {
        type: ProxyMock.PushMsgType.CMD,
        payload: {
          type: ProxyMock.CMDType.REGISTER,
          content: uid
        }
      }
      this.pushService.sendMessage(uid, data)
      return '注册成功'
    } else {
      throw 'invalid uid'
    }
  }

  saveServerConfig(config: LocalServerConfig) {
    let filePath = path.join(USER_DATA_DIR, 'local.config.json')
    try {
      accessSync(filePath)
    } catch (err) {
      console.log('file not exist')
    } finally {
      this.serverConfig.updateServer = config.updateServer
      this.serverConfig.apiDefineServer = config.apiDefineServer
      this.serverConfig.statRuleServer = config.statRuleServer
      this.serverConfig.dataServer = config.dataServer
      this.serverConfig.domain = config.domain
      this.serverConfig.port = Number.parseInt(config.port as any)
      this.serverConfig.portValid = config.portValid as boolean
      this.serverConfig.ip = config.ip
      this.serverConfig.protocol = config.protocol
      writeFileSync(filePath, JSON.stringify(this.serverConfig), 'utf-8')
    }
  }
}