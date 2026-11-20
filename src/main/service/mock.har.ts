import { MockError } from '@shared/mock.errors'
import type { MockErrorCode } from '@shared/mock.errors'
import { MOCK_HAR_MAX_ENTRIES, MOCK_PACK_FORMAT, MOCK_PACK_MAX_FILE_BYTES } from '@shared/mock.pack'
import type { MockPackRecord } from '@shared/mock.pack'
import type { ProxyMock } from '@shared/proxy.models'
import { pickHeader } from '@shared/http-header'
import { base64ToText, inferBodyType, normalizeMimeType, sanitizeResponseHeaders } from '@shared/mock.validation'
import { parseLooseUrl } from '@shared/url'
import { analyzeMatchStability } from './mock.derive'

/**
 * HAR（HTTP Archive 1.2）解析层：把一份 `.har` 读成「够得着真实导出形态」的原料，仅此一件事。
 * 字段映射（R4C-22）、响应体解码与类型（R4C-23）、entry 上限与静态资源开关（R4C-24）各自接在这层之后——
 * 把它们写进来就会顺手也重写一遍 URL 拆解，而那条必须只用 `shared/url.ts`（否则与匹配引擎归一化结果分叉，症状是「导入了却不命中」）。
 */

/** 库内头的形状与 `ProxyMock.MockResponseHeaders` 一致：同名多值用数组，单值仍是字符串 */
export type HarHeaders = Record<string, string | string[]>

export interface HarParam {
  name: string
  value: string
  /** multipart/表单式上传里的文件名。映射层不入库（B.3 写的 `source.requestBody` 模型里没有），原料留着等那个落点定下来 */
  fileName: string
}

export interface HarRequest {
  /** 缺失给空串，不补 `GET`：猜方法等于替用户造一条永远不会命中的规则，比空着更难查 */
  method: string
  /** `#` 之后已丢弃（技术设计 §9）。host/path/query 一律留给 R4C-22 用 `shared/url.ts` 拆 */
  url: string
  headers: HarHeaders
  mimeType: string
  /** `postData.text`；没有为 null。与 `params` 同时存在时（Charles 会两个都写）两份都留着，映射层都不入库 */
  text: string | null
  /** `postData.params`，没有则空数组。HAR 不支持请求体匹配，这层因此不判它能不能当条件 */
  params: HarParam[]
}

export interface HarContent {
  mimeType: string
  /** `content.size`：正文缺失但 size > 0 正是 Chrome 对二进制资源不记正文的那种常态（§9） */
  size: number
  /** `content.text`；缺失为 null。null 且 size 为 0 才是「真的没有正文」（204 之类），那种条目照样导入 */
  text: string | null
  /** 原样保留（只统一大小写）。这里不解码，也不替无法识别的编码声称是 utf8 */
  encoding: string
}

export interface HarResponse {
  status: number
  statusText: string
  headers: HarHeaders
  content: HarContent
}

export interface HarEntry {
  /** 文件里的 entry 下标：跳过明细要能指回用户那份 `.har` 的第几条，而不是「保留下来的第几条」 */
  index: number
  request: HarRequest
  response: HarResponse
}

/**
 * 条目级跳过。解析层只用 §9 认下的 `harNoResponse` / `harBodyUnreadable` 两种，不给「文件被改坏」发明第三种；
 * 映射层另加 `harUnsupportedProtocol`（§9 的协议白名单那行），它是「这条不要」而不是「这条读不出」。
 */
export interface HarSkipped {
  entryIndex: number
  reason: MockErrorCode
  detail?: string
}

export interface HarParseResult {
  /** 原顺序，未映射、未解码 */
  entries: HarEntry[]
  skipped: HarSkipped[]
}

