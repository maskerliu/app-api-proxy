import { constants } from 'node:fs'
import { access, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import path from 'path'
import { MockError } from '@shared/mock.errors'
import type { MockShareCode } from '@shared/mock.errors'
import {
  MOCK_SHARE_KEY_HEX, MOCK_SHARE_MANIFEST_FILE, MOCK_SHARE_MAX_FILE_BYTES, MOCK_SHARE_MAX_SCENE_BYTES,
  MOCK_SHARE_MAX_SCENES, MOCK_SHARE_MAX_SHARDS, MOCK_SHARE_SCENE_DIR,
  assertShareManifest, buildShareManifest, planShareShards, shareErrorDetailOf, shareSceneDigestOf,
  shareSceneKeyOf, shareShardFileOf, shareShardBytesOf, shareSkipsUnchanged,
} from '@shared/mock.share'
import type { MockShareManifest, MockShareSceneEntry, MockShareSceneInput, MockShareShard, MockShareStage } from '@shared/mock.share'
import { mergeShareScenePacks } from '@shared/mock.share'
import { MOCK_PACK_MAX_FILE_BYTES } from '@shared/mock.pack'
import type { MockPackV1 } from '@shared/mock.pack'
import type { ProxyMock } from '@shared/proxy.models'
import { readMockPackSceneParts } from './mock.pack.service'
import type { MockPackSceneParts, MockPackSource } from './mock.pack.service'

/**
 * 远端通道（PRD C1 / S-A1）：本期只有目录通道，但接口按「读侧 / 写侧」分开——
 * C4-1 说死本产品不提供任何写 URL 的能力，把写方法挂在同一个接口上就等于允许有人在 URL 分支上点「备份」。
 *
 * errno → 错误码的翻译只在这一处做（C5）：上面几层（备份执行器、恢复链路、IPC）不许再自己 `catch` errno，
 * 否则「远端证据 + 本地阶段」这两个字段会在第二处丢掉一半。
 */

/** 远端文件读回来的结果：`text` 是正文，`sha1`/`bytes` 是实测值，写侧拿它们填 manifest */
export interface MockShareReadResult {
  text: string
  sha1: string
  bytes: number
}

export interface MockShareReadOptions {
  /**
   * 文件不存在时报哪个码——同一个 ENOENT 在两个位置含义完全不同：
   * 读 `index.json` 读不到是「这个目录里还没有备份」（`remoteNotFound`），
   * 读清单上列出的分片读不到是「清单与实际不符」（`remoteCorrupted`）。
   */
  missing?: MockShareCode
  signal?: AbortSignal
}

/** 读侧两件事，目录通道与只读 URL 通道共用 */
export interface MockShareReadChannel {
  /** 只探测清单列出的名字，不提供目录遍历：网盘副本名、符号链接、被整个换掉的目录因此进不了我们的视野 */
  exists(name: string): Promise<boolean>
  read(name: string, options?: MockShareReadOptions): Promise<MockShareReadResult>
}

/** 目录通道多出来的两件事 */
export interface MockShareDirectoryChannel extends MockShareReadChannel {
  /** C1-2：不自动创建。目录不存在报 `remotePathMissing`，不可写报 `remoteForbidden` */
  assertWritable(stage?: MockShareStage): Promise<void>
  /** C1-3：先落 `.part` 再 rename，任何一步失败都要清掉 `.part` */
  write(name: string, text: string, signal?: AbortSignal): Promise<MockShareReadResult>
}

export interface MockShareErrorOptions {
  stage: MockShareStage
  missing?: MockShareCode
  /** 只有超长路径那一格需要它：Windows 上 >260 字符的写失败给的是 ENOENT，而不是 ENAMETOOLONG */
  target?: string
}

const FORBIDDEN = ['EACCES', 'EPERM']
/**
 * 「对面现在不是一张读得动的盘」而不是「盘上没有这个文件」——PRD 9.1 的中途拔盘与 RK-S6 的网盘占位文件
 * 都归到这里。报成 `remoteNotFound` 会把用户引去重新备份，报成 `remoteUnreachable` 才引他去查连接与客户端。
 */
const UNREACHABLE = [
  'EBUSY', 'ECANCELED', 'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTDOWN', 'EHOSTUNREACH',
  'EIO', 'ENETDOWN', 'ENETRESET', 'ENETUNREACH', 'ENODEV', 'ENOTCONN', 'EPFNOSUPPORT', 'EREMOTEIO',
  'ESHUTDOWN', 'ESTALE', 'ETIMEDOUT', 'ENFILE', 'ENOLCK', 'EMFILE',
]
/** 写这一侧的容量与路径问题（9.1 的只读挂载 / 磁盘满 / 超长路径）：码同一个，detail 里的 errno 保留区分 */
const WRITE_FAILED = ['EDQUOT', 'EEXIST', 'EFBIG', 'EINVAL', 'ENAMETOOLONG', 'ENOSPC', 'EROFS', 'EXDEV']

/** Windows 未开长路径支持时的实际可用长度，超过就按「路径过长」而不是「目录没了」交代 */
const LONG_PATH_THRESHOLD = 260

/** 取消不是失败归因：原样抛 AbortError，让上层把它变成「已取消」这个状态，而不是一个错误码 */
function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('share aborted')
    err.name = 'AbortError'
    throw err
  }
}

