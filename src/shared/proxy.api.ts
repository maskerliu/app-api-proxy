import type { LocalServerConfig } from './base.models'
import type { Diagnostic } from './diagnostic.models'
import type { ProxyMock } from './proxy.models'
import type {
  AnalyzeMockRequest, AnalyzeMockResponse, MatchMockRequest, MatchMockResponse,
  MigrationReport, MockMatchWarning, RevertMockRequest, RevertMockResponse,
} from './mock.models'
import { get, post, RequestOptions } from './base.api'
import { API_URL } from './api.const'

// 客户端 HTTP API：依赖 axios / vant，仅限渲染进程使用；
// 主进程请从 './proxy.models' 引入纯模型。

export function searchMockRules(keyword: string) {
  return get<Array<ProxyMock.MockRule>>(API_URL.SearchMockRules, null, { keyword })
}

export function getMockRuleDetail(ruleId: string) {
  return get<ProxyMock.MockRule>(API_URL.GetMockRuleDetail, null, { ruleId })
}

export function getActiveMockRule() {
  return get<string>(API_URL.GetActiveMockRule)
}

export function saveMockRule(mockRule: ProxyMock.MockRule) {
  return post<string>(API_URL.SaveMockRule, null, null, mockRule)
}

export function deleteMockRule(ruleId: string) {
  return post<string>(API_URL.DeleteMockRule, null, { ruleId })
}

// 全量保存记录；传 expectedUpdatedAt 时启用乐观锁，冲突返回错误
export function saveMockRecord(record: ProxyMock.MockRecord, expectedUpdatedAt?: number,
  options?: RequestOptions) {
  return post<ProxyMock.MockRecordSaveResult>(
    API_URL.SaveMockRecord, null, { expectedUpdatedAt }, record, options)
}

export function getMockRecord(recordId: string, options?: RequestOptions) {
  return get<ProxyMock.MockRecord>(API_URL.GetMockRecord, null, { recordId }, options)
}

// 录制前检测同规则下是否已有相同 url 的记录
export function getMockRecordByUrl(ruleId: string, url: string, options?: RequestOptions) {
  return get<ProxyMock.MockRecord>(
    API_URL.GetMockRecordByUrl, null, { ruleId, url }, options)
}

export function deleteMockRecord(recordId: string) {
  return post<boolean>(API_URL.DeleteMockRecord, null, { recordId })
}

export function getMockRecords(ruleId: string, offset: number, limit: number) {
  return get<ProxyMock.MockRecordPage>(API_URL.GetMockRecords, null, { ruleId, offset, limit })
}

// R1：测试匹配与录制去重共用同一入口，渲染层不得自行实现匹配
export function matchMockRecord(request: MatchMockRequest, options?: RequestOptions) {
  return post<MatchMockResponse>(
    API_URL.MATCH_MOCK_RECORD, null, null, request, options)
}

export function analyzeMockMatch(request: AnalyzeMockRequest, options?: RequestOptions) {
  return post<AnalyzeMockResponse>(
    API_URL.ANALYZE_MOCK_MATCH, null, null, request, options)
}

export function getMockMigrationReport() {
  return get<MigrationReport>(API_URL.GET_MOCK_MIGRATION_REPORT)
}

export function revertMockMatch(request: RevertMockRequest) {
  return post<RevertMockResponse>(
    API_URL.REVERT_MOCK_MATCH, null, null, request)
}

export function getMockMatchWarnings(ruleId: string) {
  return get<MockMatchWarning[]>(
    API_URL.GET_MOCK_MATCH_WARNINGS, null, { ruleId })
}

export function getServerConfig() {
  return get<LocalServerConfig>(API_URL.GetServerConfig)
}

export async function saveProxyConfig(uid: string, config: Partial<ProxyMock.ProxyConfig>) {
  return post<string>(API_URL.SaveProxyConfig, null, { uid }, config)
}

export function getProxyConfig(uid: string) {
  return get<ProxyMock.ProxyConfig>(API_URL.GetProxyConfig, null, { uid })
}

export function getSocketConnections() {
  return get<Array<ProxyMock.SocketRecord>>(API_URL.GetSocketConnections)
}

export function getAllPushClients() {
  return get<Array<ProxyMock.MsgPushClient>>(API_URL.GetAllPushClients)
}

export function getHealth() {
  return get<Diagnostic.HealthInfo>(API_URL.Health)
}

export function diagnose(target: string) {
  return post<Diagnostic.DiagnoseResult>(API_URL.Diagnose, null, { target })
}

export function mockRegister(uid: string) {
  return get<ProxyMock.RegisterResult>(`${API_URL.MockRegister}/${uid}`)
}

export function broadcast(uid: string) {
  return get<string>(`${API_URL.Broadcast}/${uid}`)
}