/** 过了包级信封之后的文档：`entries` 仍是外部输入，逐条判定在 `parseHarEntries` */
export interface HarDocument {
  version: string
  creator: string
  entries: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * `status` 只认「数字或纯数字串」，其余一律读成 0（= 没记录到完成的响应）。
 * 宽容数字串是因为工具有把 status 写成 `"200"` 的：那种条目被当成「无响应」静默丢掉，
 * 比多读一个数难查得多。非数字的非空值不猜——落到 0 就是 `harNoResponse`，明细里有 detail。
 */
function asStatus(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0
  const text = asText(value).trim()
  return /^\d+$/.test(text) ? Number(text) : 0
}

function asSize(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
  const text = asText(value).trim()
  return /^\d+$/.test(text) ? Number(text) : 0
}

/**
 * `{name,value}[]` → 头对象：重名收成等长数组（`set-cookie` 压成字符串会让导入后的结构漂移，
 * 与 `redactPackHeaders` 那条是同一个道理）。键名原样保留大小写与写法，不 lower、不 sort。
 * `request.cookies` / `response.cookies` 不读——HAR 把 cookie 同时抄在 headers 与 cookies 两处，只取一处才有唯一真相。
 */
function asHeaders(value: unknown): HarHeaders {
  const out: HarHeaders = {}
  if (!Array.isArray(value)) return out
  for (const item of value) {
    if (!isRecord(item)) continue
    const name = asText(item.name)
    if (name === '') continue
    const text = String(item.value ?? '')
    const previous = out[name]
    if (previous == null) out[name] = text
    else if (Array.isArray(previous)) previous.push(text)
    else out[name] = [previous, text]
  }
  return out
}

function asParams(value: unknown): HarParam[] {
  if (!Array.isArray(value)) return []
  const out: HarParam[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    out.push({ name: asText(item.name), value: asText(item.value), fileName: asText(item.fileName) })
  }
  return out
}

/**
 * 丢弃 fragment，截在第一个 `#`——与 `new URL()` 的读法一致（`#` 之后全归 hash）。
 * 落在这一层不是为了省事：`shared/url.ts` 里按串读的那一半（`queryParts:73-82`）只把出现在 `?` 之后的 `#` 当终止符，
 * 于是 `x#seg?token=1` 这种串会出现「按 URL 读没有 query、按串读多一个 query」两种答案。
 * 截完之后存下来的 url 只剩一种读法，映射与匹配引擎从此不会再分叉。
 */
function withoutFragment(value: unknown): string {
  const raw = asText(value).trim()
  const hash = raw.indexOf('#')
  return hash < 0 ? raw : raw.slice(0, hash)
}

/**
 * 阶段一（包级）的 HAR 侧：字节 → 非空 → JSON → 信封，四条顺序与 `readMockPackText` 一致。
 * 体积用同一个 `MOCK_PACK_MAX_FILE_BYTES`：上限讲的是「这一次请求能带多大的文件」，与包格式无关，两把尺迟早分叉。
 *
 * 「按内容分派两种包」落在信封判定上：HAR 与规则包顶层没有共同形状（`log.entries` 对 `format` + `rules`），
 * 所以选错 kind 时 detail 直接说破「这是一份规则包」，而不是让用户对着 `log is undefined` 猜该走哪个端点。
 * entry 条数上限（`harEntryLimit`）不在这一步——判不判静态资源会改变「有几条 entry 要写进库」，
 * 所以它判在映射层的候选数上，见 `mapHarEntries`。
 */
export function readHarText(text: string | undefined, byteSize: number): HarDocument {
  if (byteSize > MOCK_PACK_MAX_FILE_BYTES) throw new MockError('packTooLarge', `bytes=${byteSize}`)
  if (text == null || text.trim() === '') throw new MockError('packEmpty', `bytes=${byteSize}`)
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new MockError('packFormatUnknown', 'not valid json')
  }
  if (!isRecord(value)) throw new MockError('packFormatUnknown', `top level is ${Array.isArray(value) ? 'array' : typeof value}`)
  const log = value.log
  if (!isRecord(log)) {
    throw new MockError('packFormatUnknown',
      value.format === MOCK_PACK_FORMAT ? 'this is a rule pack, not a HAR' : `log is ${log == null ? '(missing)' : typeof log}`)
  }
  const entries = log.entries
  if (!Array.isArray(entries)) throw new MockError('packFormatUnknown', `log.entries is ${entries == null ? '(missing)' : typeof entries}`)
  // 空档案不是错误形状，但也没有可导入的东西：与规则包同一个 `packEmpty`，让用户去工具里重新录一次
  if (entries.length === 0) throw new MockError('packEmpty', 'entries=0')
  const creator = isRecord(log.creator) ? asText(log.creator.name) : ''
  return { version: asText(log.version), creator, entries }
}