/**
 * errno → 码的唯一一处翻译。
 * 写侧的 ENOENT 说的是「目录在我们眼皮底下被移走了」，与读侧「这个文件不存在」不是一回事，
 * 所以 `missing` 只在读侧生效；而超长路径在 Windows 上同样给 ENOENT，只能拿目标长度再分一次（9.1）。
 */
export function toShareError(err: unknown, options: MockShareErrorOptions): MockError {
  if (err instanceof MockError) return err
  if (err instanceof Error && err.name === 'AbortError') throw err
  const code = String((err as NodeJS.ErrnoException)?.code ?? '')
  const evidence = code ? `errno=${code}` : shareErrorEvidence(err)
  const detail = shareErrorDetailOf(options.stage, evidence)
  if (FORBIDDEN.includes(code)) return new MockError('remoteForbidden', detail)
  if (UNREACHABLE.includes(code)) return new MockError('remoteUnreachable', detail)
  if (code === 'ENOENT') {
    if (options.stage !== 'write') return new MockError(options.missing ?? 'remoteNotFound', detail)
    const tooLong = (options.target?.length ?? 0) > LONG_PATH_THRESHOLD
    return new MockError(tooLong ? 'remoteWriteFailed' : 'remotePathMissing', detail)
  }
  if (options.stage === 'write' && WRITE_FAILED.includes(code)) return new MockError('remoteWriteFailed', detail)
  // 读侧碰上 ENOSPC/EROFS 这类只可能来自写的码，说明本机的问题比远端更大，按「连不上」交代最诚实
  return new MockError('remoteUnreachable', detail)
}

/** 没有 errno 的失败（非 fs 抛出的杂错）只带这么多个字符的证据：detail 会摊到界面上 */
function shareErrorEvidence(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.slice(0, 32)
}

/**
 * 名字 → 绝对路径。远端根目录是用户选的，不自动创建（C1-2）；`scenes/` 是我们的布局，
 * 随第一次备份创建——「不自动创建」拦的是拼错的远端地址被静默建成一个空目录，不是拦自己的子目录。
 */
function resolveSharePath(root: string, name: string): string {
  // 名字一律来自 manifest，`assertShareManifest` 已经把它钉成 `<12 hex>[.part-N].json`；
  // 这里再挡一次纯属纵深防御：越界的名字唯一的可能来源是有人手工改了 index.json。
  const target = path.resolve(root, ...name.split('/'))
  const base = path.resolve(root)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new MockError('remoteCorrupted', shareErrorDetailOf('read', `name=${name.slice(0, 32)}`))
  }
  return target
}

function digestOf(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex')
}

/**
 * 读一个远端文件并顺手算出摘要。
 * `stat` 报的 size 与实读字节数对不上也报 `remoteUnreachable`：网盘按需下载没落地、占位文件、
 * 同步中途被打断都是这个形状（RK-S6），而它们绝不能被当成「一份内容正确的文件」导进本地库。
 */
