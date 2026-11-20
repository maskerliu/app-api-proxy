import { MockError } from '@shared/mock.errors'
import type { MockErrorCode } from '@shared/mock.errors'
import { MOCK_PACK_FORMAT, MOCK_PACK_MAX_FILE_BYTES } from '@shared/mock.pack'

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
  /** multipart/表单式上传里的文件名，只在 `source.requestBody` 里有展示价值 */
  fileName: string
}

export interface HarRequest {
  /** 缺失给空串，不补 `GET`：猜方法等于替用户造一条永远不会命中的规则，比空着更难查 */
  method: string
  /** `#` 之后已丢弃（技术设计 §9）。host/path/query 一律留给 R4C-22 用 `shared/url.ts` 拆 */
  url: string
  headers: HarHeaders
  mimeType: string
  /** `postData.text`；没有为 null。与 `params` 同时存在时两份都留着——取哪一份进 `source.requestBody` 是映射的决定 */
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

/** 条目级跳过：原因只允许是 §9 认下的 `harNoResponse` / `harBodyUnreadable`，这层不发明第三种 */
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
 * entry 条数上限（`harEntryLimit`）不在这一步——判不判静态资源会改变「有几条 entry」，那是 R4C-24 的口径。
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
 * 阶段一之后、映射之前的逐条解析：只把「读得到的」交出去，读不到的按 §9 归成两种跳过原因。
 * 不判协议白名单（R4C-22 用 `toAbsoluteTarget` 拒）、不解码 base64（R4C-23）、不筛静态资源（R4C-24）——
 * 这三件事各有裁决，且都不改变「这条 entry 有没有响应正文」的答案。
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
