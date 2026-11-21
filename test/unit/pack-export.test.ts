import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { ProxyMock } from '@shared/proxy.models'
import type { MockPackExportOptions, MockPackV1 } from '@shared/mock.pack'
import { MOCK_PACK_FORMAT, MOCK_PACK_MAX_RECORDS, MOCK_PACK_VERSION } from '@shared/mock.pack'
import { makeRecord } from '../unit/fixtures'

// mock.pack.service 经 constants 引用 electron，单测环境用最小替身；
// 组装本身不碰 electron（appVersion 由调用方传入），替身只要能被 import 就够
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

const { assembleMockPack, estimateMockPack, exportMockPackToFile } =
  await import('@main/service/mock.pack.service')
const { MockError } = await import('@shared/mock.errors')

class FakeSource {
  rules: ProxyMock.MockRule[] = []
  records: Map<string, ProxyMock.MockRecord[]> = new Map()
  pageSizes: number[] = []
  totalRecords: number = null

  async listRules() {
    return this.rules
  }

  async getRule(ruleId: string) {
    return this.rules.find(it => it._id === ruleId) ?? null
  }

  async countRecords(ruleId?: string) {
    if (ruleId != null) return (this.records.get(ruleId) ?? []).length
    return this.totalRecords ?? [...this.records.values()].reduce((sum, list) => sum + list.length, 0)
  }

  // 真仓库的 iterateRecords 是 `await visitor(doc)`：替身必须照抄，
  // 否则落盘出口的写序就没人守（分片会在并发 write 里串味）
  async iterateRecords(ruleId: string, visitor: (record: ProxyMock.MockRecord) => Promise<void>, pageSize = 100) {
    this.pageSizes.push(pageSize)
    for (const record of this.records.get(ruleId) ?? []) await visitor(record)
  }

  // 导出不碰这把原语（它属预览的冲突索引），但替身要给真形状：
  // 空数组会让「预览误用导出替身」这种错一路绿到底
  async listRecordSummaries(ruleId: string) {
    return (this.records.get(ruleId) ?? []).map(it => ({
      _id: it.id, ruleId: it.ruleId, url: it.url, name: it.name, match: it.match,
      matchFingerprint: it.matchFingerprint, createdAt: it.createdAt, updatedAt: it.updatedAt,
    }))
  }
}

class ThrowingSource extends FakeSource {
  constructor(private failAfter: number) {
    super()
  }

  async iterateRecords(ruleId: string, visitor: (record: ProxyMock.MockRecord) => Promise<void>, pageSize = 100) {
    let seen = 0
    for (const record of this.records.get(ruleId) ?? []) {
      if (++seen > this.failAfter) throw new Error('读库失败')
      await visitor(record)
    }
  }
}

function rule(ruleId: string, name = `场景 ${ruleId}`): ProxyMock.MockRule {
  const item = new ProxyMock.MockRule()
  item._id = ruleId
  item.name = name
  item.desc = `${name} 的描述`
  item.createdAt = 1_700_000_000_000
  item.updatedAt = 1_700_000_000_500
  return item
}

function withRecords(source: FakeSource, ruleId: string, count: number) {
  const list: ProxyMock.MockRecord[] = []
  for (let i = 0; i < count; i++) list.push(makeRecord({ ruleId, url: `/api/${ruleId}/${i}` }))
  source.records.set(ruleId, list)
  return list
}

const DEFAULTS: MockPackExportOptions = { scope: 'rule', ruleId: 'r1' }

async function packOf(source: FakeSource, options: MockPackExportOptions) {
  const result = await assembleMockPack(source, options)
  return { result, pack: JSON.parse(result.content) as MockPackV1 }
}

