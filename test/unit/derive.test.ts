import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { matchRecords, normalizeRequest } from '@main/service/mock.matcher'
import { analyzeMatchStability, createMatchFromUrl, deriveMatch, restoreStrict } from '@main/service/mock.derive'
import { levelOf } from '@shared/mock.models'
import { normalizeMatchRule } from '@shared/mock.validation'
import { addQueryCondition, previewLevel, querySuggestionsOf, summaryOf } from '@renderer/pages/proxy/mock/match'
import { condition, legacyRecord, makeMatch, makeRecord } from './fixtures'

function keysOf(match): string[] {
  return (match?.query?.conditions ?? []).map(it => it.key)
}

function hits(match, method: string, url: string): boolean {
  const record = makeRecord({ match })
  return matchRecords([record], normalizeRequest({ method, url })).matched
}

describe('createMatchFromUrl', () => {
  it('AC-R1-12 · 录制 URL 带 Query 时生成标准档条件', () => {
    const match = createMatchFromUrl('/v1/users?role=admin&page=1', { method: 'post' })

    assert.equal(match.method, 'POST')
    assert.equal(match.path, '/v1/users')
    assert.equal(match.pathType, 'exact')
    assert.equal(match.level, 'standard')
    assert.equal(match.query.mode, 'match')
    assert.equal(match.query.allowExtra, true)
    assert.deepEqual(keysOf(match), ['role', 'page'])
    assert.deepEqual(match.query.conditions[0], {
      key: 'role', op: 'equals', value: 'admin', ignoreCase: false, source: 'recording',
    })
  })

  it('AC-R1-01 · 无 Query 的录制生成宽松档', () => {
    const match = createMatchFromUrl('/v1/users')
    assert.equal(match.level, 'loose')
    assert.equal(match.query.mode, 'ignore')
    assert.deepEqual(match.query.conditions, [])
  })

  it('AC-R1-03 · Host 可显式指定并归一化', () => {
    const match = createMatchFromUrl('/v1/users', { host: 'HTTPS://API.Example.com/x' })
    assert.equal(match.host, 'api.example.com')
  })

  it('AC-R1-09 · 空 URL 或无法解析的 URL 返回 null', () => {
    assert.equal(createMatchFromUrl(''), null)
    assert.equal(createMatchFromUrl('   '), null)
    assert.equal(createMatchFromUrl('http://[::1'), null)
  })

  it('AC-R1-14 · 重复键取首值并保持 any 语义', () => {
    const match = createMatchFromUrl('/v1/users?id=1&id=2')
    assert.equal(match.query.multiValue, 'any')
    assert.equal(match.query.conditions.length, 1)
    assert.equal(match.query.conditions[0].value, '1')
  })
})

