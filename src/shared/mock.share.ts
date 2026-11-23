import { MockError } from './mock.errors'
import type { MockShareCode } from './mock.errors'
import { MOCK_PACK_FORMAT, describeValue } from './mock.pack'
import type { MockPackRecord, MockPackV1 } from './mock.pack'

/**
 * 云共享（远端目录 / 只读 URL 订阅）契约的唯一真源：manifest 形状、分片命名与合并、上限与超时、
 * 远端错误的归因字段。需求口径见 docs/PRD-v1.3-Mock数据云共享.md 第 6 节。
 *
 * 这一层保持环境中立——不算哈希、不碰 fs、不发请求：摘要由主进程算成十六进制串再传进来，
 * 字节数由持有 Buffer 的一侧算好传进来（与 `mock.pack.ts` 的 `readMockPackText` 同一个理由，
 * 在共享层自己编码一次就等于为大正文凭空多备一份副本）。渲染层、单测与主进程因此共用同一套判定，
 * PRD 9.1/9.2 两张等价类表不起 Electron 也能跑。
 */

export const MOCK_SHARE_MANIFEST_FORMAT = 'appapi-mock-share'
export const MOCK_SHARE_MANIFEST_VERSION = 1
/** manifest 的文件名：远端目录里只有这一个入口，其余正文都靠它列出来 */
export const MOCK_SHARE_MANIFEST_FILE = 'index.json'
/** 场景正文所在的子目录名 */
export const MOCK_SHARE_SCENE_DIR = 'scenes'

/**
 * 文件名只用 `sha1(ruleId)` 的前这么多位十六进制（PRD 6.1）。
 * 用场景名哈希会让「改名」换 key——旧文件留在远端，恢复时把改名前的场景当第二个场景导回来产生副本；
 * 顺带把「中文、空格、emoji、500 字符、CON/NUL 保留名、大小写不敏感」这一整列等价类从文件名上消掉。
 */
export const MOCK_SHARE_KEY_HEX = 12

/** 单个远端文件的**目标**体积：超过就分下一片。8MB 是取整留余量的目标值，硬约束是下面的片数上限 */
export const MOCK_SHARE_MAX_FILE_BYTES = 8 * 1024 * 1024
/** 单场景最多 4 片 ⇒ 云侧单场景硬上限，超过拒绝该场景、其余照常备份（C2-5） */
export const MOCK_SHARE_MAX_SHARDS = 4
/** 单次目录列举按 750 项的服务商限制取一半余量，给冲突副本留位置（PRD 6.4） */
export const MOCK_SHARE_MAX_SCENES = 300
/** 未变即跳过不可关（Q5 裁决：给了开关就等于把额度约束变成用户可关的选项） */
export const MOCK_SHARE_SKIP_UNCHANGED = true
export const MOCK_SHARE_CONNECT_TIMEOUT = 10_000
/** 60s 与 `update.runner.ts` 的 `DOWNLOAD_TIMEOUT` 同值：两处都是「整段正文在链路上」的读 */
export const MOCK_SHARE_READ_TIMEOUT = 60_000
/** 只对幂等 GET 退避重试；本期没有远端自动重试写 */
export const MOCK_SHARE_GET_RETRIES = 3
/** 跟随 301/302 的次数上限（GitHub → CDN 是典型用例，跟不到按实际状态分报） */
export const MOCK_SHARE_MAX_REDIRECTS = 3

/** 云侧单场景硬上限 = 目标体积 × 片数上限；URL 订阅读到超大响应时也拿它拒而不落盘 */
export const MOCK_SHARE_MAX_SCENE_BYTES = MOCK_SHARE_MAX_FILE_BYTES * MOCK_SHARE_MAX_SHARDS

/** 场景级摘要的材料前缀：换前缀等于换算法，老 manifest 的 sha1 会整体失效而不是悄悄改成另一种算法 */
export const MOCK_SHARE_DIGEST_TAG = 'appapi-mock-share-scene-v1'

/**
 * 用户在设置页选的那一种远端（PRD 10 节第 1 项）。`off` 是默认值，也是「除版本检查外零对外请求」
 * 那条承诺的落点（C6/AC-C-11）：拦在配置这一层，而不是只把界面按钮藏起来。
 */
