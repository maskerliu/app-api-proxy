import { Container } from 'inversify'
import { IOC_TYPES } from './constants'
import { MockRepo } from './repository/mock.repo'
import { AppMockRouter, ProxyRouter } from './router'
import { MockCache } from './service/mock.cache'
import { MockMigrationRunner } from './service/mock.migration.runner'
import {
  CommonService, DiagnosticService, MockService, ProxyService, PushService, SocketProxyService,
} from './service'

const bizContainer = new Container({ defaultScope: 'Singleton' })
bizContainer.bind<AppMockRouter>(IOC_TYPES.AppMockRouter).to(AppMockRouter)
bizContainer.bind<ProxyRouter>(IOC_TYPES.ProxyRouter).to(ProxyRouter)
bizContainer.bind<CommonService>(IOC_TYPES.CommonService).to(CommonService)
bizContainer.bind<MockService>(IOC_TYPES.MocksService).to(MockService)
bizContainer.bind<PushService>(IOC_TYPES.PushService).to(PushService)
bizContainer.bind<ProxyService>(IOC_TYPES.ProxyService).to(ProxyService)
bizContainer.bind<SocketProxyService>(IOC_TYPES.SocketProxyService).to(SocketProxyService)
bizContainer.bind<DiagnosticService>(IOC_TYPES.DiagnosticService).to(DiagnosticService)
bizContainer.bind<MockRepo>(IOC_TYPES.MockRepo).to(MockRepo)
bizContainer.bind<MockCache>(IOC_TYPES.MockCache).to(MockCache)
bizContainer.bind<MockMigrationRunner>(IOC_TYPES.MockMigration).to(MockMigrationRunner)

export { bizContainer }
