import type { LocalServerConfig } from './base.models'
import type { ProxyMock } from './proxy.models'
import { get, post } from './base.api'
import { API_URL } from './api.const'

// 客户端 HTTP API：依赖 axios / vant，仅限渲染进程使用；
// 主进程请从 './proxy.models' 引入纯模型。

export function searchMockRules(keyword: string) {
  return get<Array<ProxyMock.MockRule>>(`${API_URL.AppMock}${API_URL.SearchMockRules}`, null, { keyword })
}

export function getMockRuleDetail(ruleId: string) {
  return get<ProxyMock.MockRule>(`${API_URL.AppMock}${API_URL.GetMockRuleDetail}`, null, { ruleId })
}

export function getActiveMockRule() {
  return get<string>(`${API_URL.AppMock}${API_URL.GetActiveMockRule}`)
}

export function saveMockRule(mockRule: ProxyMock.MockRule) {
  return post<string>(`${API_URL.AppMock}${API_URL.SaveMockRule}`, null, null, mockRule)
}

export function deleteMockRule(ruleId: string) {
  return post<string>(`${API_URL.AppMock}${API_URL.DeleteMockRule}`, null, { ruleId })
}

// recordKey 是修改前的 key；与 record.url 不同时服务端会把它当作改 URL 处理
export function saveMockRecord(ruleId: string, recordKey: string, record: ProxyMock.ProxyRequestRecord) {
  return post<string>(`${API_URL.AppMock}${API_URL.SaveMockRecord}`, null, { ruleId, recordKey }, record)
}

export function deleteMockRecord(ruleId: string, recordKey: string) {
  return post<string>(`${API_URL.AppMock}${API_URL.DeleteMockRecord}`, null, { ruleId, recordKey })
}

export function getMockRecords(ruleId: string, offset: number, limit: number) {
  return get<ProxyMock.MockRecordPage>(`${API_URL.AppMock}${API_URL.GetMockRecords}`, null, { ruleId, offset, limit })
}

export function getServerConfig() {
  return get<LocalServerConfig>(`${API_URL.AppMock}${API_URL.GetServerConfig}`)
}

export async function saveProxyConfig(uid: string, config: Partial<ProxyMock.ProxyConfig>) {
  return post<string>(`${API_URL.AppMock}${API_URL.SaveProxyConfig}`, null, { uid }, config)
}

export function getProxyConfig(uid: string) {
  return get<ProxyMock.ProxyConfig>(`${API_URL.AppMock}${API_URL.GetProxyConfig}`, null, { uid })
}

export function getAllPushClients() {
  return get<Array<ProxyMock.MsgPushClient>>(`${API_URL.AppMock}${API_URL.GetAllPushClients}`)
}

export function mockRegister(uid: string) {
  return get<ProxyMock.RegisterResult>(`${API_URL.AppMock}${API_URL.MockRegister}/${uid}`)
}

export function broadcast(uid: string) {
  return get<string>(`${API_URL.AppMock}${API_URL.Broadcast}/${uid}`)
}
