import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { describe, it } from 'node:test'
import type { ProxyMock } from '@shared/proxy.models'
import type { MockPackRecord } from '@shared/mock.pack'
import {
  MOCK_PACK_FORMAT, MOCK_PACK_ISSUE_PAGE_LIMIT, MOCK_PACK_VERSION,
  pageMockPackIssues, suggestMockPackRuleName, toMockPackConflictStrategy,
} from '@shared/mock.pack'
import { makeMatch } from './fixtures'
import { MOCK_RECORD_REJECT_LIMIT, MOCK_RECORD_WARN_LIMIT, recordLimitState } from '@shared/mock.models'

// 与 pack-export.test.ts 同一套替身：service 经 repository/constants 引到 electron，
// 但预览本身不碰 electron（也不碰任何写原语），替身只要能被 import 就够
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>"",getVersion:()=>"0.0.0-test"}',
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { previewMockPack } = await import('@main/service/mock.pack.service')
const { fingerprintOf } = await import('@main/repository/mock.docs')
const { MockError } = await import('@shared/mock.errors')
type MockRecordSummary = import('@main/repository/mock.docs').MockRecordSummary

const OK_RESPONSE = { statusCode: 200, headers: {}, body: '{}', bodyType: 'json', delayMs: 0 }

/** 预览能碰的只有这几把读原语：断言调用序列时用它兜底，出现别的名字就是越界 */
const READ_PRIMITIVES = ['listRules', 'getRule', 'countRecords', 'iterateRecords', 'listRecordSummaries']

class FakeSource {
  rules: ProxyMock.MockRule[] = []
  summaries: MockRecordSummary[] = []
  /** 「库内已有条数」的替身：越档用例靠它把合计推到 5,000/10,000 之上，不必真造几万条记录 */
  recordCount = 0
  calls: string[] = []

  async listRules() {
    this.calls.push('listRules')
    return this.rules
  }

  async getRule(ruleId: string) {
    this.calls.push('getRule')
    return this.rules.find(it => it._id === ruleId) ?? null
  }

  async countRecords() {
    this.calls.push('countRecords')
    return this.recordCount
  }

  async iterateRecords() {
    this.calls.push('iterateRecords')
  }

  // 冲突索引要的是「库内那种形状」：`_id` + 指纹 + `match.enabled`，按场景过滤
  async listRecordSummaries(ruleId: string) {
    this.calls.push('listRecordSummaries')
    return this.summaries.filter(it => it.ruleId === ruleId)
  }

  assertReadsOnly(label: string) {
    for (const name of this.calls) {
      assert.equal(READ_PRIMITIVES.includes(name), true, `${label}：预览调用了 ${name}，「只读不落库」就此失效`)
    }
  }
}

/** 包文本：与 pack-validate.test.ts 同形状，包里没有 `url`，所以 match 必须齐 */
function packOf(rules: unknown[]) {
  return JSON.stringify({ format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION, exportedAt: 1, rules })
}

function packRecord(i: number, patch: Partial<MockPackRecord> = {}) {
  return {
    id: `rec_${i}`, name: `记录 ${i}`,
    match: makeMatch({ path: `/v1/orders/${i}` }), response: OK_RESPONSE, ...patch
  }
}

function ruleOf(count: number, offset = 0, name = '订单中心', id = 'rule_1') {
  return { id, name, records: Array.from({ length: count }, (_unused, i) => packRecord(offset + i)) }
}

/** 库内摘要：指纹用同一把算法算出来，否则「查不出重复」这种错在测试里也看不见 */
function summaryOf(i: number, patch: Partial<MockRecordSummary> = {}): MockRecordSummary {
  const match = makeMatch({ path: `/v1/orders/${i}`, enabled: true })
  return {
    _id: `rec_${i}`, ruleId: 'rule_1', name: `库内 ${i}`, url: '',
    match, matchFingerprint: fingerprintOf(match), createdAt: 0, updatedAt: 0, ...patch
  } as unknown as MockRecordSummary
}

function ruleDoc(_id: string, name: string): ProxyMock.MockRule {
  return { _id, name, records: [] } as unknown as ProxyMock.MockRule
}

