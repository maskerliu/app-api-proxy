import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

// R4C-18：三策略的落点只能在真库上验。「覆盖到底改了哪条」「复制有没有造出一对同指纹」
// 都取决于 `MockRepo.importRecords` 里那把代码级查重（`findByFingerprint`），假仓库给不出这个形状（同 R4C-15 的理由）。

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mock-pack-import-service-'))
mkdirSync(path.join(DATA_DIR, 'biz_storage'), { recursive: true })
process.env.MOCK_MIGRATION_USER_DATA = DATA_DIR

// 服务模块会经 constants.ts 引用 electron，测试环境用最小 app 替身把 userData 指到临时目录
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
const { MockError } = await import('@shared/mock.errors')
const { MOCK_PACK_FORMAT, MOCK_PACK_VERSION } = await import('@shared/mock.pack')
const { makeMatch } = await import('../unit/fixtures')

const repo = new MockRepo() as any
await repo.init()

const ok = { statusCode: 200, headers: {}, body: '{"ok":true}', bodyType: 'json', delayMs: 0 }

/** 包里的记录形状（`MockPackRecord`）：字段与导出侧一致，多余的 `id` 由用例给 */
function packRecord(i: number, extra: any = {}) {
  return {
    id: null, name: `记录 ${i}`,
    match: makeMatch({ path: `/v1/orders/${i}`, enabled: false }),
    response: { ...ok, body: `{"i":${i}}` },
    variants: [], activeVariantId: null, ...extra
  }
}

function scenario(name: string, records: any[]) {
  return { id: `rule_pack_${name}`, name, desc: `${name} 的描述`, records }
}

function packTextOf(...rules: any[]) {
  return JSON.stringify({ format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION, rules })
}

/** 合并模式的用例都只需要一个场景，名字不重要（合并写进目标场景，不读包里的场景名） */
function mergePack(...records: any[]) {
  return packTextOf(scenario('任意', records))
}

/** 库内那条 → 包内那条：与导出做的事一样，用例据此造「重放同一个包」 */
function packOf(record: any, overrides: any = {}) {
  return {
    id: record.id, name: record.name, match: record.match, response: record.response,
    variants: record.variants ?? [], activeVariantId: record.activeVariantId ?? null,
    createdAt: record.createdAt, updatedAt: record.updatedAt, ...overrides
  }
}

async function newRule(name: string): Promise<string> {
  return repo.save({ name, desc: '' })
}

async function readAll(ruleId: string): Promise<any[]> {
  const items: any[] = []
  await repo.iterateRecords(ruleId, (record: any) => { items.push(record) })
  return items
}

/** 种子数据直接用仓库原语写：不让「新建模式」的实现替合并模式的用例背书 */
async function seed(ruleId: string, records: any[]) {
  // 带上 preserveTimestamps：用例里给的 `createdAt/updatedAt` 要真落进库，否则「覆盖取库内原值」那格没东西可比
  const outcome = await repo.importRecords(ruleId, records, { preserveTimestamps: true })
  return outcome.created
}

let seq = 0
/** 场景名进的是全库名字集，用例之间必须各用各的名字，否则 `(1)` 那格会跟着执行顺序漂 */
function uniqueName(prefix: string) {
  return `${prefix}-${++seq}`
}

async function merge(text: string, targetRuleId: string, conflict: string) {
  return importMockPack(repo, text, { mode: 'merge', targetRuleId, conflict } as any)
}