async function readOnce(root: string, name: string, options: MockShareReadOptions): Promise<MockShareReadResult> {
  const target = resolveSharePath(root, name)
  abortIfRequested(options.signal)
  let expected: number
  try {
    expected = (await stat(target)).size
  } catch (err) {
    throw toShareError(err, { stage: 'read', missing: options.missing, target })
  }
  let buffer: Buffer
  try {
    buffer = await readFile(target)
  } catch (err) {
    throw toShareError(err, { stage: 'read', missing: options.missing, target })
  }
  abortIfRequested(options.signal)
  // 以 `stat` 报的字节数为准，不看内容长度：网盘占位文件、按需下载没落地都在这一刻露形
  if (buffer.length !== expected) {
    throw new MockError('remoteUnreachable', shareErrorDetailOf('read', `short read ${buffer.length}/${expected}`))
  }
  const text = buffer.toString('utf8')
  return { text, sha1: digestOf(text), bytes: buffer.length }
}

/**
 * 原子写（C1-3）：`.part` → `sync` → `rename`。
 * 先 `sync` 再改名才是这条承诺的实质内容——不落盘就改名，崩溃后留下的正是那个「读不了的半包」；
 * 代价是每片多一次 flush，而备份本来就是用户点一下、愿意等的动作。
 * 失败路径必删 `.part`（AC-C-03：不许残留成正式名，也不许攒一堆半截文件）。
 */
async function writeOnce(root: string, name: string, text: string, signal?: AbortSignal): Promise<MockShareReadResult> {
  const target = resolveSharePath(root, name)
  const staging = `${target}.part`
  abortIfRequested(signal)
  try {
    await ensureSceneDir(target)
    let handle: Awaited<ReturnType<typeof open>>
    try {
      handle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o644)
    } catch (err) {
      throw toShareError(err, { stage: 'write', target })
    }
    try {
      await handle.writeFile(text, { encoding: 'utf8' })
      await handle.sync()
    } catch (err) {
      throw toShareError(err, { stage: 'write', target })
    } finally {
      await handle.close()
    }
    // 取消点放在 rename 之前：过了这一步远端就正式换版了，「取消」不该有第三种结果
    abortIfRequested(signal)
    try {
      await rename(staging, target)
    } catch (err) {
      throw toShareError(err, { stage: 'write', target })
    }
    return { text, sha1: digestOf(text), bytes: Buffer.byteLength(text, 'utf8') }
  } finally {
    await rm(staging, { force: true })
  }
}

/** `scenes/` 随正文第一次落地时创建；根目录不存在时这里不补，让上层按 `remotePathMissing` 报出去 */
async function ensureSceneDir(target: string): Promise<void> {
  const parent = path.dirname(target)
  if (!parent.endsWith(MOCK_SHARE_SCENE_DIR)) return
  try {
    await mkdir(parent, { recursive: true })
  } catch (err) {
    throw toShareError(err, { stage: 'write', target: parent })
  }
}

export function createDirectoryShareChannel(root: string): MockShareDirectoryChannel {
  return {
    async exists(name: string) {
      try {
        return (await stat(resolveSharePath(root, name))).isFile()
      } catch (err) {
        // 越界名是清单被手工改过的信号，不能因为「探测不到」就咽下去
        if (err instanceof MockError) throw err
        // 这里只回答「清单上这个名字在不在」，所以不区分「没有」与「盘不在」：
        // 需要区分的那一处（manifest 存在性）走 `read`，它的 ENOENT 才会翻成 `remoteNotFound`
        return false
      }
    },

    async read(name, options = {}) {
      return readOnce(root, name, { missing: options.missing ?? 'remoteNotFound', signal: options.signal })
    },

    async assertWritable(stage = 'list') {
      try {
        await access(root, constants.R_OK | constants.W_OK)
        if (!(await stat(root)).isDirectory()) {
          throw new MockError('remotePathMissing', shareErrorDetailOf(stage, 'not a directory'))
        }
      } catch (err) {
        // 路径填错在这一层是独立的一格：界面要说的是「把这个地址改对」，不是「这个目录里还没有备份」。
        // 不传 `missing` 的话 ENOENT 会一路滑成 `remoteNotFound`，把用户引去重新备份。
        throw toShareError(err, { stage, missing: 'remotePathMissing', target: root })
      }
    },

    async write(name, text, signal) {
      return writeOnce(root, name, text, signal)
    },
  }
}

