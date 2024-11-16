import { inject, injectable } from "inversify"
import "reflect-metadata"
import { LocalServerConfig } from '../../common/base.models'
import { ProxyMock } from '../../common/proxy.models'
import { IocTypes, Lynx_Mqtt_Broker, USER_DATA_DIR } from '../MainConst'
import { findIp, getLocalIPs } from '../utils/NetworkUtils'
import { IProxyService, ProxyPref } from './proxy.service'
import { IPushService } from './push.service'
import { accessSync, existsSync, readFile, readFileSync, writeFileSync } from 'fs'
import path from 'path'

export interface ICommonService {
  serverConfig: LocalServerConfig

  register(uid: string): string

  getServerConfig(): LocalServerConfig

  saveServerConfig(uid: string, config: LocalServerConfig): "" | (LocalServerConfig & ProxyPref)
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
      console.log('read from local', config)
      this.serverConfig = {
        protocol: config.protocol,
        ip: getLocalIPs()[0].address,
        port: config.port,
        domain: config.domain,
        ips: getLocalIPs(),
        mqttBroker: Lynx_Mqtt_Broker
      }

      console.log("hello", this.serverConfig.ip)
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

  saveServerConfig(uid: string, config: LocalServerConfig) {
    if (this.proxyService == null) {
      console.log(`proxyService is null ${this.proxyService}`)
      return ""
    }
    this.proxyService.setDataProxyServer(uid, { dataServer: config.dataServer, status: config.status, delay: 0 })
    this.setServerConfig(config)
    return Object.assign(this.serverConfig, this.proxyService.getDataProxyServer(uid))
  }

  private setServerConfig(config: LocalServerConfig) {
    Object.assign(this.serverConfig, config)
  }
}