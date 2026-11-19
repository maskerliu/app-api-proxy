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

export interface MockPackEstimate {
  ruleCount: number
  recordCount: number
  /** 条数超过导入上限：导出仍然放行（本端读得动就该导得出），但 UI 要先给耗时预估 */
  oversized: boolean
}

export interface MockPackText {
  /** 包文本：桌面端直接写盘、Web 端包成 Blob，全程不再 JSON.parse 一次 */
  content: string
  ruleCount: number
  recordCount: number
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
 * 分片拼接：每读到一条记录就 stringify 成一小段字符串，文档对象当场可回收。
 * 不先聚合成大对象再一次性 stringify——50MB 包那样做的峰值是「整棵对象图 + 包文本」，
 * 而这里终归只需要一份包文本（最后一次 join）。空场景也会留下 `"records":[]`，
 * 否则导入侧无从区分「这个场景是空的」和「这个场景没导出」。
 */
export async function assembleMockPack(source: MockPackSource, options: MockPackExportOptions,
  appVersion?: string): Promise<MockPackText> {
  const rules = await resolveRules(source, options)
  const header: Record<string, unknown> = {
    format: MOCK_PACK_FORMAT,
    version: MOCK_PACK_VERSION,
    exportedAt: Date.now(),
  }
  if (appVersion != null) header.appVersion = appVersion

  // 切掉 stringify 的右括号，接着往同一个对象里补数组字段
  const chunks: string[] = [`${JSON.stringify(header).slice(0, -1)},"rules":[`]
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
    if (i > 0) chunks.push(',')
    chunks.push(`${ruleHeader.slice(0, -1)},"records":[`)
    let seen = 0
    await source.iterateRecords(rule._id, (record) => {
      if (seen++ > 0) chunks.push(',')
      chunks.push(JSON.stringify(toPackRecord(record, options)))
    }, PACK_EXPORT_PAGE_SIZE)
    recordCount += seen
    chunks.push(']}')
  }
  chunks.push(']}')
  return { content: chunks.join(''), ruleCount: rules.length, recordCount }
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
}