/**
 * 读回来再与清单上的 sha1 对一次（C1-4）：不符即 `remoteCorrupted` 拒读。
 * 恢复链路是在这道闸门之后才可能碰本地库的，所以「拒读」与「本地库一个字节不动」是同一件事的两面（AC-C-04）。
 */
export async function readShareVerified(read: MockShareReadChannel, name: string, sha1: string,
  signal?: AbortSignal): Promise<string> {
  const result = await read.read(name, { missing: 'remoteCorrupted', signal })
  if (result.sha1 !== sha1) {
    throw new MockError('remoteCorrupted',
      shareErrorDetailOf('verify', `sha1=${result.sha1.slice(0, 8)} want=${sha1.slice(0, 8)}`))
  }
  return result.text
}

/**
 * 备份执行器（PRD C2 / S-A3）。三件事在这段里定死：范围恒为全部场景（C2-1，不给调用方留 ruleId 的口子）、
 * 脱敏恒开（C2-2，界面没有关闭项，这里也就不放一个能关掉的入参）、manifest 是唯一的提交点
 * （C2-3：场景文件先落、清单最后换）。
 */

/** 上一版清单留一份：上限三问第 1 行的「远端只留最新提交 + 一份 .bak」 */
const MOCK_SHARE_MANIFEST_BAK = `${MOCK_SHARE_MANIFEST_FILE}.bak`

function bytesOf(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** 计划里的一片：正文只在计划阶段持有，写完即释放——一片的大小上限就是那个 8MB 目标 */
export interface MockShareShardDraft extends MockShareShard {
  text: string
}

/** 一个场景在本次备份里的计划：`sha1` 与上一版清单同 key 那一项比对，就是「未变即跳过」的判定 */
export interface MockShareScenePlan {
  key: string
  name: string
  records: number
  /** 被拒（超上限）时是空数组 */
  shards: MockShareShardDraft[]
  sha1: string
  /** 没备份成的原因。只有超上限这一种走这条路，其余失败要抛出去打断整次备份（C2-5） */
  rejected?: { code: MockShareCode; detail: string }
}

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

export interface MockShareBackupRuntime {
  signal?: AbortSignal
  onProgress?: (p: MockShareBackupProgress) => void
  /** 备份时刻：注入只给用例断言 manifest 里那个读数用 */
  now?: number
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

/**
 * 按记录边界切片：一片的字节数 = 信封 + 各条记录 + 记录之间的逗号，即 `shareShardBytesOf` 那把尺。
 * 单条记录本身超过 8MB 时它独占一片，那一片就比目标大——一条记录没法从中间劈开，
 * 而 32MB 的场景硬上限仍在前面兜住。
 */
function planShareSceneShards(parts: MockPackSceneParts, key: string):
  { shards: MockShareShardDraft[]; rejected?: { code: MockShareCode; detail: string } } {
  const envelopeBytes = bytesOf(parts.before) + bytesOf(parts.after)
  const recordBytes = parts.records.map(bytesOf)
  const total = shareShardBytesOf(envelopeBytes, recordBytes)
  if (planShareShards(total).rejected) {
    return { shards: [], rejected: { code: 'sceneTooLargeForCloud', detail: `bytes=${total} limit=${MOCK_SHARE_MAX_SCENE_BYTES}` } }
  }
  const groups: number[][] = []
  for (let start = 0; start < recordBytes.length;) {
    let end = start
    let used = envelopeBytes + recordBytes[start]
    while (end + 1 < recordBytes.length && used + 1 + recordBytes[end + 1] <= MOCK_SHARE_MAX_FILE_BYTES) {
      end++
      used += 1 + recordBytes[end]
    }
    groups.push([start, end + 1])
    start = end + 1
  }
  if (groups.length > MOCK_SHARE_MAX_SHARDS) {
    // 这里拦的是按记录边界切出来的**实际**片数：条数不多但每条都很大时，`planShareShards` 按总体积
    // 换算出的 4 片装不下。宁可拒这一个场景，也不让某一片悄悄超过 8MB——那正是分片要绕开的东西。
    return { shards: [], rejected: { code: 'sceneTooLargeForCloud', detail: `shards=${groups.length} limit=${MOCK_SHARE_MAX_SHARDS}` } }
  }
  // 空场景也要留一片：`records:[]` 是唯一能区分「这个场景是空的」和「这个场景没备份」的形状
  const texts = groups.length === 0
    ? [`${parts.before}${parts.after}`]
    : groups.map(([from, to]) => `${parts.before}${parts.records.slice(from, to).join(',')}${parts.after}`)
  return {
    shards: texts.map((text, index) => ({ file: shareShardFileOf(key, index), sha1: digestOf(text), bytes: bytesOf(text), text }))
  }
}

/** 单场景的计划：走 `readMockPackSceneParts`，与本地导出同一段循环，脱敏与变体口径不可能在这里走偏 */
export async function planMockShareScene(source: MockPackSource, rule: ProxyMock.MockRule): Promise<MockShareScenePlan> {
  const parts = await readMockPackSceneParts(source, { scope: 'rule', ruleId: rule._id, redact: true })
  const key = shareSceneKeyOf(digestOf(rule._id))
  const { shards, rejected } = planShareSceneShards(parts, key)
  return {
    key,
    name: rule.name ?? '',
    records: parts.records.length,
    shards,
    sha1: shareSceneDigestOf(shards, digestOf),
    rejected,
  }
}

/** 清单正文：`null` 只表示「目录读得动但没有清单」（`remoteNotFound`），目录连不上照常抛 */
async function readManifestText(channel: MockShareReadChannel, signal?: AbortSignal): Promise<string | null> {
  try {
    return (await channel.read(MOCK_SHARE_MANIFEST_FILE, { signal })).text
  } catch (err) {
    const shareErr = toShareError(err, { stage: 'read', missing: 'remoteNotFound' })
    if (shareErr.code === 'remoteNotFound') return null
    throw shareErr
  }
}

function parseShareManifest(text: string): MockShareManifest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new MockError('remoteCorrupted', shareErrorDetailOf('read', 'manifest is not json'))
  }
  return assertShareManifest(value)
}

