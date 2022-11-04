import { Autowired, Service } from 'lynx-express-mvc'
import { BizCode, BizResponse, LocalServerConfig } from '../../common/base.models'
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
    let bizResp: BizResponse<string>
    if (uid != null) {
      bizResp = { code: BizCode.SUCCESS, data: '注册成功' }

      let data: ProxyMock.PushMsg<any> = {
        type: ProxyMock.PushMsgType.CMD,
        payload: {
          type: ProxyMock.CMDType.REGISTER,
          content: uid
        }
      }
      this.pushService.sendMessage(uid, data)
    } else {
      bizResp = { code: BizCode.FAIL, message: 'invalid uid' }
    }
    return bizResp
  }

  getServerConfig() {
    return { code: BizCode.SUCCESS, data: this.serverConfig }
  }

  saveServerConfig(uid: string, config: LocalServerConfig) {
    this.proxyService.setDataProxyServer(uid, { dataServer: config.dataServer, status: config.status, delay: 0 })
    this.setServerConfig(config)
    let bizResp: BizResponse<LocalServerConfig> = {
      code: BizCode.SUCCESS,
      data: Object.assign(this.serverConfig, this.proxyService.getDataProxyServer(uid))
    }
    return bizResp
  }

  private setServerConfig(config: LocalServerConfig) {
    Object.assign(this.serverConfig, config)
  }
}