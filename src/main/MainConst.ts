import { app } from 'electron'

export const IS_DEV = process.env.NODE_ENV === 'development'
export const Lynx_Mqtt_Broker = 'f9cc4cbec7c54744b1448fe4e6bfd274.s2.eu.hivemq.cloud'

export const USER_DATA_DIR = app.getPath('userData')

export const AppName = 'AppApiProxy'

export const IocTypes = {
  AppMockRouter: Symbol.for('AppMockRouter'),
  ProxyRouter: Symbol.for('ProxyRouter'),
  CommonService: Symbol.for('CommonService'),
  PushService: Symbol.for('PushService'),
  MocksService: Symbol.for('MockService'),
  ProxyService: Symbol.for('ProxyService'),
  SocketProxyService: Symbol.for('SocketProxyService'),
  DiagnosticService: Symbol.for('DiagnosticService'),
  MockRepo: Symbol.for('MockRepo'),
  MockCache: Symbol.for('MockCache')
}