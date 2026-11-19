import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MOCK_PACK_CODES, MOCK_VALIDATION_CODES } from '@shared/mock.errors'
import { MOCK_PACK_FORMAT, MOCK_PACK_VERSION, MockPackRecord, MockPackV1, validateMockPackRecords } from '@shared/mock.pack'
import { MOCK_MAX_BODY_BYTES, MOCK_MAX_VARIANTS } from '@shared/mock.validation'
import { makeMatch } from './fixtures'

// 阶段二（条目级）是纯函数，不需要 electron 替身：与 pack-validate.test.ts 的分工是
// 「那边钉整包拒绝，这边钉单条跳过」。服务侧把两阶段串起来的路径由那边的端点用例覆盖。

const OK_RESPONSE: MockPackRecord['response'] = {
  statusCode: 200, headers: {}, body: '{}', bodyType: 'json', delayMs: 0,
}

function goodRecord(i: number): MockPackRecord {
  return { id: `rec_${i}`, name: `记录 ${i}`, match: makeMatch({ path: `/v1/orders/${i}` }), response: OK_RESPONSE }
}

/** 每个入参是一个场景的记录数组，顺序即包内坐标 */
function packOf(...recordsByRule: MockPackRecord[][]): MockPackV1 {
  return {
    format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION,
    rules: recordsByRule.map((records, i) => ({ id: `rule_${i}`, name: `场景 ${i}`, records })),
  }
}

function codesOf(issues: Array<{ code: unknown }>) {
  return issues.map(it => String(it.code))
}

