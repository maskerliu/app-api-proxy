import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'path'
import { after, describe, it } from 'node:test'
import { MockError } from '@shared/mock.errors'
import {
  MOCK_SHARE_MANIFEST_FILE, MOCK_SHARE_SCENE_DIR, shareSceneKeyOf, shareShardFileOf,
} from '@shared/mock.share'
import { createDirectoryShareChannel, readShareVerified, toShareError } from '@main/service/mock.share'

/**
 * 这一批走真实文件系统（`os.tmpdir()` 下的临时目录，绝不碰用户数据目录），要证的正是
 * `.part` → `sync` → `rename` 的原子性和「目录不存在时不许顺手创建」。
 * 「只读挂载 / 磁盘满 / 路径超长」这三格在真机上造不出来（前者要特权挂载，后者 Windows 注册表说了算），
 * 所以那三格改到下面的映射表用例里用合成 errno 判——码与 detail 是我们的行为，errno 不是。
 */

const bases: string[] = []

type Channel = ReturnType<typeof createDirectoryShareChannel>

async function tempChannel(dirName = 'share'): Promise<{ root: string; channel: Channel }> {
  const base = await mkdtemp(path.join(tmpdir(), 'appapi-share-'))
  bases.push(base)
  const root = path.join(base, dirName)
  return { root, channel: createDirectoryShareChannel(root) }
}

function sceneFile(name: string): string {
  return `${MOCK_SHARE_SCENE_DIR}/${name}`
}

async function rejectCode(promise: Promise<unknown>): Promise<{ code: string; detail: string }> {
  try {
    await promise
  } catch (err) {
    if (err instanceof MockError) return { code: err.code, detail: err.detail ?? '' }
    throw err
  }
  assert.fail('应抛出 MockError')
}

/** 临时目录整体删除，写在 finally 之外的 after 里：中途断言失败也不会把一堆测试目录留在 %TEMP% */
after(async () => {
  for (const dir of bases) await rm(dir, { recursive: true, force: true })
})

