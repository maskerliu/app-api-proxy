import { Controller, Get, QueryParam } from "../../common/decorators/WebMVC.decorators";


@Controller('/test')
export default class TestController {

  @Get('/hello')
  async hello(@QueryParam('user') name: string) {
    return `hello ${name}`
  }
}