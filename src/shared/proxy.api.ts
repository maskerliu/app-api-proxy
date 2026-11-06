import type { LocalServerConfig } from './base.models'
import type { Diagnostic } from './diagnostic.models'
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

// 全量保存记录；传 expectedUpdatedAt 时启用乐观锁，冲突返回错误
export function saveMockRecord(record: ProxyMock.MockRecord, expectedUpdatedAt?: number) {
  return post<ProxyMock.MockRecordSaveResult>(
    `${API_URL.AppMock}${API_URL.SaveMockRecord}`, null, { expectedUpdatedAt }, record)
}

export function deleteMockRecord(recordId: string) {
  return post<boolean>(`${API_URL.AppMock}${API_URL.DeleteMockRecord}`, null, { recordId })
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

export function getHealth() {
  return get<Diagnostic.HealthInfo>(`${API_URL.AppMock}${API_URL.Health}`)
}

export function diagnose(target: string) {
  return post<Diagnostic.DiagnoseResult>(`${API_URL.AppMock}${API_URL.Diagnose}`, null, { target })
}

export function mockRegister(uid: string) {
  return get<ProxyMock.RegisterResult>(`${API_URL.AppMock}${API_URL.MockRegister}/${uid}`)
}

export function broadcast(uid: string) {
  return get<string>(`${API_URL.AppMock}${API_URL.Broadcast}/${uid}`)
}
