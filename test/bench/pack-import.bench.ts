import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import {
  MOCK_PACK_FORMAT, MOCK_PACK_MAX_FILE_BYTES, MOCK_PACK_MAX_RECORDS, MOCK_PACK_VERSION, MOCK_PACK_WRITE_BATCH,
} from '@shared/mock.pack'
import { makeMatch } from '../unit/fixtures'

// R4C-30：导入侧的耗时与堆增长要有实测数，别停在「上限是 50MB / 5,000 条」这句声明上。
// 与 pack-export.bench.ts 同一套组织方式：每档各起一个进程（堆与 RSS 在同进程里单调上涨，
// 先跑的那档会把后一档的基线抬高），子进程只打一行 RESULT，父进程汇总、比对、下断言。
//
// 三档对着契约里的三个上限：
//   pack50mb —— 响应体把包顶到 50MB 档，问「读路留下多少活堆、写进去要多久」
//   pack5k   —— 5,000 条小响应体，问「条数本身值多少毫秒、批与批之间堆涨不涨」
//   har1k    —— 1,000 条 HAR entry，只量解析与映射层（`importHar` 端点仍是桩，接线在 R4C-35）

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SELF = path.resolve(ROOT, 'test/bench/pack-import.bench.ts')
const RULE_ID = 'rule-bench'
/** 两档的条数都是硬上限：凑体积只能动响应体，所以 50MB 档与 5,000 条档在契约里不是两根独立的轴 */
const RECORD_COUNT = MOCK_PACK_MAX_RECORDS
/** 条数档的响应体取 200B：这一组问的是条数本身的价格，几十 KB 的体会把耗时摊成磁盘 I/O */
const SMALL_BODY_BYTES = 200
/**
 * 体积档按整 KB 定在 8KB：5,000 条 × 8KB ≈ 41MB 正文，加上记录名与 match 的 JSON 结构约 44MB，
 * 贴着 50MB 但不越过它——越过就测成了拒绝档，那一档由 pack-validate 的单测钉着，不需要基准。
 */
const BIG_BODY_BYTES = 8 * 1024
const HAR_ENTRY_COUNT = 1_000
/** HAR 每条的响应体：真实抓包里 1KB 量级最常见，几 MB 文本就够量解析层 */
const HAR_BODY_BYTES = 1024

let DATA_DIR: string = null
/** 临时库的仓库实例：句柄要在收尾时显式关掉，Windows 上才删得掉那棵目录 */
let repo: any = null