function mergeSource(summaries: MockRecordSummary[], names = ['订单中心']) {
  const source = new FakeSource()
  source.rules = names.map((name, i) => ruleDoc(i === 0 ? 'rule_1' : `rule_${i + 1}`, name))
  source.summaries = summaries
  return source
}

async function expectCode(code: string, run: () => Promise<unknown>, label: string) {
  let thrown: unknown
  try {
    await run()
  } catch (err) {
    thrown = err
  }
  assert.ok(thrown instanceof MockError, `${label}：期望抛 MockError，实际 ${String(thrown)}`)
  assert.equal((thrown as MockError).code, code, `${label}：错误码不对`)
}

describe('明细分页：只回包内顺序的前 N 条，总数由调用方另报', () => {
  it('不超过上限时原样交出，不做多余拷贝', () => {
    const items = Array.from({ length: MOCK_PACK_ISSUE_PAGE_LIMIT }, (_unused, i) => i)
    assert.equal(pageMockPackIssues(items), items, '没超限还复制一份，等于白多一份 200 项数组')
    assert.deepEqual(pageMockPackIssues([]), [])
  })

  it('超过上限留前 N 条且保持包内顺序', () => {
    const items = Array.from({ length: MOCK_PACK_ISSUE_PAGE_LIMIT + 5 }, (_unused, i) => ({ recordIndex: i }))
    const page = pageMockPackIssues(items)
    assert.equal(page.length, MOCK_PACK_ISSUE_PAGE_LIMIT)
    assert.deepEqual([page[0].recordIndex, page[page.length - 1].recordIndex], [0, MOCK_PACK_ISSUE_PAGE_LIMIT - 1],
      '折的是尾部，不是「每个原因留一条」——明细要能回指文件里的那一行')
  })

  it('上限可由调用方收紧，默认值走 MOCK_PACK_ISSUE_PAGE_LIMIT', () => {
    assert.deepEqual(pageMockPackIssues([1, 2, 3], 2), [1, 2])
  })
})

describe('新建场景的建议名：只在单场景包上给', () => {
  it('不重名原样返回，重名顺延 (1)(2)', () => {
    assert.equal(suggestMockPackRuleName('订单中心', ['其它场景']), '订单中心')
    assert.equal(suggestMockPackRuleName('订单中心', ['订单中心']), '订单中心(1)')
    assert.equal(suggestMockPackRuleName('订单中心', ['订单中心', '订单中心(1)']), '订单中心(2)')
  })

  it('库内空名不参与判断；包内基名为空就回空串', () => {
    // 主进程拿不到文件名，「场景名取文件名」那条回落（PRD 4.4.5）只有渲染层说得清
    assert.equal(suggestMockPackRuleName('订单中心', [undefined, null]), '订单中心')
    assert.equal(suggestMockPackRuleName(undefined as unknown as string, ['订单中心']), '')
  })
})

