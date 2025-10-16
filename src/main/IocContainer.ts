import { Container } from 'inversify'
import { IocTypes } from './MainConst'
import { IMockRepo, MockRepo } from './repository/mock.repo'
import { AppMockRouter, MapiRouter, ProxyRouter } from './router'
import { CommonService, ICommonService, IMapiService, IMockService, IProxyService, IPushService, MapiService, MockService, ProxyService, PushService } from './service'

const bizContainer = new Container({ defaultScope: 'Singleton' })
bizContainer.bind<MapiRouter>(IocTypes.MapiRouter).to(MapiRouter)
bizContainer.bind<AppMockRouter>(IocTypes.AppMockRouter).to(AppMockRouter)
bizContainer.bind<ProxyRouter>(IocTypes.ProxyRouter).to(ProxyRouter)
bizContainer.bind<IMapiService>(IocTypes.MapiService).to(MapiService)
bizContainer.bind<ICommonService>(IocTypes.CommonService).to(CommonService)
bizContainer.bind<IMockService>(IocTypes.MocksService).to(MockService)
bizContainer.bind<IPushService>(IocTypes.PushService).to(PushService)
bizContainer.bind<IProxyService>(IocTypes.ProxyService).to(ProxyService)
bizContainer.bind<IMockRepo>(IocTypes.MockRepo).to(MockRepo)

export { bizContainer }

