import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  MOCK_MAX_VARIANTS, canonicalMatch, normalizeMatchRule, normalizeMockRecord,
  validateMatchRule, validateMockRecord,
} from '@shared/mock.validation'
import { MOCK_MAX_PATTERN_LENGTH } from '@shared/mock.models'
import { condition, headerCondition, makeMatch, makeRecord } from './fixtures'

function fingerprint(match): string {
  return createHash('sha1').update(canonicalMatch(match)).digest('hex')
}

function codes(match): string[] {
  return validateMatchRule(match).map(it => it.code)
}

describe('canonicalMatch 与指纹', () => {
  it('AC-R1-19 · Query 条件顺序不影响规范串', () => {
    const left = makeMatch({ conditions: [condition('role', 'admin'), condition('page', '1')] })
    const right = makeMatch({ conditions: [condition('page', '1'), condition('role', 'admin')] })
    assert.equal(canonicalMatch(left), canonicalMatch(right))
    assert.equal(fingerprint(left), fingerprint(right))
  })

  it('AC-R1-19 · Header 名大小写与条件顺序不影响规范串', () => {
    const left = makeMatch({
      headerConditions: [headerCondition('X-Client', 'mobile'), headerCondition('Accept', 'json')],
    })
    const right = makeMatch({
      headerConditions: [headerCondition('accept', 'json'), headerCondition('x-client', 'mobile')],
    })
    assert.equal(fingerprint(left), fingerprint(right))
  })

  it('AC-R1-19 · ignoreKeys 去重排序', () => {
    const left = makeMatch({ ignoreKeys: ['b', 'a', 'a'] })
    const right = makeMatch({ ignoreKeys: ['a', 'b'] })
    assert.deepEqual(left.query.ignoreKeys, ['b', 'a'])
    assert.equal(fingerprint(left), fingerprint(right))
  })

  it('AC-R1-19 · level / priority / enabled / derivation / 名称不参与指纹', () => {
    const base = makeMatch({ conditions: [condition('role', 'admin')] })
    const mutated = normalizeMatchRule({
      ...base,
      level: 'strict',
      priority: 99,
      enabled: false,
      derivation: {
        source: 'migration', autoIgnoredKeys: ['ts'], suggestions: [],
        pathParameterized: true, analyzedAt: 1,
      },
    })
    assert.equal(fingerprint(base), fingerprint(mutated))
  })

  it('AC-R1-19 · Method、路径、allowExtra 与 multiValue 参与指纹', () => {
    const base = makeMatch({ conditions: [condition('role', 'admin')] })
    const variants = [
      normalizeMatchRule({ ...base, method: 'POST' }),
      normalizeMatchRule({ ...base, path: '/v1/other' }),
      normalizeMatchRule({ ...base, query: { ...base.query, allowExtra: false } }),
      normalizeMatchRule({ ...base, query: { ...base.query, multiValue: 'all' } }),
    ]
    const basePrint = fingerprint(base)
    for (const variant of variants) assert.notEqual(fingerprint(variant), basePrint)
  })

  it('AC-R1-19 · 尾斜杠按 ignoreTrailingSlash 归一化后参与指纹', () => {
    const left = makeMatch({ path: '/v1/users/' })
    const right = makeMatch({ path: '/v1/users' })
    assert.equal(fingerprint(left), fingerprint(right))

    const kept = makeMatch({ path: '/v1/users/', ignoreTrailingSlash: false })
    assert.notEqual(fingerprint(kept), fingerprint(right))
  })

  it('AC-R1-19 · pathIgnoreCase 同时归一化大小写与标记', () => {
    const left = makeMatch({ path: '/V1/Users', pathIgnoreCase: true })
    const right = makeMatch({ path: '/v1/users', pathIgnoreCase: true })
    assert.equal(fingerprint(left), fingerprint(right))

    const sensitive = makeMatch({ path: '/V1/Users' })
    assert.notEqual(fingerprint(left), fingerprint(sensitive))
  })

  it('AC-R1-19 · exists / notExists 忽略配置值', () => {
    const left = makeMatch({ conditions: [{ key: 'a', op: 'exists', value: '' }] })
    const right = makeMatch({ conditions: [{ key: 'a', op: 'exists', value: 'ignored' }] })
    assert.equal(fingerprint(left), fingerprint(right))
  })

  it('AC-R1-19 · 指纹为主进程 sha1 十六进制串', () => {
    const print = fingerprint(makeMatch({ conditions: [condition('role', 'admin')] }))
    assert.match(print, /^[0-9a-f]{40}$/)
  })
})