describe('analyzeMatchStability · E1 ~ E5', () => {
  it('AC-R1-01 · E1 多次值不同的动态键自动忽略', () => {
    const results = analyzeMatchStability([
      legacyRecord('/v1/users?offset=1&role=admin'),
      legacyRecord('/v1/users?offset=2&role=admin'),
    ])

    assert.deepEqual(results[0].autoIgnoredKeys, ['offset'])
    assert.deepEqual(keysOf(results[0].match), ['role'])
    assert.deepEqual(results[1].autoIgnoredKeys, ['offset'])
  })

  it('AC-R1-01 · E2 高风险键即使只出现一次也自动忽略', () => {
    const [result] = analyzeMatchStability([legacyRecord('/v1/users?sign=abc&token=xyz&role=admin')])
    assert.deepEqual(result.autoIgnoredKeys, ['sign', 'token'])
    assert.deepEqual(keysOf(result.match), ['role'])
  })

  it('AC-R1-11 · E5 语义键只进建议，默认仍是条件', () => {
    const results = analyzeMatchStability([
      legacyRecord('/v1/users?version=1'),
      legacyRecord('/v1/users?version=2'),
    ])

    assert.deepEqual(results[0].autoIgnoredKeys, [])
    assert.deepEqual(keysOf(results[0].match), ['version'])
    assert.ok(results[0].suggestions.some(it =>
      it.key === 'version' && it.evidence === 'E5' && it.reason === 'semanticKey'))
    assert.equal(results[0].match.query.mode, 'match')
  })

  it('AC-R1-01 · E3 动态值形态只进建议', () => {
    const [result] = analyzeMatchStability([legacyRecord('/v1/users?reqNo=1699999999999')])
    assert.deepEqual(result.autoIgnoredKeys, [])
    assert.deepEqual(keysOf(result.match), ['reqNo'])
    assert.ok(result.suggestions.some(it =>
      it.key === 'reqNo' && it.evidence === 'E3' && it.reason === 'dynamicValueShape'))
  })

  it('AC-R1-01 · E4 可选键（部分录制缺失）只进建议', () => {
    const results = analyzeMatchStability([
      legacyRecord('/v1/users?a=1'),
      legacyRecord('/v1/users'),
    ])
    assert.deepEqual(results[0].autoIgnoredKeys, [])
    assert.ok(results[1].suggestions.some(it =>
      it.key === 'a' && it.evidence === 'E4' && it.reason === 'optionalKey'))
  })

  it('AC-R1-02 · 同 Path 不同 Method 不互相影响', () => {
    const results = analyzeMatchStability([
      legacyRecord('/v1/users?offset=1', { method: 'GET' }),
      legacyRecord('/v1/users?offset=2', { method: 'POST' }),
    ])
    assert.deepEqual(results[0].autoIgnoredKeys, [])
    assert.deepEqual(keysOf(results[0].match), ['offset'])
    assert.deepEqual(results[1].autoIgnoredKeys, [])
    assert.deepEqual(keysOf(results[1].match), ['offset'])
  })

  it('AC-R1-12 · 同组 ID 段参数化为 glob，两条录制都命中', () => {
    const results = analyzeMatchStability([
      legacyRecord('/v1/users/10086?x=1'),
      legacyRecord('/v1/users/10087?x=1'),
    ])

    const analysis = results[0]
    assert.equal(analysis.pathParameterized, true)
    assert.equal(analysis.match.path, '/v1/users/*')
    assert.equal(analysis.match.pathType, 'glob')
    assert.equal(analysis.pathOriginal, '/v1/users/10086')
    assert.equal(analysis.pathSuggested, '/v1/users/*')
    assert.equal(analysis.match.parameterizedSegmentIndex, 2)
    assert.equal(results[1].match.path, '/v1/users/*')

    assert.equal(hits(analysis.match, 'GET', '/v1/users/10086?x=1'), true)
    assert.equal(hits(analysis.match, 'GET', '/v1/users/10087?x=1'), true)
    assert.equal(hits(analysis.match, 'GET', '/v1/users/10088?x=1'), true)
  })

  it('AC-R1-12 · 单条录制的 ID 段只给建议 Path', () => {
    const [result] = analyzeMatchStability([legacyRecord('/v1/users/10086')])
    assert.equal(result.pathParameterized, false)
    assert.equal(result.pathSuggested, '/v1/users/*')
    assert.ok(result.suggestions.some(it => it.reason === 'pathParameterizable'))
  })

  it('AC-R1-12 · 版本段与文件扩展名不参与参数化', () => {
    const [versioned] = analyzeMatchStability([legacyRecord('/v1/12345')])
    assert.equal(versioned.pathSuggested, '/v1/*')

    const [file] = analyzeMatchStability([legacyRecord('/files/report.json')])
    assert.equal(file.pathSuggested, undefined)
    assert.equal(file.pathParameterized, false)
  })

  it('AC-R1-12 · 分析结果可复现', () => {
    const input = () => [
      legacyRecord('/v1/users/10086?ts=1&role=admin'),
      legacyRecord('/v1/users/10087?ts=2&role=admin'),
    ]
    const first = analyzeMatchStability(input(), { source: 'migration', analyzedAt: 1000 })
    const second = analyzeMatchStability(input(), { source: 'migration', analyzedAt: 1000 })
    assert.deepEqual(first.map(it => it.match), second.map(it => it.match))
    assert.equal(first[0].match.derivation.source, 'migration')
    assert.equal(first[0].match.derivation.analyzedAt, 1000)
  })
})

