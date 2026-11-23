import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'path'
import { registerHooks } from 'node:module'
import { after, describe, it } from 'node:test'
import type { ProxyMock } from '@shared/proxy.models'
import { MockError } from '@shared/mock.errors'
import { normalizeMockShareConfig } from '@shared/mock.share'
import type { MockShareConfig } from '@shared/mock.share'
import { makeMatch, makeRecord } from './fixtures'

// `mock.share.service` 经 `common.service` → `constants` 摸到 electron 的 `app.getPath`；
// 这里不需要真窗口，替身只要能被 import 就够。
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

const { MockShareService } = await import('@main/service/mock.share.service')
const { backupMockScenesToShare, createDirectoryShareChannel, requireShareDirectoryChannel, requireShareUrl } =
  await import('@main/service/mock.share')

/**
 * 配置这一格与主进程直调的入口（PRD C1 / C6 / S-A6）。
 *
 * 这一批真正要保证的只有一句：**关闭之后什么都不发生**（AC-C-11）。所以用例几乎全在反向——
 * 拿着残缺配置去点每一个动作，看它是不是在碰到文件系统与库之前就被挡回来，
 * 并且用一个哨兵目录证明「挡回来」不是「试了一下没成功」。
 */

const bases: string[] = []

async function sentinelDir(): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), 'appapi-share-config-'))
  bases.push(base)
  return base
}

after(async () => {
  for (const base of bases) await rm(base, { recursive: true, force: true })
})

/** 只填了通道，其余全交给归一化，免得用例自己造出配置文件里根本不存在的形状 */
function configOf(channel: MockShareConfig['channel'], extra: Partial<MockShareConfig> = {}): MockShareConfig {
  return normalizeMockShareConfig({ channel, ...extra })
}

async function rejectCode(run: () => Promise<unknown>): Promise<{ code: string; detail: string }> {
  try {
    await run()
  } catch (err) {
    assert.ok(err instanceof MockError, `预期 MockError，实际 ${String(err)}`)
    return { code: err.code, detail: err.detail ?? '' }
  }
  assert.fail('预期抛错，实际正常返回')
}

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

/** 装配层要的两个替身：记下被问过几次，「闸门在库之前」这句话才有地方可断言 */
function fakePackService() {
  const seen: { text: string; options: unknown }[] = []
  const service = {
    preview: async (text: string, options: unknown) => {
      seen.push({ text, options })
      return { marker: 'preview' }
    },
    import: async (text: string, options: unknown) => {
      seen.push({ text, options })
      return { marker: 'import' }
    },
  }
  return { seen, service }
}

/** 装配层只读 `serverConfig.mockShare`，替身给到这一格就够，不必拖着 electron 与配置文件 */
function serviceFor(config: MockShareConfig | undefined, pack = fakePackService()) {
  const service = new MockShareService()
  Object.assign(service as any, {
    mockRepo: fakeSource([{ id: 'r1', name: '场景一', bodies: [10, 10] }]),
    commonService: { serverConfig: { mockShare: config } },
    mockPackService: pack.service,
  })
  return service
}

describe('归一化：配置文件里那一格不信任读到的值', () => {
  it('没有这一段、空对象、非对象，一律按关闭处理', () => {
    for (const raw of [undefined, null, {}, 'off', 42]) {
      assert.equal(normalizeMockShareConfig(raw).channel, 'off')
    }
  })

  it('认不出的通道回 off，而不是留着让下一次点击去撞', () => {
    assert.deepEqual(normalizeMockShareConfig({ channel: 'webdav', dir: '/x' }), { channel: 'off', dir: '/x' })
  })

  it('目录与地址去掉首尾空白；只剩空白的当作没填', () => {
    assert.deepEqual(normalizeMockShareConfig({ channel: 'dir', dir: '  D:\\Share  ' }),
      { channel: 'dir', dir: 'D:\\Share' })
    assert.deepEqual(normalizeMockShareConfig({ channel: 'dir', dir: '   ' }), { channel: 'dir' })
    assert.deepEqual(normalizeMockShareConfig({ channel: 'url', url: '  https://a/b.json ' }),
      { channel: 'url', url: 'https://a/b.json' })
  })

  it('归一化是幂等的：已经归一化过的值再读一遍说法不变', () => {
    const once = normalizeMockShareConfig({ channel: 'url', url: 'https://a/b.json' })
    assert.deepEqual(normalizeMockShareConfig(once), once)
  })
})

