import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { MockError } from '@shared/mock.errors'
import { MOCK_PACK_FORMAT, MOCK_PACK_VERSION, readMockPackText } from '@shared/mock.pack'
import type { MockPackV1 } from '@shared/mock.pack'
import {
  MOCK_SHARE_KEY_HEX, MOCK_SHARE_MANIFEST_VERSION, MOCK_SHARE_MAX_FILE_BYTES, MOCK_SHARE_MAX_SCENES,
  MOCK_SHARE_MAX_SCENE_BYTES, MOCK_SHARE_MAX_SHARDS,
  assertShareManifest, buildShareManifest, mergeShareScenePacks, planShareShards, shareErrorDetailOf,
  shareManifestStatsOf, shareSceneDigestOf, shareSceneKeyOf, shareShardBytesOf, shareShardFileOf, shareSkipsUnchanged,
  unwrapShareRemoteText,
} from '@shared/mock.share'
import type { MockShareShard } from '@shared/mock.share'

// 摘要用 node 的 sha1 顶一下就行：这一层只认「传进来的十六进制串」，算法在主进程。
const digestOf = (text: string) => createHash('sha1').update(text).digest('hex')

const RECORDS = [
  { id: 'r1', name: '甲', response: { status: 200, body: 'a' } },
  { id: 'r2', name: '乙', response: { status: 200, body: 'b' } },
  { id: 'r3', name: '丙', response: { status: 200, body: 'c' } },
]

function packOf(records: unknown[], rule: Record<string, unknown> = { id: 'rule-1', name: '订单中心' }): MockPackV1 {
  return {
    format: MOCK_PACK_FORMAT,
    version: MOCK_PACK_VERSION,
    appVersion: '1.2.0',
    exportedAt: 1700000000000,
    rules: [{ ...rule, records }],
  }
}

function shardOf(key: string, index: number, bytes = 1024): MockShareShard {
  return { file: shareShardFileOf(key, index), sha1: digestOf(`${key}#${index}`), bytes }
}

const KEY = shareSceneKeyOf(digestOf('rule-1'))

function manifestOf(scenes: { key: string; name: string; records: number; shards: MockShareShard[] }[]) {
  return buildShareManifest(scenes, { now: 1700000000000, device: 'devhash', digestOf })
}

function goodManifest() {
  return manifestOf([{ key: KEY, name: '订单中心', records: 2, shards: [shardOf(KEY, 0), shardOf(KEY, 1)] }])
}

/** 断言抛的是 MockError 并返回码：远端归因全靠「码 + detail」两样，只测「出错了」等于没测 */
function shareCode(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    if (err instanceof MockError) return err.code
    throw err
  }
  assert.fail('应抛出 MockError')
}

function shareDetail(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    if (err instanceof MockError) return err.detail ?? ''
    throw err
  }
  assert.fail('应抛出 MockError')
}

/** 只改清单上第 index 片的文件名，其余照原样——网盘副本名与相对路径逃逸都从这一个入口进来 */
function tamperedFile(manifest: ReturnType<typeof goodManifest>, file: string, index = 0) {
  const raw = JSON.parse(JSON.stringify(manifest))
  raw.scenes[0].shards[index].file = file
  return raw
}

/** 把组装好的 manifest 拆回普通对象再改，改完不回写共享层的类型 */
function tampered(manifest: ReturnType<typeof goodManifest>, mutate: (raw: any) => void) {
  const raw = JSON.parse(JSON.stringify(manifest))
  mutate(raw)
  return raw
}