describe('档位切换', () => {
  const base = () => makeMatch({
    path: '/v1/users',
    conditions: [condition('role', 'admin'), condition('page', '1')],
    ignoreKeys: ['ts'],
  })
  const source = { url: '/v1/users?role=admin&page=1&ts=1', method: 'GET' }

  // previewLevel 以记录为入参：重建条件依赖录制来源，来源缺失时走 sourceMissing
  const recordOf = (withSource: boolean) => {
    const record = makeRecord({ match: base() })
    if (withSource) record.source = source
    return record
  }

  it('AC-R1-13 · loose 清空 Query 条件并保留 Header 忽略键', () => {
    const record = recordOf(false)
    record.match.headers.ignoreKeys = ['x-trace']
    const preview = previewLevel('loose', record)

    assert.equal(preview.changed, true)
    assert.equal(preview.match.level, 'loose')
    assert.equal(preview.match.query.mode, 'ignore')
    assert.deepEqual(preview.match.query.conditions, [])
    assert.deepEqual(preview.match.query.ignoreKeys, [])
    assert.deepEqual(preview.match.headers.ignoreKeys, ['x-trace'])
    assert.equal(hits(preview.match, 'GET', '/v1/users?anything=1'), true)
  })

  it('AC-R1-13 · standard 从录制来源重建条件并保留忽略键', () => {
    const preview = previewLevel('standard', recordOf(true))
    assert.equal(preview.match.query.allowExtra, true)
    assert.deepEqual(keysOf(preview.match), ['role', 'page'])
    assert.deepEqual(preview.match.query.ignoreKeys, ['ts'])
    assert.equal(preview.match.level, 'standard')
  })

  it('AC-R1-13 · strict 需要录制来源，额外参数被拒绝', () => {
    const preview = previewLevel('strict', recordOf(true))
    assert.equal(preview.changed, true)
    assert.equal(preview.match.level, 'strict')
    assert.equal(preview.match.query.allowExtra, false)
    assert.deepEqual(preview.match.query.ignoreKeys, [])
    assert.deepEqual(keysOf(preview.match), ['role', 'page', 'ts'])
    assert.deepEqual(preview.match.derivation.autoIgnoredKeys, [])
    assert.equal(hits(preview.match, 'GET', '/v1/users?role=admin&page=1&ts=1'), true)
    assert.equal(hits(preview.match, 'GET', '/v1/users?role=admin&page=1&ts=1&x=1'), false)
  })

  it('AC-R1-13 · strict 缺少来源时返回 sourceMissing 且不改条件', () => {
    const record = recordOf(false)
    const preview = previewLevel('strict', record)
    assert.equal(preview.changed, false)
    assert.equal(preview.reason, 'sourceMissing')
    assert.deepEqual(preview.match.query.conditions, record.match.query.conditions)
  })

  it('AC-R1-13 · custom 只标记档位', () => {
    const preview = previewLevel('custom', recordOf(false))
    assert.equal(preview.match.level, 'custom')
    assert.equal(preview.changed, true)
  })

  it('AC-R1-13 · 来源里没有 Query 时 standard 不保留旧条件', () => {
    const preview = previewLevel('standard', makeRecord({ match: base(), url: '/v1/users' }))
    assert.deepEqual(preview.match.query.conditions, [])
    assert.equal(preview.match.query.mode, 'ignore')
    // 条件为空时档位回填为 loose，避免单选框与实际摘要打架
    assert.equal(preview.match.level, 'loose')
  })
})

