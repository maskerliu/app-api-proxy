import { Injectable, Inject } from '@nestjs/common'
import { ProxyService, PushService } from '.'
import { LocalServerConfig } from '../../common/base.models'
import { ProxyMock } from '../../common/proxy.models'
import { Lynx_Mqtt_Broker } from '../common/Const'
import { getLocalIPs } from '../utils/NetworkUtils'

@Injectable()
export class CommonService {

  @Inject()
  private readonly proxyService: ProxyService

  @Inject()
  private readonly pushService: PushService

  constructor() {
    let config = JSON.parse(process.env.BUILD_CONFIG)
    this.serverConfig = {
      ip: getLocalIPs()[0].address,
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
    this.proxyService.setDataProxyServer(uid, { dataServer: config.dataServer, status: config.status, delay: 0 })
    this.setServerConfig(config)
    return Object.assign(this.serverConfig, this.proxyService.getDataProxyServer(uid))
  }

  private setServerConfig(config: LocalServerConfig) {
    Object.assign(this.serverConfig, config)
  }
}