describe('v1.3 云共享契约（PRD 6 与 9.1 等价类）', () => {
  it('场景名的整列等价类由构造消掉：文件名只认 sha1(ruleId)（PRD 9.1）', () => {
    for (const name of ['订单中心', 'a b c', '😀 emoji', 'x'.repeat(500), 'CON', 'NUL', 'nul.txt', '..', '', '/']) {
      const key = shareSceneKeyOf(digestOf(`rule-of-${name}`))
      assert.match(key, new RegExp(`^[0-9a-f]{${MOCK_SHARE_KEY_HEX}}$`), `${name} 派生出的 key 不合法`)
      assert.match(shareShardFileOf(key, 0), /^[0-9a-f]{12}\.json$/)
      assert.match(shareShardFileOf(key, 2), /^[0-9a-f]{12}\.part-3\.json$/)
    }
  })

  it('改名不换 key、换场景才换 key（PRD 6.1 修正 1 的那条理由）', () => {
    const key = shareSceneKeyOf(digestOf('rule-1'))
    assert.equal(shareShardFileOf(key, 0), shareShardFileOf(shareSceneKeyOf(digestOf('rule-1')), 0))
    assert.notEqual(shareShardFileOf(key, 0), shareShardFileOf(shareSceneKeyOf(digestOf('rule-2')), 0))
    // 名字只活在 manifest 的一个字段里，读回来还是原样
    const manifest = manifestOf([{ key, name: '改名之后的长名字', records: 0, shards: [shardOf(key, 0)] }])
    assert.equal(assertShareManifest(manifest).scenes[0].name, '改名之后的长名字')
  })

  it('key 恒小写：大小写不敏感的远端文件系统不会把它当成两个文件（PRD 9.1）', () => {
    assert.equal(shareSceneKeyOf(digestOf('rule-1').toUpperCase()), shareSceneKeyOf(digestOf('rule-1')))
  })

  it('片数与上限：8MB 一片、32MB 四片放行、再多就拒该场景（C2-5 / 上限三问）', () => {
    assert.deepEqual(planShareShards(0), { shards: 1, rejected: false })
    assert.deepEqual(planShareShards(MOCK_SHARE_MAX_FILE_BYTES), { shards: 1, rejected: false })
    assert.deepEqual(planShareShards(MOCK_SHARE_MAX_FILE_BYTES + 1), { shards: 2, rejected: false })
    assert.equal(planShareShards(MOCK_SHARE_MAX_SCENE_BYTES).rejected, false)
    assert.equal(planShareShards(MOCK_SHARE_MAX_SCENE_BYTES + 1).rejected, true)
    assert.equal(MOCK_SHARE_MAX_SCENE_BYTES, MOCK_SHARE_MAX_FILE_BYTES * MOCK_SHARE_MAX_SHARDS)
  })

  it('分片字节账与真实序列化字节数相等：漏掉记录之间的逗号会让分片边界整体偏移', () => {
    const records = [
      { id: 'a', response: { status: 200, body: 'x'.repeat(1000) } },
      { id: 'b', name: '订单', response: { status: 200, body: '中文正文'.repeat(300) } },
      { id: 'c', response: { status: 500, body: '' } },
    ]
    const envelopeBytes = Buffer.byteLength(JSON.stringify(packOf([])), 'utf8')
    const recordBytes = records.map(rec => Buffer.byteLength(JSON.stringify(rec), 'utf8'))
    assert.equal(shareShardBytesOf(envelopeBytes, []), envelopeBytes)
    assert.equal(shareShardBytesOf(envelopeBytes, recordBytes),
      Buffer.byteLength(JSON.stringify(packOf(records)), 'utf8'))
  })

  it('未变即跳过只比场景级 sha1；换序、减片都算变了（C2-4 / Q5）', () => {
    const one = shardOf(KEY, 0)
    const two = shardOf(KEY, 1)
    const entry = manifestOf([{ key: KEY, name: 'n', records: 1, shards: [one, two] }]).scenes[0]
    assert.equal(shareSkipsUnchanged(entry, entry.sha1), true)
    assert.equal(shareSkipsUnchanged(entry, shareSceneDigestOf([two, one], digestOf)), false)
    assert.equal(shareSkipsUnchanged(entry, shareSceneDigestOf([one], digestOf)), false)
    assert.equal(shareSkipsUnchanged(undefined, entry.sha1), false)
  })

  it('manifest 组装：按 key 排序、bytes 是分片合计、sha1 由片摘要按序合成', () => {
    const kb = shareSceneKeyOf(digestOf('b'))
    const ka = shareSceneKeyOf(digestOf('a'))
    const manifest = manifestOf([
      { key: kb, name: 'B', records: 3, shards: [shardOf(kb, 0, 10), shardOf(kb, 1, 20)] },
      { key: ka, name: 'A', records: 1, shards: [shardOf(ka, 0, 5)] },
    ])
    assert.deepEqual(manifest.scenes.map(scene => scene.key), [ka, kb])
    assert.equal(manifest.scenes[1].bytes, 30)
    assert.equal(manifest.scenes[1].sha1, shareSceneDigestOf(manifest.scenes[1].shards, digestOf))
    assert.equal(manifest.version, MOCK_SHARE_MANIFEST_VERSION)
    assert.deepEqual(shareManifestStatsOf(manifest), { scenes: 2, records: 4, bytes: 35, skipped: 0 })
  })

  it('场景数超限拒的是这次备份，不是截断（上限三问第 3 行）', () => {
    const scenes = Array.from({ length: MOCK_SHARE_MAX_SCENES }, (_, i) => {
      const key = shareSceneKeyOf(digestOf(`rule-${i}`))
      return { key, name: `场景${i}`, records: 0, shards: [shardOf(key, 0)] }
    })
    assert.equal(manifestOf(scenes).scenes.length, MOCK_SHARE_MAX_SCENES)
    assert.equal(shareCode(() => manifestOf([...scenes, { ...scenes[0], key: '000000000000' }])), 'shareSceneLimit')
  })

  describe('manifest 读侧闸门（C1-4 / PRD 9.1）', () => {
    it('自己写出去的清单原样读得回来', () => {
      const parsed = assertShareManifest(goodManifest())
      assert.deepEqual(parsed.scenes[0].shards.map(shard => shard.file), [`${KEY}.json`, `${KEY}.part-2.json`])
      assert.equal(parsed.createdAt, 1700000000000)
      assert.equal(parsed.device, 'devhash')
    })

    it('别人的 index.json：认不出 format 就拒读，不去猜它是什么', () => {
      assert.equal(shareCode(() => assertShareManifest(tampered(goodManifest(), raw => { raw.format = 'other' }))),
        'remoteCorrupted')
    })

    it('version 高于支持值 → remoteVersionTooNew，不静默降级（6.2）', () => {
      assert.equal(shareCode(() => assertShareManifest(tampered(goodManifest(), raw => {
        raw.version = MOCK_SHARE_MANIFEST_VERSION + 1
      }))), 'remoteVersionTooNew')
    })

    it('version 缺失或不是版本号属「这不是我们的清单」，不该让人去升级一个不存在的旧版本', () => {
      for (const version of [undefined, 0, -1, 1.5, '1']) {
        assert.equal(shareCode(() => assertShareManifest({ ...goodManifest(), version })), 'remoteCorrupted', `${version}`)
      }
    })

    it('网盘冲突副本名 xxx(1).json：不在我们认可的名单里就拒读，而不是当成额外场景', () => {
      assert.equal(shareCode(() => assertShareManifest(tamperedFile(goodManifest(), `${KEY}(1).json`))), 'remoteCorrupted')
    })

    it('清单里写相对路径逃逸也拒：文件名必须由 key 与下标反推', () => {
      const raw = tamperedFile(goodManifest(), '../../etc/passwd.json')
      assert.equal(shareCode(() => assertShareManifest(raw)), 'remoteCorrupted')
      assert.equal(shareDetail(() => assertShareManifest(raw)), `shards[0].file=../../etc/passwd.json want=${KEY}.json`)
    })

    it('清单与实际不符的几种形状各自都拒：字节合计、片数、片摘要、条数、key 形状、重复 key', () => {
      const cases: Array<(raw: any) => void> = [
        raw => { raw.scenes[0].bytes = 9999 },
        raw => { raw.scenes[0].shards[1].bytes = 7 },
        raw => { raw.scenes[0].shards[1].sha1 = 'zz' },
        raw => { raw.scenes[0].sha1 = 'not-hex' },
        raw => { raw.scenes[0].records = 1.5 },
        raw => { raw.scenes[0].key = '订单中心' },
        raw => { raw.scenes[0].shards = [] },
        raw => {
          raw.scenes[0].shards.push(shardOf(KEY, 2), shardOf(KEY, 3), { ...shardOf(KEY, 4), file: `${KEY}.part-5.json` })
        },
        raw => { raw.scenes.push({ ...raw.scenes[0] }) },
        raw => { raw.scenes = 'x' },
      ]
      for (const [i, mutate] of cases.entries()) {
        assert.equal(shareCode(() => assertShareManifest(tampered(goodManifest(), mutate))), 'remoteCorrupted', `case ${i}`)
      }
      assert.equal(shareCode(() => assertShareManifest('index.json 是个字符串')), 'remoteCorrupted')
    })

    it('未备份成的场景可以没有分片，但必须带原因；原因进统计（6.2 的 skipped）', () => {
      assert.equal(shareCode(() => assertShareManifest(tampered(goodManifest(), raw => { raw.scenes[0].shards = [] }))),
        'remoteCorrupted')
      const raw = tampered(goodManifest(), scene => {
        scene.scenes[0].shards = []
        scene.scenes[0].bytes = 0
        scene.scenes[0].skipped = { reason: 'sceneTooLargeForCloud', detail: 'bytes=40000000' }
      })
      const parsed = assertShareManifest(raw)
      assert.equal(parsed.scenes[0].skipped?.reason, 'sceneTooLargeForCloud')
      assert.equal(shareManifestStatsOf(parsed).skipped, 1)
    })

    it('createdAt / device 缺失只影响显示，不影响读（6.2）', () => {
      const parsed = assertShareManifest(tampered(goodManifest(), raw => {
        delete raw.createdAt
        delete raw.device
      }))
      assert.equal(parsed.createdAt, undefined)
      assert.equal(parsed.device, undefined)
      assert.equal(parsed.scenes.length, 1)
    })
  })

  describe('分片合并（C3-6：读侧拼成一个包再走一次导入）', () => {
    it('每片都是合法单场景包，合并后逐字段等于原包（AC-C-01 的契约半边）', () => {
      const parts = [packOf(RECORDS.slice(0, 2)), packOf(RECORDS.slice(2))]
      // 「合法」由 R4 那道闸门判，不另立标准：任何一片读不进去，恢复就失败在合并之前
      for (const part of parts) {
        const text = JSON.stringify(part)
        const read = readMockPackText(text, Buffer.byteLength(text, 'utf8'))
        assert.equal(read.rules.length, 1)
        assert.ok(read.rules[0].records.length > 0)
      }
      assert.deepEqual(mergeShareScenePacks(parts), packOf(RECORDS))
    })

    it('单片也走同一条路，不为「没分片」造特例', () => {
      assert.deepEqual(mergeShareScenePacks([packOf(RECORDS)]), packOf(RECORDS))
    })

    it('片与片的信封不一致 ⇒ 清单与实际不符，不猜以哪片为准', () => {
      assert.equal(shareCode(() => mergeShareScenePacks([
        packOf(RECORDS.slice(0, 1)), packOf(RECORDS.slice(1), { id: 'rule-2', name: '换场景了' }),
      ])), 'remoteCorrupted')
      assert.equal(shareCode(() => mergeShareScenePacks([])), 'remoteCorrupted')
      assert.equal(shareCode(() => mergeShareScenePacks([{ ...packOf(RECORDS), rules: [] } as any])), 'remoteCorrupted')
    })
  })

  describe('订阅 URL 的响应形态判定（C4-2，顺序固定）', () => {
    it('裸包原样交给包的闸门', () => {
      const text = JSON.stringify(packOf(RECORDS))
      assert.equal(unwrapShareRemoteText(text), text)
    })

    it('形如 {code,data} 时取 data.content 再按裸包判', () => {
      const content = JSON.stringify(packOf(RECORDS.slice(0, 1)))
      assert.equal(unwrapShareRemoteText(JSON.stringify({ code: 0, data: { content } })), content)
    })

    it('裸包自身有问题时不许降级成 remoteShapeUnknown：那会把「请升级」那句丢掉', () => {
      const tooNew = JSON.stringify({ ...packOf(RECORDS), version: MOCK_PACK_VERSION + 1 })
      assert.equal(unwrapShareRemoteText(tooNew), tooNew)
      assert.equal(shareCode(() => readMockPackText(unwrapShareRemoteText(tooNew), Buffer.byteLength(tooNew, 'utf8'))),
        'packVersionUnsupported')
    })

    it('登录墙 HTML、没有 content 的包裹、空正文都落 remoteShapeUnknown，detail 只带正文开头', () => {
      const html = '<html><body>Sign in</body></html>'
      assert.equal(shareCode(() => unwrapShareRemoteText(html)), 'remoteShapeUnknown')
      assert.match(shareDetail(() => unwrapShareRemoteText(html)), /^head=<html>/)
      assert.equal(shareCode(() => unwrapShareRemoteText(JSON.stringify({ code: 0, msg: 'ok' }))), 'remoteShapeUnknown')
      assert.equal(shareCode(() => unwrapShareRemoteText(JSON.stringify({ code: 0, data: { content: 123 } }))),
        'remoteShapeUnknown')
      assert.equal(shareCode(() => unwrapShareRemoteText(JSON.stringify({ foo: 1 }))), 'remoteShapeUnknown')
      assert.equal(shareCode(() => unwrapShareRemoteText('   ')), 'remoteShapeUnknown')
      assert.equal(shareCode(() => unwrapShareRemoteText(undefined)), 'remoteShapeUnknown')
    })
  })

  it('C5 的两个可诊断字段拼成一条 detail，证据串照 R4 那把尺截断', () => {
    assert.equal(shareErrorDetailOf('list'), 'stage=list')
    assert.equal(shareErrorDetailOf('write', 'ENOSPC'), 'stage=write ENOSPC')
    assert.equal(shareErrorDetailOf('read', 'status=404'), 'stage=read status=404')
    const long = shareErrorDetailOf('verify', 'x'.repeat(200))
    assert.equal(long, `stage=verify ${'x'.repeat(32)}…`)
  })
})
