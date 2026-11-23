import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'path'
import { registerHooks } from 'node:module'
import { after, describe, it } from 'node:test'
import type { ProxyMock } from '@shared/proxy.models'
import { MOCK_PACK_FORMAT, MOCK_PACK_MAX_FILE_BYTES, MOCK_PACK_VERSION, readMockPackText } from '@shared/mock.pack'
import type { MockPackV1 } from '@shared/mock.pack'
import { MockError } from '@shared/mock.errors'
import {
  MOCK_SHARE_MANIFEST_FILE, MOCK_SHARE_MAX_FILE_BYTES, MOCK_SHARE_MAX_SCENE_BYTES, MOCK_SHARE_SCENE_DIR,
  assertShareManifest, shareShardFileOf,
} from '@shared/mock.share'
import type { MockShareManifest } from '@shared/mock.share'
import { makeMatch, makeRecord } from './fixtures'

// 备份侧要 `readMockPackSceneParts`（住在 `mock.pack.service`，那条链经 constants 引用 electron）；
// 替身只要能被 import 就够，恢复这一段自己一个库原语都不碰。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>"",getVersion:()=>"0.0.0-test"}',
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const {
  backupMockScenesToShare, createDirectoryShareChannel, readShareRemoteOverview, restoreShareScenes,
} = await import('@main/service/mock.share')

/**
 * 恢复链路（PRD C3 / S-A4）的用例。跑真实文件系统（`os.tmpdir()` 下的临时目录，绝不碰用户数据目录），
 * 并且**先备份再恢复**：往返是这一层唯一能自证的形态——拼装、分片命名、清单口径写错任何一个字，
 * 恢复这一段立刻读不回来。
 */

const MB = 1024 * 1024
const bases: string[] = []
type Channel = ReturnType<typeof createDirectoryShareChannel>
type ReadChannel = Parameters<typeof restoreShareScenes>[0]

class FakeSource {
  rules: ProxyMock.MockRule[] = []
  records: Map<string, ProxyMock.MockRecord[]> = new Map()

  async listRules() {
    return this.rules
  }

  async getRule(ruleId: string) {
    return this.rules.find(it => it._id === ruleId) ?? null
  }

  async countRecords(ruleId?: string) {
    if (ruleId != null) return (this.records.get(ruleId) ?? []).length
    return [...this.records.values()].reduce((sum, list) => sum + list.length, 0)
  }

  async iterateRecords(ruleId: string, visitor: (record: ProxyMock.MockRecord) => Promise<void>) {
    for (const record of this.records.get(ruleId) ?? []) await visitor(record)
  }

  async listRecordSummaries(ruleId: string) {
    return (this.records.get(ruleId) ?? []).map(it => ({
      _id: it.id, ruleId: it.ruleId, url: it.url, name: it.name, match: it.match,
      matchFingerprint: it.matchFingerprint, createdAt: it.createdAt, updatedAt: it.updatedAt,
    }))
  }
}

function fakeSource(defs: { id: string; name?: string; bodies?: number[] }[]): FakeSource {
  const source = new FakeSource()
  source.rules = defs.map(def => ({
    _id: def.id, name: def.name ?? def.id, desc: '', createdAt: 1, updatedAt: 1,
  }) as ProxyMock.MockRule)
  source.records = new Map(defs.map(def => [def.id, (def.bodies ?? []).map((size, index) => {
    const record = makeRecord({ ruleId: def.id, name: `${def.id}-${index}`, match: makeMatch({ url: `http://a/${def.id}/${index}` }) })
    return { ...record, response: { ...record.response, body: 'x'.repeat(size), bodyType: 'text' } }
  })]))
  return source
}

async function tempRoot(): Promise<{ root: string; channel: Channel }> {
  const base = await mkdtemp(path.join(tmpdir(), 'appapi-share-restore-'))
  bases.push(base)
  return { root: base, channel: createDirectoryShareChannel(base) }
}

/** 只暴露读侧，并且把读过的文件名记下来：既能断言「恢复一个字节都不写」，也能断言「读的是哪几片」 */
function readSpyChannel(root: string): { read: ReadChannel; names: string[] } {
  const base = createDirectoryShareChannel(root)
  const names: string[] = []
  return {
    names,
    read: {
      exists: name => base.exists(name),
      read: async (name, options) => {
        names.push(name)
        return base.read(name, options)
      },
    },
  }
}

function shardFile(key: string, index = 0): string {
  return `${MOCK_SHARE_SCENE_DIR}/${shareShardFileOf(key, index)}`
}

function manifestPath(root: string): string {
  return path.join(root, MOCK_SHARE_MANIFEST_FILE)
}

async function readManifest(root: string): Promise<MockShareManifest> {
  return assertShareManifest(JSON.parse(await readFile(manifestPath(root), 'utf8')))
}

