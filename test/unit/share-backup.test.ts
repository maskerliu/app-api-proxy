import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'path'
import { registerHooks } from 'node:module'
import { after, describe, it } from 'node:test'
import type { ProxyMock } from '@shared/proxy.models'
import { MOCK_PACK_FORMAT, MOCK_PACK_VERSION, readMockPackText } from '@shared/mock.pack'
import { MockError } from '@shared/mock.errors'
import {
  MOCK_SHARE_MANIFEST_FILE, MOCK_SHARE_MAX_FILE_BYTES, MOCK_SHARE_MAX_SCENES, MOCK_SHARE_SCENE_DIR,
  assertShareManifest, mergeShareScenePacks, shareShardFileOf,
} from '@shared/mock.share'
import type { MockShareManifest } from '@shared/mock.share'
import { makeMatch, makeRecord } from './fixtures'

// 备份执行器要用 `readMockPackSceneParts`，它住在 `mock.pack.service` 里，而那条链经 constants 引用 electron。
// 组装本身不碰 electron（appVersion 由调用方传入，这里干脆不传），替身只要能被 import 就够。
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
  backupMockScenesToShare, cancelShareBackup, createDirectoryShareChannel, estimateShareBackup,
  runShareBackup, shareBackupProgress,
} = await import('@main/service/mock.share')

/**
 * 这一批跑真实文件系统（`os.tmpdir()` 下的临时目录，绝不碰用户数据目录）+ 真实的包组装：
 * 要证的正是「切出来的每一片自己都是一个合法单场景包」与「manifest 是唯一的提交点」，
 * 这两条换成替身组装就只是在验证替身。
 */

const MB = 1024 * 1024
const bases: string[] = []
type Channel = ReturnType<typeof createDirectoryShareChannel>

class FakeSource {
  rules: ProxyMock.MockRule[] = []
  records: Map<string, ProxyMock.MockRecord[]> = new Map()
  /** 让用例能把某一次运行卡在「任务槽已经被占」的那一刻 */
  block: Promise<unknown> = null

  async listRules() {
    if (this.block != null) await this.block
    return this.rules
  }

  async getRule(ruleId: string) {
    return this.rules.find(it => it._id === ruleId) ?? null
  }

  async countRecords(ruleId?: string) {
    if (ruleId != null) return (this.records.get(ruleId) ?? []).length
    return [...this.records.values()].reduce((sum, list) => sum + list.length, 0)
  }