/**
 * 阶段一之后、映射之前的逐条解析：只把「报得出正文」的交出去，报不出的按 §9 归成两种跳过原因。
 * 协议白名单（R4C-22 的 `rejectedScheme`）、base64 解码（R4C-23 的 `bodyOf`）、静态资源开关与条数上限（R4C-24 的 `staticKindOf` / `MOCK_HAR_MAX_ENTRIES`）
 * 都排在后面：那三件事各有裁决，各也各自新增跳过口径，放这层就会把「entry 有没有正文」问两遍。
 */
export function parseHarEntries(entries: unknown[]): HarParseResult {
  const kept: HarEntry[] = []
  const skipped: HarSkipped[] = []
  for (let index = 0; index < entries.length; index++) {
    const raw = entries[index]
    // 没有响应就没有可 Mock 的东西。detail 分两种写法：用户要能看出是「这条没录到响应」还是「这条压根不是 entry」，
    // 后者属文件被改坏，但不必为它发明第三个码（§9 只认两种跳过原因）
    if (!isRecord(raw)) {
      skipped.push({ entryIndex: index, reason: 'harNoResponse', detail: `entry is ${raw == null ? '(missing)' : typeof raw}` })
      continue
    }
    const rawResponse = raw.response
    if (!isRecord(rawResponse)) {
      skipped.push({ entryIndex: index, reason: 'harNoResponse', detail: `response is ${rawResponse == null ? '(missing)' : typeof rawResponse}` })
      continue
    }
    const status = asStatus(rawResponse.status)
    if (status === 0) {
      skipped.push({ entryIndex: index, reason: 'harNoResponse', detail: 'status=0' })
      continue
    }
    const rawContent = isRecord(rawResponse.content) ? rawResponse.content : {}
    const mimeType = asText(rawContent.mimeType)
    const contentText = typeof rawContent.text === 'string' ? rawContent.text : null
    const size = asSize(rawContent.size)
    // 正文缺失但报得出大小：Chrome 对二进制资源常不记录 `text`，这是常态不是异常（§9），所以逐条跳过并计数
    if (contentText == null && size > 0) {
      skipped.push({ entryIndex: index, reason: 'harBodyUnreadable', detail: `size=${size} mimeType=${mimeType || '(missing)'}` })
      continue
    }
    // 缺 `request` 不在这层跳过：那只是 URL 为空，属阶段二 `matchMissing` 的话；这里给个空对象把它放过去，才不会出现第二套条目级判定
    const rawRequest = isRecord(raw.request) ? raw.request : {}
    const postData = isRecord(rawRequest.postData) ? rawRequest.postData : {}
    kept.push({
      index,
      request: {
        // 原样交出：大小写与「空即 ANY」由 `normalizeMethod`（`mock.models.ts:313`）单源决定，这里再 trim/upper 一遍就是第二条标准
        method: asText(rawRequest.method),
        url: withoutFragment(rawRequest.url),
        headers: asHeaders(rawRequest.headers),
        mimeType: asText(postData.mimeType),
        text: typeof postData.text === 'string' ? postData.text : null,
        params: asParams(postData.params),
      },
      response: {
        status,
        statusText: asText(rawResponse.statusText),
        headers: asHeaders(rawResponse.headers),
        content: {
          mimeType,
          size,
          text: contentText,
          encoding: asText(rawContent.encoding).trim().toLowerCase(),
        },
      },
    })
  }
  return { entries: kept, skipped }
}

/** HAR 能 Mock 的只有这两种协议；白名单交给 `toAbsoluteTarget`，与代理上游、诊断走同一把尺 */
const HAR_PROTOCOLS = ['http:', 'https:']

/** 参数化建议的原料：`suggested` 是把 ID 形态段换成 `*` 的那个模板，本卡不应用它（§9：只给建议） */
export interface HarPathSuggestion {
  original: string
  suggested: string
}