describe('闸门：通道只能从 requireShare* 拿', () => {
  it('关闭 → remotePathMissing，说一句 channel=off', async () => {
    assert.deepEqual(await rejectCode(async () => requireShareDirectoryChannel(configOf('off'))),
      { code: 'remotePathMissing', detail: 'stage=list channel=off' })
    assert.deepEqual(await rejectCode(async () => requireShareDirectoryChannel(undefined)),
      { code: 'remotePathMissing', detail: 'stage=list channel=off' })
    assert.deepEqual(await rejectCode(async () => requireShareUrl(configOf('off'))),
      { code: 'remotePathMissing', detail: 'stage=list channel=off' })
  })

  it('选了目录没填路径，与「没开」是两种交代', async () => {
    assert.deepEqual(await rejectCode(async () => requireShareDirectoryChannel({ channel: 'dir' })),
      { code: 'remotePathMissing', detail: 'stage=list channel=dir no-dir' })
  })

  it('订阅通道拿不到可写的通道：备份这一步压根不该出现在 URL 那边', async () => {
    assert.deepEqual(await rejectCode(async () => requireShareDirectoryChannel(configOf('url', { url: 'https://a/b.json' }))),
      { code: 'remotePathMissing', detail: 'stage=list channel=url-readonly' })
    assert.deepEqual(await rejectCode(async () => requireShareUrl(configOf('dir', { dir: await sentinelDir() }))),
      { code: 'remotePathMissing', detail: 'stage=list channel=dir-no-url' })
    assert.deepEqual(await rejectCode(async () => requireShareUrl({ channel: 'url' })),
      { code: 'remotePathMissing', detail: 'stage=list channel=url no-url' })
  })

  it('地址原样交出去，一个字符都不重新编码', () => {
    const url = 'https://a/%E5%9C%BA%20景.json?x=1+2'
    assert.equal(requireShareUrl(configOf('url', { url })), url)
  })

  it('拿到通道不等于碰了目录：通道是惰性的', async () => {
    const base = await sentinelDir()
    const channel = requireShareDirectoryChannel(configOf('dir', { dir: base }))
    assert.equal(typeof channel.write, 'function')
    assert.deepEqual(await readdir(base), [])
  })
})

describe('装配层：关闭时每个动作都停在闸门前面', () => {
  const actions = (service: InstanceType<typeof MockShareService>) => [
    ['check', () => service.check()],
    ['estimate', () => service.estimate()],
    ['backup', () => service.backup()],
    ['overview', () => service.overview()],
    ['preview', () => service.preview(['k'], { mode: 'new' })],
    ['import', () => service.import(['k'], { mode: 'new', conflict: 'skip' })],
  ]

  it('六个动作一起验：全部回 channel=off，替身一次都没被问过', async () => {
    const base = await sentinelDir()
    const pack = fakePackService()
    const service = serviceFor(configOf('off'), pack)
    for (const [, run] of actions(service)) {
      assert.deepEqual(await rejectCode(run), { code: 'remotePathMissing', detail: 'stage=list channel=off' })
    }
    assert.deepEqual(pack.seen, [])
    assert.deepEqual(await readdir(base), [])
  })

  it('选了目录没填路径：同样六个动作，报的是没填', async () => {
    const service = serviceFor({ channel: 'dir' })
    for (const [, run] of actions(service)) {
      assert.equal((await rejectCode(run)).detail, 'stage=list channel=dir no-dir')
    }
  })

  it('订阅通道做不了备份、预估、清单，但预览那侧不碰目录', async () => {
    const base = await sentinelDir()
    const pack = fakePackService()
    const service = serviceFor(configOf('url', { url: 'https://127.0.0.1:1/p.json' }), pack)
    for (const run of [() => service.backup(), () => service.estimate(), () => service.overview()]) {
      assert.equal((await rejectCode(run)).detail, 'stage=list channel=url-readonly')
    }
    assert.deepEqual(await readdir(base), [])
  })
})

describe('装配层：通道接上之后只做转交', () => {
  it('check 报的是清单上的读数', async () => {
    const base = await sentinelDir()
    const source = fakeSource([{ id: 'r1', name: '场景一', bodies: [10, 20] }])
    await backupMockScenesToShare(source as any, createDirectoryShareChannel(base), { now: 1_700_000_000_000 })
    const service = serviceFor(configOf('dir', { dir: base }))
    const result = await service.check()
    assert.equal(result.channel, 'dir')
    assert.equal(result.scenes, 1)
    assert.equal(result.records, 2)
    assert.equal(result.createdAt, 1_700_000_000_000)
    assert.equal(typeof result.device, 'string')
  })

  it('预览与导入把合并出来的包文本交给 R4，渲染层一次都不经手', async () => {
    const base = await sentinelDir()
    const source = fakeSource([{ id: 'r1', name: '场景一', bodies: [10] }, { id: 'r2', name: '场景二', bodies: [20] }])
    await backupMockScenesToShare(source as any, createDirectoryShareChannel(base), { now: 1_700_000_000_000 })
    const overview = await serviceFor(configOf('dir', { dir: base })).overview()
    const keys = overview.scenes.map(scene => scene.key)
    const pack = fakePackService()
    const service = serviceFor(configOf('dir', { dir: base }), pack)
    assert.deepEqual(await service.preview(keys, { mode: 'new' }), { marker: 'preview' })
    assert.deepEqual(await service.import(keys, { mode: 'merge', targetRuleId: 'r1' }), { marker: 'import' })
    assert.equal(pack.seen.length, 2)
    assert.deepEqual(pack.seen[0].options, { mode: 'new' })
    assert.deepEqual(pack.seen[1].options, { mode: 'merge', targetRuleId: 'r1' })
    // 两个场景合起来是一个包：`rules` 两条，正文只在主进程手里过一遍
    const merged = JSON.parse(pack.seen[0].text)
    assert.equal(merged.rules.length, 2)
    assert.equal(merged.rules.reduce((sum: number, rule: any) => sum + rule.records.length, 0), 2)
  })

  it('取消与进度只是转交，不在这一层造第二个状态', () => {
    const service = serviceFor(configOf('off'))
    assert.equal(service.cancel(), false)
    assert.equal(service.progress(), null)
  })
})
