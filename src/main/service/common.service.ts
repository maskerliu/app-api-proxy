import { app } from 'electron'
import { accessSync, readFileSync, writeFileSync } from 'fs'
import { inject, injectable } from "inversify"
import path from 'path'
import "reflect-metadata"
import { LocalServerConfig, ProxyMock } from '../../common'
import { IocTypes, Lynx_Mqtt_Broker, USER_DATA_DIR } from '../MainConst'
import { getLocalIPs } from '../utils/NetworkUtils'
import { IProxyService } from './proxy.service'
import { IPushService } from './push.service'

export interface ICommonService {
  serverConfig: LocalServerConfig

  register(uid: string): string

  getServerConfig(): LocalServerConfig

  saveServerConfig(config: LocalServerConfig): void

}

@injectable()
export class CommonService implements ICommonService {

  serverConfig: LocalServerConfig

  @inject(IocTypes.ProxyService)
  private proxyService: IProxyService
  @inject(IocTypes.PushService)
  private pushService: IPushService

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
        platform: process.platform,
        arch: process.arch,
        updateServer: config.updateServer,
        protocol: config.protocol,
        ip: getLocalIPs()[0].address,
        port: config.port,
        domain: config.domain,
        ips: getLocalIPs(),
        mqttBroker: Lynx_Mqtt_Broker
      }
    }
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

  getServerConfig() {
    return this.serverConfig
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
      this.serverConfig.ip = config.ip
      writeFileSync(filePath, JSON.stringify(this.serverConfig), 'utf-8')
    }
  }
}