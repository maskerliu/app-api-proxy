import { createWriteStream } from 'fs'
import { rename, rm } from 'fs/promises'
import { app } from 'electron'
import { inject, injectable } from 'inversify'
import { ProxyMock } from '@shared/proxy.models'
import { MockError } from '@shared/mock.errors'
import type { MockMatchRule } from '@shared/mock.models'
import {
  MOCK_PACK_FORMAT, MOCK_PACK_MAX_RECORDS, MOCK_PACK_VERSION,
  MockPackConflict, MockPackExportOptions, MockPackIssue, MockPackPreparedRecord, MockPackPreviewOptions,
  MockPackPreviewResult, MockPackRecord, MockPackRecordCheck, MockPackV1,
  pageMockPackIssues, prepareMockPackRecord, readMockPackText, redactPackRecord,
  suggestMockPackRuleName, validateMockPackRecords,
} from '@shared/mock.pack'
import { fingerprintOf } from '../repository/mock.docs'
import type { MockRecordSummary } from '../repository/mock.docs'
import { IOC_TYPES } from '../constants'

/**
 * 包侧只依赖仓库的这几把**读**原语：`iterateRecords` 不受列表分页上限约束，
 * 是唯一能读全一个场景所有记录的入口（`listRecords` 会被 MAX_RECORD_PAGE_LIMIT 截断）；
 * `listRecordSummaries` 是预览专用——冲突索引只要 `_id`/`name`/`match.enabled`/指纹，
 * 用 `iterateRecords` 会把每个响应体都拉进内存再丢掉（库内单条上限 2MB）。
 */
export interface MockPackSource {
  listRules(): Promise<ProxyMock.MockRule[]>
  getRule(ruleId: string): Promise<ProxyMock.MockRule>
  countRecords(ruleId?: string): Promise<number>
  iterateRecords(ruleId: string,
    visitor: (record: ProxyMock.MockRecord) => void | Promise<void>,
    pageSize?: number): Promise<void>
  listRecordSummaries(ruleId: string, pageSize?: number): Promise<MockRecordSummary[]>
}

/** 读侧分片大小：与写侧 MOCK_PACK_WRITE_BATCH 同量级，但两者没有耦合关系 */
const PACK_EXPORT_PAGE_SIZE = 200
/** 落盘缓冲：攒够 1MB 才 write()，既不让千万次小写拖慢磁盘，也不让缓冲吃掉整个包 */
const PACK_WRITE_CHUNK_BYTES = 1024 * 1024

/** 组装的出口：字符串（Web 下载）或文件（桌面端边拼边写），同一套分片循环喂两边 */
export interface MockPackSink {
  write(text: string): Promise<void>
}

export interface MockPackEstimate {
  ruleCount: number
  recordCount: number
  /** 条数超过导入上限：导出仍然放行（本端读得动就该导得出），但 UI 要先给耗时预估 */
  oversized: boolean
}

export interface MockPackMeta {
  ruleCount: number
  recordCount: number
}

export interface MockPackText extends MockPackMeta {
  /** 包文本：Web 分支包成 Blob 下载；桌面分支不走这里，见 `exportMockPackToFile` */
  content: string
}

function toPackRecord(record: ProxyMock.MockRecord, options: MockPackExportOptions): MockPackRecord {
  const packed: MockPackRecord = {
    id: record.id ?? null,
    name: record.name,
    match: record.match,
    response: record.response,
  }
  // url / matchFingerprint / matchInvalid 一律不落包：都是派生值，落包后手改文件
  // 就能造出指纹与 match 不符的记录，绕过导入查重（见 mock.pack.ts 的 MockPackRecord 注释）
  if (options.includeVariants !== false && record.variants?.length) {
    packed.variants = record.variants
    if (record.activeVariantId != null) packed.activeVariantId = record.activeVariantId
  }
  if (options.includeSource !== false && record.source != null) packed.source = record.source
  if (record.createdAt != null) packed.createdAt = record.createdAt
  if (record.updatedAt != null) packed.updatedAt = record.updatedAt
  return redactPackRecord(packed, options.redact !== false)
}

/** 范围解析：非 all 一律按单场景，缺 ruleId 与场景不存在都以错误码回，不返回空包糊弄调用方 */
async function resolveRules(source: MockPackSource, options: MockPackExportOptions) {
  if (options.scope === 'all') return source.listRules()
  const ruleId = options.ruleId ?? null
  if (ruleId == null) throw new MockError('ruleMissing', 'export scope=rule requires ruleId')
  const rule = await source.getRule(ruleId)
  if (rule == null) throw new MockError('ruleMissing', ruleId)
  return [rule]
}

