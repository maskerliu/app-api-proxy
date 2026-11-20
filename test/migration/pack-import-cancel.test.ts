import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

// R4C-19：取消与回滚只能在真库上验。三件事各自要有落库读数才能算证住：
// 「取消在批与批之间生效」要看得见已写的那 200 条还在库里、「新建模式零写入即回收」要看得见 `listRules()` 回到基线、
// 「合并模式不回滚」要看得见目标场景那条原封不动。假仓库只能断言「我调了哪个方法」，那正好是要避免的自我实现。

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mock-pack-cancel-'))
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
const { importMockPack } = await import('@main/service/mock.pack.service')
const { MOCK_PACK_FORMAT, MOCK_PACK_VERSION, MOCK_PACK_WRITE_BATCH } = await import('@shared/mock.pack')
const { MOCK_RECORD_REJECT_LIMIT } = await import('@shared/mock.models')
const { makeMatch } = await import('../unit/fixtures')

const repo = new MockRepo() as any
await repo.init()

const ok = { statusCode: 200, headers: {}, body: '{"ok":true}', bodyType: 'json', delayMs: 0 }

function packRecord(i: number) {
  return {
    id: null, name: `取消记录 ${i}`,
    match: makeMatch({ path: `/v1/cancel/${i}`, enabled: false }),
    response: { ...ok, body: `{"i":${i}}` },
    variants: [], activeVariantId: null
  }
}

function scenario(name: string, records: any[]) {
  return { id: `rule_pack_${name}`, name, desc: '', records }
}

function packTextOf(...rules: any[]) {
  return JSON.stringify({ format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION, rules })
}

async function newRule(name: string): Promise<string> {
  return repo.save({ name, desc: '' })
}

async function ruleNames(): Promise<string[]> {
  return (await repo.listRules()).map((it: any) => it.name)
}

/**
 * 条数一律用 `countRecords`、回读一律用 `readDocs({keys})`，两处都不走 `iterateRecords`：
 * 批量写进来的记录共用一个 `createdAt`（仓库那一句 `now` 整批一次），而 `iterateRecords` 按
 * `createdAt` 排序 + bookmark 翻页，页边界落在相同 key 上会漏条（2026-11-20 实测 250 条只枚举出 100 条，
 * 导出侧 `PACK_EXPORT_PAGE_SIZE=200` 时 250 条只导出了 200 条）。修法与用例属新卡，本批不在这个文件里修。
 * 另外 `countRecords` 在「整批被拒」那两个用例里被换成越界探针，那里改用 `docsOf(created).length`。
 */
async function countOf(ruleId: string): Promise<number> {
  return repo.countRecords(ruleId)
}

async function docsOf(ids: string[]): Promise<any[]> {
  const page = await repo.readDocs({ keys: ids, include_docs: true })
  return page.rows.filter((row: any) => row.doc != null).map((row: any) => row.doc)
}

/** 记录名尾部的序号：批内前 200 条这种判据要看序号，看字符串排序会把 10 和 100 排到一起去 */
async function indicesOf(ids: string[]): Promise<number[]> {
  return (await docsOf(ids))
    .map((doc: any) => Number(String(doc.name).replace('取消记录 ', '')))
    .sort((a, b) => a - b)
}

let seq = 0
function uniqueName(prefix: string) {
  return `${prefix}-${++seq}`
}

/** 把仓库那句上限复核钉成「一定越界」：整批在写之前就被 `recordTooMany` 拒掉 */
async function withRejectLimit(fn: () => Promise<void>) {
  const original = repo.countRecords
  repo.countRecords = async () => MOCK_RECORD_REJECT_LIMIT
  try {
    await fn()
  } finally {
    repo.countRecords = original
  }
}

