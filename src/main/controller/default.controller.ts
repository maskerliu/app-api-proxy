
import { ProxyMock } from '../../common/proxy.models'
// import { CommonService, MockService, ProxyService, PushService } from '../service'

// @Controller('/appmock')
export default class DefaultController {

  // constructor(private readonly commonService: CommonService,
  //   private readonly mockService: MockService,
  //   private readonly proxyService: ProxyService,
  //   private readonly pushService: PushService
  // ) { }

  // @Post('register')
  // async register(@Param("uid") uid: string) {
  //   if (uid == null) throw 'uid不能为空'
  //   let data: ProxyMock.PushMsg<any> = {
  //     type: ProxyMock.PushMsgType.CMD,
  //     payload: { type: ProxyMock.CMDType.REGISTER, content: uid }
  //   }
  //   this.pushService.sendMessage(uid, data)
  //   return '注册成功'
  // }

  // @Get('getAllPushClients')
  // async getAllPushClients(@Param("uid") uid: string) {
  //   let data = []

  //   this.pushService.pushClients.forEach(it => {
  //     data.push({
  //       key: it.conn.id,
  //       uid: it.uid,
  //       username: it.username,
  //       ip: it.conn.remoteAddress,
  //       port: it.conn.remotePort
  //     })
  //   })

  //   return data
  // }

  // @Get('getServerConfig')
  // async getServerConfig(@Param('uid') uid: string) {
  //   return this.commonService.getServerConfig()
  // }

  // @Get('setProxyDelay')
  // async setProxyDelay(@Param('uid') uid: string, @Param('delay') delay: number) {
  //   // let uid = req.query["uid"] as string
  //   // let delay = Number.parseInt(req.query["delay"] as string)
  //   return this.proxyService.setProxyDelay(uid, delay)
  // }

  // @Get('searchMockRules')
  // async searchMockRules(@Param('uid') uid: string, @Param('keyword') keyword: string) {
  //   return this.mockService.searchMockRules(uid, keyword)
  // }

  // @Get('getMockRuleDetail')
  // async getMockRuleDetail(@Param('uid') uid: string, @Param('ruleId') ruleId: string) {
  //   return await this.mockService.getMockRuleDetail(uid, ruleId)
  // }

  // @Post('saveMockRule')
  // async saveMockRule(@Param('uid') uid: string, @Param('onlySnap') onlySnap: string, @Body() rule: ProxyMock.MockRule) {
  //   // let rule: MockRule = JSONBigInt.parse(req.body)
  //   return await this.mockService.saveMockRule(uid, onlySnap == 'true', rule)
  // }

  // @Get('deleteMockRule')
  // async deleteMockRule(@Param('uid') uid: string, @Param('ruleId') ruleId: string) {
  //   return await this.mockService.deleteMockRule(uid, ruleId)
  // }

}