describe('previewMockPack：新建模式只报包内事实', () => {
  it('统计口径分开：记录数含坏条目，变体数只数将写入的那批', async () => {
    const source = new FakeSource()
    source.rules = [ruleDoc('rule_2', '其它场景')]
    const result = await previewMockPack(source, packOf([{
      id: 'rule_1', name: '订单中心', records: [
        packRecord(0, { variants: [{ id: 'v1', name: '变体一', ...OK_RESPONSE }, { id: 'v2', name: '变体二', ...OK_RESPONSE }] }),
        { id: 'rec_bad', name: '坏记录', variants: [{ id: 'v9', name: '不算', ...OK_RESPONSE }] }
      ]
    }]), { mode: 'new' })

    assert.equal(result.kind, 'pack')
    assert.equal(result.packVersion, MOCK_PACK_VERSION)
    assert.equal(result.ruleCount, 1)
    assert.equal(result.recordCount, 2, '「包里有几条」按全量计，含会被跳过的那条')
    assert.equal(result.invalidCount, 1)
    assert.equal(result.variantCount, 2, '坏条目压根不进库，数它的变体会让两个数对不上')
    // 坏那条既没 match 也没 response：明细按「问题」计两条，被跳过的条数只算一条
    assert.deepEqual(result.issues.map(it => [it.code, it.recordIndex]), [['matchMissing', 1], ['bodyType', 1]])
    assert.equal(result.issueTotal, 2)
    assert.deepEqual(result.conflicts, [], '新建模式没有目标场景，不比冲突')
    assert.equal(result.conflictCount, 0)
    assert.deepEqual(result.notes, [], 'id/name 都齐，没有回落可报')
    assert.equal(result.noteTotal, 0)
    assert.equal(result.suggestedRuleName, '订单中心', '库内没有同名场景时建议名就是包里的名字')
    assert.deepEqual(source.calls, ['listRules'], '新建模式只需要场景名集')
    source.assertReadsOnly('新建')
  })

  it('回落说明走独立通道，不混进失败明细', async () => {
    const source = new FakeSource()
    const result = await previewMockPack(source, packOf([{
      id: 'rule_1', name: '订单中心',
      records: [{ match: makeMatch({ path: '/v1/orders/0' }), response: OK_RESPONSE }]
    }]), { mode: 'new' })

    assert.equal(result.invalidCount, 0, '缺 id/name 是「补了」不是「跳了」')
    assert.deepEqual(result.notes.map(it => [it.code, it.field, it.recordIndex]),
      [['packFieldDefaulted', 'id', 0], ['packFieldDefaulted', 'name', 0]])
    assert.equal(result.noteTotal, 2)
    assert.deepEqual(result.issues, [])
  })

  it('多场景包不替用户决定名字', async () => {
    const source = new FakeSource()
    source.rules = [ruleDoc('rule_1', '订单中心')]
    const result = await previewMockPack(source, packOf([ruleOf(1, 0, '订单中心'), ruleOf(1, 10, '库存中心')]), { mode: 'new' })
    assert.equal(result.ruleCount, 2)
    assert.equal(result.suggestedRuleName, undefined, '一个名字代表不了两个场景')
    assert.deepEqual(source.calls, [], '名字集都不必读库')
  })

  it('明细超过 200 条只回前 200，issueTotal 报包内真数', async () => {
    const source = new FakeSource()
    const total = MOCK_PACK_ISSUE_PAGE_LIMIT + 50
    const result = await previewMockPack(source, packOf([{
      id: 'rule_1', name: '订单中心',
      records: Array.from({ length: total }, (_unused, i) => ({ id: `rec_${i}`, name: `坏 ${i}`, response: OK_RESPONSE }))
    }]), { mode: 'new' })
    assert.equal(result.invalidCount, total)
    assert.equal(result.issueTotal, total)
    assert.equal(result.issues.length, MOCK_PACK_ISSUE_PAGE_LIMIT, '整包明细全回传会把响应体撑到几 MB')
  })
})