describe('restoreStrict 与档位判定', () => {
  it('AC-R1-13 · 撤销恢复全 Query、禁止额外参数并保留 Header 条件', () => {
    const record = makeRecord({
      url: '/v1/users?role=admin&ts=1',
      match: makeMatch({
        conditions: [condition('role', 'admin')],
        ignoreKeys: ['ts'],
        headerConditions: [],
        priority: 5,
      }),
    })
    record.source = { url: '/v1/users?role=admin&ts=1', method: 'GET' }
    record.match.headers.conditions = [{ name: 'x-client', op: 'equals', value: 'mobile' }]

    const result = restoreStrict(record)
    assert.equal(result.changed, true)
    assert.equal(result.match.level, 'strict')
    assert.equal(result.match.query.allowExtra, false)
    assert.deepEqual(result.match.query.ignoreKeys, [])
    assert.deepEqual(keysOf(result.match), ['role', 'ts'])
    assert.deepEqual(result.match.headers.conditions.map(it => it.name), ['x-client'])
    assert.equal(result.match.priority, 5)
    assert.equal(result.match.derivation.autoIgnoredKeys.length, 0)
  })

  it('AC-R1-13 · 缺少录制来源时无法恢复严格档', () => {
    const result = restoreStrict(makeRecord({ match: makeMatch() }))
    assert.equal(result.changed, false)
    assert.equal(result.reason, 'sourceMissing')
  })

  it('AC-R1-11 · levelOf 按实际条件判定档位', () => {
    assert.equal(levelOf(makeMatch({ pathType: 'exact' })), 'loose')
    assert.equal(levelOf(makeMatch({ conditions: [condition('role', 'admin')] })), 'standard')
    assert.equal(levelOf(makeMatch({
      pathType: 'glob', path: '/v1/*', conditions: [condition('role', 'admin')],
    })), 'standard')
    assert.equal(levelOf(makeMatch({
      conditions: [condition('role', 'admin')], allowExtra: false,
    })), 'strict')
    assert.equal(levelOf(makeMatch({
      conditions: [condition('role', 'admin')],
      headerConditions: [{ name: 'x-client', op: 'equals', value: 'mobile' }],
    })), 'custom')
  })

  it('AC-R1-16 · 摘要包含 Method 哨兵与忽略键', () => {
    const record = makeRecord({ match: makeMatch({ method: 'ANY', ignoreKeys: ['ts'] }) })
    const summary = summaryOf(record)
    assert.equal(summary.method, 'ANY')
    assert.equal(summary.host, '')
    assert.equal(summary.path, '/v1/users')
    assert.equal(summary.level, 'loose')
    assert.deepEqual(summary.ignoredKeys, ['ts'])
  })
})

describe('deriveMatch · 只存 url 的记录写入前派生', () => {
  it('派生结果已是规范形：仓库层再规范化不改变落库内容', () => {
    for (const url of ['/v1/users', '/v1/users?role=admin&page=1', '/v1/orders/1234567a?ts=1']) {
      const match = deriveMatch(legacyRecord(url), url)
      assert.ok(match != null, url)
      assert.deepEqual(normalizeMatchRule(match), match, url)
    }
  })

  it('AC-R1-12 · 带 Query 的录制派生标准档，无 Query 派生宽松档', () => {
    assert.equal(deriveMatch(legacyRecord('/v1/users?role=admin'), '/v1/users?role=admin').level, 'standard')
    assert.equal(deriveMatch(legacyRecord('/v1/users'), '/v1/users').level, 'loose')
  })

  it('AC-R1-09 · 空 url 不派生，由仓库层按 matchMissing 拒绝', () => {
    assert.equal(deriveMatch(makeRecord({ url: '' }), ''), null)
  })
})

describe('addQueryCondition', () => {
  it('新行插在条件列表顶部并把 Query 切到匹配模式', () => {
    const match = makeMatch({ conditions: [condition('page', '1')] })
    match.query.mode = 'ignore'
    const added = addQueryCondition(match)
    assert.deepEqual(match.query.conditions.map(it => it.key), ['', 'page'])
    assert.equal(match.query.conditions[0], added)
    assert.equal(match.query.mode, 'match')
  })
})

describe('querySuggestionsOf', () => {
  it('给出录制里尚未进条件的键值，已忽略的键不推荐', () => {
    const record = makeRecord({ match: makeMatch({ conditions: [condition('role', 'admin')], ignoreKeys: ['ts'] }) })
    record.source = { url: '/v1/users?role=admin&sign=abc&page=1&page=2&ts=9', method: 'GET' }

    assert.deepEqual(querySuggestionsOf(record, record.match), [
      { key: 'sign', value: 'abc' },
      { key: 'page', value: '1' },
    ])
  })

  it('缺少录制来源与来源里没有待补的键都返回空', () => {
    const record = makeRecord({ match: makeMatch() })
    assert.deepEqual(querySuggestionsOf(record, record.match), [])
    record.source = { url: '/v1/users', method: 'GET' }
    assert.deepEqual(querySuggestionsOf(record, record.match), [])
  })

  it('建议条数封顶，长 Query 不会把一行撑爆', () => {
    const record = makeRecord({ match: makeMatch() })
    const query = Array.from({ length: 12 }, (_, i) => `k${i}=v${i}`).join('&')
    record.source = { url: `/v1/users?${query}`, method: 'GET' }
    assert.equal(querySuggestionsOf(record, record.match).length, 8)
  })
})