describe('R4 导出组装', () => {
  it('包文本是合法规则包：信封字段与场景/记录数一致', async () => {
    const source = new FakeSource()
    source.rules = [rule('r1')]
    withRecords(source, 'r1', 3)
    const { result, pack } = await packOf(source, DEFAULTS)

    assert.equal(pack.format, MOCK_PACK_FORMAT)
    assert.equal(pack.version, MOCK_PACK_VERSION)
    assert.equal(typeof pack.exportedAt, 'number')
    assert.equal(result.ruleCount, 1)
    assert.equal(result.recordCount, 3)
    assert.equal(pack.rules.length, 1)
    assert.equal(pack.rules[0].records.length, 3)
    assert.equal(typeof result.content, 'string')
  })

  it('appVersion 只在调用方给出时落包', async () => {
    const source = new FakeSource()
    source.rules = [rule('r1')]

    assert.equal((await assembleMockPack(source, DEFAULTS)).content.includes('appVersion'), false)
    const withVersion = JSON.parse((await assembleMockPack(source, DEFAULTS, '1.0.6')).content)
    assert.equal(withVersion.appVersion, '1.0.6')
  })

  it('派生字段一律不落包：url / 指纹 / 校验标记 / 列表态', async () => {
    const source = new FakeSource()
    source.rules = [rule('r1')]
    const [record] = withRecords(source, 'r1', 1)
    record.matchFingerprint = 'fp-should-not-leak'
    record.matchInvalid = 'pathEmpty'
    record.matchWarnings = [{ code: 'priorityInvalid' } as any]
    const { pack } = await packOf(source, DEFAULTS)

    const packed = pack.rules[0].records[0] as Record<string, unknown>
    for (const derived of ['url', 'ruleId', 'matchFingerprint', 'matchInvalid', 'matchWarnings', 'limitState', 'requests']) {
      assert.equal(derived in packed, false, `${derived} 不该出现在包里`)
    }
    assert.equal(JSON.stringify(pack).includes('fp-should-not-leak'), false)
  })

  it('遍历走 iterateRecords 的 200 条分片，而不是受列表上限约束的 listRecords', async () => {
    const source = new FakeSource()
    source.rules = [rule('r1'), rule('r2')]
    withRecords(source, 'r1', 2)
    withRecords(source, 'r2', 1)
    await packOf(source, { scope: 'all' })

    assert.deepEqual(source.pageSizes, [200, 200])
  })

  it('全场景用规则全量表：第 16 个之后的场景不能被列表命中上限截掉', async () => {
    const source = new FakeSource()
    source.rules = Array.from({ length: 20 }, (_, i) => rule(`r${i}`))
    source.rules.forEach(it => withRecords(source, it._id, 1))
    const { pack, result } = await packOf(source, { scope: 'all' })

    assert.equal(result.ruleCount, 20)
    assert.equal(pack.rules.length, 20)
    assert.deepEqual(pack.rules.map(it => it.id), source.rules.map(it => it._id))
  })

  it('空场景留在包里（AC-R4-10）：导入侧才分得清「空的」和「没导」', async () => {
    const source = new FakeSource()
    source.rules = [rule('empty'), rule('full')]
    withRecords(source, 'full', 1)
    const { pack } = await packOf(source, { scope: 'all' })

    assert.deepEqual(pack.rules[0].records, [])
    assert.equal(pack.rules[1].records.length, 1)
  })

  it('一个场景都没有也是合法包，不是残缺字符串', async () => {
    const source = new FakeSource()
    const { pack, result } = await packOf(source, { scope: 'all' })
    assert.deepEqual(pack.rules, [])
    assert.equal(result.recordCount, 0)
  })

  it('变体与来源快照可关：关掉变体时 activeVariantId 一起走，否则导入侧指向不存在的变体', async () => {
    const source = new FakeSource()
    source.rules = [rule('r1')]
    const [record] = withRecords(source, 'r1', 1)
    record.variants = [{ ...ProxyMock.defaultResponse(), id: 'v1', name: '变体一' }]
    record.activeVariantId = 'v1'
    record.source = { method: 'GET', url: '/api/r1/0', headers: { 'user-agent': 'ua' }, capturedAt: 1 }

    const full = (await packOf(source, DEFAULTS)).pack.rules[0].records[0]
    assert.equal(full.variants.length, 1)
    assert.equal(full.activeVariantId, 'v1')
    assert.equal(full.source.url, '/api/r1/0')

    const noVariant = (await packOf(source, { ...DEFAULTS, includeVariants: false })).pack.rules[0].records[0]
    assert.equal(noVariant.variants, undefined)
    assert.equal(noVariant.activeVariantId, undefined)
    assert.equal(noVariant.source.url, '/api/r1/0')

    const noSource = (await packOf(source, { ...DEFAULTS, includeSource: false })).pack.rules[0].records[0]
    assert.equal(noSource.source, undefined)
  })

  it('脱敏在主进程组装时完成：默认遮蔽，redact=false 才留原值', async () => {
    const source = new FakeSource()
    source.rules = [rule('r1')]
    const [record] = withRecords(source, 'r1', 1)
    record.response = { ...ProxyMock.defaultResponse(), headers: { Authorization: 'real', 'Set-Cookie': ['a=1', 'b=2'] } }
    record.variants = [{ ...ProxyMock.defaultResponse(), id: 'v1', name: '变体', headers: { cookie: 'sid=9' } }]
    record.source = { url: '/api/r1/0', headers: { cookie: 'sid=9' } }

    const redacted = (await packOf(source, DEFAULTS)).pack.rules[0].records[0]
    assert.deepEqual(redacted.response.headers, { Authorization: '***', 'Set-Cookie': ['***', '***'] })
    assert.equal(redacted.variants[0].headers.cookie, '***')
    assert.equal(redacted.source.headers.cookie, '***')

    const raw = (await packOf(source, { ...DEFAULTS, redact: false })).pack.rules[0].records[0]
    assert.equal(raw.response.headers.Authorization, 'real')
    assert.equal(raw.source.headers.cookie, 'sid=9')
  })

  it('名字与响应体里的引号、换行、标签都不破坏包结构', async () => {
    const source = new FakeSource()
    source.rules = [rule('r1', '含"引号"\n与</script>的中文场景😀')]
    const [record] = withRecords(source, 'r1', 1)
    record.name = '带"引号"\\与\t制表符'
    record.response = { ...ProxyMock.defaultResponse(), body: '{"a":1}\n</script>😀' }
    const { pack } = await packOf(source, DEFAULTS)

    assert.equal(pack.rules[0].name, '含"引号"\n与</script>的中文场景😀')
    assert.equal(pack.rules[0].records[0].name, '带"引号"\\与\t制表符')
    assert.equal(pack.rules[0].records[0].response.body, '{"a":1}\n</script>😀')
  })

  it('规则元信息带出 id/name/desc/时间戳，缺 desc 也不写脏值', async () => {
    const source = new FakeSource()
    const item = rule('r1')
    delete (item as any).desc
    source.rules = [item]
    const { pack } = await packOf(source, DEFAULTS)

    assert.equal(pack.rules[0].records.length, 0)
    assert.equal(pack.rules[0].id, 'r1')
    assert.equal(pack.rules[0].name, '场景 r1')
    assert.equal(pack.rules[0].desc, '')
    assert.equal(pack.rules[0].createdAt, 1_700_000_000_000)
    assert.equal(pack.rules[0].updatedAt, 1_700_000_000_500)
  })

  it('单场景缺 ruleId / 场景不存在都按 ruleMissing 回，不给空包', async () => {
    const source = new FakeSource()
    source.rules = [rule('r1')]
    withRecords(source, 'r1', 1)

    await assert.rejects(() => assembleMockPack(source, { scope: 'rule' }), (err: Error) =>
      err instanceof MockError && err.code === 'ruleMissing')
    await assert.rejects(() => assembleMockPack(source, { scope: 'rule', ruleId: 'nope' }), (err: Error) =>
      err instanceof MockError && err.code === 'ruleMissing')
  })

  it('预估只数条数：全场景用总数，单场景用本场景数，超 5,000 条只标 oversized', async () => {
    const source = new FakeSource()
    source.rules = [rule('r1'), rule('r2')]
    withRecords(source, 'r1', 3)
    withRecords(source, 'r2', 4)

    assert.deepEqual(await estimateMockPack(source, DEFAULTS), { ruleCount: 1, recordCount: 3, oversized: false })
    source.totalRecords = 6_000
    const all = await estimateMockPack(source, { scope: 'all' })
    assert.deepEqual(all, { ruleCount: 2, recordCount: 6_000, oversized: true })

    withRecords(source, 'r1', MOCK_PACK_MAX_RECORDS + 1)
    assert.equal((await estimateMockPack(source, DEFAULTS)).oversized, true)
  })
})

