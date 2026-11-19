import { MockError } from './mock.errors'
import type { MockErrorCode } from './mock.errors'
import type { MockMatchRule } from './mock.models'
import { normalizeMockRecord, validateMockRecord } from './mock.validation'
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
  /** 包内记录全量，含条目级会跳过的坏记录：「将导入 N 条」是 `recordCount - invalidCount` */
  recordCount: number
  /** 只数将写入的那批（无效记录压根不进库，数它的变体会让两个数对不上） */
  variantCount: number
  invalidCount: number
  /** 按「维度 × 条目」计：一条记录 `_id` 与指纹都撞就算两条，四象限要分开给策略 */
  conflictCount: number
  /** 仅前 MOCK_PACK_ISSUE_PAGE_LIMIT 条；总数看 issueTotal */
  issues: MockPackIssue[]
  issueTotal: number
  /** 同样只回传前 MOCK_PACK_ISSUE_PAGE_LIMIT 条，总数看 `conflictCount` */
  conflicts: MockPackConflict[]
  /**
   * 「包没写这个字段、我们按默认值补了」（R4C-12 的 `notes`），同样分页。
   * 它单独一条通道而不是并进 `issues`：同一条记录可以既补了 `id` 又完全合法，
   * 混进失败明细会让结果页把导入成功的记录计成失败。
   */
  notes: MockPackIssue[]
  noteTotal: number
  /**
   * 新建模式下第一个场景的建议名（场景名冲突时已追加 `(1)`）。
   * 多场景包不填：一个名字代表不了 N 个场景，逐条对照交给 UI 自己算（`rules[i].name` 与库内名集）。
   */
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
 * 明细折叠（技术设计 5.4「展示与存储分别定义」）：只回前 N 条，其余只报总数。
 * 取的是**包内顺序的前 N 条**而不是「每个原因留一条」——明细要能回指「第几个场景的第几条」，
 * 打乱包内顺序去凑原因分布，会让人照着明细改文件却改错那条。被折掉的其余条数不给分布：
 * 那要多带一张 map，而列出的这 N 条已经看得见成因构成，真要逐条核对的人手里本来就拿着那个文件。
 */
export function pageMockPackIssues<T>(items: T[], limit = MOCK_PACK_ISSUE_PAGE_LIMIT): T[] {
  return items.length > limit ? items.slice(0, limit) : items
}

/**
 * 新建模式的建议场景名（AC-R4-03）：与库内重名就追加 `(1)`，被占了就顺延 `(2)`。
 * 基名为空（手改的包没写 `name`）时回空串而不是编一个「未命名场景」——主进程拿不到文件名，
 * 「场景名取文件名」那条回落（PRD 4.4.5）只有渲染层说得清，这里造名字就是把决定做两次。
 */