registerHooks({
  resolve(specifier, context, nextResolve) {
    // 服务与仓库经 constants 引用 electron，基准里用最小 app 替身把 userData 指到临时目录
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>process.env.MOCK_MIGRATION_USER_DATA,getVersion:()=>"0.0.0-bench"}',
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

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

/** 一条独立分配的响应体。不能写成 `'x'.repeat(n) + '#' + i`：那是 ConsString，只是共享底串的薄壳 */
function bodyOf(index: number, size: number): string {
  const buf = Buffer.alloc(size, 0x78)
  buf.write(`#${index}`)
  return buf.toString('latin1')
}

/**
 * 包文本按 `MockPackRecord` 契约直接拼，不绕导出侧（那边由 pack-export.bench.ts 量）。
 * 每条 path 各不相同：同场景内指纹相同会让写库段被查重挡掉一部分，量到的就不是 5,000 条的价格。
 */
function buildPackText(bodyBytes: number): string {
  const records = Array.from({ length: RECORD_COUNT }, (_unused, i) => ({
    id: `rec_${i}`,
    name: `记录 ${i}`,
    match: makeMatch({ path: `/api/order/detail/${i}` }),
    response: { statusCode: 200, headers: {}, body: bodyOf(i, bodyBytes), bodyType: 'text', delayMs: 0 },
    variants: [],
    activeVariantId: null,
  }))
  return JSON.stringify({
    format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION, exportedAt: 1,
    rules: [{ id: RULE_ID, name: '压力基准场景', desc: '', records }],
  })
}

interface PackRow {
  packBytes: number
  recordCount: number
  invalidCount: number
  noteCount: number
  /** 读路（包级 + 条目级 + 归一化 + 指纹）单跑一趟的耗时 */
  readMs: number
  /** 读路之后的活堆增量：对象图本身占住的那份 */
  readLiveMb: number
  /** 读路结束时未回收增量减活堆增量：这一趟的分配垃圾，即同步段真正高点与活堆之差 */
  readGarbageMb: number
  /** 端到端（`importMockPack` 内部还要再读一遍，故写库段 ≈ importMs − readMs，见文末说明） */
  importMs: number
  /** 每批交接时强制 GC 之后的活堆高水位 */
  liveMb: number
  /**
   * 每批交接时的活堆增量序列（相对写库段起点）：峰值只说明「最高那格多大」，
   * 这条曲线才说明「它是不是一路涨上去的」——批间累积泄漏靠峰值看不出来。
   */
  curve: number[]
  /** 每批交接时不 GC 的堆高水位：与活堆之差就是批间的分配垃圾 */
  handoffMb: number
  /** 包文本、读路产物与结果都放开之后的堆差值：留下的该是仓库自己那层缓存 */
  residualMb: number
  rssGrowthMb: number
  writtenCount: number
  dbBytes: number
  batches: number
}

function dirBytes(dir: string): number {
  let total = 0
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = statSync(full)
    total += stat.isDirectory() ? dirBytes(full) : stat.size
  }
  return total
}

async function measurePack(bodyBytes: number): Promise<PackRow> {
  const { MockRepo } = await import('@main/repository/mock.repo')
  const { readMockPack, importMockPack } = await import('@main/service/mock.pack.service')

  let text: string | null = buildPackText(bodyBytes)
  const packBytes = Buffer.byteLength(text, 'utf8')
  assert.ok(packBytes < MOCK_PACK_MAX_FILE_BYTES,
    `这份包 ${mb(packBytes).toFixed(1)}MB 已越过 50MB，量到的是拒绝档`)

  repo = new MockRepo()
  await repo.init()

  // 读路先单跑一趟：`importMockPack` 内部还会再读一次，两趟读的是同一条路、同一份文本，
  // 所以写库段用 importMs − readMs 近似即可，不必把编排逻辑抄第二份去分段计时
  const readBase = gcMb()
  const readStart = performance.now()
  let read = readMockPack(text)
  const readMs = performance.now() - readStart
  const readDirtyMb = heapMb() - readBase
  const readLiveMb = gcMb() - readBase
  // 条数与明细先抄出来：`recordCount` 报的是读路真正收下的条数而不是写库回执
  const readRecordCount = read.valid.length
  const readInvalidCount = read.invalidCount
  const readNoteCount = read.notes.length
  // 基线之前先把第一趟整图放开：批间活堆的口径要在代码里说清楚，不能指望优化器判死引用。
  // 实测这一行不改变读数（V8 的精确 liveness 早就把 `read` 收回了），留着的是口径不是省下的内存
  read = null

  const before = gcMb()
  const rssBefore = process.memoryUsage().rss
  let handoff = before
  let live = before
  let batches = 0
  const curve: number[] = []
  const startedAt = performance.now()
  let result = await importMockPack(
    repo, text, { mode: 'new' }, {
      // 每批交接量两次：先看不 GC 的堆（含分配垃圾），再强制 GC 看活堆。
      // 只看 RSS 会把「每批 200 条 8KB 响应体」的分配抖动记成导入的开销。
      // 强制 GC 本身也计进了 importMs——批数只有二十几次，量级可忽略，但要说明。
      onBatch: () => {
        batches += 1
        handoff = Math.max(handoff, heapMb())
        const liveAtBatch = gcMb()
        live = Math.max(live, liveAtBatch)
        // 峰值只说明最高那格多大，这条曲线才说明它是不是一路涨上去的
        curve.push(Number((liveAtBatch - before).toFixed(1)))
      },
    })
  const importMs = performance.now() - startedAt
  const writtenCount = result.created.length + result.updated.length
  const dbBytes = dirBytes(path.join(DATA_DIR, 'biz_storage'))
  const rssGrowthMb = mb(process.memoryUsage().rss - rssBefore)
  // 引用交还之后再量一次残留：基准自己的持有物不该算进导入
  text = null
  result = null
  const residualMb = Math.max(0, gcMb() - before)

  return {
    packBytes, recordCount: readRecordCount, invalidCount: readInvalidCount, noteCount: readNoteCount,
    readMs, readLiveMb, readGarbageMb: readDirtyMb - readLiveMb,
    importMs, liveMb: live - before, handoffMb: handoff - before, curve, residualMb,
    rssGrowthMb, writtenCount, dbBytes, batches,
  }
}

interface HarRow {
  textBytes: number
  /** 文件里的 entry 总数 */
  entries: number
  /** 过了逐条判定、进到映射层的条数 */
  parsed: number
  parseSkipped: number
  mapped: number
  mapSkipped: number
  parseMs: number
  stageMs: number
  mapMs: number
  liveMb: number
  garbageMb: number
}

/** 一份能过闸的 HAR：GET + 有响应 + 非静态资源，逐条 path 不同，避免建议层把 1,000 条并成一个模式 */
function buildHarText(): string {
  const entries = Array.from({ length: HAR_ENTRY_COUNT }, (_unused, i) => ({
    request: {
      method: 'GET', url: `https://api.demo.com/api/order/detail/${i}`,
      headers: [{ name: 'accept', value: 'application/json' }],
      queryString: [{ name: 'id', value: String(i) }],
    },
    response: {
      status: 200, statusText: 'OK',
      headers: [{ name: 'content-type', value: 'application/json;charset=utf-8' }],
      content: { size: HAR_BODY_BYTES, mimeType: 'application/json', text: bodyOf(i, HAR_BODY_BYTES) },
    },
  }))
  return JSON.stringify({ log: { version: '1.2', creator: { name: 'bench' }, entries } })
}

async function measureHar(): Promise<HarRow> {
  const { readHarText, parseHarEntries, mapHarEntries } = await import('@main/service/mock.har')

  const text = buildHarText()
  const bytes = Buffer.byteLength(text, 'utf8')

  const base = gcMb()
  const parseStart = performance.now()
  const doc = readHarText(text, bytes)
  const parseMs = performance.now() - parseStart
  const stageStart = performance.now()
  const staged = parseHarEntries(doc.entries)
  const stageMs = performance.now() - stageStart
  const mapStart = performance.now()
  const mapped = mapHarEntries(staged.entries)
  const mapMs = performance.now() - mapStart
  const dirty = heapMb() - base
  const live = gcMb() - base

  return {
    textBytes: bytes, entries: doc.entries.length, parsed: staged.entries.length,
    parseSkipped: staged.skipped.length, mapped: mapped.records.length, mapSkipped: mapped.skipped.length,
    parseMs, stageMs, mapMs, liveMb: live, garbageMb: dirty - live,
  }
}

function spawn(mode: string): { mode: string; row: PackRow | HarRow } {
  const run = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx', SELF, `--mode=${mode}`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) {
    console.error(run.stdout.slice(-2000))
    throw new Error(`${mode} 档退出码 ${run.status}`)
  }
  // 子进程的 stderr 会被 spawnSync 攒下来，父进程不转述就等于没报——「临时库没删掉」正是这种要说出来的话
  if (run.stderr.trim() !== '') console.warn(`  [${mode}] ${run.stderr.trim()}`)
  const line = run.stdout.split('\n').find(it => it.startsWith('RESULT '))
  if (line == null) {
    console.error(run.stdout.slice(-2000))
    throw new Error(`${mode} 档没有输出 RESULT`)
  }
  return JSON.parse(line.slice('RESULT '.length))
}

