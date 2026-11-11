import { app } from 'electron'

export const IS_DEV = process.env.NODE_ENV === 'development'
export const USER_DATA_DIR = app.getPath('userData')

export const APP_NAME = 'AppApiProxy'

export const IOC_TYPES = {
  AppMockRouter: Symbol.for('AppMockRouter'),
  ProxyRouter: Symbol.for('ProxyRouter'),
  CommonService: Symbol.for('CommonService'),
  PushService: Symbol.for('PushService'),
  MocksService: Symbol.for('MockService'),
  ProxyService: Symbol.for('ProxyService'),
  SocketProxyService: Symbol.for('SocketProxyService'),
  DiagnosticService: Symbol.for('DiagnosticService'),
  MockRepo: Symbol.for('MockRepo'),
  MockCache: Symbol.for('MockCache'),
  MockMigration: Symbol.for('MockMigration')
}