/**
 * 组装的唯一一段循环：分片喂给 sink，不在内存里攒整棵对象图。
 * 空场景也会留下 `"records":[]`，否则导入侧无从区分「这个场景是空的」和「这个场景没导出」。
 */
async function writeMockPack(source: MockPackSource, options: MockPackExportOptions,
  sink: MockPackSink, appVersion?: string): Promise<MockPackMeta> {
  const rules = await resolveRules(source, options)
  const header: Record<string, unknown> = {
    format: MOCK_PACK_FORMAT,
    version: MOCK_PACK_VERSION,
    exportedAt: Date.now(),
  }
  if (appVersion != null) header.appVersion = appVersion

  // 切掉 stringify 的右括号，接着往同一个对象里补数组字段
  await sink.write(`${JSON.stringify(header).slice(0, -1)},"rules":[`)
  let recordCount = 0
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    const ruleHeader = JSON.stringify({
      id: rule._id ?? null,
      name: rule.name ?? '',
      desc: rule.desc ?? '',
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    })
    if (i > 0) await sink.write(',')
    await sink.write(`${ruleHeader.slice(0, -1)},"records":[`)
    let seen = 0
    await source.iterateRecords(rule._id, async (record) => {
      if (seen++ > 0) await sink.write(',')
      await sink.write(JSON.stringify(toPackRecord(record, options)))
    }, PACK_EXPORT_PAGE_SIZE)
    recordCount += seen
    await sink.write(']}')
  }
  await sink.write(']}')
  return { ruleCount: rules.length, recordCount }
}

/**
 * 字符串出口：Web 分支要把包文本交给 Blob 下载，只能整体返回。
 * 峰值下界由出口形态决定，不由分片决定：5,000 条 / 42.7MB 实测收尾活堆 +85.5MB，
 * 与「聚合成对象再 stringify」同档（见技术设计 6.3 三档对照表）——分片省不下最后一次 join 的完整副本。
 * 桌面端因此走 `exportMockPackToFile`。
 */
export async function assembleMockPack(source: MockPackSource, options: MockPackExportOptions,
  appVersion?: string): Promise<MockPackText> {
  const chunks: string[] = []
  const meta = await writeMockPack(source, options, {
    write: async (text) => { chunks.push(text) }
  }, appVersion)
  return { content: chunks.join(''), ...meta }
}

/**
 * 落盘出口：分片直接进文件流，攒到 1MB 一次写入并尊重背压，
 * 所以峰值是「一个写缓冲」而不是「整个包」，与包大小无关。
 * 先写 `.part` 再改名：中途失败不会把用户已有的同名文件截成半截。
 */
export async function exportMockPackToFile(filePath: string, source: MockPackSource,
  options: MockPackExportOptions, appVersion?: string): Promise<MockPackMeta> {
  const stagingPath = `${filePath}.part`
  const stream = createWriteStream(stagingPath)
  let buffer = ''
  let failed: Error = null
  // 写盘的错误是异步抛的：不接住它，半截文件会被当成导出成功
  stream.on('error', (err) => { failed = err })

  const writeThrough = async (text: string) => {
    if (failed != null) throw failed
    if (stream.write(text)) return
    // 背压时 drain 可能永远不来（磁盘错、句柄已坏），等 error 与 drain 谁先到。
    // 不用 Promise.race([once(drain), once(error)])：先到的一方只摘自己的监听器，
    // 另一方每冲刷一次就留一个悬空 once——几十次后报 MaxListeners，迟到的 error 还会成 unhandled rejection。
    await new Promise<void>((resolve) => {
      const settle = () => {
        stream.off('drain', settle)
        stream.off('error', settle)
        resolve()
      }
      stream.once('drain', settle)
      stream.once('error', settle)
    })
    if (failed != null) throw failed
  }

  const flush = async (force: boolean) => {
    if (buffer.length === 0 || (!force && buffer.length < PACK_WRITE_CHUNK_BYTES)) return
    const pending = buffer
    buffer = ''
    await writeThrough(pending)
  }

  try {
    const meta = await writeMockPack(source, options, {
      write: async (text) => { buffer += text; await flush(false) }
    }, appVersion)
    await flush(true)
    if (failed != null) throw failed
    await new Promise<void>((resolve, reject) => {
      // 只等 end 的回调，落盘错误就永远等不到「finish」：导出挂在那里不返回
      stream.once('finish', () => (failed == null ? resolve() : reject(failed)))
      stream.once('error', reject)
      stream.end()
    })
    await rename(stagingPath, filePath)
    return meta
  } catch (err) {
    stream.destroy()
    await rm(stagingPath, { force: true })
    throw err
  }
}