function packReport(label: string, row: PackRow): string {
  return `${label} 包 ${mb(row.packBytes).toFixed(1)}MB · ${row.recordCount.toLocaleString('en-US')} 条` +
    ` · 读路 ${row.readMs.toFixed(0)}ms（活堆 +${row.readLiveMb.toFixed(1)}MB / 垃圾 +${row.readGarbageMb.toFixed(1)}MB）` +
    ` · 端到端 ${row.importMs.toFixed(0)}ms / ${row.batches} 批` +
    ` · 批间活堆峰值 +${row.liveMb.toFixed(1)}MB（不 GC +${row.handoffMb.toFixed(1)}MB）` +
    ` · 曲线 首批 +${row.curve[0].toFixed(1)} → 末批 +${row.curve[row.curve.length - 1].toFixed(1)}MB` +
    ` · 残留 +${row.residualMb.toFixed(1)}MB · RSS +${row.rssGrowthMb.toFixed(1)}MB` +
    ` · 落库 ${mb(row.dbBytes).toFixed(1)}MB`
}

function assertPackRow(label: string, row: PackRow): void {
  assert.equal(row.invalidCount, 0, `${label}：本基准不该有被跳过的条目，否则条数口径跟着失真`)
  assert.equal(row.recordCount, RECORD_COUNT, `${label}：读路没有把 ${RECORD_COUNT} 条全部收下`)
  assert.equal(row.writtenCount, RECORD_COUNT, `${label}：写库只落了 ${row.writtenCount} 条，耗时不是 5,000 条的耗时`)
  assert.equal(row.noteCount, 0, `${label}：包里的 id/name/时间戳都齐，不该有回落说明`)
  assert.equal(row.batches, Math.ceil(RECORD_COUNT / MOCK_PACK_WRITE_BATCH),
    `${label}：批数与写库分片对不上，` + '`onBatch`' + ' 没有逐批回调')
  assert.equal(row.curve.length, row.batches, `${label}：曲线与批数不等长`)
  // 引用交还后仍读到的堆：留下该是仓库那层缓存，不该是整包
  if (row.residualMb > 2) {
    console.error(`\n${label}：结果交还、引用放开之后仍残留 ${row.residualMb.toFixed(1)}MB——导入把整包留在了内存里`)
    process.exit(1)
  }
  // 批间累积泄漏：首批就把该摊的摊满，之后逐批只该往下走（每批交出去一份、收回来一份）
  const drift = Math.max(...row.curve) - row.curve[0]
  const driftCap = Math.max(4, mb(row.packBytes) * 0.15)
  if (drift > driftCap) {
    console.error(`\n${label}：批间活堆从首批 +${row.curve[0].toFixed(1)}MB 涨到峰值 +${(row.curve[0] + drift).toFixed(1)}MB，` +
      `超过 ${driftCap.toFixed(1)}MB 容差——写库段在逐批攒东西，不是逐批交出去`)
    process.exit(1)
  }
}