export interface HarMappedRecord {
  /** 与 `skipped.entryIndex` 同一个坐标：文件里的 entry 下标 */
  entryIndex: number
  /** 包侧的记录形状，可直接进既有的阶段二校验（R4C-10/11）、归一化（R4C-12）与写入（R4C-18）链路 */
  record: MockPackRecord
  suggestion?: HarPathSuggestion
}

export interface HarMappingResult {
  records: HarMappedRecord[]
  /** 只装本步新拒的条目（协议白名单、静态资源、正文读不出三道），解析层跳过的那些仍在 `HarParseResult.skipped`，两层各自数各自的 */
  skipped: HarSkipped[]
}

export interface HarMappingOptions {
  analyzedAt?: number
  /**
   * 默认关：js / css / 图片逐条跳过并计数（R4C-24）。
   * 它是「这一次导入」的开关，契约字段是 `MockPackImportOptions.includeStatic`，不进全局设置（Q5）——
   * 这一层只认传入的值，界面在哪、参数怎么从端点走到这里属 R4C-25/27。
   */
  includeStatic?: boolean
}

/**
 * `data:` / `file:` / `chrome://` 这类 entry 拆不出可匹配的 path+query，也没有可 Mock 的上游语义，
 * 放到最后只会变成「导入成功，但一堆规则永不命中」，所以在入口就拒掉并报出协议名。
 *
 * 卡片（R4C-22）写的是用 `toAbsoluteTarget` 的白名单拒，实测不行：它为了「裸主机名当 http 处理」那个输入框，
 * 只认 `scheme://` 形态，于是 `data:image/png;base64,…` 与 `javascript:alert(1)` 被补成 `http://data:…` 之后
 * 报的是 `invalid` 而不是 `unsupported`——既拒不掉，也读不出协议名，而 `parseLooseUrl` 对同一个串给出的
 * pathname 是 `image/png;base64,…`，照原样走下去就导进一条永远不会命中的路径规则。
 * 现在用 `parseLooseUrl` 读协议：它的返回值与后面派生 path 读的是同一个 URL 对象，一条串只有一种读法。
 *
 * 地址为空或压根解析不了不跳——那属阶段二 `matchMissing` 的话，与 §9「缺 `request` 的 entry 不跳过」同一条口径。
 */
function rejectedScheme(url: string): string | null {
  if (url === '') return null
  const parsed = parseLooseUrl(url)
  if (parsed == null) return null
  return HAR_PROTOCOLS.indexOf(parsed.protocol) < 0 ? parsed.protocol : null
}

/**
 * 这条 entry 「是什么类型」的唯一读法：响应头里的 `content-type` 优先，其次 `content.mimeType`。
 * `bodyType`（R4C-23）与静态资源判定（R4C-24）都读它——两头各读一次就会造出「算图片却按文本存」的自相矛盾条目，
 * 而这两种判定落在同一个循环里，读者只会看到一个结果。
 */
function contentTypeOf(entry: HarEntry): string {
  return pickHeader(entry.response.headers, 'content-type') ?? entry.response.content.mimeType
}

/**
 * js / css / 图片三类，就是卡片（R4C-24）的字面范围，不顺手扩到字体、音视频：
 * 那两类同样可能淹没有效记录，但 PRD 4.4.5 与评审都没裁决过它们，跳过用户没要求跳的条目比留下更糟。
 * `image/` 按前缀整类算（`image/svg+xml` 也是图片），js/css 用精确类型表。
 */
const HAR_JS_MIME_TYPES = ['application/ecmascript', 'application/javascript', 'application/x-javascript', 'text/ecmascript', 'text/javascript']
const HAR_CSS_MIME_TYPES = ['text/css']

/**
 * 只看类型，不看 URL 后缀：后缀要在这一层再起一套路径解析，而 HAR 的 `content.mimeType` 与响应头才是权威。
 * 类型读不出来（空串）不算静态资源——宁可多导一条无用记录，也不静默跳掉用户没要求跳的条目。
 */
function staticKindOf(contentType: string): 'css' | 'image' | 'js' | null {
  const type = normalizeMimeType(contentType)
  if (type === '') return null
  if (type.startsWith('image/')) return 'image'
  if (HAR_CSS_MIME_TYPES.indexOf(type) >= 0) return 'css'
  if (HAR_JS_MIME_TYPES.indexOf(type) >= 0) return 'js'
  return null
}