describe('云共享目录通道（S-A1 / PRD 9.1）', () => {
  it('写出去再读回来：摘要与字节数是实测值，非 ASCII 不按字符数算', async () => {
    const { channel } = await tempChannel()
    const text = JSON.stringify({ 中文: '正文 😀 与 emoji', body: 'x'.repeat(2048) })
    const written = await channel.write(sceneFile('deadbeef0000.json'), text)
    assert.equal(written.bytes, Buffer.byteLength(text, 'utf8'))
    assert.equal(written.sha1.length, 40)
    const read = await channel.read(sceneFile('deadbeef0000.json'))
    assert.equal(read.text, text)
    assert.equal(read.sha1, written.sha1)
    assert.equal(read.bytes, written.bytes)
  })

  it('原子写不留 .part：成功不留，取消也不留，且取消不改远端（AC-C-03）', async () => {
    const { root, channel } = await tempChannel()
    const name = sceneFile('cafe00000001.json')
    await channel.write(name, '{"a":1}')
    assert.deepEqual(await readdir(path.join(root, MOCK_SHARE_SCENE_DIR)), ['cafe00000001.json'])

    const controller = new AbortController()
    controller.abort()
    // 取消原样抛 AbortError：它是一个状态，不是一个需要归因的失败
    await assert.rejects(() => channel.write(name, '{"a":2}', controller.signal),
      (err: Error) => err.name === 'AbortError')
    assert.deepEqual(await readdir(path.join(root, MOCK_SHARE_SCENE_DIR)), ['cafe00000001.json'])
    assert.equal((await channel.read(name)).text, '{"a":1}')
  })

  it('根目录不存在时报 remotePathMissing，并且不自动创建（C1-2）', async () => {
    const { root, channel } = await tempChannel('not-created')
    const { code, detail } = await rejectCode(channel.assertWritable())
    assert.equal(code, 'remotePathMissing')
    assert.equal(detail, 'stage=list errno=ENOENT')
    await assert.rejects(() => stat(root), (err: NodeJS.ErrnoException) => err.code === 'ENOENT')
  })

  it('根目录被当成文件：也是 remotePathMissing，不去读它里面', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'appapi-share-'))
    bases.push(base)
    const file = path.join(base, 'index.json')
    await writeFile(file, '{}')
    const { code, detail } = await rejectCode(createDirectoryShareChannel(file).assertWritable())
    assert.equal(code, 'remotePathMissing')
    assert.match(detail, /not a directory$/)
  })

  it('同一个 ENOENT 按位置分码：manifest 缺是没有备份，清单里的分片缺是清单与实际不符', async () => {
    const { channel } = await tempChannel()
    await channel.write(sceneFile('00000000000a.json'), '{}')
    assert.equal((await rejectCode(channel.read(MOCK_SHARE_MANIFEST_FILE))).code, 'remoteNotFound')
    assert.equal((await rejectCode(channel.read(MOCK_SHARE_MANIFEST_FILE, { missing: 'remoteCorrupted' }))).code,
      'remoteCorrupted')
  })

  it('通道只有清单点名的四个动作，没有列目录的原语（9.1 网盘副本名与符号链接那两行因此进不了视野）', async () => {
    const { channel } = await tempChannel()
    assert.deepEqual(Object.keys(channel).sort(), ['assertWritable', 'exists', 'read', 'write'])
    assert.equal(await channel.exists(sceneFile('nosuch.json')), false)
  })

  it('目录不是文件：exists 只认文件', async () => {
    const { channel } = await tempChannel()
    await channel.write(sceneFile('00000000000b.json'), '{}')
    assert.equal(await channel.exists(MOCK_SHARE_SCENE_DIR), false)
    await channel.assertWritable()
  })

  it('越界的名字在 read 与 exists 两侧都抛 remoteCorrupted，不去 root 外面碰文件', async () => {
    const { channel } = await tempChannel()
    const { code, detail } = await rejectCode(channel.read('../../windows/win.ini'))
    assert.equal(code, 'remoteCorrupted')
    assert.equal(detail, 'stage=read name=../../windows/win.ini')
    await assert.rejects(() => channel.exists('../evil.json'),
      (err: unknown) => (err as MockError).code === 'remoteCorrupted')
  })

  it('sha1 对不上就拒读，detail 说清是 verify 阶段（C1-4 / AC-C-04）', async () => {
    const { root, channel } = await tempChannel()
    const name = sceneFile('abcdef000001.json')
    const written = await channel.write(name, '{"body":"原始"}')
    // 绕过通道直接改盘：模拟用户在备份目录里手工编辑过那个 json
    await writeFile(path.join(root, name), '{"body":"篡改"}')
    const { code, detail } = await rejectCode(readShareVerified(channel, name, written.sha1))
    assert.equal(code, 'remoteCorrupted')
    assert.match(detail, /^stage=verify sha1=[0-9a-f]{8} want=[0-9a-f]{8}$/)
    assert.equal(await readShareVerified(channel, name, (await channel.read(name)).sha1), '{"body":"篡改"}')
  })

  it('场景名那一整列等价类不落进文件名：盘上只有 12 位 hex（PRD 6.1）', async () => {
    const { root, channel } = await tempChannel()
    const names = ['订单中心', 'a b c', '😀 emoji', 'x'.repeat(200), 'CON', 'NUL', 'nul.txt', '', '/', '../evil']
    for (const [i, name] of names.entries()) {
      const key = shareSceneKeyOf(fakeDigest(`rule-${i}`))
      await channel.write(sceneFile(shareShardFileOf(key, 0)), JSON.stringify({ name }))
    }
    const listed = await readdir(path.join(root, MOCK_SHARE_SCENE_DIR))
    assert.equal(listed.length, names.length)
    for (const file of listed) assert.match(file, /^[0-9a-f]{12}\.json$/)
  })

  it('根目录带空格与中文、名字用 / 分隔也读写得了（9.1 分隔符那一行）', async () => {
    const { root, channel } = await tempChannel('网盘 同步 目录')
    const text = '{"ok":true}'
    const written = await channel.write(sceneFile('111122223333.json'), text)
    assert.equal(written.bytes, Buffer.byteLength(text, 'utf8'))
    assert.equal((await channel.read(sceneFile('111122223333.json'))).text, text)
    assert.equal(path.basename(root), '网盘 同步 目录')
  })

  describe('errno → 码的映射（真机上造不出来的那三格在这里判）', () => {
    const errnoOf = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

    it('写侧的只读挂载、磁盘满、路径超长共用一个码，errno 留在 detail 里区分', () => {
      for (const code of ['EROFS', 'ENOSPC', 'ENAMETOOLONG', 'EDQUOT']) {
        const err = toShareError(errnoOf(code), { stage: 'write' })
        assert.equal(err.code, 'remoteWriteFailed', code)
        assert.equal(err.detail, `stage=write errno=${code}`)
      }
    })

    it('权限与「盘不在了」分得开：EACCES 是权限，ENOTCONN/ESTALE/EBUSY 是连不上', () => {
      assert.equal(toShareError(errnoOf('EACCES'), { stage: 'write' }).code, 'remoteForbidden')
      assert.equal(toShareError(errnoOf('EPERM'), { stage: 'read' }).code, 'remoteForbidden')
      for (const code of ['ENOTCONN', 'ESTALE', 'EBUSY', 'EIO', 'EREMOTEIO', 'ETIMEDOUT']) {
        assert.equal(toShareError(errnoOf(code), { stage: 'read' }).code, 'remoteUnreachable', code)
      }
    })

    it('读侧的 ENOENT 由调用方给码，写侧的 ENOENT 是目录被移走', () => {
      assert.equal(toShareError(errnoOf('ENOENT'), { stage: 'read', missing: 'remoteCorrupted' }).code, 'remoteCorrupted')
      assert.equal(toShareError(errnoOf('ENOENT'), { stage: 'read' }).code, 'remoteNotFound')
      assert.equal(toShareError(errnoOf('ENOENT'), { stage: 'write' }).code, 'remotePathMissing')
    })

    it('Windows 超长路径给的是 ENOENT：拿目标长度再分一次，别报成「目录不存在」（9.1 超长路径那一行）', () => {
      const longPath = `D:\\${'x'.repeat(300)}\\scenes\\a.json`
      assert.equal(toShareError(errnoOf('ENOENT'), { stage: 'write', target: longPath }).code, 'remoteWriteFailed')
      assert.equal(toShareError(errnoOf('ENOENT'), { stage: 'write', target: 'D:\\short\\a.json' }).code, 'remotePathMissing')
    })

    it('已经归因过的错误原样穿过，取消不算失败归因', () => {
      const already = new MockError('remoteForbidden', 'stage=read errno=EACCES')
      assert.equal(toShareError(already, { stage: 'write' }), already)
      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
      assert.throws(() => toShareError(abort, { stage: 'write' }), (err: Error) => err.name === 'AbortError')
    })

    it('没有 errno 的杂错只带上限内的证据串，不把整段驱动消息推给界面', () => {
      const err = toShareError(new Error('some very long driver message that must not reach the ui'), { stage: 'read' })
      assert.equal(err.code, 'remoteUnreachable')
      assert.match(err.detail ?? '', /^stage=read /)
      assert.ok((err.detail ?? '').length <= 'stage=read '.length + 33, err.detail)
    })
  })
})

/** 摘要由主进程算，这里只要「同一 ruleId 恒得同一串、不同 ruleId 得不同串」这一点性质 */
function fakeDigest(ruleId: string): string {
  let h = 2166136261
  for (const ch of ruleId) h = ((h ^ ch.charCodeAt(0)) * 16777619) >>> 0
  return h.toString(16).padStart(8, '0').repeat(5)
}
