import type { MockErrorCode } from './mock.errors'
import type { MockMatchRule } from './mock.models'
import type { ProxyMock } from './proxy.models'
import { MOCK_SENSITIVE_HEADERS } from './http-header'

/**
 * 规则包（导入/导出）契约的唯一真源：包格式、上限常量与端点请求/响应类型。
 * 包是外部交换格式，与库内 schema 版本解耦——兼容性只认 `version`，`appVersion` 仅供排查。
 */

export const MOCK_PACK_FORMAT = 'appapi-mock-pack'
export const MOCK_PACK_VERSION = 1

/** 包体积上限：与 MainServer 三类 body parser 的 `limit: '50mb'` 同值，改一处必须同步改另一处；multipart 侧只多留 1MB 余量 */
export const MOCK_PACK_MAX_FILE_BYTES = 50 * 1024 * 1024
/** 单包记录总数：超过即整包拒绝，提示按场景拆分 */
export const MOCK_PACK_MAX_RECORDS = 5000
/** 单个 HAR 文件的 entry 数：超过即整包拒绝 */
export const MOCK_HAR_MAX_ENTRIES = 1000
/** 预览与结果页只回传前 N 条明细，其余按同类原因折叠计数 */
export const MOCK_PACK_ISSUE_PAGE_LIMIT = 200
/** 批量写库的分片大小，与仓库层 DELETE_BATCH 同一节奏 */
export const MOCK_PACK_WRITE_BATCH = 200

export const MOCK_PACK_KINDS = ['pack', 'har'] as const
export type MockPackKind = typeof MOCK_PACK_KINDS[number]

/**
 * 文件选择框的白名单。两种部署形态共用同一把 `<input type="file">`：扩展名管住「知道自己后缀」的用户，
 * mimetype 管住只认类型的系统对话框。`.har` 在多数系统里没有登记 MIME，浏览器给的 `File.type` 常是空串，
 * 所以主力是扩展名那一半；上传时由 `proxy.api.withFallbackMimeType` 补 part 的 Content-Type，
 * 服务端才把它当文件而不是普通字段。
 * 键集必须等于 `MOCK_PACK_KINDS`——新增 kind 忘了配白名单，pack-file.test.ts 立刻变红。
 */
export const MOCK_PACK_FILE_ACCEPT: Record<MockPackKind, string> = {
  pack: '.json,application/json',
  har: '.har,application/har+json,application/json'
}

/** new=新建场景（ID 全部重生成），merge=合并到目标场景（保留包内 recordId 以支持幂等重放） */
export const MOCK_PACK_IMPORT_MODES = ['new', 'merge'] as const
export type MockPackImportMode = typeof MOCK_PACK_IMPORT_MODES[number]

export const MOCK_PACK_SCOPES = ['rule', 'all'] as const
export type MockPackScope = typeof MOCK_PACK_SCOPES[number]

/** 合并模式下 `_id` 或匹配指纹已在库内存在时的处理策略 */
export const MOCK_PACK_CONFLICT_STRATEGIES = ['skip', 'overwrite', 'copy'] as const
export type MockPackConflictStrategy = typeof MOCK_PACK_CONFLICT_STRATEGIES[number]

/**
 * 包内记录：`url`、`matchFingerprint`、`matchInvalid` 与 matchWarnings/limitState/requests
 * 一律不落包——前两者都是派生值，落包后手改文件即可造出指纹与 match 不符的记录，绕过查重。
 */
export interface MockPackRecord {
  id?: string | null
  name?: string
  match?: MockMatchRule
  response: ProxyMock.MockResponseDef
  variants?: ProxyMock.MockVariant[]
  activeVariantId?: string | null
  source?: ProxyMock.MockRecordSource
  createdAt?: number
  updatedAt?: number
}

export interface MockPackRule {
  /** 新建场景导入时重生成；合并模式只用 name/desc 匹配目标场景 */
  id?: string | null
  name: string
  desc?: string
  createdAt?: number
  updatedAt?: number
  records: MockPackRecord[]
}

export interface MockPackV1 {
  format: string
  version: number
  appVersion?: string
  exportedAt?: number
  rules: MockPackRule[]
}

export interface MockPackExportOptions {
  scope: MockPackScope
  ruleId?: string | null
  /** 是否带上录制请求头/URL，脱敏仍按 redact 执行 */
  includeSource?: boolean
  redact?: boolean
  includeVariants?: boolean
}

export interface MockPackPreviewOptions {
  mode: MockPackImportMode
  /** 合并模式的目标场景；新建模式忽略 */
  targetRuleId?: string | null
}

export interface MockPackImportOptions extends MockPackPreviewOptions {
  conflict?: MockPackConflictStrategy
  /** HAR 专用：默认跳过 js/css/图片 */
  includeStatic?: boolean
}

/** 条目级失败明细：复用 `err.issues` 通道回传，只补定位用的下标 */
export interface MockPackIssue {
  code: MockErrorCode | string
  field?: string
  detail?: string
  ruleIndex?: number
  recordIndex?: number
  recordId?: string
}

/** 与库内既有记录的冲突点；`fingerprint` 型不会撞 `_id`，覆盖时按库内记录落点 */
export interface MockPackConflict {
  kind: 'id' | 'fingerprint'
  ruleIndex: number
  recordIndex: number
  recordId?: string
  existingRecordId: string
  existingName?: string
  /** 覆盖会替换正在生效的规则，预览页据此给出「将影响 N 条已生效规则」 */
  existingEnabled?: boolean
}

