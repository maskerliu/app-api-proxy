import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import type { MockPackExportOptions, MockPackV1 } from '@shared/mock.pack'
import { MOCK_PACK_FORMAT, MOCK_PACK_VERSION } from '@shared/mock.pack'
import { ProxyMock } from '@shared/proxy.models'
import { MockError } from '@shared/mock.errors'
import { makeMatch } from '../unit/fixtures'

// R4C-06 验收：5,000 条导出的堆增长要有实测数。
// 两条路径各起一个进程：堆与 RSS 在同进程里单调上涨，先跑的那条会把后一条的基线抬高。
// RSS 回落很慢，所以收尾的 RSS−起点近似这段工作的高水位。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SELF = path.resolve(ROOT, 'test/bench/pack-export.bench.ts')
const RULE_ID = 'rule-5k'
const RECORD_COUNT = 5_000
const PAGE_SIZE = 200
/** 响应体大小：5,000 条 × 8KB ≈ 40MB 包文本，对着 50MB 上限的量级取 */
const BODY_BYTES = 8 * 1024
const OPTIONS: MockPackExportOptions = { scope: 'rule', ruleId: RULE_ID }

registerHooks({
  resolve(specifier, context, nextResolve) {
    // mock.pack.service 经 constants 引用 electron，Node 里跑基准要给最小替身
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>"",getVersion:()=>"0.0.0-bench"}',
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { assembleMockPack } = await import('@main/service/mock.pack.service')

/**
 * 每条一份独立的 8KB 字符串。
 * 不能写成 `'x'.repeat(8192) + '#' + index`：那是 V8 的 ConsString，只是共享底串的薄壳，
 * 对照组靠它省下的内存是假的，量出来的差值就成了假账。Buffer#toString 才是真分配。
 */
function bodyOf(index: number): string {
  const buf = Buffer.alloc(BODY_BYTES, 0x78)
  buf.write(`#${index}`)
  return buf.toString('latin1')
}

function record(index: number): ProxyMock.MockRecord {
  return {
    id: `rec_${index}`,
    ruleId: RULE_ID,
    name: `记录 ${index}`,
    url: `/api/order/detail?id=${index}`,
    match: makeMatch({ path: '/api/order/detail' }),
    matchFingerprint: `fp-${index}`,
    response: { ...ProxyMock.defaultResponse(), body: bodyOf(index) },
    variants: [],
    activeVariantId: null,
    source: { method: 'GET', url: `/api/order/detail?id=${index}`, headers: { 'user-agent': 'bench' } },
    createdAt: 1_700_000_000_000 + index,
    updatedAt: 1_700_000_000_000 + index,
  }
}

function benchRule(): ProxyMock.MockRule {
  const item = new ProxyMock.MockRule()
  item._id = RULE_ID
  item.name = '基准场景'
  item.desc = ''
  item.createdAt = 1
  item.updatedAt = 2
  return item
}

/** 逐页造数、逐页交出：仓库的 iterateRecords 就是这个形状，替身不把 5,000 条常驻在内存里 */
class StreamingSource {
  visited = 0
  onHandoff: () => void = () => {}

  async listRules(): Promise<ProxyMock.MockRule[]> {
    return [benchRule()]
  }

  async getRule(ruleId: string): Promise<ProxyMock.MockRule> {
    if (ruleId !== RULE_ID) throw new MockError('ruleMissing', ruleId)
    return benchRule()
  }

  async countRecords(): Promise<number> {
    return RECORD_COUNT
  }

  async iterateRecords(_ruleId: string, visitor: (item: ProxyMock.MockRecord) => void,
    pageSize: number = PAGE_SIZE): Promise<void> {
    for (let start = 0; start < RECORD_COUNT; start += pageSize) {
      for (let i = 0; i < Math.min(pageSize, RECORD_COUNT - start); i++) {
        visitor(record(start + i))
        this.visited += 1
      }
      this.onHandoff()
    }
  }
}

/** 对照组写法：整场景读成数组、拼出完整对象图，最后一次性 JSON.stringify */
async function aggregatePackText(source: StreamingSource): Promise<string> {
  const records: ProxyMock.MockRecord[] = []
  await source.iterateRecords(RULE_ID, item => { records.push(item) })
  const pack: MockPackV1 = {
    format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION, exportedAt: Date.now(),
    rules: [{
      id: RULE_ID, name: '基准场景', desc: '', createdAt: 1, updatedAt: 2,
      records: records.map(it => ({
        id: it.id, name: it.name, match: it.match, response: it.response,
        source: it.source, createdAt: it.createdAt, updatedAt: it.updatedAt,
      })),
    }],
  }
  return JSON.stringify(pack)
}

interface Measurement {
  packBytes: number
  /** 信封头（到 "rules": 之前），导出时间与 appVersion 之外的差异都要一致 */
  head: string
  /** rules 载荷的 FNV-1a：两条路径逐字段一致的证明，切片比对不额外复制 40MB */
  checksum: string
  /** 每页交接时采一次：读数据这一段的堆高水位 */
  handoffMb: number
  /** 收尾 RSS−起点：包含各自最后一次同步序列化 */
  rssGrowthMb: number
  /** 结果交还并强制 GC 之后仍读到的堆差值：两侧数字相同，说明它是 V8 大字符串的账面底，
   * 而不是某一条路径的泄漏——所以只打印、不作闸门 */
  residualMb: number
  ms: number
  visited: number
}

function fnv1a(text: string, from: number = 0): string {
  let hash = 0x811c9dc5
  for (let i = from; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16)
}

function mb(bytes: number): number {
  return bytes / 1024 / 1024
}

function heapMb(): number {
  return process.memoryUsage().heapUsed / 1024 / 1024
}

function gcMb(): number {
  if (typeof global.gc === 'function') global.gc()
  return heapMb()
}

async function measure(mode: string): Promise<Measurement> {
  const before = gcMb()
  const rssBefore = process.memoryUsage().rss
  let handoff = before
  const source = new StreamingSource()
  source.onHandoff = () => { handoff = Math.max(handoff, heapMb()) }

  const startedAt = performance.now()
  // 两边都不传 appVersion：信封头才是可比的，包文本逐字段一致由 head + checksum + 长度共同证明
  let content: string = mode === 'stream'
    ? (await assembleMockPack(source, OPTIONS)).content
    : await aggregatePackText(source)
  const ms = performance.now() - startedAt
  // 先量 RSS 再做任何切片：校验和的中间副本不算进高水位
  const rssGrowthMb = mb(process.memoryUsage().rss - rssBefore)
  const visited = source.visited
  const rulesAt = content.indexOf('"rules":[')
  const packBytes = content.length
  const head = content.slice(0, rulesAt)
  const checksum = fnv1a(content, rulesAt)
  content = null
  return {
    packBytes, head, checksum, handoffMb: handoff - before, rssGrowthMb,
    residualMb: Math.max(0, gcMb() - before), ms, visited,
  }
}

function spawn(mode: string): Measurement {
  const run = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx', SELF, `--mode=${mode}`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) {
    console.error(run.stderr)
    throw new Error(`${mode} 分支退出码 ${run.status}`)
  }
  const line = run.stdout.split('\n').find(it => it.startsWith('RESULT '))
  if (line == null) throw new Error(`${mode} 分支没有输出 RESULT`)
  return JSON.parse(line.slice('RESULT '.length))
}

function report(label: string, row: Measurement): string {
  return `${label} 包文本 ${mb(row.packBytes).toFixed(1)}MB · 耗时 ${row.ms.toFixed(0)}ms · ` +
    `读数据时堆高水位 +${row.handoffMb.toFixed(1)}MB（不强制 GC，含待回收对象） · ` +
    `进程 RSS 高水位 +${row.rssGrowthMb.toFixed(1)}MB · 交还后账面残留 +${row.residualMb.toFixed(1)}MB`
}

async function runParent(): Promise<void> {
  if (typeof global.gc !== 'function') console.log('[bench] 提示：未经 --expose-gc 启动，残留量按不强制 GC 读取')
  console.log(`\n[bench] R4 导出组装：${RECORD_COUNT.toLocaleString('en-US')} 条 / 响应体 ${BODY_BYTES / 1024}KB` +
    `（两条路径各起一个进程，避免前一条抬高后一条的基线）`)
  const stream = spawn('stream')
  const aggregate = spawn('aggregate')
  console.log(`  ${report('流式拼接  ', stream)}`)
  console.log(`  ${report('聚合成对象', aggregate)}`)

  assert.equal(stream.visited, RECORD_COUNT, '5,000 条应当全部读到，一条不落')
  // 一致性：流式实现若漏字段/多逗号，与对照组立刻对不上
  assert.equal(stream.packBytes, aggregate.packBytes, '两条路径的包文本长度不同')
  assert.notEqual(stream.checksum, '', '基准没有读到任何内容')
  assert.equal(stream.head.replace(/"exportedAt":\d+/, '"exportedAt":0'),
    aggregate.head.replace(/"exportedAt":\d+/, '"exportedAt":0'), '信封头不一致')
  assert.equal(stream.checksum, aggregate.checksum, '两条路径组装出的包不逐字段一致')

  const budget = mb(stream.packBytes) * 5
  if (stream.rssGrowthMb > budget) {
    console.error(`\n流式拼接的 RSS 高水位 ${stream.rssGrowthMb.toFixed(1)}MB 超过包文本 5 倍预算 ${budget.toFixed(1)}MB`)
    process.exit(1)
  }
  console.log(`\n实测：同样 5,000 条 / ${mb(stream.packBytes).toFixed(1)}MB 包文本，` +
    `流式拼接堆峰值 +${stream.handoffMb.toFixed(1)}MB、进程 RSS 高水位 +${stream.rssGrowthMb.toFixed(1)}MB；` +
    `聚合成对象 +${aggregate.handoffMb.toFixed(1)}MB / +${aggregate.rssGrowthMb.toFixed(1)}MB`)
  // 这条结论必须随实现一起看：只要 assembleMockPack 还返回一个大字符串，
  // 分片拼接省下的就只是「文档对象图」那一份，最后一次 join 仍要复制整个包。
  // 想让峰值与包大小解耦，出口必须是文件流（见 R4C-08 的落盘通道）。
  console.log('注：两侧都以「返回完整字符串」为前提，峰值下界就是包文本的 2 倍（chunks + join）。')
}

async function runChild(mode: string): Promise<void> {
  process.stdout.write(`RESULT ${JSON.stringify(await measure(mode))}\n`)
}

const mode = process.argv.find(it => it.startsWith('--mode='))?.slice('--mode='.length)
if (mode != null) await runChild(mode)
else await runParent()
