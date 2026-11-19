import { createWriteStream } from 'fs'
import { rename, rm } from 'fs/promises'
import { app } from 'electron'
import { inject, injectable } from 'inversify'
import { ProxyMock } from '@shared/proxy.models'
import { MockError } from '@shared/mock.errors'
import {
  MOCK_PACK_FORMAT, MOCK_PACK_MAX_RECORDS, MOCK_PACK_VERSION,
  MockPackExportOptions, MockPackRecord, redactPackRecord,
} from '@shared/mock.pack'
import { IOC_TYPES } from '../constants'

/**
 * 导出只依赖仓库的这四把原语：`iterateRecords` 不受列表分页上限约束，
 * 是唯一能读全一个场景所有记录的入口（`listRecords` 会被 MAX_RECORD_PAGE_LIMIT 截断）。
 */
export interface MockPackSource {
  listRules(): Promise<ProxyMock.MockRule[]>
  getRule(ruleId: string): Promise<ProxyMock.MockRule>
  countRecords(ruleId?: string): Promise<number>
  iterateRecords(ruleId: string,
    visitor: (record: ProxyMock.MockRecord) => void | Promise<void>,
    pageSize?: number): Promise<void>
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
 * 峰值 = 分片缓冲 + 最后一次 join 的完整副本，即包文本的两倍；
 * 5,000 条 / 42.7MB 实测 RSS 高水位 +195.6MB（对照组聚合成对象再 stringify 是 +154.8MB）——
 * 只要出口还是字符串，分片就省不下那一份完整副本。桌面端因此走 `exportMockPackToFile`。
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

@injectable()
export class MockPackService {

  @inject(IOC_TYPES.MockRepo)
  private mockRepo: MockPackSource

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
}