export const MOCK_SHARE_CHANNELS = ['off', 'dir', 'url'] as const
export type MockShareChannel = typeof MOCK_SHARE_CHANNELS[number]

export interface MockShareConfig {
  channel: MockShareChannel
  /** `channel='dir'` 时的远端目录；不自动创建（C1-2） */
  dir?: string
  /** `channel='url'` 时订阅的地址，只读 */
  url?: string
}

/**
 * 配置文件里的这一段是用户能手工编辑的，所以归一化不信任读到的值：认不出的通道一律回 `off`。
 * 宁可让用户多点一次「选择目录」，也不要拿着一个残缺配置去发请求或写盘——
 * 缺目录时的 `remotePathMissing` 与「没开」是两种交代，这里就先分开。
 */
export function normalizeMockShareConfig(raw: unknown): MockShareConfig {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const channel = MOCK_SHARE_CHANNELS.includes(value.channel as MockShareChannel)
    ? value.channel as MockShareChannel : 'off'
  const config: MockShareConfig = { channel }
  if (typeof value.dir === 'string' && value.dir.trim() !== '') config.dir = value.dir.trim()
  if (typeof value.url === 'string' && value.url.trim() !== '') config.url = value.url.trim()
  return config
}

/**
 * 下面几块是主进程交给渲染层的读数（IPC 的载荷，因此与 `MockPackPreviewResult` 同层）。
 * 放在共享层不是为了复用逻辑，而是因为 `IMainAPI` 的返回类型要能指到它们——
 * 在 `ipc.api.ts` 里另抄一份同形状的接口，就等于允许两边说法不一致。
 */

export interface MockShareBackupProgress {
  scenesDone: number
  sceneTotal: number
  records: number
  /** 本次真正写出去的字节：跳过的场景不计，那才是「月度上传流量 1GB」那一问要看的数 */
  writtenBytes: number
  skipped: number
  failed: number
}

/** 本次没备份成的场景，供结果页那一行「N 个场景未备份」（C2-5 / C2-8） */
export interface MockShareBackupFailure {
  key: string
  name: string
  records: number
  code: MockShareCode
  detail: string
}

export interface MockShareBackupResult {
  /** 远端此刻真正存得住内容的场景数：超限失败且上次也没备份成的不计 */
  scenes: number
  records: number
  bytes: number
  writtenBytes: number
  /** 内容未变而跳过的场景数（C2-4） */
  skipped: number
  failed: MockShareBackupFailure[]
  createdAt: number
  device: string
}

export interface MockShareBackupEstimate {
  /** 本地场景总数（受 300 上限约束的就是这个数） */
  scenes: number
  records: number
  /** 全部能备份的场景的正文合计，与远端在管体积同一把尺 */
  bytes: number
  /** 其中真正会写出去的那部分：未变的场景已经跳过 */
  writtenBytes: number
  skipped: number
  /** 超上限、这次不会备份出去的场景名 */
  oversize: string[]
}

/** C3-1 清单上的一格：不下载正文就能报出来的那几个字段 */
export interface MockShareSceneSummary {
  key: string
  name: string
  records: number
  bytes: number
  /** 恢复这一个场景要按序读几个文件 */
  shards: number
}

/** 恢复前的远端概览（C3-1）：只列读得到的，读不到的另说一格 */
export interface MockShareRemoteOverview {
  scenes: MockShareSceneSummary[]
  /**
   * 清单上列了名字却没有正文的场景（上次备份被拒的那几个）。
   * 下面的 `records`/`bytes` 只统计可恢复的场景：被拒那一项记的条数是「本来想备份多少条」，
   * 把它算进「远端有 N 条可恢复」是虚报。
   */
  unavailable: { key: string; name: string; reason: string }[]
  records: number
  bytes: number
  /** 上次备份时间与来源设备代号（6.2：这两个值只在清单里，正文里没有第二个口径） */
  createdAt?: number
  device?: string
}

/**
 * 「测试连接」的回执。两种通道的信息量不同：目录那边有清单，能报场景数与上次备份信息；
 * URL 那边只有一个正文，没有清单可数，所以那几项是 `undefined` 而不是 0——
 * 「没数过」与「远端是空的」在这一格上必须区分得开。
 */
