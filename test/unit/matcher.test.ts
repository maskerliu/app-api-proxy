import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ProxyMock } from '@shared/proxy.models'
import type { MockMatchRule } from '@shared/mock.models'
import {
  checkRecord, compileRecord, diagnoseMiss, explainMatch, findBestMatch, isSensitiveKey,
  maskValue, matchRecords, normalizeRequest, pathSpecificity,
} from '@main/service/mock.matcher'
import type { CompiledMatchRecord, NormalizedRequest } from '@main/service/mock.matcher'
import { detectMatchWarnings } from '@main/service/mock.conflict'
import { condition, headerCondition, makeMatch, makeRecord } from './fixtures'

function request(method: string, url: string, headers?: Record<string, string | string[]>): NormalizedRequest {
  return normalizeRequest({ method, url, headers })
}

function compiled(match: MockMatchRule): CompiledMatchRecord {
  return compileRecord(makeRecord({ match }))
}

function hit(match: MockMatchRule, method: string, url: string,
  headers?: Record<string, string | string[]>): boolean {
  return checkRecord(compiled(match), request(method, url, headers)).passed
}

function matchedRecord(records: ProxyMock.MockRecord[], method: string, url: string,
  headers?: Record<string, string | string[]>) {
  return matchRecords(records, request(method, url, headers))
}

describe('Path 匹配', () => {
  it('AC-R1-04 · exact 命中完全相等的 Path', () => {
    assert.equal(hit(makeMatch({ path: '/v1/users' }), 'GET', '/v1/users'), true)
  })

  it('AC-R1-04 · exact 默认忽略尾斜杠', () => {
    assert.equal(hit(makeMatch({ path: '/v1/users' }), 'GET', '/v1/users/'), true)
  })

  it('AC-R1-04 · 关闭忽略尾斜杠后差异生效', () => {
    const match = makeMatch({ path: '/v1/users', ignoreTrailingSlash: false })
    assert.equal(hit(match, 'GET', '/v1/users/'), false)
  })

  it('AC-R1-04 · pathIgnoreCase 生效', () => {
    const match = makeMatch({ path: '/v1/Users', pathIgnoreCase: true })
    assert.equal(hit(match, 'GET', '/v1/users'), true)
  })

  it('AC-R1-04 · prefix 命中子路径', () => {
    const match = makeMatch({ path: '/v1/users', pathType: 'prefix' })
    assert.equal(hit(match, 'GET', '/v1/users/10086/orders'), true)
  })

  it('AC-R1-04 · glob 通配 ID 段（录制参数化产物）', () => {
    const match = makeMatch({ path: '/v1/users/*', pathType: 'glob' })
    assert.equal(hit(match, 'GET', '/v1/users/10086'), true)
  })

  it('AC-R1-15 · glob 的 ? 只匹配单个非斜杠字符', () => {
    const match = makeMatch({ path: '/v1/users/?', pathType: 'glob' })
    assert.equal(hit(match, 'GET', '/v1/users/a'), true)
    assert.equal(hit(match, 'GET', '/v1/users/ab'), false)
  })

  it('AC-R1-04 · regex 命中数字段', () => {
    const match = makeMatch({ path: '/v1/users/\\d+', pathType: 'regex' })
    assert.equal(hit(match, 'GET', '/v1/users/10086'), true)
    assert.equal(hit(match, 'GET', '/v1/users/abc'), false)
  })

  it('AC-R1-06 · 非法正则不抛错且视为不命中', () => {
    const match = makeMatch({ path: '([', pathType: 'regex' })
    assert.equal(hit(match, 'GET', '/v1/users'), false)
  })

  it('AC-R1-08 · regex 只作用于前 2,048 字符', () => {
    const match = makeMatch({ path: 'a{3000}$', pathType: 'regex' })
    assert.equal(hit(match, 'GET', `/${'a'.repeat(3000)}`), false)
  })
})