describe('R4 导出落盘出口', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'mock-pack-export-'))
  after(() => rmSync(workDir, { recursive: true, force: true }))

  const stripClock = (text: string) => text.replace(/"exportedAt":\d+/, '"exportedAt":0')

  function bigSource(records: number, bodyKb: number) {
    const source = new FakeSource()
    source.rules = [rule('r1')]
    const list: ProxyMock.MockRecord[] = []
    for (let i = 0; i < records; i++) {
      const item = makeRecord({ ruleId: 'r1', url: `/api/r1/${i}` })
      // 用真实字节而不是 ConsString：分片的正确性要在真的跨过 1MB 缓冲时才验得出来
      item.response = { ...ProxyMock.defaultResponse(), body: Buffer.alloc(bodyKb * 1024, 0x61 + i % 26).toString('latin1') }
      list.push(item)
    }
    source.records.set('r1', list)
    return source
  }

  it('落盘内容与字符串出口逐字节一致，包括跨过写缓冲边界的分片', async () => {
    const source = bigSource(300, 8) // ≈ 2.4MB，必然跨过一次 1MB 冲刷
    const target = path.join(workDir, 'pack.json')
    const meta = await exportMockPackToFile(target, source, DEFAULTS)
    const onDisk = readFileSync(target, 'utf-8')

    assert.equal(meta.recordCount, 300)
    assert.equal(stripClock(onDisk), stripClock((await assembleMockPack(source, DEFAULTS)).content))
    assert.equal(JSON.parse(onDisk).rules[0].records.length, 300)
  })

  it('组装中途失败：不留 .part，也不碰用户已有的同名文件', async () => {
    const target = path.join(workDir, 'keep.json')
    writeFileSync(target, '原有内容')
    const source = new ThrowingSource(5)
    source.rules = [rule('r1')]
    withRecords(source, 'r1', 10)

    await assert.rejects(() => exportMockPackToFile(target, source, DEFAULTS), /读库失败/)
    assert.equal(readFileSync(target, 'utf-8'), '原有内容')
    assert.equal(existsSync(`${target}.part`), false, '失败的半成品要删掉')
  })

  it('目录不存在时按失败回，不静默产出空文件', async () => {
    const source = new FakeSource()
    source.rules = [rule('r1')]
    await assert.rejects(() =>
      exportMockPackToFile(path.join(workDir, 'no-such-dir', 'pack.json'), source, DEFAULTS))
  })
})