describe('取消在批与批之间生效（PRD 4.4.7 / 技术设计 §6.5）', () => {
  it('首批之前就取消 → 一条没写，新建模式的壳全部回收，没写的逐条报 packWriteAborted', async () => {
    const base = uniqueName('取消-零写入')
    const before = (await repo.listRules()).length
    const text = packTextOf(
      scenario(`${base}A`, [packRecord(0), packRecord(1), packRecord(2)]),
      scenario(`${base}B`, [packRecord(3), packRecord(4), packRecord(5)])
    )
    const controller = new AbortController()
    controller.abort()

    const result = await importMockPack(repo, text, { mode: 'new' }, { signal: controller.signal })

    assert.equal(result.aborted, true, '取消要自己占一栏，不能只靠 failed 反推')
    assert.deepEqual([result.created.length, result.updated.length, result.ruleIds.length], [0, 0, 0],
      '库里没写进一条，结果页也就没有场景可跳')
    assert.equal(result.partial, false, '「一条都没写」和「写了一半失败」是两回事')
    assert.equal(result.failed.length, 6)
    assert.deepEqual([...new Set(result.failed.map((it: any) => it.code))], ['packWriteAborted'],
      '没写的每条都要有交代，不许留成没数')

    assert.deepEqual((await ruleNames()).filter(it => it.startsWith(base)), [], '新建的场景一个都不该留下')
    assert.equal((await repo.listRules()).length, before, '回收即零写入')
  })

  it('首批落库之后取消 → 已写的 200 条留着，场景不回收，剩下 50 条报 packWriteAborted', async () => {
    const base = uniqueName('取消-半程')
    const total = MOCK_PACK_WRITE_BATCH + 50
    const text = packTextOf(scenario(base, Array.from({ length: total }, (_, i) => packRecord(i))))
    const controller = new AbortController()
    const batches: number[][] = []

    const result = await importMockPack(repo, text, { mode: 'new' }, {
      signal: controller.signal,
      onBatch: (written, count) => {
        batches.push([written, count])
        // 第一批刚落库就取消：取消点落在批与批之间，正是仓库唯一的检查位置
        if (written === 1) controller.abort()
      }
    })

    assert.deepEqual(batches, [[1, 2]], '进度按批次报，每批一次')
    assert.equal(result.created.length, MOCK_PACK_WRITE_BATCH, '已写的那一批不许因为取消而消失')
    assert.equal(result.failed.length, 50)
    assert.deepEqual([...new Set(result.failed.map((it: any) => it.code))], ['packWriteAborted'])
    assert.equal(result.aborted, true)
    assert.equal(result.partial, true, '既有失败又有写入 = 部分成功')
    assert.equal(result.ruleIds.length, 1)

    const ruleId = result.ruleIds[0]
    assert.equal(await countOf(ruleId), MOCK_PACK_WRITE_BATCH, '落库读数是唯一能证明「没回滚」的东西')
    assert.deepEqual(await indicesOf(result.created), Array.from({ length: MOCK_PACK_WRITE_BATCH }, (_, i) => i),
      '写进去的是批内前 200 条，不是随便某 200 条')
  })

  it('合并模式取消 → 已写的留着，目标场景本来就在，不回滚（AC-R4-09）', async () => {
    const ruleId = await newRule(uniqueName('合并-取消'))
    await repo.importRecords(ruleId, [packRecord(0)], { preserveTimestamps: true })
    const text = packTextOf(scenario('任意', Array.from({ length: MOCK_PACK_WRITE_BATCH + 10 },
      (_, i) => packRecord(i + 100))))
    const controller = new AbortController()

    const result = await importMockPack(repo, text, { mode: 'merge', targetRuleId: ruleId, conflict: 'skip' } as any,
      { signal: controller.signal, onBatch: (written) => { if (written === 1) controller.abort() } })

    assert.equal(result.aborted, true)
    assert.equal(result.created.length, MOCK_PACK_WRITE_BATCH)
    assert.equal(result.failed.length, 10)
    assert.deepEqual(result.ruleIds, [ruleId], '合并模式的目标场景是用户自己的，取消不许把它删掉')
    assert.equal(await countOf(ruleId), MOCK_PACK_WRITE_BATCH + 1)
  })
})