export function suggestMockPackRuleName(base: string, taken: Array<string | undefined>): string {
  const name = base == null ? '' : String(base)
  const used = new Set(taken.filter(it => it != null).map(it => String(it)))
  if (!used.has(name)) return name
  for (let i = 1; ; i++) {
    const candidate = `${name}(${i})`
    if (!used.has(candidate)) return candidate
  }
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
export function emptyMockPackImportResult(mode: MockPackImportMode): MockPackImportResult {
  return {
    ruleId: null, mode, created: [], updated: [], skipped: [], invalid: [], failed: [],
    enabled: false, invalidTotal: 0, nameCollided: false, partial: false, aborted: false,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 诊断用的取值摘要：detail 会进响应体，不能把用户文件里的任意长串原样带出去 */
function describeValue(value: unknown): string {
  const text = value === undefined ? '(missing)' : typeof value === 'string' ? value : String(value)
  return text.length > 32 ? `${text.slice(0, 32)}…` : text
}

/**
 * 阶段一（技术设计 D8）的唯一一道闸门：整包通过才交出包对象，任一项不过就抛 `MockError`。
 * 「拒绝即零写入」是靠这道闸门跑在任何写库动作之前实现的，不是靠写库那段代码自觉。
 *
 * 只判顶层结构与限额，字段级问题留给阶段二逐条处理（R4C-11）：一条被手改坏的记录不该把整包
 * 带崩，那与 4.4.7「单条失败跳过、其余继续」相反。
 */
function assertMockPackEnvelope(value: unknown): MockPackV1 {
  if (!isRecord(value)) throw new MockError('packFormatUnknown', `top level is ${describeValue(value)}`)
  if (value.format !== MOCK_PACK_FORMAT) {
    throw new MockError('packFormatUnknown', `format=${describeValue(value.format)}`)
  }
  // 兼容性只认 pack.version：库内 schema 版本与包格式版本是两条线（R4 不新增迁移），
  // 拿 appVersion 猜版本会让「升级程序」和「换包格式」两件事互相冒充。
  // version 缺失或不象版本号属「这不是我们的包」——给 packVersionUnsupported 会让用户去升级一个并不存在的旧版本。
  const version = value.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new MockError('packFormatUnknown', `version=${describeValue(version)}`)
  }
  if (version > MOCK_PACK_VERSION) {
    throw new MockError('packVersionUnsupported', `version=${version} supported=${MOCK_PACK_VERSION}`)
  }
  const rules = value.rules
  if (!Array.isArray(rules)) throw new MockError('packFormatUnknown', `rules is ${describeValue(rules)}`)

  let recordCount = 0
  for (let i = 0; i < rules.length; i++) {
    if (!isRecord(rules[i])) throw new MockError('packFormatUnknown', `rules[${i}] is ${describeValue(rules[i])}`)
    const records = rules[i].records
    if (!Array.isArray(records)) throw new MockError('packFormatUnknown', `rules[${i}].records is ${describeValue(records)}`)
    recordCount += records.length
  }
  if (recordCount === 0) throw new MockError('packEmpty', `rules=${rules.length}`)
  if (recordCount > MOCK_PACK_MAX_RECORDS) {
    throw new MockError('packRecordLimit', `records=${recordCount} limit=${MOCK_PACK_MAX_RECORDS}`)
  }
  // 阶段一只保证到这里：records[] 里的字段仍按外部输入看待，交给阶段二逐条校验
  return value as unknown as MockPackV1
}

/**
 * 文本 → 校验过的包对象（阶段一）。
 * `byteSize` 由持有文件的一侧算好传进来（主进程用 `Buffer.byteLength`，只扫不分配）：这里自己编码一次
 * 就等于为 50MB 的包凭空多备一份副本，而校验恰恰跑在最缺内存的时候。
 * 体积先于解析：过了上限的文件不该先被 `JSON.parse` 一遍再拒。
 */
export function readMockPackText(text: string | undefined, byteSize: number): MockPackV1 {
  if (byteSize > MOCK_PACK_MAX_FILE_BYTES) throw new MockError('packTooLarge', `bytes=${byteSize}`)
  // 空文件在 multipart 侧是刻意放行的（formidable 默认会用英文报错拒掉 0 字节），
  // 放行之后就由这里给出「没有任何可导入的条目」——见 base.router.parseMultipart 的同一句注释。
  // 只带了普通字段、压根没有文件部分时 `fetchFormFileText` 给的就是 undefined，同一个原因。
  if (text == null || text.trim() === '') throw new MockError('packEmpty', `bytes=${byteSize}`)
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new MockError('packFormatUnknown', 'not valid json')
  }
  return assertMockPackEnvelope(value)
}

/** 通过条目级校验的记录及其包内坐标：写库与冲突明细都要能回指「第几个场景的第几条」 */
export interface MockPackLocatedRecord {
  ruleIndex: number
  recordIndex: number
  record: MockPackRecord
}

/** 阶段二（条目级）的产出 */
export interface MockPackRecordCheck {
  /** 原顺序、原坐标，不做归一化——补默认值是 R4C-12，写库是 R4C-14 */
  valid: MockPackLocatedRecord[]
  issues: MockPackIssue[]
  /** 被整条跳过的记录数：一条记录可以同时有几项问题，所以它不等于 `issues.length` */
  invalidCount: number
}
/**
 * 阶段二（技术设计 D8）：逐条复用保存路径的同一套判定，单条不过就跳过它、其余继续（PRD 4.4.7）。
 *
 * 只调 `validateMockRecord` 一处就够——它内部已经串了 `validateMatchRule(record.match)`
 * （`mock.validation.ts:146`），响应体上限、变体上限、`match.body` 非 `ignore` 的拒绝语义全在里面。
 * 再包一层自己的判定就等于给导入开第二条标准，「导入进得去、编辑器保存不了」是这种漂移唯一的症状。
 *
 * 递给判定的是按包契约重建的视图，不是包里的原始对象：`validateMockRecord` 认「没有 match 但有 url」
 * 这条路（库内历史记录如此），而 `url` 压根不是包字段（`MockPackRecord` 的注释写明它不落包）。原样透传
 * 就等于让手写的 `"url": "..."` 过阶段二，但派生 match 发生在 `MockService.saveMockRecord`、仓库层不做
 * （R4C-15 走 `importRecords`）——症状正是技术设计风险表 RK1 那句「导入成功、一条不命中、全程不报错」。
 * 所以视图里只留包契约声明的六个字段：包内记录必须有 match，缺它就拿 `matchMissing`。
 *
 * `field` 保持记录内相对路径（如 `match.body.mode`），不拼成 `rules[0].records[3].match...`：
 * 定位已由 `ruleIndex`/`recordIndex`/`recordId` 三个字段承担，拼上去只会把明细行挤出横向滚动。
 *
 * 明细里的 code 全是 `MOCK_VALIDATION_CODES` 那一族（不是 `MOCK_PACK_CODES`），文案落在
 * `mock.editor.validation.*`——同一份判定就该同一份文案，见技术设计 7 节的回写。
 *
 * 不做「库内已有 + 待写入」的上限复核：那要读库，属阶段一之后、写库之前的 R4C-14（5.3 表第三行）。
 */
export function validateMockPackRecords(pack: MockPackV1): MockPackRecordCheck {
  const valid: MockPackLocatedRecord[] = []
  const issues: MockPackIssue[] = []
  let invalidCount = 0
  for (let ruleIndex = 0; ruleIndex < pack.rules.length; ruleIndex++) {
    const records = pack.rules[ruleIndex].records
    for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
      const record = records[recordIndex]
      // 非对象（字符串、数字）也当空记录报：`'x'.match` 是 String.prototype 上的方法，
      // 直接透传会让它冒充一条匹配规则，报出来的是「pathType 不合法」而不是「这条不是记录」。
      const fields: MockPackRecord = (record != null && typeof record === 'object') ? record : {} as MockPackRecord
      const found = validateMockRecord({
        id: fields.id ?? null,
        name: fields.name,
        match: fields.match,
        response: fields.response,
        variants: fields.variants,
        activeVariantId: fields.activeVariantId,
      } as unknown as ProxyMock.MockRecord)
      if (found.length === 0) {
        valid.push({ ruleIndex, recordIndex, record })
        continue
      }
      invalidCount++
      for (const issue of found) {
        issues.push({
          code: issue.code, field: issue.field, detail: issue.detail,
          ruleIndex, recordIndex, recordId: record?.id ?? undefined,
        })
      }
    }
  }
  return { valid, issues, invalidCount }
}

