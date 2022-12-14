

import { Controller, Get, QueryParam, Autowired } from 'lynx-express-mvc'

import TestService from '../TestService'


@Controller('/test')
export default class TestController extends Object {

  constructor() {
    super()
    // this.test = ''
    // this.testService = new TestService()
  }

  @Autowired()
  test: string

  name: string

  @Autowired()
  testService: TestService

  @Get('/hello')
  async hello(@QueryParam('user') name: string) {
    try {
      return this.testService.test(name)
    } catch (err) {
      console.error(err)
      return err.toString()
    }

  }
}