/** 手工改清单：写出「我们自己的备份写不出来的清单」，用来验读侧那道闸——写侧的同形状在 `share-backup.test.ts` 已证 */
async function writeManifest(root: string, manifest: unknown): Promise<void> {
  await writeFile(manifestPath(root), JSON.stringify(manifest), 'utf8')
}

async function rejectCode(promise: Promise<unknown>): Promise<MockError> {
  try {
    await promise
  } catch (err) {
    if (err instanceof MockError) return err
    throw err
  }
  assert.fail('应抛出 MockError')
}

async function backup(defs: { id: string; name?: string; bodies?: number[] }[], now = 1700000000000) {
  const { root, channel } = await tempRoot()
  const result = await backupMockScenesToShare(fakeSource(defs), channel, { now })
  const keys = (await readManifest(root)).scenes.filter(entry => entry.shards.length > 0).map(entry => entry.key)
  return { root, channel, result, keys }
}

after(async () => {
  for (const dir of bases) await rm(dir, { recursive: true, force: true })
})

describe('云共享恢复链路（C3 / S-A4）', () => {
  it('先备份再恢复：清单报出的四个字段与合并出来的包逐项对得上', async () => {
    const defs = [{ id: 'r-order', name: '订单中心', bodies: [10, 20] }, { id: 'r-cart', name: '购物车', bodies: [30] }]
    const { root, keys } = await backup(defs)
    const { read } = readSpyChannel(root)

    const overview = await readShareRemoteOverview(read)
    assert.equal(overview.createdAt, 1700000000000)
    assert.match(String(overview.device), /^[0-9a-f]{12}$/)
    // 清单按 key 排序，而 key 是 `_id` 的哈希：断言按名字取，别把哈希顺序当成用例的一部分
    const listed = new Map(overview.scenes.map(scene => [scene.name, [scene.records, scene.shards]]))
    assert.deepEqual(listed.get('订单中心'), [2, 1])
    assert.deepEqual(listed.get('购物车'), [1, 1])
    assert.equal(overview.bytes, overview.scenes.reduce((sum, scene) => sum + scene.bytes, 0))
    assert.deepEqual(overview.unavailable, [])

    const payload = await restoreShareScenes(read, keys)
    assert.equal(payload.scenes, 2)
    assert.equal(payload.bytes, Buffer.byteLength(payload.text, 'utf8'))
    const pack = readMockPackText(payload.text, payload.bytes)
    assert.equal(pack.format, MOCK_PACK_FORMAT)
    assert.equal(pack.version, MOCK_PACK_VERSION)
    assert.deepEqual(pack.rules.map(rule => rule.name).sort(), ['订单中心', '购物车'])
    assert.equal(pack.rules.reduce((sum, rule) => sum + rule.records.length, 0), 3)
    // 正文原样回来：分片、拼装、清单三段里任何一段动了手脚，这里就对不上
    const order = pack.rules.find(rule => rule.name === '订单中心')
    assert.deepEqual(order.records.map(record => record.response.body.length), [10, 20])
    assert.equal(order.records[0].response.body, 'x'.repeat(10))
  })

  it('按场景勾选：只取那一个场景，包里不含其余（C3-2 的选择不落库、也不夹带）', async () => {
    const { root, channel } = await tempRoot()
    await backupMockScenesToShare(fakeSource([
      { id: 'r-order', name: '订单中心', bodies: [10] }, { id: 'r-cart', name: '购物车', bodies: [20] },
    ]), channel)
    const manifest = await readManifest(root)
    const cart = manifest.scenes.find(entry => entry.name === '购物车')
    const { read, names } = readSpyChannel(root)

    const payload = await restoreShareScenes(read, [cart.key])
    const pack = JSON.parse(payload.text) as MockPackV1
    assert.equal(payload.scenes, 1)
    assert.deepEqual(pack.rules.map(rule => rule.name), ['购物车'])
    // 除了清单就是那一片，别的场景正文一次都没读
    assert.deepEqual(names, [MOCK_SHARE_MANIFEST_FILE, shardFile(cart.key)])
  })

  it('恢复顺序按清单不按点选顺序：两次点选反着选，拿到的正文逐字节相同', async () => {
    const { root, keys } = await backup([{ id: 'r-a', name: 'A', bodies: [10] }, { id: 'r-b', name: 'B', bodies: [20] }])
    const { read } = readSpyChannel(root)
    const first = await restoreShareScenes(read, keys)
    const second = await restoreShareScenes(read, [...keys].reverse())
    assert.equal(first.text, second.text)
  })

  it('分片场景在读侧合并成一个包：两片各读一次、一个场景一次导入（C3-6）', async () => {
    const { root, keys } = await backup([{ id: 'r-big', name: '大场景', bodies: [6 * MB, 1 * MB, 1 * MB] }])
    const manifest = await readManifest(root)
    const entry = manifest.scenes[0]
    assert.equal(entry.shards.length, 2)
    for (const shard of entry.shards) assert.ok(shard.bytes <= MOCK_SHARE_MAX_FILE_BYTES, '每片不超目标体积')

    const { read, names } = readSpyChannel(root)
    const overview = await readShareRemoteOverview(read)
    assert.deepEqual(overview.scenes.map(scene => scene.shards), [2])

    names.length = 0
    const payload = await restoreShareScenes(read, keys)
    assert.deepEqual(names, [MOCK_SHARE_MANIFEST_FILE, shardFile(entry.key, 0), shardFile(entry.key, 1)])
    const pack = readMockPackText(payload.text, payload.bytes)
    assert.equal(pack.rules.length, 1)
    assert.equal(pack.rules[0].records.length, 3)
    assert.deepEqual(pack.rules[0].records.map(record => record.response.body.length), [6 * MB, 1 * MB, 1 * MB])
  })

  it('某一片被改过一个字节就整场拒读：remoteCorrupted，本地库连门都摸不到（AC-C-04）', async () => {
    const { root, keys } = await backup([{ id: 'r-order', name: '订单中心', bodies: [64] }])
    const entry = (await readManifest(root)).scenes[0]
    const file = path.join(root, shardFile(entry.key))
    await writeFile(file, `${await readFile(file, 'utf8')} `, 'utf8')

    const { read } = readSpyChannel(root)
    const err = await rejectCode(restoreShareScenes(read, keys))
    assert.equal(err.code, 'remoteCorrupted')
    assert.match(String(err.detail), /^stage=verify sha1=[0-9a-f]{8} want=[0-9a-f]{8}$/)
  })

  it('清单列了分片而远端没有这个文件：报清单与远端不符（remoteCorrupted），不是「还没有备份」', async () => {
    const { root, keys } = await backup([{ id: 'r-big', name: '大场景', bodies: [6 * MB, 1 * MB, 1 * MB] }])
    const entry = (await readManifest(root)).scenes[0]
    assert.equal(entry.shards.length, 2)
    await rm(path.join(root, shardFile(entry.key, 1)))

    const { read } = readSpyChannel(root)
    const err = await rejectCode(restoreShareScenes(read, keys))
    assert.equal(err.code, 'remoteCorrupted')
    assert.match(String(err.detail), /^stage=read/)
  })

  it('清单上没有的 key 与被拒的场景都单独报出来，不静默少导几个场景', async () => {
    const { root, keys } = await backup([{ id: 'r-order', name: '订单中心', bodies: [10] }])
    const manifest = await readManifest(root)
    // 把清单改成「列了名字却没有正文」：写侧这种形状来自超上限被拒的场景，见 `share-backup.test.ts`
    const rejected = { ...manifest.scenes[0], key: 'abcdef012345', name: '超限场景', records: 9, shards: [],
      skipped: { reason: 'sceneTooLargeForCloud', detail: 'bytes=40000000 limit=33554432' } }
    await writeManifest(root, { ...manifest, scenes: [manifest.scenes[0], rejected] })
    const { read } = readSpyChannel(root)

    const overview = await readShareRemoteOverview(read)
    assert.deepEqual(overview.scenes.map(scene => scene.name), ['订单中心'])
    assert.deepEqual(overview.unavailable, [{ key: 'abcdef012345', name: '超限场景', reason: 'sceneTooLargeForCloud' }])
    // 被拒那一项的条数不进「可恢复条数」：那是「本来想备份多少条」，报出来就是虚报
    assert.equal(overview.records, 1)
    assert.equal(overview.bytes, manifest.scenes[0].bytes)

    const absent = await rejectCode(restoreShareScenes(read, ['ffffffffffffff']))
    assert.equal(absent.code, 'remoteNotFound')
    assert.equal(absent.detail, 'stage=list key=ffffffffffffff')

    const skipped = await rejectCode(restoreShareScenes(read, ['abcdef012345']))
    assert.equal(skipped.code, 'remoteNotFound')
    // `reason` 排在 `key` 之后，整条证据串受 `describeValue` 那 32 字符的尺限制（detail 会原样摊给用户看）：
    // 截到 `sceneTooLargeFo` 为止，剩下的由错误码本身补齐
    assert.match(String(skipped.detail), /^stage=list key=abcdef012345 sceneTooLargeFo…$/)
  })

  it('没选场景与目录里根本没有备份是两回事：前者 packEmpty，后者 remoteNotFound', async () => {
    const { root, keys } = await backup([{ id: 'r-order', name: '订单中心', bodies: [10] }])
    const { read } = readSpyChannel(root)
    const none = await rejectCode(restoreShareScenes(read, []))
    assert.equal(none.code, 'packEmpty')
    assert.equal(none.detail, 'stage=list scenes=0')
    // 空选拦在取正文之前，那份清单本身仍然是好的
    assert.equal((await readShareRemoteOverview(read)).scenes.length, 1)

    const { root: empty } = await tempRoot()
    const missing = await rejectCode(restoreShareScenes(readSpyChannel(empty).read, keys))
    assert.equal(missing.code, 'remoteNotFound')
    assert.equal(missing.detail, `stage=list ${MOCK_SHARE_MANIFEST_FILE}`)
    const overviewErr = await rejectCode(readShareRemoteOverview(readSpyChannel(empty).read))
    assert.equal(overviewErr.code, 'remoteNotFound')
  })

  it('清单声称的体积超过 R4 单包上限：一个场景文件都不读就拒掉（拒而不把几个 GB 拼进内存）', async () => {
    const { root, keys } = await backup([{ id: 'r-a', name: 'A', bodies: [10] }, { id: 'r-b', name: 'B', bodies: [20] }])
    const manifest = await readManifest(root)
    // 单场景各报 26MB（都在 32MB 那把尺之内），合计 52MB 才越过 50MB——越界的正是「全选」这个动作
    const inflated = {
      ...manifest,
      scenes: manifest.scenes.map(entry => ({
        ...entry,
        bytes: 26 * MB,
        shards: entry.shards.map(shard => ({ ...shard, bytes: 26 * MB })),
      })),
    }
    assert.ok(inflated.scenes.reduce((sum, entry) => sum + entry.bytes, 0) > MOCK_PACK_MAX_FILE_BYTES)
    assert.ok(inflated.scenes.every(entry => entry.bytes <= MOCK_SHARE_MAX_SCENE_BYTES))
    await writeManifest(root, inflated)

    const { read, names } = readSpyChannel(root)
    const err = await rejectCode(restoreShareScenes(read, keys))
    assert.equal(err.code, 'packTooLarge')
    assert.match(String(err.detail), new RegExp(`^stage=list bytes=\\d+ limit=${MOCK_PACK_MAX_FILE_BYTES}$`))
    assert.deepEqual(names, [MOCK_SHARE_MANIFEST_FILE])
  })

  it('取消点在任何正文之前：半份正文不会拼成包，AbortError 原样透传', async () => {
    const { root, keys } = await backup([{ id: 'r-a', name: 'A', bodies: [10] }, { id: 'r-b', name: 'B', bodies: [20] }])
    const { read, names } = readSpyChannel(root)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(restoreShareScenes(read, keys, controller.signal), (err: Error) => err.name === 'AbortError')
    // 取消点在最前面那一次清单读取上：名字记了一笔，但 `readOnce` 碰磁盘之前就抛了出来
    assert.deepEqual(names, [MOCK_SHARE_MANIFEST_FILE])
  })

  it('只选中一个空场景恢复时，拿到的是 R4 那句「没有可导入的条目」，不是云共享另造的说法', async () => {
    const { root, keys } = await backup([{ id: 'r-empty', name: '空场景', bodies: [] }])
    const { read } = readSpyChannel(root)
    const payload = await restoreShareScenes(read, keys)
    assert.equal(payload.scenes, 1)
    assert.deepEqual(JSON.parse(payload.text).rules[0].records, [])
    assert.throws(() => readMockPackText(payload.text, payload.bytes), (err: MockError) => err.code === 'packEmpty')
  })

  it('恢复侧没有任何写的手：这一段能碰到的通道只有 exists 与 read，跑一趟远端目录一个字节不变（C3-4）', async () => {
    const { root, keys } = await backup([{ id: 'r-a', name: 'A', bodies: [10] }, { id: 'r-b', name: 'B', bodies: [20] }])
    const { read } = readSpyChannel(root)
    assert.deepEqual(Object.keys(read).sort(), ['exists', 'read'])

    const before = (await readdir(root, { recursive: true })).sort()
    await restoreShareScenes(read, keys)
    assert.deepEqual((await readdir(root, { recursive: true })).sort(), before)

    // 中途拒读也一样：远端保持原样，下一次备份的「未变即跳过」判定不会被这次失败的恢复改动
    const entry = (await readManifest(root)).scenes[0]
    const file = path.join(root, shardFile(entry.key))
    await writeFile(file, 'not a pack', 'utf8')
    await assert.rejects(restoreShareScenes(read, keys), (err: MockError) => err.code === 'remoteCorrupted')
    const manifest = JSON.parse(await readFile(manifestPath(root), 'utf8'))
    assert.equal(manifest.scenes.length, 2)
  })
})
