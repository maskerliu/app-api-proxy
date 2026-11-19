import type { MockErrorCode } from './mock.errors'
import type { MockMatchRule } from './mock.models'
import type { ProxyMock } from './proxy.models'

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

/** query 传进来的模式收敛到受支持取值：默认新建，合并必须显式声明 */
export function toMockPackImportMode(value: unknown): MockPackImportMode {
  return value === 'merge' ? 'merge' : 'new'
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
