import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import type { ProxyMock } from '@shared/proxy.models'
import { MOCK_MAX_PATH_LENGTH, MOCK_MAX_PATTERN_LENGTH, recordLimitState } from '@shared/mock.models'
import { validateMatchRule } from '@shared/mock.validation'
import {
  checkRecord, compileRecord, diagnoseMiss, findBestMatch, normalizeRequest,
} from '@main/service/mock.matcher'
import type { CompiledMatchRecord, MatcherRequestInput } from '@main/service/mock.matcher'
import { MEMO_CAPACITY, shouldRebuildSnapshot } from '@main/service/mock.cache.policy'
import { condition, makeMatch, makeRecord } from '../unit/fixtures'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// R1C-27：1,000 / 5,000 条记录，10% 命中 / 90% miss。
// 命中走 exact 路径桶，miss 走全量候选诊断，与 MockCache 的候选收集保持一致。
const MIX_HIT_RATE = 0.1
const WARMUP = 100

interface Dataset {
  records: ProxyMock.MockRecord[]
  compiled: CompiledMatchRecord[]
  exact: Map<string, CompiledMatchRecord[]>
  hitUrls: string[]
}

interface Timings {
  hit: number[]
  miss: number[]
  all: number[]
}

function createRandom(seed: number): () => number {
  let value = seed
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296
    return value / 4294967296
  }
}

function buildDataset(count: number): Dataset {
  const records: ProxyMock.MockRecord[] = []
  const exact = new Map<string, CompiledMatchRecord[]>()
  const hitUrls: string[] = []

  for (let index = 0; index < count; index++) {
    const path = `/api/service${index % 20}/resource/${index}`
    const match = makeMatch({
      method: 'GET',
      path,
      pathType: 'exact',
      conditions: [condition('page', '1'), condition('id', `${index}`)],
      ignoreKeys: ['ts', 'sign'],
    })
    const record = makeRecord({ id: `rec_${index}`, ruleId: 'bench-rule', name: path, match })
    records.push(record)
    hitUrls.push(`${path}?page=1&id=${index}`)

    const compiled = compileRecord(record)
    const list = exact.get(path) ?? []
    list.push(compiled)
    exact.set(path, list)
  }

  return { records, compiled: [...exact.values()].flat(), exact, hitUrls }
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1))
  return sorted[index]
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0,
  }
}

function runMix(dataset: Dataset, iterations: number): Timings {
  const random = createRandom(20261107)
  const timings: Timings = { hit: [], miss: [], all: [] }
  const total = WARMUP + iterations

  for (let index = 0; index < total; index++) {
    const expectHit = random() < MIX_HIT_RATE
    const target = Math.floor(random() * dataset.records.length)
    const url = expectHit
      ? `${dataset.hitUrls[target]}&ts=${index}`
      : `/api/missing/${index}?page=1&id=${target}&ts=${index}`
    const input: MatcherRequestInput = { method: 'GET', url }

    const started = performance.now()
    const request = normalizeRequest(input)
    const candidates = dataset.exact.get(request.path) ?? []
    const hit = findBestMatch(candidates, request)
    if (hit == null) diagnoseMiss(dataset.compiled, request)
    const elapsed = performance.now() - started

    if (index < WARMUP) continue
    timings.all.push(elapsed)
    if (hit != null) timings.hit.push(elapsed)
    else timings.miss.push(elapsed)
  }

  return timings
}

function measureMemoHitRate(dataset: Dataset, requests: number, hotKeys: number): number {
  const random = createRandom(7)
  const memo = new Map<string, number>()
  let hits = 0

  for (let index = 0; index < requests; index++) {
    const target = Math.floor(random() * Math.min(hotKeys, dataset.records.length))
    const key = `GET|${dataset.hitUrls[target]}`
    if (memo.has(key)) {
      hits++
      memo.delete(key)
      memo.set(key, index)
      continue
    }
    memo.set(key, index)
    if (memo.size > MEMO_CAPACITY) {
      const oldest = memo.keys().next().value
      if (oldest != null) memo.delete(oldest)
    }
  }

  return hits / Math.max(1, requests)
}

function heapUsedMb(): number {
  if (typeof global.gc === 'function') global.gc()
  return process.memoryUsage().heapUsed / 1024 / 1024
}

// 10k 次请求的堆占用采样：只在 GC 后读，避免把待回收对象当成泄漏
function checkMemory(dataset: Dataset, requests: number): { samples: number[]; growth: number } {
  const random = createRandom(99)
  const round = Math.floor(requests / 5)
  const samples: number[] = [heapUsedMb()]

  for (let index = 0; index < requests; index++) {
    const expectHit = random() < MIX_HIT_RATE
    const target = Math.floor(random() * dataset.records.length)
    const request = normalizeRequest({
      method: 'GET',
      url: expectHit
        ? `${dataset.hitUrls[target]}&ts=${index}`
        : `/api/missing/${index}?page=1&id=${target}&ts=${index}`,
    })
    const hit = findBestMatch(dataset.exact.get(request.path) ?? [], request)
    if (hit == null) diagnoseMiss(dataset.compiled, request)
    if ((index + 1) % round === 0) samples.push(heapUsedMb())
  }

  return { samples, growth: samples[samples.length - 1] - samples[0] }
}