export interface MockShareCheckResult {
  channel: MockShareChannel
  bytes: number
  scenes?: number
  records?: number
  createdAt?: number
  device?: string
}

export interface MockShareShard {
  /** `scenes/` 下的文件名（不带目录前缀），由 `shareShardFileOf` 生成 */
  file: string
  /** 该片正文的 sha1（40 位小写十六进制） */
  sha1: string
  /** 该片正文的 UTF-8 字节数 */
  bytes: number
}

/** 本次没备份成的场景与原因，供结果页交代（6.2）；正文若上一次备份成功过，它的分片仍留在远端可读 */
export interface MockShareSkipped {
  reason: MockShareCode | string
  detail?: string
}

export interface MockShareSceneEntry {
  key: string
  /** 只供人读；改名不换 key */
  name: string
  records: number
  /** 各片字节数合计——不另存「正文大小」这种第二个口径 */
  bytes: number
  /** 各片 sha1 按序合并后的摘要：内容未变的判定就只比这一个值（C2-4） */
  sha1: string
  shards: MockShareShard[]
  skipped?: MockShareSkipped
}

export interface MockShareManifest {
  format: string
  version: number
  /** 上次备份时间；缺失只影响显示，不影响读（6.2） */
  createdAt?: number
  /** 机器名哈希，不存真实机器名 */
  device?: string
  scenes: MockShareSceneEntry[]
}

/** 写侧交给 manifest 的场景：`shards` 的 sha1/bytes 必须是主进程实测值，这里不重算也不信任估算 */
export interface MockShareSceneInput {
  key: string
  name: string
  records: number
  shards: MockShareShard[]
  skipped?: MockShareSkipped
}

export interface MockShareManifestMeta {
  /** 备份时刻（epoch ms） */
  now: number
  /** 机器名哈希 */
  device: string
  /** 主进程传 `(text) => createHash('sha1').update(text).digest('hex')`；共享层不引 crypto */
  digestOf: (source: string) => string
}

/** C5 要求的「本地阶段」：远端证据只能说明对面发生了什么，这四个值说明我们当时在做哪一步 */
export const MOCK_SHARE_STAGES = ['list', 'read', 'write', 'verify', 'import'] as const
export type MockShareStage = typeof MOCK_SHARE_STAGES[number]

/** 判定失败时带出去的正文开头，只截这么多字符：登录墙 HTML 的头几十字足够定位，不需要整页 */
const MOCK_SHARE_HEAD_CHARS = 32

const KEY_RE = new RegExp(`^[0-9a-f]{${MOCK_SHARE_KEY_HEX}}$`)
const SHA1_RE = /^[0-9a-f]{40}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function corrupted(detail: string): MockError {
  return new MockError('remoteCorrupted', detail)
}

/** `digestHex` 是主进程对场景 `_id` 取的 sha1；只截不校验，非十六进制进不来这一层（写侧的输入是 crypto 的输出） */
export function shareSceneKeyOf(digestHex: string): string {
  return digestHex.slice(0, MOCK_SHARE_KEY_HEX).toLowerCase()
}

/** 第 1 片就是 `<key>.json`，往后 `<key>.part-2.json`（PRD 6.1 的布局） */
export function shareShardFileOf(key: string, index: number): string {
  return index === 0 ? `${key}.json` : `${key}.part-${index + 1}.json`
}

/** 一个场景在 `scenes/` 下占用的全部文件名，顺序即读取与拼接顺序 */
export function shareShardFilesOf(entry: MockShareSceneEntry): string[] {
  return entry.shards.map(shard => shard.file)
}

/** 分片计划：`bytes` 是正文合计（预估值），给「预计写入体积」和上限判定用同一把尺 */
export interface MockShareShardPlan {
  /** 计划写入的片数，至少 1 */
  shards: number
  /** 超过片数上限 ⇒ 该场景拒绝备份，提示改用本地文件导出（C2-5） */
  rejected: boolean
}

export function planShareShards(bytes: number): MockShareShardPlan {
  const shards = Math.max(1, Math.ceil(Math.max(0, bytes) / MOCK_SHARE_MAX_FILE_BYTES))
  return { shards, rejected: shards > MOCK_SHARE_MAX_SHARDS }
}