describe('新建模式（PRD 4.4.4 / 技术设计 D4）', () => {
  it('包里有几个场景就建几个新场景，记录 ID 一律重新生成', async () => {
    const base = uniqueName('新建')
    const text = packTextOf(
      scenario(`${base}A`, [packRecord(0, { id: 'rec_from_source' }), packRecord(1)]),
      scenario(`${base}B`, [packRecord(2)])
    )

    const result = await importMockPack(repo, text, { mode: 'new' })
    assert.equal(result.mode, 'new')
    assert.equal(result.ruleIds.length, 2, '两个场景就该有两个新场景')
    assert.deepEqual([result.created.length, result.updated.length], [3, 0])
    assert.deepEqual([result.skipped.length, result.failed.length, result.invalidTotal], [0, 0, 0])
    assert.equal(result.enabled, false, '导入不许自动启用（风险表 RK6）')
    assert.deepEqual([result.partial, result.aborted, result.nameCollided], [false, false, false])

    const rules = await repo.listRules()
    for (const ruleId of result.ruleIds) {
      const rule = rules.find(it => it._id === ruleId)
      assert.ok(rule, `新场景 ${ruleId} 该在列表里`)
      assert.ok(rule.name.startsWith(base), `场景名取自包里那条：${rule.name}`)
      assert.equal(rule.desc.endsWith('的描述'), true, '包里的场景描述要跟着建进来')
      for (const record of await readAll(ruleId)) {
        assert.notEqual(record.id, 'rec_from_source', '新建模式不沿用包内记录 ID')
        assert.equal(record.match.enabled, false)
      }
    }
  })

  it('场景名撞库内或撞本轮上一条 → 追加 (1)、(2) 并置 nameCollided（AC-R4-03）', async () => {
    const base = uniqueName('重名')
    await newRule(base)

    const result = await importMockPack(repo,
      packTextOf(scenario(base, [packRecord(0)]), scenario(base, [packRecord(1)])), { mode: 'new' })

    assert.equal(result.nameCollided, true)
    const rules = await repo.listRules()
    assert.deepEqual(result.ruleIds.map(id => rules.find(it => it._id === id).name),
      [`${base}(1)`, `${base}(2)`], '第二轮避让要看得到第一轮刚建出来的名字')
  })

  // 「场景名/记录名长度」这条边界在全工程都没有上限：编辑器那侧 van-field 没写 maxlength、
  // `validateMockRecord` 也不看名字。导入因此不许自己加一把尺——截断一旦出现在导入侧，
  // 症状就是「导进来的名字和编辑器里存的名字不是一条」，与包校验那条「不许开第二条标准」同形。
  it('超长场景名与超长记录名原样进库原样读回，导入侧不截断（AC-R4-03 的长度档）', async () => {
    const long = '長'.repeat(2000) + '-name'
    const text = packTextOf(scenario(long, [packRecord(0, { name: 'R'.repeat(5000) })]))

    const result = await importMockPack(repo, text, { mode: 'new' })
    assert.equal(result.created.length, 1)
    const rule = (await repo.listRules()).find(it => it._id === result.ruleIds[0])
    assert.equal(rule.name, long, `场景名被截了：${rule.name.length} 个字符`)
    const [record] = await readAll(result.ruleIds[0])
    assert.equal(record.name, 'R'.repeat(5000), '记录名同理：长度不是导入侧该管的事')

    // 撞名避让也按全长名算：截到文件名那把 40 字符尺会把两个不同的长名字当成同一个
    const again = await importMockPack(repo, text, { mode: 'new' })
    assert.equal(again.nameCollided, true, '同一个超长名再来一次就该避让')
    const second = (await repo.listRules()).find(it => it._id === again.ruleIds[0])
    assert.equal(second.name, `${long}(1)`, `避让要接在全长名后面，实际 ${second.name.slice(-12)}`)
  })

  // 空场景名（手改的包没写 `name`）用的是和别的名字同一条避让判据：`suggestMockPackRuleName`
  // 只把 null/undefined 剔出占位集，空串照样占位。于是同一份无名包连着导两次得到 `''` 和 `(1)`
  // ——后者是个只有计数器后缀的名字。这条钉的是当前口径，要不要给无名场景另开一档属待裁决。
  it('包里场景名是空串：第一份留空名，第二份按同一条判据顺延成 (1)', async () => {
    const before = (await repo.listRules()).length
    const text = packTextOf(scenario('', [packRecord(7)]))
    const nameOf = async (ruleId: string) => (await repo.listRules()).find(it => it._id === ruleId).name

    const first = await importMockPack(repo, text, { mode: 'new' })
    assert.equal(await nameOf(first.ruleIds[0]), '', '库里没有别的无名场景时空名原样落库')
    assert.equal(first.nameCollided, false)

    const second = await importMockPack(repo, text, { mode: 'new' })
    assert.equal(await nameOf(second.ruleIds[0]), '(1)', '空名也参与避让：它落的还是那个后缀')
    assert.equal(second.nameCollided, true, '改了名就要报「已追加序号」，否则用户看不出两条不是同一次导入')
    assert.deepEqual([first.created.length, second.created.length], [1, 1], '两次都写进去了')
    assert.equal((await repo.listRules()).length, before + 2)
    // 重放同一包时按记录指纹跳过，无名场景不会跟着越长越多
    const replay = await merge(text, first.ruleIds[0], 'skip')
    assert.deepEqual([replay.created.length, replay.skipped.length], [0, 1],
      '合并进那个无名场景时同指纹该跳过：空名不影响查重判据')
  })

  it('整个场景都是坏数据 → 不建空场景，坏条目进 invalid（PRD 4.4.7）', async () => {
    const base = uniqueName('半坏')
    const before = (await repo.listRules()).length
    const text = packTextOf(
      scenario(`${base}好`, [packRecord(0)]),
      scenario(`${base}坏`, [{ response: ok }, null])
    )

    const result = await importMockPack(repo, text, { mode: 'new' })
    assert.equal(result.ruleIds.length, 1, '一条都写不了的场景不该留壳')
    assert.equal(result.created.length, 1)
    assert.equal(result.invalidTotal, 2, '两条坏数据各算一条，但明细可以不止一项')
    assert.deepEqual(result.invalid.map(it => [it.code, it.ruleIndex]),
      [['matchMissing', 1], ['matchMissing', 1], ['bodyType', 1]],
      '明细要指得回那个场景：第一条缺 match，第二条连响应体都没有')
    assert.deepEqual((await repo.listRules()).length, before + 1)
  })

  it('包级闸门没过 → 抛错误码且一个场景都不建', async () => {
    const before = (await repo.listRules()).length
    await assert.rejects(() => importMockPack(repo, '{ oops', { mode: 'new' }),
      (err: any) => err instanceof MockError && err.code === 'packFormatUnknown')
    assert.deepEqual((await repo.listRules()).length, before, '拒绝即零写入')
  })
})

