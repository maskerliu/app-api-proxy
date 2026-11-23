import { constants } from 'node:fs'
import { access, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'path'
import { MockError } from '@shared/mock.errors'
import type { MockShareCode } from '@shared/mock.errors'
import { MOCK_SHARE_SCENE_DIR, shareErrorDetailOf } from '@shared/mock.share'
import type { MockShareStage } from '@shared/mock.share'

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