describe('previewMockPack：合并模式在目标场景内建冲突索引', () => {
  it('没给目标场景与目标不存在都是 ruleMissing', async () => {
    const source = mergeSource([])
    await expectCode('ruleMissing',
      () => previewMockPack(source, packOf([ruleOf(1)]), { mode: 'merge', targetRuleId: undefined }), '缺 targetRuleId')
    await expectCode('ruleMissing',
      () => previewMockPack(source, packOf([ruleOf(1)]), { mode: 'merge', targetRuleId: 'rule_none' }), '目标不存在')
    assert.deepEqual(source.calls, ['getRule'], '目标查不到就该立刻停，别再把整个场景读一遍')
  })

  it('_id 撞与指纹撞分开报，一条记录两种都撞就算两条', async () => {
    // 库内：rec_0 与包内第 0 条同 id 同指纹；rec_9 是另一条记录，但 match 与包内第 1 条相同
    const sameMatch = makeMatch({ path: '/v1/orders/1' })
    const source = mergeSource([
      summaryOf(0),
      { _id: 'rec_9', ruleId: 'rule_1', name: '同指纹的副本', match: sameMatch, matchFingerprint: fingerprintOf(sameMatch) } as unknown as MockRecordSummary
    ])
    const result = await previewMockPack(source, packOf([ruleOf(2)]), { mode: 'merge', targetRuleId: 'rule_1' })

    assert.deepEqual(result.conflicts.map(it => [it.kind, it.recordIndex, it.existingRecordId]),
      [['id', 0, 'rec_0'], ['fingerprint', 1, 'rec_9']])
    assert.equal(result.conflictCount, 2)
    assert.equal(result.invalidCount, 0)
  })

  it('幂等重放同一个包：id 与指纹指向同一条库内记录时只算一条', async () => {
    const source = mergeSource([summaryOf(0)])
    const result = await previewMockPack(source, packOf([ruleOf(1)]), { mode: 'merge', targetRuleId: 'rule_1' })
    assert.deepEqual(result.conflicts.map(it => it.kind), ['id'], '两个维度都指回同一条记录，报两条是把一次碰撞数成两次')
  })

  it('跨场景同指纹不算冲突：查重在库里就是规则级的', async () => {
    const source = mergeSource([summaryOf(0, { ruleId: 'rule_2' })])
    const result = await previewMockPack(source, packOf([ruleOf(1)]), { mode: 'merge', targetRuleId: 'rule_1' })
    assert.deepEqual(result.conflicts, [])
    assert.equal(result.conflictCount, 0)
  })

  it('existingEnabled 取库内那条记录的启用状态，覆盖风险提示靠它', async () => {
    const disabled = makeMatch({ path: '/v1/orders/0', enabled: false })
    const source = mergeSource([summaryOf(0, {
      match: disabled, matchFingerprint: fingerprintOf(disabled)
    })])
    const result = await previewMockPack(source, packOf([ruleOf(1)]), { mode: 'merge', targetRuleId: 'rule_1' })
    assert.equal(result.conflicts.length, 1)
    assert.equal(result.conflicts[0].existingEnabled, false, '被覆盖的是条没启用的规则，提示不该说「将影响生效规则」')
  })

  it('同指纹在库里出现两次（历史脏数据），冲突只报第一条', async () => {
    const source = mergeSource([summaryOf(0, { _id: 'rec_a' }), summaryOf(0, { _id: 'rec_b' })])
    const result = await previewMockPack(source, packOf([ruleOf(1)]), { mode: 'merge', targetRuleId: 'rule_1' })
    assert.deepEqual(result.conflicts.map(it => [it.kind, it.existingRecordId]), [['fingerprint', 'rec_a']],
      '预览要说的是「会撞上谁」，不是「被撞了几次」')
  })

  it('冲突超过 200 条只回前 200，conflictCount 报真数', async () => {
    const total = MOCK_PACK_ISSUE_PAGE_LIMIT + 1
    const source = mergeSource(Array.from({ length: total }, (_unused, i) => summaryOf(i)))
    const result = await previewMockPack(source, packOf([{
      id: 'rule_1', name: '订单中心', records: Array.from({ length: total }, (_unused, i) => packRecord(i))
    }]), { mode: 'merge', targetRuleId: 'rule_1' })
    assert.equal(result.conflictCount, total)
    assert.equal(result.conflicts.length, MOCK_PACK_ISSUE_PAGE_LIMIT)
    assert.deepEqual(source.calls, ['getRule', 'countRecords', 'listRecordSummaries'])
    source.assertReadsOnly('合并')
  })

  it('坏条目不进冲突索引：它压根不写库', async () => {
    const source = mergeSource([summaryOf(1)])
    const result = await previewMockPack(source, packOf([{
      id: 'rule_1', name: '订单中心',
      records: [{ id: 'rec_1', name: '坏记录', response: OK_RESPONSE }]
    }]), { mode: 'merge', targetRuleId: 'rule_1' })
    assert.equal(result.invalidCount, 1)
    assert.deepEqual(result.conflicts, [], '拿 matchMissing 的条目去比指纹等于比了个空 match')
  })
})