function checkGuardrails() {
  const warn = recordLimitState(5001)
  assert.equal(warn.warn, true)
  assert.equal(warn.reject, false)
  assert.equal(warn.suggestion, 'splitRecommended')
  assert.equal(warn.count, 5001, '5001 条只提示，不得截断')

  const limit = recordLimitState(10000)
  assert.equal(limit.reject, false, '10,000 条仍可启用')

  const over = recordLimitState(10001)
  assert.equal(over.reject, true)
  assert.equal(over.suggestion, 'recordTooMany')
  assert.equal(over.count, 10001, '超限时保留真实数量')

  const longPath = `/${'a'.repeat(MOCK_MAX_PATH_LENGTH - 1)}`
  assert.equal(longPath.length, MOCK_MAX_PATH_LENGTH)
  const longMatch = makeMatch({ path: longPath, pathType: 'exact' })
  const longCompiled = compileRecord(makeRecord({ match: longMatch }))
  assert.equal(checkRecord(longCompiled, normalizeRequest({ method: 'GET', url: longPath })).passed, true)
  const longerPath = `${longPath}a`
  assert.equal(checkRecord(longCompiled, normalizeRequest({ method: 'GET', url: longerPath })).passed, false)

  const safePattern = 'a'.repeat(MOCK_MAX_PATTERN_LENGTH)
  assert.deepEqual(validateMatchRule(makeMatch({ path: safePattern, pathType: 'regex' })), [])
  assert.ok(validateMatchRule(makeMatch({ path: `${safePattern}a`, pathType: 'regex' }))
    .some(it => it.code === 'pathRegexTooLong'))

  assert.ok(validateMatchRule(makeMatch({ path: '(a+)+$', pathType: 'regex' }))
    .some(it => it.code === 'pathRegexUnsafe'))
  assert.deepEqual(validateMatchRule(makeMatch({ path: '(ab|cd)+$', pathType: 'regex' })), [])

  return '护栏 6 项通过'
}

function checkEngineeringGuards() {
  const cacheSource = readFileSync(path.join(ROOT, 'src/main/service/mock.cache.ts'), 'utf8')
  const matchBody = cacheSource.slice(
    cacheSource.indexOf('public async match('),
    cacheSource.indexOf('public async getCompiled('))
  assert.ok(matchBody.length > 0, '无法定位 MockCache.match')
  assert.equal(matchBody.includes('mockRepo'), false, '命中路径不得访问仓库')
  assert.equal(/pouchdb/i.test(matchBody), false, '命中路径不得访问 PouchDB')

  assert.equal(shouldRebuildSnapshot(5000, 5001), false, '小幅保存应走增量')
  assert.equal(shouldRebuildSnapshot(5000, 5600), true, '规模变化超过 10% 才全量重建')
  assert.equal(shouldRebuildSnapshot(0, 100), false)

  return '工程护栏 5 项通过'
}

function format(value: number): string {
  return value.toFixed(3)
}

function main() {
  const cpu = os.cpus()[0]?.model ?? 'unknown'
  console.log('R1 Matcher 基准（R1C-27）')
  console.log(`Node ${process.version} · ${process.platform} ${process.arch}`)
  console.log(`CPU ${cpu} · 命中比例 ${MIX_HIT_RATE * 100}% · 预热 ${WARMUP} 次`)

  const failures: string[] = []

  for (const spec of [{ count: 1000, iterations: 2000, hitP95: 1, missP95: 3, allP95: 5 },
    { count: 5000, iterations: 1000, hitP95: 3, missP95: 8, allP95: 8 }]) {
    const buildStarted = performance.now()
    const dataset = buildDataset(spec.count)
    const buildMs = performance.now() - buildStarted
    const timings = runMix(dataset, spec.iterations)
    const hit = stats(timings.hit)
    const miss = stats(timings.miss)
    const all = stats(timings.all)

    console.log(`\n[${spec.count} 条 · ${spec.iterations} 次请求] 快照编译 ${format(buildMs)}ms`)
    console.log(`  命中 ${timings.hit.length} 次 p50=${format(hit.p50)} p95=${format(hit.p95)} p99=${format(hit.p99)} max=${format(hit.max)} ms`)
    console.log(`  miss ${timings.miss.length} 次 p50=${format(miss.p50)} p95=${format(miss.p95)} p99=${format(miss.p99)} max=${format(miss.max)} ms`)
    console.log(`  整体 ${timings.all.length} 次 p50=${format(all.p50)} p95=${format(all.p95)} p99=${format(all.p99)} max=${format(all.max)} ms`)

    if (hit.p95 > spec.hitP95) failures.push(`${spec.count} 命中 p95 ${format(hit.p95)}ms > ${spec.hitP95}ms`)
    if (miss.p95 > spec.missP95) failures.push(`${spec.count} miss p95 ${format(miss.p95)}ms > ${spec.missP95}ms`)
    if (all.p95 > spec.allP95) failures.push(`${spec.count} 整体 p95 ${format(all.p95)}ms > ${spec.allP95}ms`)

    if (spec.count === 1000) {
      const rate = measureMemoHitRate(dataset, 10000, 200)
      console.log(`  memo 复用命中率 ${(rate * 100).toFixed(2)}%（10,000 次请求 / 200 个热点键）`)
      const memory = checkMemory(dataset, 10000)
      console.log(`  10,000 次请求堆占用 ${memory.samples.map(it => `${it.toFixed(1)}MB`).join(' → ')}（增长 ${memory.growth.toFixed(1)}MB）`)
      if (memory.growth > 16) failures.push(`堆增长 ${memory.growth.toFixed(1)}MB > 16MB`)
    }
  }

  console.log(`\n${checkGuardrails()}`)
  console.log(`${checkEngineeringGuards()}`)
  console.log(`\n阈值：1k 命中 p95 ≤ 1ms / miss p95 ≤ 3ms / 整体 p95 ≤ 5ms；5k 命中 ≤ 3ms / miss ≤ 8ms`)

  if (failures.length > 0) {
    console.error('\n基准未达标：')
    failures.forEach(it => console.error(`- ${it}`))
    process.exit(1)
  }
  console.log('\n基准达标')
}

main()