describe('R4C-11 条目级校验：单条不过只跳那一条', () => {
  it('整包都好：valid 保留原顺序与原坐标，且交出的还是包里那条记录', () => {
    const pack = packOf([goodRecord(0), goodRecord(1)], [goodRecord(2)])
    const check = validateMockPackRecords(pack)
    assert.equal(check.invalidCount, 0)
    assert.deepEqual(check.issues, [])
    assert.deepEqual(check.valid.map(it => [it.ruleIndex, it.recordIndex]), [[0, 0], [0, 1], [1, 0]])
    // 不做归一化（那是 R4C-12）：写库与冲突明细都还要回指包内对象，换成副本就对不上了
    assert.equal(check.valid[0].record, pack.rules[0].records[0])
  })

  it('一条记录多项问题只算「跳过 1 条」，issues 记的是明细条数', () => {
    // 无 match + 状态码越界 + bodyType 不认识：三个问题、一条记录
    const broken = { id: 'rec_bad', name: '坏记录', response: { statusCode: 99, body: 'x', bodyType: 'yaml' } } as unknown as MockPackRecord
    const check = validateMockPackRecords(packOf([goodRecord(0), broken]))
    assert.equal(check.invalidCount, 1, '一条记录有几项问题都只该算一条被跳过的记录')
    assert.ok(check.issues.length >= 2, `明细应当多于条数，实际 ${check.issues.length}`)
    assert.deepEqual(check.issues.map(it => it.recordIndex), [1, 1, 1])
    assert.deepEqual(codesOf(check.issues).sort(), ['bodyType', 'matchMissing', 'statusRange'])
    assert.deepEqual(check.valid.map(it => it.recordIndex), [0], '坏条目不影响同场景其余记录')
  })

  it('明细带包内坐标，field 保持记录内相对路径', () => {
    const eavesdropped = { ...goodRecord(5), match: { ...makeMatch(), body: { mode: 'json' } } } as MockPackRecord
    const check = validateMockPackRecords(packOf([goodRecord(4)], [goodRecord(9), eavesdropped]))
    assert.equal(check.invalidCount, 1)
    const issue = check.issues[0]
    assert.equal(issue.code, 'bodyModeUnsupported')
    // 定位由 ruleIndex/recordIndex/recordId 三个字段承担；拼成 rules[1].records[1].match... 只会把明细行挤出横向滚动
    assert.equal(issue.field, 'match.body.mode')
    assert.equal(issue.ruleIndex, 1)
    assert.equal(issue.recordIndex, 1)
    assert.equal(issue.recordId, 'rec_5')
  })

  it('包内记录必须有 match：手加的 url 不算数', () => {
    // url 不是包字段（派生值，落包就能伪造指纹）。validateMockRecord 本身认「无 match 但有 url」那条路,
    // 但派生 match 只在 MockService.saveMockRecord 做、仓库层不做——放过它就等于 RK1「导入成功、一条不命中、全程不报错」。
    const urlOnly = { id: 'rec_u', name: '只带 url', url: 'https://api.demo/v1/orders', response: OK_RESPONSE } as unknown as MockPackRecord
    const check = validateMockPackRecords(packOf([urlOnly]))
    assert.equal(check.invalidCount, 1)
    assert.ok(codesOf(check.issues).includes('matchMissing'), `实际明细 ${JSON.stringify(check.issues)}`)
  })

  it('null / 字符串这样的记录不炸整包，按坏条目跳过', () => {
    const pack = packOf([goodRecord(0), null as unknown as MockPackRecord, 'hello' as unknown as MockPackRecord])
    const check = validateMockPackRecords(pack)
    assert.equal(check.invalidCount, 2)
    assert.deepEqual(check.valid.map(it => it.recordIndex), [0])
    // 字符串记录不许借 String.prototype.match 冒充一条规则：两者报的都是「这条不是记录」
    assert.deepEqual(check.issues.map(it => it.recordIndex), [1, 1, 2, 2])
    assert.deepEqual(codesOf(check.issues), ['matchMissing', 'bodyType', 'matchMissing', 'bodyType'])
  })

  it('响应体超上限只跳那一条', () => {
    const huge = { ...goodRecord(1), response: { ...OK_RESPONSE, body: 'x'.repeat(MOCK_MAX_BODY_BYTES + 1) } }
    const check = validateMockPackRecords(packOf([goodRecord(0), huge]))
    assert.deepEqual(codesOf(check.issues), ['bodyTooLarge'])
    assert.equal(check.issues[0].field, 'response.body')
    assert.deepEqual(check.valid.map(it => it.recordIndex), [0])
  })

  it('变体超上限只报条数，不逐个变体刷屏', () => {
    const variants = Array.from({ length: MOCK_MAX_VARIANTS + 1 }, (_unused, i) => ({
      id: `var_${i}`, name: `变体 ${i}`, ...OK_RESPONSE,
    })) as unknown as MockPackRecord['variants']
    const many = { ...goodRecord(2), variants, activeVariantId: 'var_0' }
    const check = validateMockPackRecords(packOf([many]))
    assert.deepEqual(codesOf(check.issues), ['variantLimit'], '变体内容都合法，只该多出这一条')
    assert.equal(check.issues[0].field, 'variants')
  })

  it('未归一化的 match 走既有严格判定：缺 query 就是 queryOperatorInvalid', () => {
    // 本程序导出的包永远带完整 match（库内记录读出来就归一化过），所以往返不受影响。
    // 手写/外部生成的包只给 method+path 时会被整条跳过——补默认值是 R4C-12 的活，而它排在阶段二之后。
    // 这条断言钉住当前的严格口径，顺序要不要换属待裁决（见技术设计 D8 的落地状态）。
    const handWritten = { id: 'rec_h', name: '手写', match: { method: 'GET', path: '/v1/orders' }, response: OK_RESPONSE } as unknown as MockPackRecord
    const check = validateMockPackRecords(packOf([handWritten]))
    assert.deepEqual(codesOf(check.issues).sort(), ['pathTypeInvalid', 'queryOperatorInvalid'])
    assert.deepEqual(check.issues.map(it => it.field), ['match.pathType', 'match.query'])
  })

  it('条目级明细一律用既有校验码，不新造一族包专用码', () => {
    const validationCodes = new Set<string>(MOCK_VALIDATION_CODES)
    const packCodes = new Set<string>(MOCK_PACK_CODES)
    const check = validateMockPackRecords(packOf([
      { id: 'a', name: 'A', response: { statusCode: 99, body: 'x'.repeat(MOCK_MAX_BODY_BYTES + 1), bodyType: 'yaml', delayMs: 999999 } } as unknown as MockPackRecord,
      { ...goodRecord(1), variants: Array.from({ length: MOCK_MAX_VARIANTS + 1 }, (_u, i) => ({ id: `v${i}`, ...OK_RESPONSE })) } as MockPackRecord,
      { ...goodRecord(2), activeVariantId: 'not_exist' },
    ]))
    assert.ok(check.issues.length >= 6, `这份包该造出多条明细，实际 ${check.issues.length}`)
    for (const issue of check.issues) {
      const code = String(issue.code)
      assert.equal(validationCodes.has(code), true, `${code} 不在 MOCK_VALIDATION_CODES 里：条目级复用保存路径的判定，码就得是那一族的`)
      assert.equal(packCodes.has(code), false, `${code} 属包级码族，不该出现在条目级明细里`)
    }
    assert.equal(check.invalidCount, 3)
  })
})
