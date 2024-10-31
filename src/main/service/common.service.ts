import { inject, injectable } from "inversify"
import "reflect-metadata"
import { LocalServerConfig } from '../../common/base.models'
import { ProxyMock } from '../../common/proxy.models'
import { IocTypes, Lynx_Mqtt_Broker } from '../common/Const'
import { findIp, getLocalIPs } from '../utils/NetworkUtils'
import { ProxyPref, ProxyService } from "./proxy.service"
import { PushService } from './push.service'

export interface ICommonService {
  register(uid: string): string

  getServerConfig(): LocalServerConfig

  saveServerConfig(uid: string, config: LocalServerConfig): "" | (LocalServerConfig & ProxyPref)
}

@injectable()
export class CommonService implements ICommonService {

  @inject(IocTypes.ProxyService)
  private proxyService: ProxyService
  @inject(IocTypes.PushService)
  private pushService: PushService

  constructor() {
    let config = JSON.parse(process.env.BUILD_CONFIG)
    this.serverConfig = {
      // ip: getLocalIPs()[0].address,
      ip: findIp('v4'),
      port: config.port,
      ips: getLocalIPs(),
      mqttBroker: Lynx_Mqtt_Broker
    }
  }

  serverConfig: LocalServerConfig

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