describe('validateMatchRule', () => {
  const valid = makeMatch({
    path: '/v1/users',
    conditions: [condition('role', 'admin')],
    headerConditions: [headerCondition('x-client', 'mobile')],
  })

  it('AC-R1-19 · 合法条件无告警', () => {
    assert.deepEqual(validateMatchRule(valid), [])
  })

  it('AC-R1-20 · 非法 Method 被拒绝', () => {
    const match = makeMatch()
    match.method = 'FOO'
    assert.ok(codes(match).includes('methodInvalid'))
  })

  it('AC-R1-03 · 非法 Host 被拒绝，通配与 IPv6 可用', () => {
    const bad = makeMatch({ host: 'bad host' })
    assert.ok(codes(bad).includes('hostInvalid'))
    assert.deepEqual(validateMatchRule(makeMatch({ host: '*.example.com' })), [])
    assert.deepEqual(validateMatchRule(makeMatch({ host: '[::1]:8080' })), [])
  })

  it('AC-R1-20 · 空 Path 与非法 Path 类型被拒绝', () => {
    assert.ok(codes(makeMatch({ path: '   ' })).includes('pathEmpty'))
    const match = makeMatch()
    match.pathType = 'fuzzy' as never
    assert.ok(codes(match).includes('pathTypeInvalid'))
  })

  it('AC-R1-08 · 高风险正则、超长正则与非法正则被拒绝', () => {
    assert.ok(codes(makeMatch({ path: '(a+)+$', pathType: 'regex' })).includes('pathRegexUnsafe'))
    assert.ok(codes(makeMatch({ path: 'a'.repeat(MOCK_MAX_PATTERN_LENGTH + 1), pathType: 'regex' }))
      .includes('pathRegexTooLong'))
    assert.ok(codes(makeMatch({ path: '([', pathType: 'regex' })).includes('pathRegexInvalid'))
    assert.deepEqual(validateMatchRule(makeMatch({ path: '/v1/users/\\d+', pathType: 'regex' })), [])
  })

  it('AC-R1-01 · 非法 Query 操作符与缺失键被拒绝', () => {
    const badOp = makeMatch({ conditions: [condition('role', 'admin')] })
    badOp.query.conditions[0].op = 'gt' as never
    assert.ok(codes(badOp).includes('queryOperatorInvalid'))

    const badKey = makeMatch({ conditions: [condition('', 'admin')] })
    assert.ok(codes(badKey).includes('queryValueMissing'))
  })

  it('AC-R1-01 · Header 名不符合 RFC 或值含 CRLF 时被拒绝', () => {
    const badName = makeMatch()
    badName.headers.conditions = [{ name: 'bad name', op: 'equals', value: 'x' }]
    assert.ok(codes(badName).includes('headerNameInvalid'))

    const crlf = makeMatch()
    crlf.headers.conditions = [{ name: 'x-client', op: 'equals', value: 'a\r\nb' }]
    assert.ok(codes(crlf).includes('headerValueInvalid'))
  })

  it('AC-R1-20 · Body 暂不支持匹配，导入直接拒绝', () => {
    const match = makeMatch()
    match.body = { mode: 'match' } as never
    assert.ok(codes(match).includes('bodyModeUnsupported'))
  })

  it('AC-R1-05 · 手动优先级必须是整数', () => {
    const match = makeMatch()
    match.priority = 1.5
    assert.ok(codes(match).includes('priorityInvalid'))
    assert.deepEqual(validateMatchRule(makeMatch({ priority: 10 })), [])
    assert.deepEqual(validateMatchRule(makeMatch({ priority: -1 })), [])
  })
})

describe('validateMockRecord 与 normalizeMockRecord', () => {
  it('AC-R1-19 · 只有 match 或只有 url 都可保存，两者都没有时拒绝', () => {
    assert.deepEqual(validateMockRecord(makeRecord({ match: makeMatch() })), [])
    assert.deepEqual(validateMockRecord(makeRecord({ url: '/v1/users' })), [])
    assert.ok(validateMockRecord(makeRecord()).some(it => it.code === 'matchMissing'))
  })

  it('AC-R1-20 · 响应体超过 2MB 被拒绝', () => {
    const record = makeRecord({ match: makeMatch() })
    record.response.body = 'x'.repeat(2 * 1024 * 1024 + 1)
    assert.ok(validateMockRecord(record).some(it => it.code === 'bodyTooLarge'))
  })

  it('AC-R1-20 · 状态码越界被拒绝', () => {
    const record = makeRecord({ match: makeMatch() })
    record.response.statusCode = 600
    assert.ok(validateMockRecord(record).some(it => it.code === 'statusRange'))
  })

  it('AC-R1-20 · 变体数量与激活 ID 被校验', () => {
    const record = makeRecord({ match: makeMatch() })
    record.variants = Array.from({ length: MOCK_MAX_VARIANTS + 1 }, (_, index) => ({
      ...record.response,
      id: `v${index}`,
      name: `variant-${index}`,
    }))
    assert.ok(validateMockRecord(record).some(it => it.code === 'variantLimit'))

    const missing = makeRecord({ match: makeMatch() })
    missing.activeVariantId = 'missing'
    assert.ok(validateMockRecord(missing).some(it => it.code === 'variantIdMissing'))
  })

  it('AC-R1-09 · 读库补默认值并丢弃失效的激活变体', () => {
    const normalized = normalizeMockRecord({
      id: 'rec_1',
      name: 'legacy',
      url: '/v1/users',
      activeVariantId: 'missing',
      createdAt: 1,
    })
    assert.equal(normalized.activeVariantId, null)
    assert.equal(normalized.match, undefined)
    assert.equal(normalized.response.statusCode, 200)
    assert.equal(normalized.response.bodyType, 'json')
  })

  it('AC-R1-19 · 归一化后的 match 可直接进入指纹计算', () => {
    const normalized = normalizeMockRecord({
      id: 'rec_1',
      match: { path: '/v1/users', method: 'get' } as never,
      response: null as never,
      createdAt: 0,
      updatedAt: 0,
    })
    assert.equal(normalized.match.method, 'GET')
    assert.equal(normalized.match.query.mode, 'ignore')
    assert.equal(normalized.match.query.allowExtra, true)
    assert.equal(normalized.match.ignoreTrailingSlash, true)
    assert.match(fingerprint(normalized.match), /^[0-9a-f]{40}$/)
  })
})