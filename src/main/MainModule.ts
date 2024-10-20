import { Module } from '@nestjs/common'
import DefaultController from './controller/default.controller'
import { MockService, CommonService, PushService, ProxyService } from './service'

@Module({
  imports: [],
  controllers: [DefaultController],
  providers: [MockService, CommonService, PushService, ProxyService],
})
export class MainModule { }
