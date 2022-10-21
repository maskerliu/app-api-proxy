
import { BizCode, BizResponse, CMDType, MockRule, MsgPushClient, PushMsg, PushMsgType } from '../../common/models'
import { BodyParam, Controller, Get, Post, QueryParam } from '../common/decorators/WebMVC.decorators'
import commonService from '../service/CommonService'
import mockService from '../service/MockService'
import proxyService from '../service/ProxyService'
import pushService from '../service/PushService'

@Controller('/appmock')
export default class DefaultController {

  @Post('/register')
  async register(@QueryParam("uid") uid: string) {
    let bizResp: BizResponse<string>
    try {
      if (uid == null) throw 'uid不能为空'
      let data: PushMsg<any> = {
        type: PushMsgType.CMD,
        payload: { type: CMDType.REGISTER, content: uid }
      }
      pushService.sendMessage(uid, data)
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

    pushService.pushClients.forEach(it => {
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
    return commonService.getServerConfig()
  }

  @Get('/setProxyDelay')
  async setProxyDelay(@QueryParam('uid') uid: string, @QueryParam('delay') delay: number) {
    // let uid = req.query["uid"] as string
    // let delay = Number.parseInt(req.query["delay"] as string)
    return proxyService.setProxyDelay(uid, delay)
  }

  @Get('/searchMockRules')
  async searchMockRules(@QueryParam('uid') uid: string, @QueryParam('keyword') keyword: string) {
    return mockService.searchMockRules(uid, keyword)
  }

  @Get('/getMockRuleDetail')
  async getMockRuleDetail(@QueryParam('uid') uid: string, @QueryParam('ruleId') ruleId: string) {
    return await mockService.getMockRuleDetail(uid, ruleId)
  }

  @Post('/saveMockRule')
  async saveMockRule(@QueryParam('uid') uid: string, @QueryParam('onlySnap') onlySnap: string, @BodyParam() rule: MockRule) {
    // let rule: MockRule = JSONBigInt.parse(req.body)
    return await mockService.saveMockRule(uid, onlySnap == 'true', rule)
  }

  @Get('/deleteMockRule')
  async deleteMockRule(@QueryParam('uid') uid: string, @QueryParam('ruleId') ruleId: string) {
    return await mockService.deleteMockRule(uid, ruleId)
  }

  async test(req: string, resp: string) {
    return `${req} ${resp}`
  }
}