/** 严格读清单（恢复链路用）：坏清单就是坏清单，不许退化成「这个目录里还没有备份」 */
export async function readShareManifest(channel: MockShareReadChannel, signal?: AbortSignal): Promise<MockShareManifest | null> {
  const text = await readManifestText(channel, signal)
  return text == null ? null : parseShareManifest(text)
}

/**
 * 备份侧读上一版清单：坏清单按「没有可比对的版本」处理，但正文照旧留着当 `.bak`——
 * 用户手工改坏的那份文件是我们即将覆盖掉的唯一副本。
 * `remoteVersionTooNew` 不在放宽之列：拿旧格式的清单去覆盖新格式，等于把别人机器上的备份降级。
 */
async function readPrevManifestForBackup(channel: MockShareReadChannel, signal?: AbortSignal):
  Promise<{ text: string | null; scenes: Map<string, MockShareSceneEntry> }> {
  const text = await readManifestText(channel, signal)
  if (text == null) return { text: null, scenes: new Map() }
  try {
    return { text, scenes: new Map(parseShareManifest(text).scenes.map(entry => [entry.key, entry])) }
  } catch (err) {
    const shareErr = toShareError(err, { stage: 'read' })
    if (shareErr.code === 'remoteVersionTooNew') throw shareErr
    return { text, scenes: new Map() }
  }
}

