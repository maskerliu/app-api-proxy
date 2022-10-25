import { BizCode, BizResponse, CMDType, LocalServerConfig, PushMsg, PushMsgType } from '../../common/models'
import { Autowired } from '../common/decorators/ioc.decorators'
import { Service } from '../common/decorators/webmvc.decorators'
import { getLocalIPs } from '../utils/NetworkUtils'
import ProxyService from './ProxyService'
import PushService from './PushService'


@Service()
export default class CommonService {

  @Autowired()
  proxyService: ProxyService

  @Autowired()
  pushService: PushService

  serverConfig: LocalServerConfig

  constructor() {
    this.serverConfig = {
      ip: getLocalIPs()[0].address,
      port: 8885,
      ips: getLocalIPs()
    }
  }

  public register(uid: string) {
    let bizResp: BizResponse<string>
    if (uid != null) {
      bizResp = { code: BizCode.SUCCESS, data: '注册成功' }

      let data: PushMsg<any> = {
        type: PushMsgType.CMD,
        payload: {
          type: CMDType.REGISTER,
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