describe('previewMockPack：「库内已有 + 待写入」的合计档位（R4C-20）', () => {
  async function quotaOf(existing: number, records: number) {
    const source = mergeSource([])
    source.recordCount = existing
    const result = await previewMockPack(source, packOf([ruleOf(records)]),
      { mode: 'merge', targetRuleId: 'rule_1' })
    // 待写入数必须是「将导入 N 条」那个数本身，quota 不能变成第三套计数
    assert.equal(result.quota?.incomingRecordCount, result.recordCount - result.invalidCount)
    return result.quota
  }

  it('两个数分开摊给 UI，合计只是它们相加——不替用户算「还剩多少可写」', async () => {
    const quota = await quotaOf(7, 3)
    assert.deepEqual(quota, {
      existingRecordCount: 7, incomingRecordCount: 3, totalRecordCount: 10,
      warn: false, reject: false, suggestion: undefined
    })
  })

  it('档位边界是「大于」而不是「不小于」：合计正好 5,000 与 10,000 都不亮', async () => {
    // 判据比的是合计，所以这里让合计落在档位值上：已有 = 档位 − 1、待写入 = 1
    for (const [total, warn, reject] of [
      [MOCK_RECORD_WARN_LIMIT, false, false],
      [MOCK_RECORD_WARN_LIMIT + 1, true, false],
      [MOCK_RECORD_REJECT_LIMIT, true, false],
      [MOCK_RECORD_REJECT_LIMIT + 1, true, true],
    ] as Array<[number, boolean, boolean]>) {
      const quota = await quotaOf(total - 1, 1)
      assert.equal(quota.warn, warn, `合计 ${total}`)
      assert.equal(quota.reject, reject, `合计 ${total}`)
    }
    assert.equal((await quotaOf(MOCK_RECORD_WARN_LIMIT, 1)).suggestion, 'splitRecommended')
    assert.equal((await quotaOf(MOCK_RECORD_REJECT_LIMIT, 1)).suggestion, 'recordTooMany')
  })

  it('待写入数只数过了条目级校验的记录：坏条目压根不进库，数它就是把警告算给不存在的数据', async () => {
    const source = mergeSource([])
    source.recordCount = 2
    const result = await previewMockPack(source, packOf([{
      id: 'rule_1', name: '订单中心',
      records: [
        packRecord(0),
        { id: 'rec_bad', name: '坏记录', response: OK_RESPONSE },
        packRecord(1),
      ]
    }]), { mode: 'merge', targetRuleId: 'rule_1' })
    assert.equal(result.invalidCount, 1)
    assert.equal(result.quota?.incomingRecordCount, 2, '三条里有一条坏，待写入该是 2')
    assert.equal(result.quota?.totalRecordCount, 4)
  })

  it('与库内既有上限提示同判据：档位取自 recordLimitState，包侧不写第二把尺', async () => {
    // 故意取一个会亮黄灯的合计：两个都是 false 的比对证明不了「同源」
    const quota = await quotaOf(MOCK_RECORD_WARN_LIMIT - 2, 3)
    const state = recordLimitState(MOCK_RECORD_WARN_LIMIT + 1)
    assert.equal(state.warn, true, '这条用例的前提：合计已过建议档')
    assert.deepEqual([quota.warn, quota.reject, quota.suggestion], [state.warn, state.reject, state.suggestion])
  })

  it('新建模式不填 quota：每个新场景从 0 起，而包级闸门已把整包压在建议档之内', async () => {
    const source = mergeSource([])
    source.recordCount = 999999
    const result = await previewMockPack(source, packOf([ruleOf(3)]), { mode: 'new' })
    assert.equal(result.quota, undefined,
      '新建模式没有目标场景，那个 999999 属于谁都没定义，拿它吓用户不如不给')
    assert.equal(source.calls.includes('countRecords'), false, '既然不填，就不该为它多读一次库')
  })
})

describe('冲突策略的取值收敛（R4C-18）', () => {
  it('认不出来的取值落回默认档「跳过」', () => {
    assert.equal(toMockPackConflictStrategy('skip'), 'skip')
    assert.equal(toMockPackConflictStrategy('overwrite'), 'overwrite')
    assert.equal(toMockPackConflictStrategy('copy'), 'copy')
    // query 里过来的是字符串：大小写、多余空格都要认，否则用户选的档位会静默变成默认档
    assert.equal(toMockPackConflictStrategy(' OverWrite '), 'overwrite')
    for (const value of [undefined, null, '', 'overwite', 'SKIP ALL', 0, {}]) {
      assert.equal(toMockPackConflictStrategy(value), 'skip', `${String(value)} 该落回默认档`)
    }
  })
})