export async function backupMockScenesToShare(source: MockPackSource, channel: MockShareDirectoryChannel,
  runtime: MockShareBackupRuntime = {}): Promise<MockShareBackupResult> {
  abortIfRequested(runtime.signal)
  await channel.assertWritable('write')
  const { text: prevText, scenes: prev } = await readPrevManifestForBackup(channel, runtime.signal)
  const rules = await source.listRules()
  if (rules.length > MOCK_SHARE_MAX_SCENES) {
    throw new MockError('shareSceneLimit', `scenes=${rules.length} limit=${MOCK_SHARE_MAX_SCENES}`)
  }
  const failed: MockShareBackupFailure[] = []
  const inputs: MockShareSceneInput[] = []
  let writtenBytes = 0
  let skipped = 0
  let progress: MockShareBackupProgress = {
    scenesDone: 0, sceneTotal: rules.length, records: 0, writtenBytes: 0, skipped: 0, failed: 0
  }
  runtime.onProgress?.(progress)

  for (const rule of rules) {
    // 取消点放在场景之间：一个场景内部不留断点，否则多片的场景被拦腰取消，
    // 上一版清单里的 sha1 就对不上新写出去的那几片，读侧只能整场拒读
    abortIfRequested(runtime.signal)
    const plan = await planMockShareScene(source, rule)
    const prevEntry = prev.get(plan.key)
    if (plan.rejected != null) {
      failed.push({
        key: plan.key, name: plan.name, records: plan.records, code: plan.rejected.code, detail: plan.rejected.detail
      })
      // 上次备份成功过的话，那份正文仍在远端：清单继续记它，条数记远端那份的，不记本地的新条数
      inputs.push({
        key: plan.key, name: plan.name, records: prevEntry?.records ?? 0,
        shards: prevEntry?.shards ?? [], skipped: { reason: plan.rejected.code, detail: plan.rejected.detail }
      })
    } else if (shareSkipsUnchanged(prevEntry, plan.sha1)) {
      skipped += 1
      // 连文件名与 sha1 一起沿用上一版：内容没变，一个字节都不必再写（C2-4）
      inputs.push({ key: plan.key, name: plan.name, records: plan.records, shards: prevEntry?.shards ?? [] })
    } else {
      const shards: MockShareShard[] = []
      for (const draft of plan.shards) {
        const written = await channel.write(`${MOCK_SHARE_SCENE_DIR}/${draft.file}`, draft.text, runtime.signal)
        shards.push({ file: draft.file, sha1: written.sha1, bytes: written.bytes })
        writtenBytes += written.bytes
      }
      inputs.push({ key: plan.key, name: plan.name, records: plan.records, shards })
    }
    progress = {
      scenesDone: progress.scenesDone + 1,
      sceneTotal: rules.length,
      records: progress.records + plan.records,
      writtenBytes,
      skipped,
      failed: failed.length,
    }
    runtime.onProgress?.(progress)
  }

  const now = runtime.now ?? Date.now()
  // 机器名哈希：清单要回答「哪台机器备份的」，但真实机器名常带用户名，出本机就得换成一串 hex
  const device = digestOf(hostname()).slice(0, MOCK_SHARE_KEY_HEX)
  const manifest = buildShareManifest(inputs, { now, device, digestOf })
  // 提交点。这两步之间崩溃留下的场景文件比清单新，读侧按 sha1 拒读、重跑一次备份即恢复（C2-3）
  if (prevText != null) await channel.write(MOCK_SHARE_MANIFEST_BAK, prevText, runtime.signal)
  await channel.write(MOCK_SHARE_MANIFEST_FILE, JSON.stringify(manifest), runtime.signal)

  let scenes = 0
  let records = 0
  let bytes = 0
  for (const entry of manifest.scenes) {
    if (entry.shards.length === 0) continue
    scenes += 1
    records += entry.records
    bytes += entry.bytes
  }
  return { scenes, records, bytes, writtenBytes, skipped, failed, createdAt: now, device }
}

/**
 * 备份前的「预计写入体积」（上限三问第 6 行）。算的是准数，代价是把库序列化一遍：
 * 不这么算只能报上次备份的体积，而「这次会写多少」正是未变即跳过之后唯一用户想知道的数。
 * 内存峰值与备份相同——一次只持有一个场景的正文。
 */
export async function estimateShareBackup(source: MockPackSource, channel: MockShareReadChannel):
  Promise<MockShareBackupEstimate> {
  const { scenes: prev } = await readPrevManifestForBackup(channel)
  const rules = await source.listRules()
  let records = 0
  let bytes = 0
  let writtenBytes = 0
  let skipped = 0
  const oversize: string[] = []
  for (const rule of rules) {
    const plan = await planMockShareScene(source, rule)
    records += plan.records
    if (plan.rejected != null) {
      oversize.push(plan.name)
      continue
    }
    const sceneBytes = plan.shards.reduce((sum, shard) => sum + shard.bytes, 0)
    bytes += sceneBytes
    if (shareSkipsUnchanged(prev.get(plan.key), plan.sha1)) {
      skipped += 1
      continue
    }
    writtenBytes += sceneBytes
  }
  return { scenes: rules.length, records, bytes, writtenBytes, skipped, oversize }
}