describe('新建模式整批被拒 → 回收已建场景（用户 2026-11-20 裁决）', () => {
  it('recordTooMany 拒掉整个场景 → 空壳删掉，listRules 回到基线', async () => {
    const base = uniqueName('被拒-回收')
    const before = (await repo.listRules()).length
    const text = packTextOf(
      scenario(`${base}A`, [packRecord(0), packRecord(1)]),
      scenario(`${base}B`, [packRecord(2), packRecord(3)])
    )

    await withRejectLimit(async () => {
      const result = await importMockPack(repo, text, { mode: 'new' })
      assert.deepEqual([result.created.length, result.updated.length, result.ruleIds.length], [0, 0, 0])
      assert.equal(result.failed.length, 4)
      assert.deepEqual([...new Set(result.failed.map((it: any) => it.code))], ['recordTooMany'])
      // 回收走的是仓库那句 `delete`：连记录清理一起做完，服务层不许自己补
      assert.deepEqual((await ruleNames()).filter(it => it.startsWith(base)), [])
    })

    assert.equal((await repo.listRules()).length, before, '整批被拒不许留下空场景')
  })

  it('同一次导入里一个场景写进去、另一个被拒 → 只回收后者', async () => {
    const base = uniqueName('被拒-一半')
    const text = packTextOf(
      scenario(`${base}A`, [packRecord(0), packRecord(1)]),
      scenario(`${base}B`, [packRecord(2), packRecord(3)])
    )

    // 只让第二个场景越界：按场景名判定，保证「哪个壳被回收」是写入结果决定的，不是循环顺序决定的
    const original = repo.countRecords
    repo.countRecords = async (ruleId?: string) => {
      const rule = ruleId == null ? null : await repo.getRule(ruleId)
      return rule?.name?.endsWith(`${base}B`) === true ? MOCK_RECORD_REJECT_LIMIT : 0
    }
    try {
      const result = await importMockPack(repo, text, { mode: 'new' })
      assert.equal(result.created.length, 2, '第一个场景照写不误')
      assert.equal(result.ruleIds.length, 1, '被拒的那个场景不进结果页')
      assert.deepEqual([...new Set(result.failed.map((it: any) => it.code))], ['recordTooMany'])
      // 这一条不能用 `countOf`：`countRecords` 正被这个用例换成越界探针，读数只能按 ID 回取
      assert.equal((await docsOf(result.created)).length, 2, '写进去的那两条真在库里')
      assert.deepEqual((await repo.listRules()).filter((it: any) => it.name.startsWith(base)).map((it: any) => it.name),
        [`${base}A`], '库里只剩写得满的那个场景')
    } finally {
      repo.countRecords = original
    }
  })

  it('新建模式没有「全部跳过」这一档：同批内挡掉一条仍算有写入，不回收', async () => {
    // 包内同指纹的两条里必有一条写得进，而新场景不与库内任何记录比冲突（冲突只在目标场景内比）。
    // 所以回收只有两个来历：整批被拒、取消落在首批之前。条目级全坏那一档由 R4C-18 的「不建空场景」钉着。
    const base = uniqueName('同指纹')
    const text = packTextOf(scenario(base, [
      { ...packRecord(0), match: makeMatch({ path: '/v1/dup', enabled: false }) },
      { ...packRecord(1), match: makeMatch({ path: '/v1/dup', enabled: false }) }
    ]))

    const result = await importMockPack(repo, text, { mode: 'new' })
    assert.equal(result.created.length, 1, '同批内第二条被指纹查重挡掉')
    assert.equal(result.skipped.length, 1)
    assert.equal(result.ruleIds.length, 1, '写进去一条就不是空壳，回收判据看的是实际写入')
    assert.equal(await countOf(result.ruleIds[0]), 1)
  })
})

describe('上限内的正常导入仍按批报进度', () => {
  it('250 条分两批 → onBatch 恰好两次，读数 (1,2) 与 (2,2)', async () => {
    const base = uniqueName('进度')
    const text = packTextOf(scenario(base, Array.from({ length: MOCK_PACK_WRITE_BATCH + 50 },
      (_, i) => packRecord(i))))
    const batches: number[][] = []

    const result = await importMockPack(repo, text, { mode: 'new' }, {
      onBatch: (written, count) => { batches.push([written, count]) }
    })

    assert.deepEqual(batches, [[1, 2], [2, 2]], '每批一次、总数是本场景的批数')
    assert.deepEqual([result.aborted, result.partial], [false, false])
    assert.equal(result.created.length, MOCK_PACK_WRITE_BATCH + 50)
  })

  it('新建模式跨场景 → 每个场景各报各的批数，总数不累计', async () => {
    const base = uniqueName('进度-跨场景')
    const text = packTextOf(
      scenario(`${base}A`, Array.from({ length: MOCK_PACK_WRITE_BATCH + 10 }, (_, i) => packRecord(i))),
      scenario(`${base}B`, Array.from({ length: 5 }, (_, i) => packRecord(i + 500)))
    )
    const batches: number[][] = []

    await importMockPack(repo, text, { mode: 'new' }, {
      onBatch: (written, count) => { batches.push([written, count]) }
    })

    assert.deepEqual(batches, [[1, 2], [2, 2], [1, 1]],
      '分批只在仓库那一层，跨场景累计属渲染层口径（R4C-26/27 待裁决）')
  })
})
