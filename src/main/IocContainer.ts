import { Container } from 'inversify'
import { IocTypes } from './MainConst'
import { MockRepo } from './repository/mock.repo'
import { AppMockRouter, ProxyRouter } from './router'
import { MockCache } from './service/mock.cache'
import {
  CommonService, DiagnosticService, MockService, ProxyService, PushService, SocketProxyService,
} from './service'

const bizContainer = new Container({ defaultScope: 'Singleton' })
bizContainer.bind<AppMockRouter>(IocTypes.AppMockRouter).to(AppMockRouter)
bizContainer.bind<ProxyRouter>(IocTypes.ProxyRouter).to(ProxyRouter)
bizContainer.bind<CommonService>(IocTypes.CommonService).to(CommonService)
bizContainer.bind<MockService>(IocTypes.MocksService).to(MockService)
bizContainer.bind<PushService>(IocTypes.PushService).to(PushService)
bizContainer.bind<ProxyService>(IocTypes.ProxyService).to(ProxyService)
bizContainer.bind<SocketProxyService>(IocTypes.SocketProxyService).to(SocketProxyService)
bizContainer.bind<DiagnosticService>(IocTypes.DiagnosticService).to(DiagnosticService)
bizContainer.bind<MockRepo>(IocTypes.MockRepo).to(MockRepo)
bizContainer.bind<MockCache>(IocTypes.MockCache).to(MockCache)

export { bizContainer }