describe('Query / Header 匹配', () => {
  it('AC-R1-01 · equals 条件命中', () => {
    const match = makeMatch({ conditions: [condition('role', 'admin')] })
    assert.equal(hit(match, 'GET', '/v1/users?role=admin'), true)
    assert.equal(hit(match, 'GET', '/v1/users?role=user'), false)
  })

  it('AC-R1-01 · 忽略键的值变化不影响命中', () => {
    const match = makeMatch({ ignoreKeys: ['ts', 'sign'] })
    assert.equal(hit(match, 'GET', '/v1/users?ts=1&sign=abc&other=1'), true)
    assert.equal(hit(match, 'GET', '/v1/users?ts=999&sign=zzz'), true)
  })

  it('AC-R1-14 · equals 空串要求键带等号', () => {
    const match = makeMatch({ conditions: [condition('flag', '')] })
    assert.equal(hit(match, 'GET', '/v1/users?flag='), true)
    assert.equal(hit(match, 'GET', '/v1/users?flag'), false)
  })

  it('AC-R1-13 · allowExtra=false 拒绝额外参数', () => {
    const strict = makeMatch({ conditions: [condition('role', 'admin')], allowExtra: false })
    assert.equal(hit(strict, 'GET', '/v1/users?role=admin'), true)
    assert.equal(hit(strict, 'GET', '/v1/users?role=admin&x=1'), false)
  })

  it('AC-R1-13 · allowExtra=true 允许额外参数', () => {
    const standard = makeMatch({ conditions: [condition('role', 'admin')], allowExtra: true })
    assert.equal(hit(standard, 'GET', '/v1/users?role=admin&x=1'), true)
  })

  it('AC-R1-14 · multiValue=any 允许重复键之一匹配', () => {
    const match = makeMatch({ conditions: [condition('id', '1')], multiValue: 'any' })
    assert.equal(hit(match, 'GET', '/v1/users?id=1&id=2'), true)
  })

  it('AC-R1-14 · multiValue=all 要求重复键全部匹配', () => {
    const match = makeMatch({ conditions: [condition('id', '1')], multiValue: 'all' })
    assert.equal(hit(match, 'GET', '/v1/users?id=1&id=2'), false)
    assert.equal(hit(match, 'GET', '/v1/users?id=1&id=1'), true)
  })

  it('AC-R1-01 · regex 操作符命中', () => {
    const match = makeMatch({ conditions: [condition('id', '\\d+', 'regex')] })
    assert.equal(hit(match, 'GET', '/v1/users?id=10086'), true)
    assert.equal(hit(match, 'GET', '/v1/users?id=abc'), false)
  })

  it('AC-R1-01 · exists 与 notExists 操作符', () => {
    const exists = makeMatch({ conditions: [condition('trace', '', 'exists')] })
    assert.equal(hit(exists, 'GET', '/v1/users?trace='), true)
    assert.equal(hit(exists, 'GET', '/v1/users'), false)

    const notExists = makeMatch({ conditions: [condition('trace', '', 'notExists')] })
    assert.equal(hit(notExists, 'GET', '/v1/users'), true)
    assert.equal(hit(notExists, 'GET', '/v1/users?trace=1'), false)
  })

  it('AC-R1-01 · ignoreCase 只影响值比较', () => {
    const match = makeMatch({ conditions: [condition('role', 'Admin', 'equals', true)] })
    assert.equal(hit(match, 'GET', '/v1/users?role=admin'), true)
    assert.equal(hit(match, 'GET', '/v1/users?role=ADMIN'), true)
  })

  it('AC-R1-13 · Query 模式为 ignore 时不校验参数', () => {
    const match = makeMatch({ queryMode: 'ignore' })
    assert.equal(hit(match, 'GET', '/v1/users?a=1&b=2'), true)
  })

  it('AC-R1-01 · Header 条件命中且名称大小写不敏感', () => {
    const match = makeMatch({ headerConditions: [headerCondition('X-Client', 'mobile')] })
    assert.equal(hit(match, 'GET', '/v1/users', { 'x-client': 'mobile' }), true)
    assert.equal(hit(match, 'GET', '/v1/users', { 'x-client': 'web' }), false)
  })

  it('AC-R1-01 · Header 多值中任一命中', () => {
    const match = makeMatch({ headerConditions: [headerCondition('accept', 'json')] })
    assert.equal(hit(match, 'GET', '/v1/users', { accept: ['html', 'json'] }), true)
  })

  it('AC-R1-01 · Header exists / notExists', () => {
    const exists = makeMatch({ headerConditions: [headerCondition('authorization', '', 'exists')] })
    assert.equal(hit(exists, 'GET', '/v1/users', { authorization: 'Bearer x' }), true)
    assert.equal(hit(exists, 'GET', '/v1/users'), false)
  })

  it('AC-R1-01 · Query 与 Header 条件需同时满足', () => {
    const match = makeMatch({
      conditions: [condition('role', 'admin')],
      headerConditions: [headerCondition('x-client', 'mobile')],
    })
    assert.equal(hit(match, 'GET', '/v1/users?role=admin', { 'x-client': 'mobile' }), true)
    assert.equal(hit(match, 'GET', '/v1/users?role=admin', { 'x-client': 'web' }), false)
  })
})

