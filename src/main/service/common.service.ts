import { Autowired, Service } from 'lynx-express-mvc'
import { LocalServerConfig } from '../../common/base.models'
import { ProxyMock } from '../../common/proxy.models'
import { getLocalIPs } from '../utils/NetworkUtils'
import ProxyService from './proxy.service'
import PushService from './push.service'

import { Lynx_Mqtt_Broker } from '../common/Const'

@Service()
export default class CommonService {

  @Autowired()
  proxyService: ProxyService

  @Autowired()
  pushService: PushService

  serverConfig: LocalServerConfig

  constructor() {
    let config = JSON.parse(process.env.BUILD_CONFIG)
    this.serverConfig = {
      ip: getLocalIPs()[0].address,
      port: config.port,
      ips: getLocalIPs(),
      mqttBroker: Lynx_Mqtt_Broker
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
    this.proxyService.setDataProxyServer(uid, { dataServer: config.dataServer, status: config.status, delay: 0 })
    this.setServerConfig(config)
    return Object.assign(this.serverConfig, this.proxyService.getDataProxyServer(uid))
  }

  private setServerConfig(config: LocalServerConfig) {
    Object.assign(this.serverConfig, config)
  }
}