async function runParent(): Promise<void> {
  if (typeof global.gc !== 'function') {
    console.error('[bench] 必须经 --expose-gc 启动：活堆峰值靠批间强制 GC 才量得准')
    process.exit(1)
  }
  console.log(`\n[bench] R4 导入压力：体积档 5,000 条 × ${BIG_BODY_BYTES / 1024}KB 响应体` +
    ` · 条数档 5,000 条 × ${SMALL_BODY_BYTES}B · HAR 档 ${HAR_ENTRY_COUNT} entry` +
    '（每档各起一个进程，避免前一档抬高后一档的基线）')

  const bigRow = spawn('pack50mb').row as PackRow
  const smallRow = spawn('pack5k').row as PackRow
  const harRow = spawn('har1k').row as HarRow

  console.log(`  ${packReport('pack50mb', bigRow)}`)
  console.log(`  ${packReport('pack5k  ', smallRow)}`)
  console.log(`  har1k    ${mb(harRow.textBytes).toFixed(1)}MB · ${harRow.entries} entry` +
    ` · 信封+解析 ${harRow.parseMs.toFixed(0)}ms · 逐条判定 ${harRow.stageMs.toFixed(0)}ms` +
    ` · 映射 ${harRow.mapMs.toFixed(0)}ms → 成记录 ${harRow.mapped}（判定跳 ${harRow.parseSkipped}` +
    ` / 映射跳 ${harRow.mapSkipped}）· 活堆 +${harRow.liveMb.toFixed(1)}MB（垃圾 +${harRow.garbageMb.toFixed(1)}MB）`)

  assertPackRow('pack50mb', bigRow)
  assertPackRow('pack5k', smallRow)
  assert.equal(harRow.entries, HAR_ENTRY_COUNT, 'har1k：entry 没有全部读出来')
  assert.equal(harRow.parsed, HAR_ENTRY_COUNT, 'har1k：逐条判定跳掉了条目，文本形状不合契约')
  assert.equal(harRow.mapped, HAR_ENTRY_COUNT, 'har1k：映射层有跳过，量到的不是 1,000 条的耗时')
  // 三段跑完文本、解析出的 entry、映射出的记录还都挂在作用域里，所以这一格活堆是「整包 + 每条的对象开销」，
  // 不是「读了两份」。允许量按每条 4KB 摊：HAR 的响应体只有 1KB，摊不出包体积那种比例
  const harAllowance = mb(harRow.textBytes) + mb(HAR_ENTRY_COUNT * 4 * 1024)
  if (harRow.liveMb > harAllowance) {
    console.error(`\nhar1k：三段跑完仍活着 ${harRow.liveMb.toFixed(1)}MB，超出 HAR 文本 ` +
      `${mb(harRow.textBytes).toFixed(1)}MB + 每条 4KB 开销的 ${harAllowance.toFixed(1)}MB`)
    process.exit(1)
  }

  // 下面四组阈值由 2026-11-21 首轮实测定，只用来抓失控的倍率，不用来宣称达标线。
  const bigMb = mb(bigRow.packBytes)
  // 读路是同步的、没有采样点，能证明的只有「结束后留下多少」。对象图本就 ≈ 包体积，
  // 涨到包体积两倍上下说明归一化又攒了一份整图（`prepareMockPackRecord` 只该复制单条）
  if (bigRow.readLiveMb > bigMb * 2.2) {
    console.error(`\n50MB 档读路后的活堆 ${bigRow.readLiveMb.toFixed(1)}MB 已是包体积的 ` +
      `${(bigRow.readLiveMb / bigMb).toFixed(1)} 倍：读路攒了不止一份整图`)
    process.exit(1)
  }
  // 写库段的活堆 = 服务内部那一趟读路的整图 + 一批批交出去的写入侧开销，所以拿读路那一档活堆当地基。
  // 两档条数同为 5,000、字节差 10 倍：把「地基」扣掉之后剩下的那份开销若随字节涨，就是逐批没交出去。
  const bigExtra = bigRow.liveMb - bigRow.readLiveMb
  const smallExtra = smallRow.liveMb - smallRow.readLiveMb
  if (bigRow.liveMb > bigRow.readLiveMb * 1.5 + 8) {
    console.error(`\n50MB 档批间活堆峰值 ${bigRow.liveMb.toFixed(1)}MB 相对读路整图 ` +
      `${bigRow.readLiveMb.toFixed(1)}MB 涨过 1.5 倍 + 8MB：写库段攒出了第二份整图`)
    process.exit(1)
  }
  if (bigExtra > smallExtra * 2 + 2) {
    console.error(`\n写入侧额外活堆从条数档的 ${smallExtra.toFixed(1)}MB 涨到体积档的 ${bigExtra.toFixed(1)}MB：` +
      '两档条数相同、字节差 10 倍，这个开销该随条数摊而不是随字节摊')
    process.exit(1)
  }
  // 同一批 5,000 条，体积差 10 倍；端到端若几乎不涨，说明响应体压根没写进去。
  // 门槛取 1.3 而不是更贴实测的那个数：比值实测在 1.7~1.8，但两档各起一个进程、机器一忙就往下掉，
  // 这条要抓的是「没落盘」那种量级（比值 ≈ 1），不是毫秒级的性能回归
  if (bigRow.importMs < smallRow.importMs * 1.3) {
    console.error(`\n50MB 档端到端 ${bigRow.importMs.toFixed(0)}ms 与条数档 ${smallRow.importMs.toFixed(0)}ms ` +
      '几乎同价：两档条数相同、字节差数倍，写盘那一段没有被计入')
    process.exit(1)
  }
  console.log(`\n实测：同样 5,000 条，包体积 ${mb(smallRow.packBytes).toFixed(1)}MB → ${bigMb.toFixed(1)}MB` +
    `（×${(bigMb / mb(smallRow.packBytes)).toFixed(1)}）时端到端 ${smallRow.importMs.toFixed(0)}ms → ` +
    `${bigRow.importMs.toFixed(0)}ms（×${(bigRow.importMs / smallRow.importMs).toFixed(1)}），` +
    `其中读路 ${smallRow.readMs.toFixed(0)}ms → ${bigRow.readMs.toFixed(0)}ms`)
  console.log('注：端到端含第二次读路（`importMockPack` 内部自己会 `readMockPack` 一遍），' +
    '写库段近似为端到端减读路；一次真实导入只做一遍读。批间采样里的强制 GC 也计在耗时内。')
  console.log(`写入侧额外活堆（批间峰值减读路整图）：条数档 +${smallExtra.toFixed(1)}MB / 体积档 +${bigExtra.toFixed(1)}MB` +
    '——两档条数相同，这笔开销按条数摊而不是按字节摊。')
  console.log(`落库体积：条数档 ${mb(smallRow.dbBytes).toFixed(1)}MB / 体积档 ${mb(bigRow.dbBytes).toFixed(1)}MB。` +
    '体积档远小于包体积是因为 level 的 snappy 把这批合成响应体（同一字符重复）压掉了，' +
    '这一格只能读成「落盘量级」，不是真实数据的压缩比。')
}