/**
 * 响应体三元组，与渲染层编辑器同一约定（`MockResponseForm.vue:122-131`）：
 * 「二进制」这一档的内容按 base64 存，其余档存可直接编辑的文本，`bodyEncoding` 只在存 base64 时给值。
 */
interface HarResponseBody {
  body: string
  bodyType: ProxyMock.MockBodyType
  bodyEncoding?: 'base64'
}

/**
 * 只解「解出来确实是文本」的那一半：文本档解成功就存文本、编辑器能直接改；解不出 UTF-8 说明
 * `mimeType` 报的文本其实不是文本，继续按文本存就会发出乱码，改按二进制原样存 base64 才发得对。
 * `atob` 会自己跳过折行空白（Chrome / Fiddler 那种每 76 字符折一行照常解得开），必抛的只剩两种：
 * 中段出现 `=` 的拼接式 base64，以及解出来不是合法 UTF-8 的字节——后者正是这里要接住的那种。
 *
 * 反过来，`mimeType` 判成二进制却没有 base64 标记时返回 null：HAR 把字节当文本写了，
 * 无论怎么存发出去的都是坏字节——这与 §9「`text` 缺失但 `size > 0`」是同一种「读不到正文」，
 * 所以复用同一个码逐条跳过并计数，而不是静默交出一条看着成功、命中后回乱码的规则。
 *
 * 2MB 不在这道判：阶段二那把 `validateResponseDef`（`mock.validation.ts:120`）已经在数 body 的 UTF-8 字节，
 * 这里再加一道就是第二条标准；代价是二进制那档量的仍是 base64 文本长度（比真实字节多约 1/3），
 * 但编辑器里存二进制走的是同一把尺（`MockResponseForm.vue:148`），导入与手工保存因此保持一致。
 */
function bodyOf(content: HarContent, contentType: string): HarResponseBody | null {
  const bodyType = inferBodyType(contentType)
  const text = content.text ?? ''
  const isBase64 = content.encoding === 'base64'
  // 空正文不猜编码：没有字节就没有可解的东西，204 那类照样导入
  if (text === '') return { body: '', bodyType }
  if (bodyType === 'binary') {
    return isBase64 ? { body: text, bodyType: 'binary', bodyEncoding: 'base64' } : null
  }
  if (!isBase64) return { body: text, bodyType }
  const decoded = base64ToText(text)
  return decoded == null
    ? { body: text, bodyType: 'binary', bodyEncoding: 'base64' }
    : { body: decoded, bodyType }
}

/**
 * 读不到正文时只回一句 detail（与解析层共用 `harBodyUnreadable`），交给调用方去计入跳过明细。
 * `contentType` 由调用方用 `contentTypeOf` 算好交进来——静态资源判定已经读过同一个值，这里再读一遍就是两条标准。
 * `statusCode` 越界不夹成 200（`responseFromLegacy` 那样做是因为旧记录压根没校验通道），留给阶段二报 `statusRange`。
 */
function responseOf(entry: HarEntry, contentType: string): { response: ProxyMock.MockResponseDef } | { unreadable: string } {
  const headers = sanitizeResponseHeaders(entry.response.headers)
  const body = bodyOf(entry.response.content, contentType)
  if (body == null) {
    return { unreadable: `encoding=${entry.response.content.encoding || '(missing)'} mimeType=${contentType || '(missing)'}` }
  }
  return { response: { statusCode: entry.response.status, headers, delayMs: 0, ...body } }
}

/**
 * 附录 B.3 的字段映射。**match 一律由既有的派生层产出**（`mock.derive.ts` 的 `analyzeMatchStability`，
 * 单条自成一组），因为这层要是自己拆一遍 URL，就会和匹配引擎的归一化结果分叉——症状是「导入了却不命中」。
 * 于是 host 恒为空串（Q2）、E2 高风险键剔进 `ignoreKeys`、E1 不自动忽略（单条没有跨录制证据）、
 * ID 形态段只出建议（单条不会自动参数化）全部是派生层的既有行为，不是这里新写的规则。
 *
 * `postData` 不入库：B.3 写的落点 `source.requestBody` 在模型里不存在，且全站没有任何界面读 Mock 记录的请求体
 * （只有代理记录显示 `requestData`）。原料仍留在解析层，见技术设计 §11 的 PRD 差异表。
 *
 * 每条单独调一次派生：`entry` 之间常常同接口不同参数，攒成一组就会触发 E1 自动忽略与 Path 自动参数化，
 * 那两条正是 B.3 明令「不自动」的。
 */
