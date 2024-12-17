import { app } from 'electron'


export const Lynx_Mqtt_Broker = 'f9cc4cbec7c54744b1448fe4e6bfd274.s2.eu.hivemq.cloud'

export const USER_DATA_DIR = app.getPath('userData')

export const IocTypes = {
  AppMockRouter: Symbol.for("AppMockRouter"),
  CommonService: Symbol.for("CommonService"),
  PushService: Symbol.for("PushService"),
  MocksService: Symbol.for("MockService"),
  ProxyService: Symbol.for("ProxyService"),
  MockRepo: Symbol.for("MockRepo")
}