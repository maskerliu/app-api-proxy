
import { BizCode, BizResponse, CMDType, MockRule, MsgPushClient, PushMsg, PushMsgType } from '../../common/models'
import { Autowired } from '../common/decorators/ioc.decorators'
import { BodyParam, Controller, Get, Post, QueryParam } from '../common/decorators/webmvc.decorators'
import CommonService from '../service/CommonService'
import MockService from '../service/MockService'
import ProxyService from '../service/ProxyService'
import PushService from '../service/PushService'

@Controller('/appmock')
export default class DefaultController {

  @Autowired()
  commonService: CommonService

  @Autowired()
  mockService: MockService

  @Autowired()
  proxyService: ProxyService

  @Autowired()
  pushService: PushService

  @Post('/register')
  async register(@QueryParam("uid") uid: string) {
    let bizResp: BizResponse<string>
    try {
      if (uid == null) throw 'uid不能为空'
      let data: PushMsg<any> = {
        type: PushMsgType.CMD,
        payload: { type: CMDType.REGISTER, content: uid }
      }
      this.pushService.sendMessage(uid, data)
      bizResp = { code: BizCode.SUCCESS, data: "注册成功" }
    } catch (err: any) {
      bizResp = { code: BizCode.ERROR, message: err }
    } finally {
      return bizResp
    }
  }

  @Get('/getAllPushClients')
  async getAllPushClients(@QueryParam("uid") uid: string) {
    let bizResp: BizResponse<Array<MsgPushClient>> = new BizResponse<Array<MsgPushClient>>()
    bizResp.code = BizCode.SUCCESS
    bizResp.data = []

    this.pushService.pushClients.forEach(it => {
      bizResp.data.push({
        key: it.conn.id,
        uid: it.uid,
        username: it.username,
        ip: it.conn.remoteAddress,
        port: it.conn.remotePort
      })
    })

    return bizResp
  }

  @Get('/getServerConfig')
  async getServerConfig() {
    return this.commonService.getServerConfig()
  }

  @Get('/setProxyDelay')
  async setProxyDelay(@QueryParam('uid') uid: string, @QueryParam('delay') delay: number) {
    // let uid = req.query["uid"] as string
    // let delay = Number.parseInt(req.query["delay"] as string)
    return this.proxyService.setProxyDelay(uid, delay)
  }

  @Get('/searchMockRules')
  async searchMockRules(@QueryParam('uid') uid: string, @QueryParam('keyword') keyword: string) {
    return this.mockService.searchMockRules(uid, keyword)
  }

  @Get('/getMockRuleDetail')
  async getMockRuleDetail(@QueryParam('uid') uid: string, @QueryParam('ruleId') ruleId: string) {
    return await this.mockService.getMockRuleDetail(uid, ruleId)
  }

  @Post('/saveMockRule')
  async saveMockRule(@QueryParam('uid') uid: string, @QueryParam('onlySnap') onlySnap: string, @BodyParam() rule: MockRule) {
    // let rule: MockRule = JSONBigInt.parse(req.body)
    return await this.mockService.saveMockRule(uid, onlySnap == 'true', rule)
  }

  @Get('/deleteMockRule')
  async deleteMockRule(@QueryParam('uid') uid: string, @QueryParam('ruleId') ruleId: string) {
    return await this.mockService.deleteMockRule(uid, ruleId)
  }

}