export async function estimateMockPack(source: MockPackSource,
  options: MockPackExportOptions): Promise<MockPackEstimate> {
  const rules = await resolveRules(source, options)
  let recordCount = 0
  if (options.scope === 'all') {
    recordCount = await source.countRecords()
  } else {
    for (const rule of rules) recordCount += await source.countRecords(rule._id)
  }
  return { ruleCount: rules.length, recordCount, oversized: recordCount > MOCK_PACK_MAX_RECORDS }
}

/** 归一化之后的记录，外加它的匹配指纹 */
export interface MockPackPrepared extends MockPackPreparedRecord {
  /** 冲突比对（R4C-13/18）要用指纹，而指纹是 `canonicalMatch` 单向导出的派生值：在这里算一次，别到写库那段再算一遍 */
  fingerprint: string
}

/**
 * 三阶段读完一个包的交付物（技术设计 D8）：包级不过整包拒绝，条目级不过只跳那一条，
 * 跳剩的那些再归一化成「库里那种形状」。
 * 定义在主进程侧而不是共享层：它是「编排的产物」，不是包契约的一部分——预览与导入各自只取其中几项。
 */
export interface MockPackRead extends MockPackRecordCheck {
  pack: MockPackV1
  /** 与 `valid` 同序：坐标一致，明细要能指回包里第几个场景的第几条 */
  prepared: MockPackPrepared[]
  /** 归一化替包补了哪些字段（`packFieldDefaulted`）——是提示不是失败，不与 `issues` 混计数 */
  notes: MockPackIssue[]
}

/**
 * 校验 + 归一化的唯一入口（D8 阶段一～R4C-12）：预览与写入都从这里拿数，包级不过就连一个字符都不往下带。
 * 字节数在这一侧算——`Buffer.byteLength` 只扫不分配，换成 `mock.validation.utf8ByteLength`（它真的
 * 编码一次）就要为 50MB 的包多备一份副本；那个 helper 的量级是 2MB 响应体，不是整包。
 * 上传通道的上限只比这里多 1MB 余量，所以越过 50MB 的包确实能走到这一步，而不是先在传输层断掉。
 */
export function readMockPack(text: string | undefined): MockPackRead {
  const pack = readMockPackText(text, Buffer.byteLength(text ?? '', 'utf8'))
  const check = validateMockPackRecords(pack)
  const prepared = check.valid.map(located => {
    const item = prepareMockPackRecord(located)
    // 阶段二保证了 match 存在（缺它就拿 matchMissing 跳过），所以指纹不必判空
    const match = item.record.match as MockMatchRule
    return { ...item, fingerprint: fingerprintOf(match) }
  })
  const notes: MockPackIssue[] = []
  for (const item of prepared) {
    for (const field of item.defaulted) {
      notes.push({
        code: 'packFieldDefaulted', field,
        ruleIndex: item.ruleIndex, recordIndex: item.recordIndex, recordId: item.record.id ?? undefined,
      })
    }
  }
  return { pack, ...check, prepared, notes }
}

/** 目标场景的冲突索引：一次摘要扫描建两张表，之后每条记录只做两次查表 */
async function indexMockPackTarget(source: MockPackSource, ruleId: string) {
  const byId = new Map<string, MockRecordSummary>()
  const byFingerprint = new Map<string, MockRecordSummary>()
  for (const item of await source.listRecordSummaries(ruleId, PACK_EXPORT_PAGE_SIZE)) {
    byId.set(item._id, item)
    // 同指纹在库里本该被 `MockRepo.saveRecord` 的指纹查重挡住，真出现（迁移遗留、历史脏数据）就记第一条：
    // 预览要说的是「会撞上谁」，不是「被撞了几次」
    if (item.matchFingerprint != null && !byFingerprint.has(item.matchFingerprint)) {
      byFingerprint.set(item.matchFingerprint, item)
    }
  }
  return { byId, byFingerprint }
}

/**
 * 预览（R4C-13）：把三阶段的产出折算成响应体，全程只读——用的三把原语里没有一把写得住东西，
 * 「预览不落库」因此是结构事实，不是一句约定。
 *
 * 冲突只在合并模式算，且只在**目标场景内**比：指纹查重在库里就是规则级的（`findByFingerprint(ruleId, …)`），
 * 跨场景同指纹是合法的。**但 `_id` 是全局唯一的**，所以「包里的 id 属于别的场景」这种必败情况
 * 在这一层看不见，只能等 R4C-15 写库时被 PouchDB 顶回来——要不要在预览就查全库 id，属 R4C-15 的取舍。
 */