/**
 * 一片正文的字节数：`envelopeBytes` 用「records 为空」的同构包实测，逐条记录单独实测。
 * 那个 `+ count - 1` 是记录之间的逗号——漏了它，几千条记录就能低估出上百 KB，
 * 分片边界随之整体偏移，而偏移只体现在「某一片比目标大一点」这种没人复核的地方。
 */
export function shareShardBytesOf(envelopeBytes: number, recordBytes: number[]): number {
  if (recordBytes.length === 0) return envelopeBytes
  const total = recordBytes.reduce((sum, bytes) => sum + bytes, 0)
  return envelopeBytes + total + recordBytes.length - 1
}

/** 场景级摘要的材料：片序参与哈希，所以「同样的两片换个顺序」也会被视为变了 */
export function shareDigestSourceOf(shardSha1s: string[]): string {
  return [MOCK_SHARE_DIGEST_TAG, ...shardSha1s].join('\n')
}

export function shareSceneDigestOf(shards: MockShareShard[], digestOf: (source: string) => string): string {
  return digestOf(shareDigestSourceOf(shards.map(shard => shard.sha1)))
}

/**
 * 未变即跳过的判定单源在此：只比场景级 sha1，因为它已经把每片的字节数与顺序都吃进去了。
 * 比较的对象是上一版 manifest 里同 key 那一项。
 * 改名会重传那一个场景：规则名在单场景包的正文里（`rules[0].name`），换了名字字节就换了；
 * 换 key 的仍然只有 `_id`，所以「网盘里旧场景文件变成孤儿副本」那一格依旧由构造消掉。换机不换 sha1。
 */
export function shareSkipsUnchanged(prev: MockShareSceneEntry | undefined, sha1: string): boolean {
  return MOCK_SHARE_SKIP_UNCHANGED && prev != null && prev.sha1 === sha1
}

/**
 * 组装 manifest（提交点的内容）。场景按 key 排序：manifest 既是提交点也是排查时人要对的文件清单，
 * 顺序稳定才能让两次备份的清单逐行可比，重复 key 也才能在这里当场拦住而不是留到读侧猜。
 */
export function buildShareManifest(scenes: MockShareSceneInput[], meta: MockShareManifestMeta): MockShareManifest {
  if (scenes.length > MOCK_SHARE_MAX_SCENES) {
    throw new MockError('shareSceneLimit', `scenes=${scenes.length} limit=${MOCK_SHARE_MAX_SCENES}`)
  }
  const sorted = [...scenes].sort((a, b) => (a.key === b.key ? 0 : a.key < b.key ? -1 : 1))
  const entries: MockShareSceneEntry[] = sorted.map(scene => {
    const entry: MockShareSceneEntry = {
      key: scene.key,
      name: scene.name,
      records: scene.records,
      bytes: scene.shards.reduce((sum, shard) => sum + shard.bytes, 0),
      sha1: shareSceneDigestOf(scene.shards, meta.digestOf),
      shards: scene.shards,
    }
    if (scene.skipped != null) entry.skipped = scene.skipped
    return entry
  })
  return {
    format: MOCK_SHARE_MANIFEST_FORMAT,
    version: MOCK_SHARE_MANIFEST_VERSION,
    createdAt: meta.now,
    device: meta.device,
    scenes: entries,
  }
}

function assertShareShard(raw: unknown, key: string, index: number): MockShareShard {
  if (!isRecord(raw)) throw corrupted(`scenes[${key}].shards[${index}] is ${describeValue(raw)}`)
  // 文件名按 key 与下标反推：这一条同时挡住三件事——网盘冲突副本名 `xxx(1).json`、
  // 手工挪进来的别的目录里的文件，以及 `../../` 那种把读取点搬出远端根目录的写法。
  const file = shareShardFileOf(key, index)
  if (raw.file !== file) throw corrupted(`shards[${index}].file=${describeValue(raw.file)} want=${file}`)
  if (typeof raw.sha1 !== 'string' || !SHA1_RE.test(raw.sha1)) {
    throw corrupted(`shards[${index}].sha1=${describeValue(raw.sha1)}`)
  }
  if (!Number.isInteger(raw.bytes) || (raw.bytes as number) < 0) {
    throw corrupted(`shards[${index}].bytes=${describeValue(raw.bytes)}`)
  }
  return { file, sha1: raw.sha1, bytes: raw.bytes as number }
}