/** 正在进行的那一个备份任务：取消与「查看进度」都从这一份状态出（11.1） */
interface MockShareBackupSlot {
  controller: AbortController
  progress: MockShareBackupProgress
}

let backupSlot: MockShareBackupSlot | null = null

export function shareBackupProgress(): MockShareBackupProgress | null {
  return backupSlot == null ? null : { ...backupSlot.progress }
}

export function cancelShareBackup(): boolean {
  if (backupSlot == null) return false
  backupSlot.controller.abort()
  return true
}

/** 单任务槽：形态同 `MockPackService.importTask`——第二次触发直接拒，不排队 */
export async function runShareBackup(source: MockPackSource, channel: MockShareDirectoryChannel):
  Promise<MockShareBackupResult> {
  if (backupSlot != null) {
    const running = backupSlot.progress
    throw new MockError('shareInProgress', `scenes=${running.scenesDone}/${running.sceneTotal}`)
  }
  const controller = new AbortController()
  backupSlot = {
    controller,
    progress: { scenesDone: 0, sceneTotal: 0, records: 0, writtenBytes: 0, skipped: 0, failed: 0 }
  }
  try {
    return await backupMockScenesToShare(source, channel, {
      signal: controller.signal,
      onProgress: (p) => {
        if (backupSlot != null) backupSlot.progress = p
      }
    })
  } finally {
    backupSlot = null
  }
}

/**
 * 恢复链路（PRD C3 / S-A4）：这一段只负责把远端正文取成**一份合法的包文本**，
 * 落库一概是 R4 既有的预览/导入。
 *
 * 入参里只有 `MockShareReadChannel`，没有 `MockPackSource`——C3-4「恢复永不删本地」不是靠这里写得小心，
 * 而是靠这一层压根拿不到写库的手；能删本地的代码在这一层的调用方那边，那条链有它自己的用例。
 */

/** C3-1 清单上的一格：不下载正文就能报出来的那几个字段 */
export interface MockShareSceneSummary {
  key: string
  name: string
  records: number
  bytes: number
  /** 恢复这一个场景要按序读几个文件 */
  shards: number
}

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
 * 「读取并预览」的第一步：只读清单，不碰正文（C3-1）。
 * 清单缺失在这里是错误而不是空列表：备份侧把「没有上一版」当成正常起步，
 * 恢复侧同一个 `null` 要说的是「这个目录里还没有备份」，两种读法不能共用一个返回值。
 */
export async function readShareRemoteOverview(channel: MockShareReadChannel, signal?: AbortSignal):
  Promise<MockShareRemoteOverview> {
  const manifest = await readShareManifest(channel, signal)
  if (manifest == null) throw new MockError('remoteNotFound', shareErrorDetailOf('list', MOCK_SHARE_MANIFEST_FILE))
  const scenes: MockShareSceneSummary[] = []
  const unavailable: MockShareRemoteOverview['unavailable'] = []
  let records = 0
  let bytes = 0
  for (const entry of manifest.scenes) {
    if (entry.shards.length === 0) {
      unavailable.push({ key: entry.key, name: entry.name, reason: entry.skipped?.reason ?? 'no shards' })
      continue
    }
    scenes.push({
      key: entry.key, name: entry.name, records: entry.records, bytes: entry.bytes, shards: entry.shards.length
    })
    records += entry.records
    bytes += entry.bytes
  }
  const overview: MockShareRemoteOverview = { scenes, unavailable, records, bytes }
  if (manifest.createdAt != null) overview.createdAt = manifest.createdAt
  if (manifest.device != null) overview.device = manifest.device
  return overview
}

/** 一次恢复的产出：形状与用户自己「导出全部场景」的那个文件一致，导入侧分辨不出来源 */
export interface MockShareRestorePayload {
  text: string
  bytes: number
  scenes: number
}

/**
 * 取回选中的场景并拼成一个包（C3-6：分片场景在读侧合并成一个包，一次落库、一个结果，不逐片导入）。
 *
 * 顺序按清单而不是按点选顺序：预览页的明细行、重放同一次恢复得到的文本都得是同一个样子。
 * 体积闸门放在读之前——单场景 32MB、场景数 300，真让人「全选」时按清单声称的体积就已经可能超出
 * R4 那个 50MB 单包上限；那种情况宁可不下载也别把几个 GB 拼进内存，报的码沿用 R4 那句「请按场景拆分」。
 */