describe('合并·跳过（AC-R4-04：已存在的 recordId 不被修改）', () => {
  it('同 ID 同条件重放 → skipped，库里那条连 updatedAt 都没动', async () => {
    const ruleId = await newRule('跳过-重放')
    await seed(ruleId, [packRecord(0)])
    const [existing] = await readAll(ruleId)

    // 包里这条带着不同的响应体和更晚的时间戳：只要真写了库就一定看得见
    const replayed = { ...packOf(existing), response: { ...ok, body: '{"changed":true}' }, updatedAt: 9e12 }
    const result = await merge(mergePack(replayed), ruleId, 'skip')

    assert.deepEqual([result.created.length, result.updated.length], [0, 0])
    assert.equal(result.skipped.length, 1)
    assert.deepEqual([result.skipped[0].reason, result.skipped[0].recordId], ['packIdCollision', existing.id])
    assert.deepEqual(result.ruleIds, [ruleId], '合并模式的操作对象就是目标场景，即使一条没写')

    const [still] = await readAll(ruleId)
    assert.equal(still.response.body, existing.response.body, '内容没被盖掉')
    assert.equal(still.updatedAt, existing.updatedAt, '连写入时刻都没顶，这才叫没动过它')
  })

  it('同条件不同 ID → 报 matchDuplicate 跳过，条数不变', async () => {
    const ruleId = await newRule('跳过-同指纹')
    await seed(ruleId, [packRecord(0)])
    const [existing] = await readAll(ruleId)

    const result = await merge(mergePack(packRecord(0)), ruleId, 'skip')

    assert.equal(result.skipped.length, 1)
    assert.equal(result.skipped[0].reason, 'matchDuplicate')
    assert.equal(result.skipped[0].recordId, undefined, '包里这条本来就没带 ID')
    assert.equal(result.skipped[0].detail.includes(existing.id), true, '明细要说清撞的是库里哪条')
    assert.equal((await readAll(ruleId)).length, 1)
  })

  it('没冲突的条目照写，冲突的那条才跳', async () => {
    const ruleId = await newRule('跳过-混合')
    await seed(ruleId, [packRecord(0)])
    const [existing] = await readAll(ruleId)

    const result = await merge(mergePack(packOf(existing), packRecord(7)), ruleId, 'skip')

    assert.deepEqual([result.created.length, result.skipped.length], [1, 1])
    assert.equal(result.skipped[0].recordIndex, 0, '跳过明细要带包内坐标，否则指不回文件里那一行')
    assert.equal((await readAll(ruleId)).length, 2)
  })
})

