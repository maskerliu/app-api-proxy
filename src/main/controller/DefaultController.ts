import { MockService } from '../service/MockMgr'
import { Controller } from '../decorators/Controller'
import { router } from '../AppRouter'

@Controller
export class DefaultController {


  mockService: MockService

  selectInforByPhone = router.post('/api/login/loginByPassWord', (req: Request, resp: Response) => {
    //...
  })

  registerByPhone = router.post('/api/register/registerByPhone', (req: Request, resp: Response) => {
    //...
  })

  async home() {
    return "Hello Midwayjs!";
  }

  // @Get('/getServerConfig')
  // async getServerConfig() {

  // }

  // @Post('/saveServerConfig')
  // async saveServerConfig() {

  // }

  // @Get('/searchMockRules')
  // async searchMockRules() {
  //   this.mockService.getMockRule('')
  // }

}