describe('排序与冲突', () => {
  it('AC-R1-02 · 同 Path 多方法各自命中', () => {
    const getRecord = makeRecord({ id: 'rec_get', match: makeMatch({ method: 'GET', path: '/v1/users' }) })
    const postRecord = makeRecord({ id: 'rec_post', match: makeMatch({ method: 'POST', path: '/v1/users' }) })
    const records = [getRecord, postRecord]

    assert.equal(matchedRecord(records, 'GET', '/v1/users').recordId, 'rec_get')
    assert.equal(matchedRecord(records, 'POST', '/v1/users').recordId, 'rec_post')
  })

  it('AC-R1-02 · ANY 方法可兜底，精确方法优先', () => {
    const anyMatch = makeRecord({
      id: 'rec_any', match: makeMatch({ method: 'ANY', path: '/v1/users' }),
    })
    const getMatch = makeRecord({
      id: 'rec_get', match: makeMatch({ method: 'GET', path: '/v1/users' }),
    })
    assert.equal(matchedRecord([anyMatch, getMatch], 'GET', '/v1/users').recordId, 'rec_get')
    assert.equal(matchedRecord([anyMatch, getMatch], 'DELETE', '/v1/users').recordId, 'rec_any')
  })

  it('AC-R1-05 · 手动优先级高于自动排序', () => {
    const manual = makeRecord({
      id: 'rec_manual', match: makeMatch({ path: '/v1/users', priority: 10 }),
    })
    const auto = makeRecord({
      id: 'rec_auto', match: makeMatch({ path: '/v1/users', priority: null }),
    })
    const result = matchedRecord([auto, manual], 'GET', '/v1/users?x=1')
    assert.equal(result.recordId, 'rec_manual')
    assert.equal(result.ordering, 'manual-priority')
  })

  it('AC-R1-10 · Path 更具体者优先于更宽泛者', () => {
    const globRecord = makeRecord({
      id: 'rec_glob', match: makeMatch({ path: '/v1/users/*', pathType: 'glob' }),
    })
    const exactRecord = makeRecord({
      id: 'rec_exact', match: makeMatch({ path: '/v1/users/10086' }),
    })
    const result = matchedRecord([globRecord, exactRecord], 'GET', '/v1/users/10086')
    assert.equal(result.recordId, 'rec_exact')
    assert.equal(result.ordering, 'path-specificity')
  })

  it('AC-R1-10 · 同等 Path 时条件更多者优先', () => {
    const plain = makeRecord({
      id: 'rec_plain', match: makeMatch({ path: '/v1/users/*', pathType: 'glob' }),
    })
    const conditional = makeRecord({
      id: 'rec_conditional',
      match: makeMatch({ path: '/v1/users/*', pathType: 'glob', conditions: [condition('role', 'admin')] }),
    })
    const result = matchedRecord([plain, conditional], 'GET', '/v1/users/10086?role=admin')
    assert.equal(result.recordId, 'rec_conditional')
    assert.equal(result.ordering, 'condition-count')
  })

  it('AC-R1-10 · 条件完全并列时最近更新优先', () => {
    const older = makeRecord({
      id: 'rec_a', updatedAt: 100, match: makeMatch({ path: '/v1/users' }),
    })
    const newer = makeRecord({
      id: 'rec_b', updatedAt: 200, match: makeMatch({ path: '/v1/users' }),
    })
    const result = matchedRecord([older, newer], 'GET', '/v1/users')
    assert.equal(result.recordId, 'rec_b')
    assert.equal(result.ordering, 'updated-at')
  })

  it('AC-R1-10 · 更新时间和条件都并列时按记录 ID 稳定兜底', () => {
    const left = makeRecord({ id: 'rec_a', updatedAt: 100, match: makeMatch({ path: '/v1/users' }) })
    const right = makeRecord({ id: 'rec_b', updatedAt: 100, match: makeMatch({ path: '/v1/users' }) })
    assert.equal(matchedRecord([right, left], 'GET', '/v1/users').recordId, 'rec_a')
    assert.equal(matchedRecord([left, right], 'GET', '/v1/users').recordId, 'rec_a')
  })

  it('AC-R1-17 · Path 类型的具体度顺序固定', () => {
    assert.deepEqual(
      ['exact', 'prefix', 'glob', 'regex'].map(it => pathSpecificity(it as MockMatchRule['pathType'])),
      [4, 3, 2, 1])
  })

  it('AC-R1-19 · 同指纹记录标记重复并保留最新', () => {
    const older = makeRecord({ id: 'rec_a', updatedAt: 100, match: makeMatch({ path: '/v1/users' }) })
    const newer = makeRecord({ id: 'rec_b', updatedAt: 200, match: makeMatch({ path: '/v1/users' }) })
    const warnings = detectMatchWarnings([older, newer])
    assert.deepEqual(warnings, [{ recordId: 'rec_a', type: 'duplicate', coveredBy: 'rec_b' }])
  })

  it('AC-R1-17 · 高优先级同指纹标记为不可达', () => {
    const high = makeRecord({
      id: 'rec_high', updatedAt: 100, match: makeMatch({ path: '/v1/users', priority: 10 }),
    })
    const low = makeRecord({
      id: 'rec_low', updatedAt: 200, match: makeMatch({ path: '/v1/users', priority: null }),
    })
    const warnings = detectMatchWarnings([low, high])
    assert.deepEqual(warnings, [{ recordId: 'rec_low', type: 'unreachable', coveredBy: 'rec_high' }])
  })

  it('AC-R1-17 · 宽规则覆盖窄规则时提示可能永远不会命中', () => {
    const broad = makeRecord({
      id: 'rec_broad', match: makeMatch({ path: '/v1', pathType: 'prefix' }),
    })
    const narrow = makeRecord({
      id: 'rec_narrow',
      match: makeMatch({ path: '/v1/users', conditions: [condition('role', 'admin')] }),
    })
    const warnings = detectMatchWarnings([broad, narrow])
    assert.deepEqual(warnings, [{ recordId: 'rec_narrow', type: 'shadowed', coveredBy: 'rec_broad' }])
  })

  it('AC-R1-19 · 缺少匹配条件的记录标记 invalid', () => {
    const invalid = makeRecord({ id: 'rec_invalid' })
    invalid.matchInvalid = 'urlInvalid'
    assert.equal(detectMatchWarnings([invalid])[0].type, 'invalid')
    assert.equal(detectMatchWarnings([makeRecord({ id: 'rec_none' })])[0].message, 'matchMissing')
  })

  it('AC-R1-02 · 停用的规则不参与匹配与冲突扫描', () => {
    const disabled = makeRecord({ id: 'rec_disabled', match: makeMatch({ enabled: false }) })
    assert.equal(compileRecord(disabled), null)
    assert.deepEqual(detectMatchWarnings([disabled]), [])
    assert.equal(matchedRecord([disabled], 'GET', '/v1/users').matched, false)
  })
})

