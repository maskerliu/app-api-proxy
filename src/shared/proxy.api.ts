import type { LocalServerConfig } from './base.models'
import type { Diagnostic } from './diagnostic.models'
import type { ProxyMock } from './proxy.models'
import type {
  AnalyzeMockRequest, AnalyzeMockResponse, MatchMockRequest, MatchMockResponse,
  MigrationReport, MockMatchWarning, RevertMockRequest, RevertMockResponse,
} from './mock.models'
import { formPost, get, post, RequestOptions } from './base.api'
import { API_URL } from './api.const'
import type {
  MockPackExportOptions, MockPackImportOptions, MockPackImportResult, MockPackPreviewOptions,
  MockPackPreviewResult,
} from './mock.pack'
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

// ---- R4 规则导入/导出 ----

/**
 * 文件部分固定用 pack 这个键，导入选项一律放 query。
 * `.har` 这类后缀常常没有登记 MIME，浏览器给出的 File.type 是空串，
 * multipart 里就会缺少 part 的 Content-Type——服务端只能把它当普通字段读进内存。
 * 补上兜底类型，让 50MB 级的包走 formidable 的落盘通道而不是堆在字段缓冲里。
 */
function packForm(file: File | Blob): FormData {
  const form = new FormData()
  form.append('pack', withFallbackMimeType(file))
  return form
}

function withFallbackMimeType(file: File | Blob): File | Blob {
  const name = (file as File).name
  return name && !file.type ? new File([file], name, { type: 'application/octet-stream' }) : file
}

// 桌面端导出由主进程组装后边拼边写目标文件，这个端点只服务 Web 分支：浏览器没有主进程可用，
// 包文本必须整份取进渲染层再包成 Blob 下载（峰值与包大小同阶，UI 上已提示改用桌面端）。
// 回的是字符串而不是包对象：主进程是流式拼出来的，再解析一次等于把省下的内存还回去。
export function exportMockPack(options: MockPackExportOptions, requestOptions?: RequestOptions) {
  return get<string>(API_URL.EXPORT_MOCK_PACK, undefined, {
    scope: options.scope,
    ruleId: options.ruleId ?? undefined,
    includeSource: options.includeSource,
    redact: options.redact,
    includeVariants: options.includeVariants,
  }, requestOptions)
}

/**
 * 预览/导入/取消这三个入口的超时一律放到「不限时」，由服务端自己判完：50MB 的包上传 + 写 5,000 条
 * 本来就可能跑过 axios 的 10s 默认值，客户端先把连接掐掉，用户看到的是「导入失败」而库里已经写进去一半。
 * 卡住不动另有「取消」那一枚按钮兜，它走的是另一条请求，不受这次上传的影响。
 */
function packUploadOptions(requestOptions?: RequestOptions): RequestOptions {
  return { timeout: 0, ...requestOptions }
}

export function previewMockPack(file: File | Blob, options: MockPackPreviewOptions,
  requestOptions?: RequestOptions) {
  return formPost<MockPackPreviewResult>(API_URL.PREVIEW_MOCK_PACK, undefined, {
    mode: options.mode,
    targetRuleId: options.targetRuleId ?? undefined,
  }, packForm(file), packUploadOptions(requestOptions))
}

export function importMockPack(file: File | Blob, options: MockPackImportOptions,
  requestOptions?: RequestOptions) {
  return formPost<MockPackImportResult>(API_URL.IMPORT_MOCK_PACK, undefined, {
    mode: options.mode,
    targetRuleId: options.targetRuleId ?? undefined,
    conflict: options.conflict,
  }, packForm(file), packUploadOptions(requestOptions))
}

export function importHar(file: File | Blob, options: MockPackImportOptions,
  requestOptions?: RequestOptions) {
  return formPost<MockPackImportResult>(API_URL.IMPORT_HAR, undefined, {
    mode: options.mode,
    targetRuleId: options.targetRuleId ?? undefined,
    // 与 `importMockPack` 同一组键：合并模式的冲突策略对 HAR 派生的记录一样成立（同 path 不同域名的两条会撞指纹）
    conflict: options.conflict,
    includeStatic: options.includeStatic,
    sceneName: options.sceneName ?? undefined,
  }, packForm(file), packUploadOptions(requestOptions))
}

/**
 * 取消当前那次导入：信号落在写库的批与批之间，已写进去的一条不动，没写的逐条以 `packWriteAborted` 交代。
 * 回 `false` 表示「此刻没有导入任务」——不是失败，弹窗照常等那次请求的回执。
 * 走 HTTP 而不是 IPC：触发导入的那次请求本身就是 multipart POST，两种部署形态同一份代码；
 * 导出那次的进度用 IPC 推，是因为执行体在主进程、Web 分支根本没有主进程可推。
 */
export function cancelMockPackImport(requestOptions?: RequestOptions) {
  return post<boolean>(API_URL.CANCEL_MOCK_PACK_IMPORT, undefined, undefined, undefined, requestOptions)
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

// SSE 演示通道：帧的 data 与 /echo 共用同一套 PushMsg 信封，见 AppMockRouter
export function ssePush(uid: string) {
  return get<string>(`${API_URL.SsePush}/${uid}`)
}

export function sseBroadcast(uid: string) {
  return get<string>(`${API_URL.SseBroadcast}/${uid}`)
}