export interface MockPackPreviewResult {
  kind: MockPackKind
  packVersion: number
  appVersion?: string
  ruleCount: number
  recordCount: number
  variantCount: number
  invalidCount: number
  conflictCount: number
  /** 仅前 MOCK_PACK_ISSUE_PAGE_LIMIT 条；总数看 issueTotal */
  issues: MockPackIssue[]
  issueTotal: number
  conflicts: MockPackConflict[]
  /** 新建模式下的建议场景名（场景名冲突时已追加 `(1)`） */
  suggestedRuleName?: string
}

export interface MockPackSkipped {
  recordId?: string
  recordIndex?: number
  reason: MockErrorCode | string
  detail?: string
}

export interface MockPackImportResult {
  /** 新建模式返回新生成的场景 ID，合并模式等于 targetRuleId */
  ruleId: string | null
  ruleName?: string
  mode: MockPackImportMode
  created: string[]
  /** 合并·覆盖策略替换掉的库内记录 */
  updated: string[]
  skipped: MockPackSkipped[]
  /** 条目级校验不通过 */
  invalid: MockPackIssue[]
  /** 校验通过但写库失败 */
  failed: MockPackIssue[]
  /** 导入的记录一律不自动启用，UI 必须显式提示「已导入但未启用」 */
  enabled: false
  invalidTotal: number
  /** 场景名冲突已追加 `(1)` */
  nameCollided: boolean
  /** 中途失败或取消导致的部分写入 */
  partial: boolean
  aborted: boolean
  /** HAR 不区分域名，与既有规则构成遮蔽的条数（Q2 的代价） */
  shadowedCount?: number
  /** HAR 专用：Path 参数化建议，不自动应用 */
  suggestions?: MockPackIssue[]
}

/** 脱敏后的固定掩码：不写成空串，空串会让导入侧把「头不存在」和「头被脱敏」混为一谈 */
export const MOCK_PACK_REDACTED_VALUE = '***'

type PackHeaders = Record<string, unknown> | null | undefined

/**
 * 敏感头替换为掩码：键名原样保留（大小写是用户配置的一部分），数组值保持等长数组
 * （`set-cookie` 压成字符串会让导入后的结构漂移），null/undefined 不伪造值。
 * 返回新对象——就地改会污染调用方手里的库内记录。
 */
export function redactPackHeaders<T extends PackHeaders>(headers: T): T {
  if (headers == null) return headers
  const out: Record<string, unknown> = {}
  for (const name of Object.keys(headers)) {
    const value = headers[name]
    const sensitive = MOCK_SENSITIVE_HEADERS.includes(String(name).trim().toLowerCase() as typeof MOCK_SENSITIVE_HEADERS[number])
    out[name] = !sensitive ? value
      : Array.isArray(value) ? value.map(() => MOCK_PACK_REDACTED_VALUE)
      : typeof value === 'string' ? MOCK_PACK_REDACTED_VALUE
      : value
  }
  return out as T
}

/**
 * 记录级脱敏，覆盖三处头：`source.headers`、`response.headers` 与**每个变体**的 headers
 * （变体本身也是一份完整响应，只脱敏前两处等于漏一半）。
 * `redact=false` 原样返回同一条记录——关闭脱敏走 `-raw` 分支，不能悄悄做半截替换。
 */
export function redactPackRecord<T extends MockPackRecord>(record: T, redact: boolean): T {
  if (!redact) return record
  const out: T = { ...record }
  if (out.response != null) {
    out.response = { ...out.response, headers: redactPackHeaders(out.response.headers) }
  }
  if (out.variants != null) {
    out.variants = out.variants.map(variant => ({ ...variant, headers: redactPackHeaders(variant.headers) }))
  }
  if (out.source != null) {
    out.source = { ...out.source, headers: redactPackHeaders(out.source.headers) }
  }
  return out
}

/** query 传进来的模式收敛到受支持取值：默认新建，合并必须显式声明 */
export function toMockPackImportMode(value: unknown): MockPackImportMode {
  return value === 'merge' ? 'merge' : 'new'
}

/**
 * query 里的开关只有字符串：缺省按默认值（导出默认带全量信息、默认脱敏），
 * 显式写 `false` 才是关。渲染层传布尔，axios 会序列化成 `'false'`。
 */
export function toMockPackFlag(value: unknown, fallback: boolean): boolean {
  if (value == null || value === '') return fallback
  return String(value) !== 'false'
}

/** 路由 handler 返回 undefined 会被 base.router 转成「biz inner error」，空结果必须显式回对象 */
export function emptyMockPackPreviewResult(): MockPackPreviewResult {
  return {
    kind: 'pack', packVersion: 0, ruleCount: 0, recordCount: 0, variantCount: 0,
    invalidCount: 0, conflictCount: 0, issues: [], issueTotal: 0, conflicts: [],
  }
}

export function emptyMockPackImportResult(mode: MockPackImportMode): MockPackImportResult {
  return {
    ruleId: null, mode, created: [], updated: [], skipped: [], invalid: [], failed: [],
    enabled: false, invalidTotal: 0, nameCollided: false, partial: false, aborted: false,
  }
}