describe('命中解释', () => {
  it('AC-R1-16 · 输出各维度、条件与实际值', () => {
    const match = makeMatch({
      conditions: [condition('role', 'admin'), condition('page', '1')],
      headerConditions: [headerCondition('x-client', 'mobile')],
    })
    const compiledRecord = compiled(match)
    const req = request('GET', '/v1/users?role=admin&page=2', { 'x-client': 'mobile' })
    const explain = explainMatch(compiledRecord, req, 'condition-count', 2)

    assert.equal(explain.recordId, compiledRecord.recordId)
    assert.equal(explain.ordering, 'condition-count')
    assert.equal(explain.elapsedMs, 2)
    const query = explain.conditions.filter(it => it.dimension === 'query')
    assert.equal(query.length, 2)
    assert.equal(query.find(it => it.key === 'role').passed, true)
    assert.equal(query.find(it => it.key === 'page').passed, false)
    assert.equal(query.find(it => it.key === 'page').actual, '2')
    assert.equal(explain.conditions.find(it => it.dimension === 'header').passed, true)
    assert.equal(explain.dimensions.find(it => it.dimension === 'query').totalCount, 2)
  })

  it('AC-R1-16 · 敏感键在解释中脱敏', () => {
    const match = makeMatch({ conditions: [condition('sign', 'abc')] })
    const explain = explainMatch(compiled(match), request('GET', '/v1/users?sign=abc'), 'record-id', 0)
    const signCondition = explain.conditions.find(it => it.key === 'sign')

    assert.equal(signCondition.expected, '***')
    assert.equal(signCondition.actual, '***')
    assert.equal(maskValue('sign', 'raw'), '***')
    assert.equal(maskValue('authorization', 'Bearer x'), '***')
    assert.equal(maskValue('page', '1'), '1')
    assert.equal(isSensitiveKey('access_token'), true)
    assert.equal(isSensitiveKey('x-page'), false)
  })

  it('AC-R1-16 · 忽略键带证据来源', () => {
    const match = makeMatch({ ignoreKeys: ['ts', 'sign'] })
    match.derivation = {
      source: 'recording', autoIgnoredKeys: ['sign', 'ts'], suggestions: [],
      pathParameterized: false, analyzedAt: 0,
    }
    const explain = explainMatch(compiled(match), request('GET', '/v1/users?ts=1&sign=x'), 'record-id', 0)
    assert.deepEqual(explain.ignoredKeys, [
      { key: 'ts', evidence: 'E1' },
      { key: 'sign', evidence: 'E2' },
    ])
  })

  it('AC-R1-16 · 条件超过 20 条时标记截断', () => {
    const conditions = Array.from({ length: 21 }, (_, index) => condition(`c${index}`, '1'))
    const match = makeMatch({ conditions })
    const search = conditions.map(it => `${it.key}=1`).join('&')
    const explain = explainMatch(compiled(match), request('GET', `/v1/users?${search}`), 'record-id', 0)
    assert.equal(explain.truncated, true)
    assert.equal(explain.conditions.length, 20)
  })

  it('AC-R1-01 / AC-R1-16 · 命中结果携带 mock 元数据所需字段', () => {
    const record = makeRecord({ id: 'rec_hit', match: makeMatch({ conditions: [condition('role', 'admin')] }) })
    const result = matchRecords([record], request('GET', '/v1/users?role=admin'), { explain: true })
    assert.equal(result.matched, true)
    assert.equal(result.recordId, 'rec_hit')
    assert.equal(result.ordering, 'record-id')
    assert.equal(result.explain.level, 'standard')
    assert.equal(result.miss, undefined)
  })
})

