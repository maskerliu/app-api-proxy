import { get, post } from './base.api'
import { LocalServerConfig } from './base.models'
import { ProxyMock } from './proxy.models'


export function searchMockRules(keyword: string) {
  return get<Array<ProxyMock.MockRule>>('/appmock/searchMockRules', null, { keyword })
}

export function getMockRuleDetail(ruleId: string) {
  return get<ProxyMock.MockRule>('/appmock/getMockRuleDetail', null, { ruleId })
}

export function saveMockRule(mockRule: ProxyMock.MockRule, onlySnap: boolean) {
  return post<string>('/appmock/saveMockRule', null, { onlySnap }, mockRule)
}

export function deleteMockRule(ruleId: string) {
  return post<string>('/appmock/deleteMockRule', null, { ruleId })
}

export function getServerConfig() {
  return get<LocalServerConfig>('/appmock/getServerConfig')
}

export async function saveProxyConfig(config: Partial<ProxyMock.ProxyConfig>) {
  return post<string>('/appmock/saveProxyConfig', null, null, config)
}

export function getAllPushClients() {
  return get<Array<ProxyMock.MsgPushClient>>('/appmock/getAllPushClients')
}

export function mockRegister() {
  return post<string>('/appmock/register')
}