function assertShareScene(raw: unknown, index: number): MockShareSceneEntry {
  if (!isRecord(raw)) throw corrupted(`scenes[${index}] is ${describeValue(raw)}`)
  if (typeof raw.key !== 'string' || !KEY_RE.test(raw.key)) {
    throw corrupted(`scenes[${index}].key=${describeValue(raw.key)}`)
  }
  if (typeof raw.name !== 'string') throw corrupted(`${raw.key}.name=${describeValue(raw.name)}`)
  if (!Number.isInteger(raw.records) || (raw.records as number) < 0) {
    throw corrupted(`${raw.key}.records=${describeValue(raw.records)}`)
  }
  const skipped = isRecord(raw.skipped) ? {
    reason: typeof raw.skipped.reason === 'string' ? raw.skipped.reason : describeValue(raw.skipped.reason),
    ...(typeof raw.skipped.detail === 'string' ? { detail: raw.skipped.detail } : {}),
  } : undefined
  if (!Array.isArray(raw.shards)) throw corrupted(`${raw.key}.shards is ${describeValue(raw.shards)}`)
  // 未备份成的场景可以没有分片（首次就失败），其余情况至少一片；片数上限在读侧也判一次：
  // 远端文件是别人手得着的，写侧那道闸拦住的是自己，这一道拦住的是「清单已经不像我们写的」。
  if (raw.shards.length === 0 && skipped == null) throw corrupted(`${raw.key}.shards=0`)
  if (raw.shards.length > MOCK_SHARE_MAX_SHARDS) {
    throw corrupted(`${raw.key}.shards=${raw.shards.length} limit=${MOCK_SHARE_MAX_SHARDS}`)
  }
  const shards = raw.shards.map((shard, i) => assertShareShard(shard, raw.key as string, i))
  const entry: MockShareSceneEntry = {
    key: raw.key,
    name: raw.name,
    records: raw.records as number,
    bytes: shards.reduce((sum, shard) => sum + shard.bytes, 0),
    sha1: typeof raw.sha1 === 'string' ? raw.sha1 : '',
    shards,
  }
  if (skipped != null) entry.skipped = skipped
  // 场景级 sha1 是从分片摘要合成的，重算要 crypto（归 verify 阶段）；这里只挡形状——
  // 「列了分片却没有 40 位十六进制」的清单一定是被人动过的。
  if (shards.length > 0 && !SHA1_RE.test(entry.sha1)) throw corrupted(`${entry.key}.sha1=${describeValue(entry.sha1)}`)
  if (entry.shards.length > 0 && entry.bytes !== raw.bytes) {
    throw corrupted(`${entry.key}.bytes=${describeValue(raw.bytes)} want=${entry.bytes}`)
  }
  return entry
}

/**
 * 读侧的 manifest 闸门：只信清单列出的名字，不遍历目录（PRD 9.1「符号链接/目录被替换 ⇒ 天然免疫」）。
 * 抛 `remoteCorrupted` 即拒读，恢复链路在这一步之后才可能碰本地库。
 */
export function assertShareManifest(value: unknown): MockShareManifest {
  if (!isRecord(value)) throw corrupted(`top level is ${describeValue(value)}`)
  // manifest 只由本产品写进备份目录，认不出 format 就是「这个目录里躺着别人的 index.json」
  if (value.format !== MOCK_SHARE_MANIFEST_FORMAT) throw corrupted(`format=${describeValue(value.format)}`)
  const version = value.version
  if (!Number.isInteger(version) || (version as number) < 1) throw corrupted(`version=${describeValue(version)}`)
  // 兼容性只认 version，且过高即拒读、不静默降级（6.2）
  if ((version as number) > MOCK_SHARE_MANIFEST_VERSION) {
    throw new MockError('remoteVersionTooNew', `version=${version} supported=${MOCK_SHARE_MANIFEST_VERSION}`)
  }
  if (!Array.isArray(value.scenes)) throw corrupted(`scenes is ${describeValue(value.scenes)}`)
  const scenes = value.scenes.map((scene, i) => assertShareScene(scene, i))
  const seen = new Set<string>()
  for (const scene of scenes) {
    if (seen.has(scene.key)) throw corrupted(`key=${scene.key} duplicated`)
    seen.add(scene.key)
  }
  const manifest: MockShareManifest = {
    format: MOCK_SHARE_MANIFEST_FORMAT,
    version: MOCK_SHARE_MANIFEST_VERSION,
    scenes,
  }
  if (Number.isFinite(value.createdAt)) manifest.createdAt = value.createdAt as number
  if (typeof value.device === 'string') manifest.device = value.device
  return manifest
}

