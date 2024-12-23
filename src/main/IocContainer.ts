import { Container, BindingScopeEnum } from 'inversify'
import { IocTypes } from './MainConst'
import { IMockRepo, MockRepo } from './repository/mock.repo'
import { CommonService, ICommonService } from './service/common.service'
import { IMockService, MockService } from './service/mock.service'
import { IProxyService, ProxyService } from './service/proxy.service'
import { IPushService, PushService } from './service/push.service'
import { AppMockRouter } from './router/AppMockRouter'

const bizContainer = new Container({ defaultScope: BindingScopeEnum.Singleton })
bizContainer.bind<AppMockRouter>(IocTypes.AppMockRouter).to(AppMockRouter)
bizContainer.bind<ICommonService>(IocTypes.CommonService).to(CommonService)
bizContainer.bind<IMockService>(IocTypes.MocksService).to(MockService)
bizContainer.bind<IPushService>(IocTypes.PushService).to(PushService)
bizContainer.bind<IProxyService>(IocTypes.ProxyService).to(ProxyService)
bizContainer.bind<IMockRepo>(IocTypes.MockRepo).to(MockRepo)

export { bizContainer }

