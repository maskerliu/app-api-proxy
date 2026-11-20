import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MOCK_PACK_CODES, MOCK_VALIDATION_CODES } from '@shared/mock.errors'
import { MOCK_PACK_FORMAT, MOCK_PACK_VERSION, MockPackRecord, MockPackV1, prepareMockPackRecord, validateMockPackRecords } from '@shared/mock.pack'
import { MOCK_MAX_BODY_BYTES, MOCK_MAX_VARIANTS, canonicalMatch, normalizeMatchRule, normalizeMockRecord } from '@shared/mock.validation'
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

describe('R4C-12 归一化：把包里的记录变成库里那种形状', () => {
  const locate = (record: MockPackRecord, ruleIndex = 0, recordIndex = 0) => ({ ruleIndex, recordIndex, record })

  it('match 归一化到库内形状，且不污染包里那条', () => {
    const packed = goodRecord(1)
    const prepared = prepareMockPackRecord(locate(packed)).record
    // 与保存路径同源：同一条记录交给 normalizeMockRecord 会得到同一个形状
    const reference = normalizeMatchRule(packed.match)
    for (const field of ['level', 'pathType', 'path', 'method', 'host', 'query', 'headers', 'body', 'priority'] as const) {
      assert.deepEqual(prepared.match[field], reference[field], `${field} 应与保存路径的归一化结果一致`)
    }
    assert.equal(prepared.match.enabled, false)
    assert.equal(prepared.url, '', '库内形状有 url 这个键（包契约里没有），R4C-15 写库时靠它兜底名称')
    // 阶段二交出的 `valid[].record` 是包对象本身（写库与冲突明细要回指坐标），归一化不许就地改它
    assert.equal(packed.match.enabled, true, '不许写回包对象')
    assert.equal(packed.match.derivation.source, 'manual', '导出那台机器的来源印记要留在包对象上')
  })

  it('pathOriginal 原样带进库内形状，但不进指纹', () => {
    // 参数化建议会把原始路径留在 pathOriginal 上（`mock.derive.ts:316`），手改的包可能带也可能不带。
    // 指纹是合并模式查重的那把钥匙（R4C-13）：它若看见这个字段，同一条规则会因「有没有这行注释」变成两条。
    const plain = prepareMockPackRecord(locate(goodRecord(1))).record
    const original = prepareMockPackRecord(locate({
      ...goodRecord(1),
      match: { ...makeMatch({ path: '/v1/orders/{id}' }), pathOriginal: '/v1/orders/12345' },
    } as unknown as MockPackRecord)).record
    assert.equal(plain.match.pathOriginal, undefined)
    assert.equal(original.match.pathOriginal, '/v1/orders/12345')
    assert.equal(canonicalMatch(original.match), canonicalMatch(makeMatch({ path: '/v1/orders/{id}' })),
      '同一把 path 带不带 pathOriginal 都要算出同一个规范串')
    assert.notEqual(canonicalMatch(plain.match), canonicalMatch(original.match), 'path 本身要进指纹')
  })

  it('归一化是幂等的：仓库层再规范化一次不会改变形状', () => {
    const once = prepareMockPackRecord(locate(goodRecord(7))).record
    assert.deepEqual(normalizeMockRecord(once), once)
  })

  it('一律置为未启用，来源改写成 import 但保留其余派生信息', () => {
    const packed = {
      ...goodRecord(2),
      match: {
        ...makeMatch(),
        derivation: { source: 'recording', autoIgnoredKeys: ['ts', 'ts'], suggestions: [{ key: 'uid', reason: '每次不同' }], pathParameterized: true, analyzedAt: 5 },
      },
    } as unknown as MockPackRecord
    const match = prepareMockPackRecord(locate(packed)).record.match
    assert.equal(match.enabled, false, '导入不许劫持真实请求（风险表 RK6）')
    assert.equal(match.derivation.source, 'import')
    assert.deepEqual(match.derivation.autoIgnoredKeys, ['ts'], '去重排序是既有规范化的活，不该被 import 印记抹掉')
    assert.equal(match.derivation.pathParameterized, true)
    assert.equal(match.derivation.analyzedAt, 5)
  })

  it('缺 id / 缺名称只报「回落」，ID 仍由仓库层分配', () => {
    const bare = { response: OK_RESPONSE, match: makeMatch() } as unknown as MockPackRecord
    const prepared = prepareMockPackRecord(locate(bare, 1, 3))
    assert.deepEqual(prepared.defaulted, ['id', 'name'])
    assert.equal(prepared.record.id, null, '在这里造 ID 就是第二条分配标准（`mock.repo.ts:410` 才是那一点）')
    assert.deepEqual([prepared.ruleIndex, prepared.recordIndex], [1, 3])
    assert.deepEqual(prepareMockPackRecord(locate(goodRecord(4))).defaulted, [])
  })

  it('变体、录制来源与时间戳原样带进库内形状', () => {
    const packed = {
      ...goodRecord(6),
      variants: [{ id: 'v1', name: '变体一', ...OK_RESPONSE }],
      activeVariantId: 'v1',
      source: { url: 'https://api.demo/v1/orders/6', method: 'GET' },
      createdAt: 111, updatedAt: 222,
    } as unknown as MockPackRecord
    const record = prepareMockPackRecord(locate(packed)).record
    assert.deepEqual(record.variants.map(it => it.id), ['v1'])
    assert.equal(record.activeVariantId, 'v1')
    assert.equal(record.source?.url, 'https://api.demo/v1/orders/6')
    assert.deepEqual([record.createdAt, record.updatedAt], [111, 222])
    assert.equal(record.url, '', 'url 不落包：导入侧保持空串，不拿 match 反推一个出来冒充录制地址')
  })

  it('时间戳只认能用的：写了却用不了要报回落，没写则不作声', () => {
    const bogus = prepareMockPackRecord(locate({ ...goodRecord(8), createdAt: 0, updatedAt: '昨天' } as unknown as MockPackRecord))
    assert.deepEqual(bogus.defaulted, ['createdAt', 'updatedAt'], '「写了但用不了」和「没写」的修法不同，得报出来')
    assert.deepEqual([bogus.record.createdAt, bogus.record.updatedAt], [0, 0], '坏值不许留在排序键上：updatedAt 是列表与匹配的兜底排序键')

    const beyond = prepareMockPackRecord(locate({ ...goodRecord(9), updatedAt: 8.64e15 + 1 } as unknown as MockPackRecord))
    assert.deepEqual(beyond.defaulted, ['updatedAt'], '超出 Date 表示范围同样算不可用')

    const silent = prepareMockPackRecord(locate(goodRecord(10)))
    assert.deepEqual(silent.defaulted, [], '包里没写时间戳不是用户的错，写入时刻本来就是缺省')
    assert.deepEqual([silent.record.createdAt, silent.record.updatedAt], [0, 0])
  })
})