/** 预览阶段给 UI 的远端概况：不下载正文就能报场景数、记录数与体积（6.2 的 `scenes[]` 用途） */
export function shareManifestStatsOf(manifest: MockShareManifest): {
  scenes: number
  records: number
  bytes: number
  skipped: number
} {
  let records = 0
  let bytes = 0
  let skipped = 0
  for (const scene of manifest.scenes) {
    records += scene.records
    bytes += scene.bytes
    if (scene.skipped != null) skipped += 1
  }
  return { scenes: manifest.scenes.length, records, bytes, skipped }
}

/**
 * 订阅 URL 的响应形态判定（C4-2，顺序固定）：先按裸包，形如 `{code, data}` 时取 `data.content`。
 * 判的是**形状**而不是「能不能导入」——裸包本身 version 过高、条数超上限这些要在下一道闸门
 * （`readMockPackText`）里报成 `packVersionUnsupported` / `packRecordLimit`，
 * 在这里就判失败会把「请升级」那句降级成含义完全不同的 `remoteShapeUnknown`。
 * Content-Type 不参与判定：网盘与静态目录经常给错类型（PRD 9.2）。
 */
export function unwrapShareRemoteText(text: string | undefined): string {
  if (text == null || text.trim() === '') throw new MockError('remoteShapeUnknown', 'empty body')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new MockError('remoteShapeUnknown', `head=${describeValue(text.slice(0, MOCK_SHARE_HEAD_CHARS))}`)
  }
  if (isRecord(value) && value.format === MOCK_PACK_FORMAT) return text
  if (isRecord(value) && isRecord(value.data) && typeof value.data.content === 'string') {
    return value.data.content
  }
  throw new MockError('remoteShapeUnknown', `top level is ${describeValue(value)}`)
}

/**
 * 分片场景在读侧合并成一个包，再走一次导入（C3-6）：不逐片导入，否则一个场景被拆成 N 次落库与 N 次结果。
 * 入参顺序就是 manifest 里的顺序；除 records 之外任何字段不一致都是清单与实际不符。
 */
export function mergeShareScenePacks(parts: MockPackV1[]): MockPackV1 {
  const first = parts?.[0]
  if (first == null) throw corrupted('parts=0')
  if (first.rules.length !== 1) throw corrupted(`rules=${describeValue(first.rules.length)}`)
  const shape = sharePackShapeOf(first)
  const records: MockPackRecord[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (sharePackShapeOf(part) !== shape) throw corrupted(`part=${i} shape`)
    records.push(...(part.rules[0]?.records ?? []))
  }
  return { ...first, rules: [{ ...first.rules[0], records }] }
}

/** 一个分片包除正文之外的全部字段——分片之间必须逐字节相同，否则拼起来的那个包不知道以哪片为准 */
function sharePackShapeOf(pack: MockPackV1): string {
  return JSON.stringify({ ...pack, rules: [{ ...pack.rules[0], records: [] }] })
}

/**
 * C5 的两个可诊断字段拼成一条 detail：`stage=read errno=ENOENT`、`stage=read status=404`。
 * 证据串走 `describeValue` 截断——detail 会进响应体也会被界面原样摊出来，不能把对面返回的一段 HTML
 * 当成诊断信息带出去（R4 用的是同一把尺 `MOCK_PACK_DETAIL_MAX_CHARS`）。
 */
export function shareErrorDetailOf(stage: MockShareStage, evidence?: unknown): string {
  if (evidence == null || evidence === '') return `stage=${stage}`
  return `stage=${stage} ${describeValue(String(evidence))}`
}