export async function restoreShareScenes(channel: MockShareReadChannel, keys: string[],
  signal?: AbortSignal): Promise<MockShareRestorePayload> {
  const manifest = await readShareManifest(channel, signal)
  if (manifest == null) throw new MockError('remoteNotFound', shareErrorDetailOf('list', MOCK_SHARE_MANIFEST_FILE))
  if (keys.length === 0) throw new MockError('packEmpty', shareErrorDetailOf('list', 'scenes=0'))
  const byKey = new Map(manifest.scenes.map(entry => [entry.key, entry]))
  for (const key of keys) {
    const entry = byKey.get(key)
    // 清单上没有这个名字：多半是列表停留在上一次备份、远端这中间又被重写过。不静默少导几个场景。
    if (entry == null) throw new MockError('remoteNotFound', shareErrorDetailOf('list', `key=${key}`))
    if (entry.shards.length === 0) {
      throw new MockError('remoteNotFound',
        shareErrorDetailOf('list', `key=${key} ${entry.skipped?.reason ?? 'no shards'}`))
    }
    if (entry.bytes > MOCK_SHARE_MAX_SCENE_BYTES) {
      throw new MockError('remoteCorrupted',
        shareErrorDetailOf('list', `bytes=${entry.bytes} limit=${MOCK_SHARE_MAX_SCENE_BYTES}`))
    }
  }
  const selected = new Set(keys)
  let planned = 0
  for (const entry of manifest.scenes) {
    if (selected.has(entry.key)) planned += entry.bytes
  }
  if (planned > MOCK_PACK_MAX_FILE_BYTES) {
    throw new MockError('packTooLarge', shareErrorDetailOf('list', `bytes=${planned} limit=${MOCK_PACK_MAX_FILE_BYTES}`))
  }

  const packs: MockPackV1[] = []
  for (const entry of manifest.scenes) {
    if (!selected.has(entry.key)) continue
    abortIfRequested(signal)
    const parts: MockPackV1[] = []
    for (const shard of entry.shards) {
      // 逐片按清单上的 sha1 验过才拼：拼起来的那个包的摘要没有任何东西能背书，只有每片各自对得上，
      // 合并结果才还是备份时写出去的那些字节（AC-C-04 的「拒读、不改本地库」就在这一步之前）
      const text = await readShareVerified(channel, `${MOCK_SHARE_SCENE_DIR}/${shard.file}`, shard.sha1, signal)
      parts.push(parseShareShard(text, entry.key))
    }
    packs.push(mergeShareScenePacks(parts))
  }
  const text = JSON.stringify(combineShareScenePacks(packs))
  return { text, bytes: bytesOf(text), scenes: packs.length }
}

/**
 * 片正文只解析到「能拼回去」的程度：版本闸门、条数上限、字段归一化仍是 `readMockPackText` 的活。
 * 在这里重跑一遍会把「请升级应用」那种明确的说法降级成含义不明的远端错误（同 `unwrapShareRemoteText`）。
 */
function parseShareShard(text: string, key: string): MockPackV1 {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new MockError('remoteCorrupted', shareErrorDetailOf('read', `key=${key} is not json`))
  }
  if (typeof value !== 'object' || value === null || !Array.isArray((value as MockPackV1).rules)) {
    throw new MockError('remoteCorrupted', shareErrorDetailOf('read', `key=${key} has no rules`))
  }
  return value as MockPackV1
}

/**
 * 多个单场景包并成一个多场景包。信封取第一份，`appVersion` 允许各场景不同——
 * 那正是「两台机器分别备份过」的正常形状，把它当成冲突拒读等于把能用的备份判死。
 * 不带 `exportedAt`：备份侧本来就不写它（否则内容寻址的「未变即跳过」永远不成立），
 * 恢复侧凭空补一个时刻等于改动正文。
 */
function combineShareScenePacks(packs: MockPackV1[]): MockPackV1 {
  const first = packs[0]
  if (first == null) throw new MockError('packEmpty', shareErrorDetailOf('list', 'scenes=0'))
  return {
    format: first.format,
    version: first.version,
    appVersion: first.appVersion,
    rules: packs.flatMap(pack => pack.rules),
  }
}