export async function previewMockPack(source: MockPackSource, text: string | undefined,
  options: MockPackPreviewOptions): Promise<MockPackPreviewResult> {
  const read = readMockPack(text)
  const result: MockPackPreviewResult = {
    kind: 'pack',
    packVersion: read.pack.version,
    appVersion: read.pack.appVersion,
    ruleCount: read.pack.rules.length,
    recordCount: read.pack.rules.reduce((sum, it) => sum + it.records.length, 0),
    variantCount: read.prepared.reduce((sum, it) => sum + (it.record.variants?.length ?? 0), 0),
    invalidCount: read.invalidCount,
    conflictCount: 0,
    issues: pageMockPackIssues(read.issues),
    issueTotal: read.issues.length,
    conflicts: [],
    notes: pageMockPackIssues(read.notes),
    noteTotal: read.notes.length,
  }
  if (options.mode !== 'merge') {
    // 多场景包不填建议名：一个名字代表不了 N 个场景，逐条对照是 UI 拿 `rules[i].name` 自己做的事
    if (read.pack.rules.length === 1) {
      const rules = await source.listRules()
      result.suggestedRuleName = suggestMockPackRuleName(read.pack.rules[0].name, rules.map(it => it.name))
    }
    return result
  }

  const ruleId = options.targetRuleId ?? null
  if (ruleId == null) throw new MockError('ruleMissing', 'merge preview requires targetRuleId')
  if (await source.getRule(ruleId) == null) throw new MockError('ruleMissing', ruleId)
  const index = await indexMockPackTarget(source, ruleId)
  const conflicts: MockPackConflict[] = []
  for (const item of read.prepared) {
    const existingOf = (existing: MockRecordSummary) => ({
      ruleIndex: item.ruleIndex, recordIndex: item.recordIndex, recordId: item.record.id ?? undefined,
      existingRecordId: existing._id, existingName: existing.name, existingEnabled: existing.match?.enabled !== false,
    })
    const sameId = item.record.id == null ? null : index.byId.get(item.record.id)
    if (sameId != null) conflicts.push({ kind: 'id', ...existingOf(sameId) })
    const sameFingerprint = index.byFingerprint.get(item.fingerprint)
    if (sameFingerprint != null && sameFingerprint._id !== item.record.id) {
      conflicts.push({ kind: 'fingerprint', ...existingOf(sameFingerprint) })
    }
  }
  result.conflicts = pageMockPackIssues(conflicts)
  result.conflictCount = conflicts.length
  return result
}

@injectable()
export class MockPackService {

  @inject(IOC_TYPES.MockRepo)
  private mockRepo: MockPackSource

  // 预统计没有调用方，是刻意留的：技术设计 5.3 原写「>5,000 显示耗时预估」，但预估要把全库数一遍，
  // 比实测 283ms 的写盘还贵；条数改由落盘回执给出。若将来要做真正的耗时预估，别接回这里。
  async estimate(options: MockPackExportOptions) {
    return estimateMockPack(this.mockRepo, options)
  }

  async export(options: MockPackExportOptions) {
    return assembleMockPack(this.mockRepo, options, app.getVersion())
  }

  /** 桌面端出口：包文本直接进文件，不经过渲染进程（几十 MB 走 IPC 会被克隆两遍） */
  async exportToFile(filePath: string, options: MockPackExportOptions) {
    return exportMockPackToFile(filePath, this.mockRepo, options, app.getVersion())
  }

  /**
   * 三阶段（D8）：包级不过整包拒绝，条目级不过只跳过那一条、其余继续，剩下的归一化成库内形状。
   * 这里没有 `this.mockRepo` 是刻意的——坏包在碰到任何库原语之前就该被拒，「零写入」由这一步的位置保证，
   * 不靠后面的写库代码自觉。「库内已有 + 待写入」的上限复核要读库，属 R4C-14 写库前的那一步。
   */
  readPack(text: string | undefined) {
    return readMockPack(text)
  }

  /** 预览（R4C-13）：只读，统计 + 冲突 + 建议名；写库与上限复核属 R4C-15 */
  async preview(text: string | undefined, options: MockPackPreviewOptions) {
    return previewMockPack(this.mockRepo, text, options)
  }
}