export function mapHarEntries(entries: HarEntry[], options?: HarMappingOptions): HarMappingResult {
  const skipped: HarSkipped[] = []
  const candidates: Array<{ entry: HarEntry, response: ProxyMock.MockResponseDef }> = []

  // 三道「这条要不要」的判定排在同一遍里：协议白名单、静态资源开关、正文报不报得出来。
  // 合成一遍不只是为了省一次循环——跳过明细因此始终按文件下标升序，展示层不必再排一次。
  for (const entry of entries) {
    const scheme = rejectedScheme(entry.request.url)
    if (scheme != null) {
      skipped.push({ entryIndex: entry.index, reason: 'harUnsupportedProtocol', detail: `scheme=${scheme}` })
      continue
    }
    const contentType = contentTypeOf(entry)
    const staticKind = options?.includeStatic === true ? null : staticKindOf(contentType)
    if (staticKind != null) {
      skipped.push({ entryIndex: entry.index, reason: 'harStaticResource', detail: `kind=${staticKind} mimeType=${contentType || '(missing)'}` })
      continue
    }
    const mapped = responseOf(entry, contentType)
    if ('unreadable' in mapped) {
      skipped.push({ entryIndex: entry.index, reason: 'harBodyUnreadable', detail: mapped.unreadable })
      continue
    }
    candidates.push({ entry, response: mapped.response })
  }

  // 上限判在候选数（= 这一次会写进库几条），不判文件里的 entry 总数：
  // 静态资源开关的全部意义就是把一份页面 HAR 收成可用的一小批，判总数会让那几百张图照样把整包顶回 1,000 条之外。
  // 排在派生之前是这个判定唯一的要求——超限的包不该先做 1,001 次 `analyzeMatchStability` 再被整包拒掉。
  // 与 `packRecordLimit`（判包内记录总数）同属「整包拒绝、零记录」，所以这里抛错而不返回部分结果。
  if (candidates.length > MOCK_HAR_MAX_ENTRIES) {
    throw new MockError('harEntryLimit', `parsed=${entries.length} candidates=${candidates.length} limit=${MOCK_HAR_MAX_ENTRIES}`)
  }

  const records: HarMappedRecord[] = []
  for (const { entry, response } of candidates) {
    // id / ruleId / 时间戳都是占位，只为让派生层吃下这条记录；真正写库时由 R4C-16/18 注入
    const draft: ProxyMock.MockRecord = {
      id: `har-${entry.index}`,
      ruleId: '',
      name: '',
      url: entry.request.url,
      response,
      variants: [],
      activeVariantId: null,
      source: {
        method: entry.request.method,
        url: entry.request.url,
        statusCode: entry.response.status,
        // 请求头进 `source.headers`：既有消费方（匹配测试台 `match.ts:413`）就是把它当请求头用的
        headers: entry.request.headers,
      },
      createdAt: 0,
      updatedAt: 0,
    }
    const [analysis] = analyzeMatchStability([draft], { source: 'import', analyzedAt: options?.analyzedAt })
    records.push({
      entryIndex: entry.index,
      // `url`、`matchFingerprint`、`matchInvalid` 都不填：它们是派生值（`mock.pack.ts:55`），手填等于绕过查重
      // `name` 也不填：交给 R4C-12 的默认值补齐，走 `packFieldDefaulted` 那条 notes 通道而不是这里编一个
      record: analysis?.match != null ? { match: analysis.match, response, source: draft.source } : { response, source: draft.source },
      suggestion: analysis?.pathSuggested != null
        ? { original: analysis.pathOriginal ?? analysis.match?.path ?? '', suggested: analysis.pathSuggested }
        : undefined,
    })
  }

  return { records, skipped }
}