  // 真仓库的 `iterateRecords` 是 `await visitor(doc)`：替身照抄，异步 visitor 才不会在这里被咽掉
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

interface SceneDef {
  id: string
  name?: string
  /** 每条记录一个响应体字节数；留空就是空场景 */
  bodies?: number[]
  headers?: Record<string, string>
}

function fakeSource(defs: SceneDef[]): FakeSource {
  const source = new FakeSource()
  source.rules = defs.map(def => ({
    _id: def.id, name: def.name ?? def.id, desc: '', createdAt: 1, updatedAt: 1,
  }) as ProxyMock.MockRule)
  source.records = new Map(defs.map(def => [def.id, (def.bodies ?? []).map((size, index) => {
    const record = makeRecord({ ruleId: def.id, name: `${def.id}-${index}`, match: makeMatch({ url: `http://a/${def.id}/${index}` }) })
    return { ...record, response: { ...record.response, body: 'x'.repeat(size), bodyType: 'text', headers: def.headers ?? {} } }
  })]))
  return source
}

/** 只记写过的文件名，其余原样交给真通道：「这次到底写没写字节」是这批最硬的那条断言 */
function countedChannel(root: string): { channel: Channel; writes: string[] } {
  const base = createDirectoryShareChannel(root)
  const writes: string[] = []
  return {
    writes,
    channel: {
      ...base,
      write: async (name: string, text: string, signal?: AbortSignal) => {
        writes.push(name)
        return base.write(name, text, signal)
      }
    }
  }
}

async function tempRoot(): Promise<{ root: string; channel: Channel }> {
  const base = await mkdtemp(path.join(tmpdir(), 'appapi-share-backup-'))
  bases.push(base)
  return { root: base, channel: createDirectoryShareChannel(base) }
}

function shardFile(key: string, index = 0): string {
  return `${MOCK_SHARE_SCENE_DIR}/${shareShardFileOf(key, index)}`
}

async function readManifest(root: string): Promise<MockShareManifest> {
  return assertShareManifest(JSON.parse(await readFile(path.join(root, MOCK_SHARE_MANIFEST_FILE), 'utf8')))
}

async function fileSha1(root: string, name: string): Promise<string> {
  return createHash('sha1').update(await readFile(path.join(root, name))).digest('hex')
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

after(async () => {
  for (const dir of bases) await rm(dir, { recursive: true, force: true })
})

describe('云共享备份执行器（C2 / S-A3）', () => {
  it('两个场景备份成功：清单里的字节与摘要都是实测值，每片自己就是一个合法单场景包', async () => {
    const { root, channel } = await tempRoot()
    const source = fakeSource([
      { id: 'r-order', name: '订单中心', bodies: [10, 20] },
      { id: 'r-empty', name: '空场景', bodies: [] },
    ])
    const result = await backupMockScenesToShare(source, channel, { now: 1700000000000 })
    assert.equal(result.scenes, 2)
    assert.equal(result.records, 2)
    assert.equal(result.skipped, 0)
    assert.equal(result.createdAt, 1700000000000)

    const manifest = await readManifest(root)
    assert.equal(manifest.scenes.length, 2)
    for (const entry of manifest.scenes) {
      assert.equal(entry.shards.length, 1)
      const name = shardFile(entry.key)
      const text = await readFile(path.join(root, name), 'utf8')
      assert.equal(entry.bytes, Buffer.byteLength(text, 'utf8'))
      assert.equal(entry.shards[0].sha1, await fileSha1(root, name))
      // 空场景那一片在下面单独判：它结构合法，但过不了 R4「整包零条目」那条导入闸门
      if (entry.records === 0) continue
      const pack = readMockPackText(text, entry.bytes)
      assert.equal(pack.format, MOCK_PACK_FORMAT)
      assert.equal(pack.version, MOCK_PACK_VERSION)
      assert.equal(pack.rules.length, 1)
      assert.equal(pack.rules[0].records.length, entry.records)
    }
    // 空场景也留一片，结构上仍是单场景包；但 R4「整包零条目就 packEmpty」那条闸门照样管用：
    // 只选中一个空场景去恢复会拿到那句「没有可导入的条目」，连着别的场景一起选就导得动（C3-2 是同一条管线）
    const empty = manifest.scenes.find(entry => entry.name === '空场景')
    const emptyText = await readFile(path.join(root, shardFile(empty.key)), 'utf8')
    assert.equal(empty.records, 0)
    assert.deepEqual(JSON.parse(emptyText).rules[0].records, [])
    assert.throws(() => readMockPackText(emptyText, empty.bytes), (err: MockError) => err.code === 'packEmpty')
  })

  it('备份恒脱敏：凭证头不在远端正文里', async () => {
    const { root, channel } = await tempRoot()
    const source = fakeSource([{ id: 'r-1', bodies: [8], headers: { Authorization: 'Bearer sk-live', Cookie: 'a=b' } }])
    await backupMockScenesToShare(source, channel)
    const entry = (await readManifest(root)).scenes[0]
    const text = await readFile(path.join(root, shardFile(entry.key)), 'utf8')
    assert.equal(text.includes('sk-live'), false)
    assert.equal(text.includes('Bearer'), false)
  })

  it('正文里没有 exportedAt：否则每次时间戳都变，未变即跳过永远不成立', async () => {
    const { root, channel } = await tempRoot()
    const source = fakeSource([{ id: 'r-1', bodies: [8] }])
    await backupMockScenesToShare(source, channel)
    const entry = (await readManifest(root)).scenes[0]
    const text = await readFile(path.join(root, shardFile(entry.key)), 'utf8')
    assert.equal(text.includes('exportedAt'), false)
  })

  it('未变即跳过：第二次备份一个场景文件都不写，只换清单与 .bak', async () => {
    const { root } = await tempRoot()
    const { channel, writes } = countedChannel(root)
    const source = fakeSource([{ id: 'r-1', bodies: [64] }, { id: 'r-2', bodies: [64, 64] }])
    await backupMockScenesToShare(source, channel)
    writes.length = 0
    const second = await backupMockScenesToShare(source, channel)
    assert.equal(second.writtenBytes, 0)
    assert.equal(second.skipped, 2)
    assert.deepEqual(writes, [`${MOCK_SHARE_MANIFEST_FILE}.bak`, MOCK_SHARE_MANIFEST_FILE])
  })

  it('改名不换 key，但规则名在包正文里，于是只有那一个场景重传', async () => {
    const { root } = await tempRoot()
    const { channel, writes } = countedChannel(root)
    const source = fakeSource([{ id: 'r-1', name: '旧名字', bodies: [64] }, { id: 'r-2', name: '另一个', bodies: [64] }])
    await backupMockScenesToShare(source, channel)
    const keys = (await readManifest(root)).scenes.map(entry => entry.key).sort()
    source.rules[0].name = '新名字'
    writes.length = 0
    const result = await backupMockScenesToShare(source, channel)
    const manifest = await readManifest(root)
    assert.deepEqual(manifest.scenes.map(entry => entry.key).sort(), keys)
    const renamed = manifest.scenes.find(entry => entry.name === '新名字')
    assert.equal(result.skipped, 1)
    assert.deepEqual(writes, [shardFile(renamed.key), `${MOCK_SHARE_MANIFEST_FILE}.bak`, MOCK_SHARE_MANIFEST_FILE])
    // 正文里的场景名也要跟着换：恢复时新建的那个场景不该带着旧名字
    assert.equal(JSON.parse(await readFile(path.join(root, shardFile(renamed.key)), 'utf8')).rules[0].name, '新名字')
  })

  it('超过 8MB 的场景按记录边界分片，每片都是合法包，拼回去条数一致', async () => {
    const { root, channel } = await tempRoot()
    const source = fakeSource([{ id: 'r-1', bodies: [3 * MB, 3 * MB, 3 * MB] }])
    await backupMockScenesToShare(source, channel)
    const entry = (await readManifest(root)).scenes[0]
    assert.equal(entry.shards.length, 2)
    assert.equal(entry.bytes, entry.shards.reduce((sum, shard) => sum + shard.bytes, 0))
    const parts = []
    for (const [index, shard] of entry.shards.entries()) {
      assert.equal(shard.file, shareShardFileOf(entry.key, index))
      assert.ok(shard.bytes <= MOCK_SHARE_MAX_FILE_BYTES, `这片 ${shard.bytes} 字节超过了目标`)
      const name = shardFile(entry.key, index)
      assert.equal(shard.sha1, await fileSha1(root, name))
      parts.push(readMockPackText(await readFile(path.join(root, name), 'utf8'), shard.bytes))
    }
    const merged = mergeShareScenePacks(parts)
    assert.equal(merged.rules.length, 1)
    assert.equal(merged.rules[0].records.length, 3)
    assert.equal(merged.rules[0].records.reduce((sum, it) => sum + String(it.response?.body ?? '').length, 0), 9 * MB)
  })

  it('4 片装不下的场景只拒这一个，其余照常备份并在清单里交代原因', async () => {
    const { root, channel } = await tempRoot()
    // 单条 5MB：两片装一条会超过 8MB 目标，五条就是五片——总体积 25MB 仍在 32MB 之内
    const source = fakeSource([
      { id: 'r-big', name: '大场景', bodies: [5 * MB, 5 * MB, 5 * MB, 5 * MB, 5 * MB] },
      { id: 'r-small', name: '小场景', bodies: [16] },
    ])
    const result = await backupMockScenesToShare(source, channel)
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].code, 'sceneTooLargeForCloud')
    assert.equal(result.failed[0].detail, 'shards=5 limit=4')
    assert.equal(result.failed[0].records, 5)
    assert.equal(result.scenes, 1)
    const manifest = await readManifest(root)
    const big = manifest.scenes.find(entry => entry.name === '大场景')
    assert.equal(big.shards.length, 0)
    assert.equal(big.skipped.reason, 'sceneTooLargeForCloud')
    assert.deepEqual(await readdir(path.join(root, MOCK_SHARE_SCENE_DIR)), [`${manifest.scenes.find(e => e.name === '小场景').key}.json`])
  })

  it('清单是提交点：中途取消既没有新清单也没有 .part 残件', async () => {
    const { root, channel } = await tempRoot()
    const source = fakeSource([{ id: 'r-1', bodies: [32] }, { id: 'r-2', bodies: [32] }])
    const controller = new AbortController()
    const err = await backupMockScenesToShare(source, channel, {
      signal: controller.signal,
      onProgress: (p) => { if (p.scenesDone === 1) controller.abort() }
    }).then(() => null, (e: unknown) => e)
    assert.equal((err as Error).name, 'AbortError')
    assert.deepEqual(await readdir(root), [MOCK_SHARE_SCENE_DIR])
    assert.equal((await readdir(path.join(root, MOCK_SHARE_SCENE_DIR))).length, 1)
  })

  it('远端清单版本比本产品新：整次备份拒绝，一个字节都不动', async () => {
    const { root, channel } = await tempRoot()
    const foreign = JSON.stringify({ format: 'appapi-mock-share', version: 99, scenes: [] })
    await writeFile(path.join(root, MOCK_SHARE_MANIFEST_FILE), foreign)
    const source = fakeSource([{ id: 'r-1', bodies: [16] }])
    assert.equal((await rejectCode(backupMockScenesToShare(source, channel))).code, 'remoteVersionTooNew')
    assert.deepEqual(await readdir(root), [MOCK_SHARE_MANIFEST_FILE])
    assert.equal(await readFile(path.join(root, MOCK_SHARE_MANIFEST_FILE), 'utf8'), foreign)
  })

  it('坏清单不阻断备份，但被覆盖掉的原文进 .bak', async () => {
    const { root, channel } = await tempRoot()
    const broken = '{"scenes": 这是手工改坏的'
    await writeFile(path.join(root, MOCK_SHARE_MANIFEST_FILE), broken)
    const source = fakeSource([{ id: 'r-1', bodies: [16] }])
    await backupMockScenesToShare(source, channel)
    assert.equal(await readFile(path.join(root, `${MOCK_SHARE_MANIFEST_FILE}.bak`), 'utf8'), broken)
    await readManifest(root)
  })

  it('场景数超 300 整体拒绝：连场景文件都不写', async () => {
    const { root, channel } = await tempRoot()
    const source = fakeSource(Array.from({ length: MOCK_SHARE_MAX_SCENES + 1 }, (_, i) => ({ id: `r-${i}`, bodies: [1] })))
    const err = await rejectCode(backupMockScenesToShare(source, channel))
    assert.equal(err.code, 'shareSceneLimit')
    assert.equal(err.detail, `scenes=${MOCK_SHARE_MAX_SCENES + 1} limit=${MOCK_SHARE_MAX_SCENES}`)
    assert.deepEqual(await readdir(root), [])
  })

  it('单任务槽：进行中再点一次拿 shareInProgress，槽在结束后释放', async () => {
    const { root } = await tempRoot()
    const { channel } = countedChannel(root)
    const source = fakeSource([{ id: 'r-1', bodies: [16] }])
    let release: (value: unknown) => void
    source.block = new Promise(resolve => { release = resolve })
    assert.equal(cancelShareBackup(), false)

    const first = runShareBackup(source, channel)
    assert.equal((await rejectCode(runShareBackup(source, channel))).code, 'shareInProgress')
    assert.equal(shareBackupProgress().sceneTotal, 0)
    assert.equal(cancelShareBackup(), true)
    release(null)
    // 取消落在第一次备份还卡在场景清单那一行上：任务槽照样要释放，不能把之后的备份全堵死
    assert.equal((await first.then(() => null, (e: unknown) => e) as Error).name, 'AbortError')
    assert.equal(shareBackupProgress(), null)

    source.block = null
    assert.equal((await runShareBackup(source, channel)).scenes, 1)
  })

  it('预计写入体积与备份实测同一把尺：备份过一次之后就归零', async () => {
    const { root, channel } = await tempRoot()
    const source = fakeSource([{ id: 'r-1', bodies: [48] }, { id: 'r-2', bodies: [48, 48] }])
    const before = await estimateShareBackup(source, channel)
    assert.equal(before.scenes, 2)
    assert.equal(before.records, 3)
    assert.equal(before.skipped, 0)
    const result = await backupMockScenesToShare(source, channel)
    assert.equal(before.bytes, result.bytes)
    assert.equal(before.writtenBytes, result.writtenBytes)
    const after = await estimateShareBackup(source, channel)
    assert.equal(after.writtenBytes, 0)
    assert.equal(after.skipped, 2)
    assert.equal(after.bytes, result.bytes)
  })

  it('预计体积把超限场景单列成 oversize，不计入要写的字节', async () => {
    const { root, channel } = await tempRoot()
    const source = fakeSource([
      { id: 'r-big', name: '大场景', bodies: [5 * MB, 5 * MB, 5 * MB, 5 * MB, 5 * MB] },
      { id: 'r-small', name: '小场景', bodies: [48] },
    ])
    const estimate = await estimateShareBackup(source, channel)
    assert.deepEqual(estimate.oversize, ['大场景'])
    assert.equal(estimate.writtenBytes, estimate.bytes)
    assert.ok(estimate.bytes < 5 * MB)
  })

  it('结果页那几个数：device 是机器名哈希，writtenBytes 只算真正写出去的', async () => {
    const { root, channel } = await tempRoot()
    const source = fakeSource([{ id: 'r-1', name: '场景一', bodies: [1024] }])
    const result = await backupMockScenesToShare(source, channel)
    assert.notEqual(result.device, hostname())
    assert.match(result.device, /^[0-9a-f]{12}$/)
    assert.ok(result.bytes > 1024)
    assert.equal(result.writtenBytes, result.bytes)
    assert.deepEqual(result.failed, [])
    assert.equal(JSON.parse(await readFile(path.join(root, MOCK_SHARE_MANIFEST_FILE), 'utf8')).device, result.device)
  })
})
