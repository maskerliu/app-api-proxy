import { Container } from 'inversify'
import { IocTypes } from './MainConst'
import { MockRepo } from './repository/mock.repo'
import { AppMockRouter, MapiRouter, ProxyRouter } from './router'
import { CommonService, MapiService, MockService, ProxyService, PushService } from './service'

const bizContainer = new Container({ defaultScope: 'Singleton' })
bizContainer.bind<MapiRouter>(IocTypes.MapiRouter).to(MapiRouter)
bizContainer.bind<AppMockRouter>(IocTypes.AppMockRouter).to(AppMockRouter)
bizContainer.bind<ProxyRouter>(IocTypes.ProxyRouter).to(ProxyRouter)
bizContainer.bind<MapiService>(IocTypes.MapiService).to(MapiService)
bizContainer.bind<CommonService>(IocTypes.CommonService).to(CommonService)
bizContainer.bind<MockService>(IocTypes.MocksService).to(MockService)
bizContainer.bind<PushService>(IocTypes.PushService).to(PushService)
bizContainer.bind<ProxyService>(IocTypes.ProxyService).to(ProxyService)
bizContainer.bind<MockRepo>(IocTypes.MockRepo).to(MockRepo)

export { bizContainer }