async function runChild(mode: string): Promise<void> {
  const leaked: string[] = []
  // 监听器泄漏要攒几十 MB 的量才报得出来，基准正是那把尺
  process.on('warning', (w) => {
    if (w.name === 'MaxListenersExceededWarning') leaked.push(w.message)
  })
  DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mock-pack-import-bench-'))
  mkdirSync(path.join(DATA_DIR, 'biz_storage'), { recursive: true })
  process.env.MOCK_MIGRATION_USER_DATA = DATA_DIR

  const row = mode === 'har1k'
    ? await measureHar()
    : await measurePack(mode === 'pack50mb' ? BIG_BODY_BYTES : SMALL_BODY_BYTES)
  process.stdout.write(`RESULT ${JSON.stringify({ mode, row })}\n`)

  // 临时库在系统临时目录，绝不指向用户数据目录。level 的句柄不先关掉，Windows 上这一下必 EBUSY
  try {
    await repo?.pouchdb?.close?.()
  } catch { }
  try {
    rmSync(DATA_DIR, { recursive: true, force: true })
  } catch {
    console.error(`[bench] 临时库未删除：${DATA_DIR}`)
  }
  if (leaked.length > 0) {
    console.error(`监听器没摘干净：${leaked.join(' / ')}`)
    process.exit(3)
  }
}

const mode = process.argv.find(it => it.startsWith('--mode='))?.slice('--mode='.length)
if (mode != null) await runChild(mode)
else await runParent()