/** 归一化之后的记录 + 「包没写、由我们补齐」的字段名 */
export interface MockPackPreparedRecord {
  ruleIndex: number
  recordIndex: number
  /** 不含 `ruleId`：它是「导到哪个场景」的答案，属预览与写入阶段（R4C-13/R4C-18），包里也没有这个字段 */
  record: ProxyMock.MockRecord
  /** 回落了哪些字段（`id` / `name`），由调用方折算成 `packFieldDefaulted` 明细 */
  defaulted: string[]
}

/**
 * 阶段二之后的归一化（R4C-12）：把「包里的记录」变成「与编辑器保存后同一种形状的记录」。
 * 用 `normalizeMockRecord` 而不是自己逐字段补——派生 match 之外的那套默认值有一份就够了，
 * 补两次就会漂移（读库路径 `docToRecord` 用的也是它）。
 *
 * 只有两处是归一化管不到、又必须强制的：
 * - `match.enabled = false`：导入不许劫持真实请求（风险表 RK6），启不启用是用户之后的决定；
 * - `match.derivation.source = 'import'`：包里的来源印记讲的是导出那台机器的事，
 *   对本库而言这条记录就是导入产生的（`mock.models.ts:95` 已有该取值，不扩类型）。
 *
 * 不生成 ID：`MockRepo.saveRecord` 里「无 id 就 `rec_<uuid>`」那次分配是唯一点，这里再分配一次就是第二条标准。
 * 但缺 id 要在 `defaulted` 里说一声——合并模式靠包内 `id` 做幂等重放，缺了它，重放同一个包就会多出副本。
 */
export function prepareMockPackRecord(located: MockPackLocatedRecord): MockPackPreparedRecord {
  const packed = located.record
  const record = normalizeMockRecord({
    id: packed?.id ?? undefined,
    name: packed?.name,
    match: packed?.match,
    response: packed?.response,
    variants: packed?.variants,
    activeVariantId: packed?.activeVariantId,
    source: packed?.source,
    createdAt: packed?.createdAt,
    updatedAt: packed?.updatedAt,
  })
  const defaulted: string[] = []
  if (record.id == null) defaulted.push('id')
  // 名称回落发生在仓库层（url → match.path），包内记录没有 url，所以这里只能说「名称是补的」
  if (record.name === '') defaulted.push('name')
  const match = record.match
  if (match != null) {
    const derivation = match.derivation
    match.enabled = false
    match.derivation = {
      source: 'import',
      autoIgnoredKeys: derivation?.autoIgnoredKeys ?? [],
      suggestions: derivation?.suggestions ?? [],
      pathParameterized: !!derivation?.pathParameterized,
      analyzedAt: derivation?.analyzedAt ?? 0,
    }
  }
  return { ruleIndex: located.ruleIndex, recordIndex: located.recordIndex, record, defaulted }
}
