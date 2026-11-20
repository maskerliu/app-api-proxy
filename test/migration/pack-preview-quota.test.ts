import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

// R4C-20：预览那两个数只能在真库上验。「库内已有」取的是 `MockRepo.countRecords(ruleId)`——
// 与写库前那道复核同一个原语，而这个原语按场景过滤；假仓库把 ruleId 参数吞了也照样绿，
// 于是「把别的场景的条数算进合计」这种错只在真库看得见。

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mock-pack-quota-'))
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
const { previewMockPack } = await import('@main/service/mock.pack.service')
const { MOCK_PACK_FORMAT, MOCK_PACK_VERSION } = await import('@shared/mock.pack')
const { makeMatch, makeRecord } = await import('../unit/fixtures')

const repo = new MockRepo() as any
await repo.init()

async function newRule(name: string): Promise<string> {
  return repo.save({ name, desc: '' })
}

async function seed(ruleId: string, count: number) {
  const records = Array.from({ length: count }, (_unused, i) => {
    const record = makeRecord({
      ruleId, name: `库内 ${i}`, match: makeMatch({ path: `/seed/${ruleId}/${i}`, enabled: false })
    })
    record.id = null
    return record
  })
  await repo.importRecords(ruleId, records)
}

function packRecord(i: number) {
  return {
    id: null, name: `包内 ${i}`,
    match: makeMatch({ path: `/pack/${i}`, enabled: false }),
    response: { statusCode: 200, headers: {}, body: `{"i":${i}}`, bodyType: 'json', delayMs: 0 }
  }
}

function packText(...records: any[]) {
  return JSON.stringify({
    format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION,
    rules: [{ id: 'rule_pack', name: '包里的场景', desc: '', records }]
  })
}

describe('R4C-20 预览的「库内已有 + 待写入」（真 PouchDB）', () => {
  it('「库内已有」只数目标场景：隔壁场景那 5 条不进合计', async () => {
    const target = await newRule('配额-目标')
    const neighbor = await newRule('配额-邻居')
    await seed(target, 3)
    await seed(neighbor, 5)

    const result = await previewMockPack(repo, packText(packRecord(0), packRecord(1)),
      { mode: 'merge', targetRuleId: target } as any)

    assert.equal(result.quota?.existingRecordCount, 3,
      '合计里混进邻居场景的条数，用户就会看到凭空多出来的 5 条')
    assert.equal(result.quota?.incomingRecordCount, 2)
    assert.equal(result.quota?.totalRecordCount, 5)
    assert.equal(result.quota?.warn, false)
    assert.equal(result.quota?.reject, false)
  })

  it('填档位不改变「预览不落库」：跑完预览，目标场景条数一动不动', async () => {
    const target = await newRule('配额-只读')
    await seed(target, 2)
    const before = await repo.countRecords(target)

    const result = await previewMockPack(repo, packText(packRecord(0)),
      { mode: 'merge', targetRuleId: target } as any)

    assert.equal(result.quota?.existingRecordCount, before)
    assert.equal(await repo.countRecords(target), before, '为了算合计而写库，预览就成了第二次导入')
  })
})