describe('未命中诊断', () => {
  it('AC-R1-06 · 相似 Path 给出失败维度、期望与实际', () => {
    const record = makeRecord({ id: 'rec_users', match: makeMatch({ path: '/v1/users' }) })
    const result = matchedRecord([record], 'GET', '/v1/users/10086')

    assert.equal(result.matched, false)
    assert.equal(result.miss.recordId, 'rec_users')
    assert.equal(result.miss.candidateCount, 1)
    assert.ok(result.miss.score > 0 && result.miss.score <= 1)
    const failure = result.miss.failures.find(it => it.dimension === 'path')
    assert.equal(failure.expected, 'exact /v1/users')
    assert.equal(failure.actual, '/v1/users/10086')
    assert.equal(failure.suggestion, 'edit-record')
    assert.equal(result.miss.suggestion, 'edit-record')
  })

  it('AC-R1-06 · Query 失败建议忽略该键', () => {
    const record = makeRecord({
      id: 'rec_role', match: makeMatch({ conditions: [condition('role', 'admin')] }),
    })
    const result = matchedRecord([record], 'GET', '/v1/users?role=user')
    const failure = result.miss.failures.find(it => it.dimension === 'query')

    assert.equal(failure.key, 'role')
    assert.equal(failure.detail, 'conditionMismatch')
    assert.equal(failure.suggestion, 'ignore-key')
    assert.equal(result.miss.suggestion, 'ignore-key')
  })

  it('AC-R1-06 · 敏感键在诊断中脱敏', () => {
    const record = makeRecord({
      id: 'rec_sign', match: makeMatch({ conditions: [condition('sign', 'abc')] }),
    })
    const failure = matchedRecord([record], 'GET', '/v1/users?sign=xyz').miss
      .failures.find(it => it.dimension === 'query')
    assert.equal(failure.expected, '***')
    assert.equal(failure.actual, '***')
  })

  it('AC-R1-13 · 严格档额外参数给出 extraKeys 明细', () => {
    const record = makeRecord({
      id: 'rec_strict',
      match: makeMatch({ conditions: [condition('role', 'admin')], allowExtra: false }),
    })
    const failure = matchedRecord([record], 'GET', '/v1/users?role=admin&extra=1').miss
      .failures.find(it => it.dimension === 'query')
    assert.equal(failure.detail, 'extraKeys')
    assert.equal(failure.actual, 'extra')
    assert.equal(failure.suggestion, 'loosen')
  })

  it('AC-R1-06 · 相似度过低时不返回诊断', () => {
    const record = makeRecord({ id: 'rec_orders', match: makeMatch({ path: '/v1/orders' }) })
    assert.equal(diagnoseMiss([compiled(record.match)], request('GET', '/v2/different/path')), null)
  })

  it('AC-R1-06 · 空规则集不产生诊断', () => {
    assert.equal(diagnoseMiss([], request('GET', '/v1/users')), null)
  })
})

describe('findBestMatch', () => {
  it('AC-R1-10 · 直接返回排序依据与最优候选', () => {
    const plain = compileRecord(makeRecord({ id: 'rec_a', match: makeMatch({ path: '/v1/users/*', pathType: 'glob' }) }))
    const exact = compileRecord(makeRecord({ id: 'rec_b', match: makeMatch({ path: '/v1/users/1' }) }))
    const best = findBestMatch([plain, exact], request('GET', '/v1/users/1'))
    assert.equal(best.compiled.recordId, 'rec_b')
    assert.equal(best.ordering, 'path-specificity')
  })
})