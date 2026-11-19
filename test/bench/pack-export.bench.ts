import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import type { MockPackExportOptions, MockPackV1 } from '@shared/mock.pack'
import { MOCK_PACK_FORMAT, MOCK_PACK_VERSION } from '@shared/mock.pack'
import { ProxyMock } from '@shared/proxy.models'
import { MockError } from '@shared/mock.errors'
import { makeMatch } from '../unit/fixtures'

// R4C-06 验收：5,000 条导出的堆增长要有实测数。
// 每条路径各起一个进程：堆与 RSS 在同进程里单调上涨，先跑的那条会把后一条的基线抬高。
// RSS 回落很慢，所以收尾的 RSS−起点近似这段工作的高水位。
//
// 三档：
//   stream    —— 流式拼接 + 返回字符串（Web 分支的出口）
//   aggregate —— 对照组：整棵对象图聚合成对象再 stringify
//   file      —— 流式拼接 + 直接落盘（裁决后的桌面端出口）：峰值应与包大小无关

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

const { assembleMockPack, exportMockPackToFile } = await import('@main/service/mock.pack.service')

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

  async iterateRecords(_ruleId: string, visitor: (item: ProxyMock.MockRecord) => void | Promise<void>,
    pageSize: number = PAGE_SIZE): Promise<void> {
    for (let start = 0; start < RECORD_COUNT; start += pageSize) {
      for (let i = 0; i < Math.min(pageSize, RECORD_COUNT - start); i++) {
        // 必须逐条 await：仓库的 iterateRecords 就是这么做的，导出侧的写序与背压都建立在这上面。
        // 早前这里没 await，一页 200 次写盘并发跑，量出来的峰值是替身的错，不是导出的。
        await visitor(record(start + i))
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
  /** 包体积一律按 UTF-8 字节计：落盘文件、上传体积、50MB 上限量的是同一个东西 */
  packBytes: number
  /** 信封头（到 "rules": 之前），导出时间与 appVersion 之外的差异都要一致 */
  head: string
  /** rules 载荷的 FNV-1a：三档逐字段一致的证明 */
  checksum: string
  /** 每页交接时「强制 GC 之后」的活堆高水位：这才是峰值，不含还来不及回收的分配垃圾。
   * 基准每页现造 200 条 8KB 记录，分配速率远高于导出本身——只看 RSS 会把它记成导出的开销。 */
  liveMb: number
  /** 每页交接时不 GC 的堆高水位：与活堆之差就是这段的分配垃圾 */
  handoffMb: number
  /** 收尾 RSS−起点：含分配抖动，只作参考 */
  rssGrowthMb: number
  /** 结果交还并强制 GC 之后仍读到的堆差值：字符串档留着整个包，落盘档应当接近零 */
  residualMb: number
  ms: number
  visited: number
}

/**
 * 一律按 UTF-8 字节取包体积与校验和：落盘文件、上传体积、50MB 上限量的是同一个东西，
 * 而字符串档的 `.length` 是 UTF-16 码元数，含中文记录名时与字节数不等——混用会假报不一致。
 * FNV-1a 逐字节累加。
 */
function digest(bytes: Buffer) {
  const rulesAt = bytes.indexOf(Buffer.from('"rules":[', 'latin1'))
  let hash = 0x811c9dc5
  for (let i = rulesAt; i < bytes.length; i++) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return { head: bytes.subarray(0, rulesAt).toString('latin1'), checksum: hash.toString(16) }
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
  let live = before
  const source = new StreamingSource()
  // 每页交接量两次：先看不 GC 的堆（含分配垃圾），再强制 GC 看活堆。
  // 只报 RSS 会把「每页现造 200 条 8KB 记录」的分配抖动记成导出的开销。
  source.onHandoff = () => {
    handoff = Math.max(handoff, heapMb())
    live = Math.max(live, gcMb())
  }
  // 落盘档写进系统临时目录而不是工作树：几十 MB 的基准产物不该污染仓库
  const dir = mode === 'file' ? mkdtempSync(path.join(tmpdir(), 'mock-pack-bench-')) : null
  const filePath = dir != null ? path.join(dir, 'pack.json') : null

  const startedAt = performance.now()
  // 三档都不传 appVersion：信封头才是可比的，包文本逐字段一致由 head + checksum + 长度共同证明
  let text: string = null
  if (mode === 'stream') {
    text = (await assembleMockPack(source, OPTIONS)).content
  } else if (mode === 'file') {
    await exportMockPackToFile(filePath, source, OPTIONS)
  } else {
    text = await aggregatePackText(source)
  }
  const ms = performance.now() - startedAt
  // 先取 RSS 再读回文件：读回那一份副本不该记进导出自己的高水位
  const rssGrowthMb = mb(process.memoryUsage().rss - rssBefore)
  const visited = source.visited
  // 落盘档读回的是字节，字符串档把字符串按 UTF-8 编码成同样的字节再比
  let bytes: Buffer = mode === 'file' ? readFileSync(filePath) : Buffer.from(text, 'utf8')
  const packBytes = bytes.length
  const { head, checksum } = digest(bytes)
  bytes = null
  text = null
  if (dir != null) rmSync(dir, { recursive: true, force: true })
  return {
    packBytes, head, checksum, liveMb: live - before, handoffMb: handoff - before,
    rssGrowthMb, residualMb: Math.max(0, gcMb() - before), ms, visited,
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
  return `${label} 包 ${(mb(row.packBytes)).toFixed(1)}MB · 耗时 ${row.ms.toFixed(0)}ms · ` +
    `活堆峰值 +${row.liveMb.toFixed(1)}MB（每页 GC 之后） · 不 GC 堆峰值 +${row.handoffMb.toFixed(1)}MB · ` +
    `RSS +${row.rssGrowthMb.toFixed(1)}MB（含每页现造记录的分配抖动） · 交还后残留 +${row.residualMb.toFixed(1)}MB`
}

/** 落盘档的字节数必须和字符串档逐字节相同，否则比较内存没有意义 */
function samePack(label: string, a: Measurement, b: Measurement): void {
  assert.equal(a.visited, RECORD_COUNT, `${label}：5,000 条没有全部读到`)
  assert.equal(a.packBytes, b.packBytes, `${label}：包字节数与另一档不一致`)
  assert.equal(a.head.replace(/"exportedAt":\d+/, '"exportedAt":0'),
    b.head.replace(/"exportedAt":\d+/, '"exportedAt":0'), `${label}：信封头不一致`)
  assert.equal(a.checksum, b.checksum, `${label}：组装出的包不逐字段一致`)
}

async function runParent(): Promise<void> {
  if (typeof global.gc !== 'function') {
    console.error('[bench] 必须经 --expose-gc 启动：活堆峰值靠每页强制 GC 才量得准')
    process.exit(1)
  }
  const runFile = !process.argv.includes('--no-file')
  console.log(`\n[bench] R4 导出组装：${RECORD_COUNT.toLocaleString('en-US')} 条 / 响应体 ${BODY_BYTES / 1024}KB` +
    `（每档各起一个进程，避免前一档抬高后一档的基线）`)
  const legs: Array<[string, Measurement]> = [
    ['stream    ', spawn('stream')],
    ['aggregate ', spawn('aggregate')],
  ]
  if (runFile) legs.push(['file      ', spawn('file')])
  for (const [label, row] of legs) console.log(`  ${report(label, row)}`)

  const stream = legs[0][1]
  const aggregate = legs[1][1]
  // 一致性：流式实现若漏字段/多逗号，与对照组立刻对不上
  samePack('stream', stream, aggregate)
  // 字符串档的活堆峰值本就是包体积的两倍（分片数组 + 最后一次 join 的完整副本），
  // 这条闸门只用来抓真正的失控累积，不用来宣称流式拼接省了内存——它省不下那一份副本。
  const budget = mb(stream.packBytes)
  if (stream.liveMb > budget * 2.5) {
    console.error(`\n流式拼接的活堆峰值 ${stream.liveMb.toFixed(1)}MB 高于包体积 ${budget.toFixed(1)}MB——` +
      '序列化过程中攒了不该攒的东西')
    process.exit(1)
  }

  if (legs.length > 2) {
    const file = legs[2][1]
    samePack('file', file, stream)
    console.log(`\n实测：同样 ${budget.toFixed(1)}MB 的包，活堆峰值 ` +
      `流式拼接返字符串 +${stream.liveMb.toFixed(1)}MB · 聚合成对象 +${aggregate.liveMb.toFixed(1)}MB · ` +
      `流式直接落盘 +${file.liveMb.toFixed(1)}MB`)
    console.log(`交还后残留：字符串档 +${stream.residualMb.toFixed(1)}MB（留住整个包） / ` +
      `落盘档 +${file.residualMb.toFixed(1)}MB`)
    // 裁决「改成边拼边写盘」要证明的两件事：峰值不再随包大小走，且结果不再被调用方持有
    if (file.liveMb * 4 > stream.liveMb) {
      console.error(`\n落盘档活堆峰值 ${file.liveMb.toFixed(1)}MB 相对字符串档 ${stream.liveMb.toFixed(1)}MB ` +
        '没有降到一个量级——峰值仍在随包大小走')
      process.exit(1)
    }
    if (file.residualMb > stream.residualMb / 2) {
      console.error(`\n落盘档残留 ${file.residualMb.toFixed(1)}MB 没有比字符串档 ${stream.residualMb.toFixed(1)}MB ` +
        '降下来：包文本被留在了内存里')
      process.exit(1)
    }
  } else {
    console.log('\n注：stream/aggregate 两档都以「返回完整字符串」为前提，峰值下界就是包体积本身；')
    console.log('与包大小无关的是落盘档（--mode=file），本次以 --no-file 跳过。')
  }
}

async function runChild(mode: string): Promise<void> {
  const leaked: string[] = []
  // 背压每冲刷一次若留一个悬空监听器，几十 MB 的量才会报出来——基准正是那把尺
  process.on('warning', (w) => {
    if (w.name === 'MaxListenersExceededWarning') leaked.push(w.message)
  })
  const row = await measure(mode)
  process.stdout.write(`RESULT ${JSON.stringify(row)}\n`)
  if (leaked.length > 0) {
    console.error(`监听器没摘干净：${leaked.join(' / ')}`)
    process.exit(3)
  }
}

const mode = process.argv.find(it => it.startsWith('--mode='))?.slice('--mode='.length)
if (mode != null) await runChild(mode)
else await runParent()
