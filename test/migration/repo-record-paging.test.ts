import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

// R4C-34：整批翻页只能在真 PouchDB 上验。bookmark 在排序键有并列时下一页返回空且 bookmark=null，
// 这是 pouchdb-find 的内部行为，内存数组与假仓库都不会复现；而触发条件恰好是 R4 批量写自己造的：
// `importRecords` 里 `now` 每次调用只取一次，同批导入的记录 `createdAt` 全同值。
// 修之前这批 1,200 条的读数是：iterateRecords 100、导出 recordCount 200、listRecordSummaries/listAllRecordSummaries 500、
// countRecords 1000，四条读路都静默截断到第一页；后果里最重的一条是查重漏查（第 8 个用例修前报 created）。

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mock-repo-paging-'))
mkdirSync(path.join(DATA_DIR, 'biz_storage'), { recursive: true })
process.env.MOCK_MIGRATION_USER_DATA = DATA_DIR

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>process.env.MOCK_MIGRATION_USER_DATA}',
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { MockRepo } = await import('@main/repository/mock.repo')
const { assembleMockPack } = await import('@main/service/mock.pack.service')
const { makeMatch } = await import('../unit/fixtures')

const repo = new MockRepo() as any
await repo.init()

const ok = { statusCode: 200, headers: {}, body: '{"ok":true}', bodyType: 'json', delayMs: 0 }

/**
 * 1,200 条：把四个读路的页大小（`iterateRecords` 默认 100、导出/预览 200、
 * `listRecordSummaries` 500、`countRecords` 1000）全部越界，一处造数覆盖四条读路。
 */
const TOTAL = 1200

function packRecord(i: number) {
  return {
    id: null, name: `翻页记录 ${i}`,
    match: makeMatch({ path: `/v1/page/${i}`, enabled: false }),
    response: { ...ok, body: `{"i":${i}}` },
    variants: [], activeVariantId: null
  }
}

const ruleId = await repo.save({ name: '翻页-同批同值', desc: '' })
const seeded = await repo.importRecords(ruleId, Array.from({ length: TOTAL }, (_, i) => packRecord(i)))
const seededIds: string[] = seeded.created

async function docsOf(ids: string[]): Promise<any[]> {
  const docs: any[] = []
  for (let start = 0; start < ids.length; start += 500) {
    const page = await repo.readDocs({ keys: ids.slice(start, start + 500), include_docs: true })
    for (const row of page.rows) {
      if (row.doc != null) docs.push(row.doc)
    }
  }
  return docs
}

async function iterateIds(pageSize?: number): Promise<string[]> {
  const ids: string[] = []
  await repo.iterateRecords(ruleId, (record: any) => { ids.push(record.id) }, pageSize)
  return ids
}

describe('同批导入的记录 createdAt 同值 @真实PouchDB', () => {
  it('触发条件成立：这批确实共用一个 createdAt，且条数够越界', async () => {
    assert.equal(seededIds.length, TOTAL)
    const stamps = new Set((await docsOf(seededIds)).map((doc: any) => doc.createdAt))
    assert.equal(stamps.size, 1, '一旦哪天改成每条取一次时间戳，本文件就退化成空断言，靠这一条报警')
  })

  it('countRecords 数得出整批', async () => {
    assert.equal(await repo.countRecords(ruleId), TOTAL)
  })

  it('iterateRecords 在四种页大小下都枚举到底且不重复', async () => {
    for (const pageSize of [undefined, 100, 200, 500, 1000]) {
      const ids = await iterateIds(pageSize)
      assert.equal(ids.length, TOTAL, `pageSize=${pageSize} 只枚举出 ${ids.length} 条`)
      assert.equal(new Set(ids).size, TOTAL, `pageSize=${pageSize} 枚举出重复条目`)
    }
  })

  it('导出 recordCount 一条不丢（AC-R4-02/04 的读侧底座）', async () => {
    const result = await assembleMockPack(repo, { scope: 'rule', ruleId })
    assert.equal(result.recordCount, TOTAL)
    assert.equal(JSON.parse(result.content).rules[0].records.length, TOTAL)
  })

  it('预览与缓存走的 listRecordSummaries 读得到整批', async () => {
    assert.equal((await repo.listRecordSummaries(ruleId)).length, TOTAL)
    assert.equal((await repo.listRecordSummaries(ruleId, 200)).length, TOTAL)
  })

  it('listAllRecordSummaries 数得出全库', async () => {
    assert.equal((await repo.listAllRecordSummaries()).length, TOTAL)
    assert.equal((await repo.listAllRecordSummaries(200)).length, TOTAL)
  })

  it('与第 1,150 条同指纹的记录要被判成 duplicate——漏读的直接后果就是查重漏查', async () => {
    const twin = packRecord(1150)
    twin.name = '翻页-查重对'
    const result = await repo.importRecords(ruleId, [twin])
    assert.equal(result.outcomes[0].status, 'duplicate')
    assert.equal(result.created.length, 0)
  })

  it('翻页换法不改排序：仍按 createdAt 升序，后一批接在前一批之后', async () => {
    await new Promise(resolve => setTimeout(resolve, 5))
    const later = await repo.importRecords(ruleId, [0, 1, 2].map(i => {
      const record = packRecord(90000 + i)
      record.name = `翻页记录 后一批 ${i}`
      return record
    }))
    assert.equal(later.created.length, 3)

    const stamps: number[] = []
    const ids: string[] = []
    await repo.iterateRecords(ruleId, (record: any) => { stamps.push(record.createdAt); ids.push(record.id) }, 100)
    for (let i = 1; i < stamps.length; i++) {
      assert.ok(stamps[i] >= stamps[i - 1], `第 ${i} 条的 createdAt 比前一条小，读路顺序不再是时间升序`)
    }
    const firstLate = ids.findIndex(id => later.created.includes(id))
    assert.ok(firstLate > 0)
    assert.deepEqual(ids.slice(firstLate).sort(), [...later.created].sort(), '后一批被拆散到整段枚举里了')
  })
})