describe('合并·覆盖', () => {
  it('同 ID 同条件 → 内容换掉，updatedAt 仍是库内原值（Q3）', async () => {
    const ruleId = await newRule('覆盖-重放')
    await seed(ruleId, [packRecord(0, { createdAt: 1000, updatedAt: 1000 })])
    const [existing] = await readAll(ruleId)
    assert.deepEqual([existing.createdAt, existing.updatedAt], [1000, 1000])

    const result = await merge(mergePack({ ...packOf(existing),
      response: { ...ok, body: '{"changed":true}' }, updatedAt: 9e12 }), ruleId, 'overwrite')

    assert.deepEqual([result.created.length, result.updated.length], [0, 1])
    assert.deepEqual(result.updated, [existing.id])
    const [after] = await readAll(ruleId)
    assert.equal(after.response.body, '{"changed":true}', '覆盖就是真的写进去')
    assert.deepEqual([after.createdAt, after.updatedAt], [1000, 1000],
      '覆盖分支取库内原值：包里的时间戳是源机的事，不能顶掉本机的「上次改动」')
  })

  it('同 ID 换条件 → 按 ID 覆盖那条，条数不变', async () => {
    const ruleId = await newRule('覆盖-同ID换条件')
    await seed(ruleId, [packRecord(0)])
    const [existing] = await readAll(ruleId)

    const result = await merge(mergePack(packOf(existing,
      { match: makeMatch({ path: '/v1/refunds/9', enabled: false }) })), ruleId, 'overwrite')

    assert.deepEqual([result.updated.length, result.skipped.length], [1, 0])
    const records = await readAll(ruleId)
    assert.equal(records.length, 1)
    assert.equal(records[0].match.path, '/v1/refunds/9')
  })

  it('ID 占住者与指纹占住者不是同一条 → 覆盖指纹那条，库里不留同指纹对', async () => {
    const ruleId = await newRule('覆盖-错位')
    await seed(ruleId, [packRecord(0), packRecord(1)])
    const [a, b] = await readAll(ruleId)

    // 包里这条挂着 A 的 ID、却是 B 的匹配条件：按 ID 覆盖会让库里出现两条同指纹
    const result = await merge(mergePack(packOf(a, { match: b.match })), ruleId, 'overwrite')

    assert.deepEqual(result.updated, [b.id], '落点是占住指纹的那条')
    const records = await readAll(ruleId)
    assert.equal(records.length, 2)
    const fingerprints = records.map(it => it.matchFingerprint)
    assert.equal(new Set(fingerprints).size, 2, '同指纹对会让这两条在编辑器里双双存不下')
    assert.equal(records.find(it => it.id === a.id).match.path, a.match.path, 'A 那条不该被动')
  })
})

describe('合并·复制为新记录', () => {
  it('同 ID 换条件 → 另发新 ID，库里两条并存', async () => {
    const ruleId = await newRule('复制-同ID换条件')
    await seed(ruleId, [packRecord(0)])
    const [existing] = await readAll(ruleId)

    const changed = packOf(existing, { match: makeMatch({ path: '/v1/refunds/9', enabled: false }) })
    const result = await merge(mergePack(changed), ruleId, 'copy')

    assert.deepEqual([result.created.length, result.updated.length], [1, 0])
    assert.notEqual(result.created[0], existing.id, '复制就是换新 ID，库里那条原样留着')
    assert.equal((await readAll(ruleId)).length, 2)
  })

  it('同条件 → 仓库那把唯一判据拒收，进 skipped 而不是造出存不下的副本', async () => {
    const ruleId = await newRule('复制-同指纹')
    await seed(ruleId, [packRecord(0)])
    const [existing] = await readAll(ruleId)

    const result = await merge(mergePack(packOf(existing)), ruleId, 'copy')

    assert.deepEqual([result.created.length, result.updated.length], [0, 0])
    assert.deepEqual([result.skipped.length, result.skipped[0].reason], [1, 'matchDuplicate'])
    const records = await readAll(ruleId)
    assert.equal(records.length, 1)
    // 这条断言才是「宁可跳过」的理由：库里没被塞进同指纹对，编辑器仍然存得动它
    await repo.saveRecord({ ...records[0], name: '改个名试试' })
    assert.equal((await readAll(ruleId))[0].name, '改个名试试')
  })
})

describe('未知策略与合并目标', () => {
  it('合并模式没有目标场景 → ruleMissing，且不写任何库', async () => {
    const before = (await repo.listRules()).length
    await assert.rejects(() => importMockPack(repo, mergePack(packRecord(0)),
      { mode: 'merge' } as any), (err: any) => err instanceof MockError && err.code === 'ruleMissing')
    assert.equal((await repo.listRules()).length, before)
  })

  it('目标场景不存在 → ruleMissing', async () => {
    await assert.rejects(() => merge(mergePack(packRecord(0)), 'rule_missing', 'skip'),
      (err: any) => err instanceof MockError && err.code === 'ruleMissing')
  })

  it('策略拼错按默认档跳过，不静默覆盖', async () => {
    const ruleId = await newRule('策略兜底')
    await seed(ruleId, [packRecord(0)])
    const [existing] = await readAll(ruleId)

    const result = await importMockPack(repo, mergePack(packOf(existing)),
      { mode: 'merge', targetRuleId: ruleId, conflict: 'overwite' } as any)

    assert.equal(result.skipped.length, 1, '认不出策略就当「跳过」：盖掉库内数据比漏跳几条难发现')
    assert.equal((await readAll(ruleId))[0].response.body, existing.response.body)
  })
})
