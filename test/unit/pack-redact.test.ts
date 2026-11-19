import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MOCK_SENSITIVE_HEADERS } from '@shared/http-header'
import { MOCK_PACK_REDACTED_VALUE, redactPackHeaders, redactPackRecord } from '@shared/mock.pack'
import type { MockPackRecord } from '@shared/mock.pack'

/**
 * 脱敏等价类用例表（R4C-07，按 DoD 第 6 条在实现之前冻结）。
 * 真源：docs/PRD-v1.1-0-6周需求.md 附录 B.2 的七项 + docs/R4-技术设计.md D7。
 * 这里只钉语义（命中谁、形状怎么保、改不改入参），实现细节不进断言。
 */

describe('规则包脱敏', () => {
  it('敏感头清单就是 B.2 的七项，且全部为小写', () => {
    assert.deepEqual([...MOCK_SENSITIVE_HEADERS].sort(), [
      'authorization', 'cookie', 'proxy-authorization', 'set-cookie', 'x-access-token', 'x-auth-token', 'x-token',
    ])
    assert.ok(MOCK_SENSITIVE_HEADERS.every(name => name === name.toLowerCase()))
    assert.equal(new Set(MOCK_SENSITIVE_HEADERS).size, MOCK_SENSITIVE_HEADERS.length)
  })

  it('七项逐个命中，值替换为固定掩码', () => {
    for (const name of MOCK_SENSITIVE_HEADERS) {
      const out = redactPackHeaders({ [name]: 'Bearer secret-value' })
      assert.equal(out[name], MOCK_PACK_REDACTED_VALUE, `${name} 必须脱敏`)
    }
  })

  it('大小写混写与首尾空格同样命中，但输出保留原写法', () => {
    const out = redactPackHeaders({ 'Authorization': 'a', 'COOKIE': 'b', 'X-Auth-Token': 'c', 'Set-Cookie': 'd', ' authorization ': 'e' })
    assert.deepEqual(out, {
      Authorization: MOCK_PACK_REDACTED_VALUE,
      COOKIE: MOCK_PACK_REDACTED_VALUE,
      'X-Auth-Token': MOCK_PACK_REDACTED_VALUE,
      'Set-Cookie': MOCK_PACK_REDACTED_VALUE,
      ' authorization ': MOCK_PACK_REDACTED_VALUE,
    }, '键名大小写与空格是用户配置的一部分，脱敏不得顺手把它们规范化')
  })

  it('同名多值脱敏后仍是等长数组，不被压成字符串', () => {
    const out = redactPackHeaders({ 'set-cookie': ['a=1; HttpOnly', 'b=2; Path=/'] })
    assert.ok(Array.isArray(out['set-cookie']), '数组形态变了，导入后请求头结构就漂移了')
    assert.deepEqual(out['set-cookie'], [MOCK_PACK_REDACTED_VALUE, MOCK_PACK_REDACTED_VALUE])
  })

  it('只精确匹配名单，前缀包含敏感名的业务头不动', () => {
    const out = redactPackHeaders({
      'authorization-type': 'Bearer',
      'x-token-kind': 'static',
      'cookie-consent': 'accepted',
      'proxy-authorization-required': 'false',
      'x_xsrf_token': 'keep-me',
    })
    assert.deepEqual(out, {
      'authorization-type': 'Bearer',
      'x-token-kind': 'static',
      'cookie-consent': 'accepted',
      'proxy-authorization-required': 'false',
      'x_xsrf_token': 'keep-me',
    })
  })

  it('非敏感头原样保留，空串值也照样脱敏，缺失与 null 不伪造值', () => {
    const out = redactPackHeaders({
      'content-type': 'application/json',
      'x-request-id': '',
      'token-not-in-list': '',
      authorization: '',
      cookie: null,
      'x-token': undefined,
    })
    assert.equal(out['content-type'], 'application/json')
    assert.equal(out['token-not-in-list'], '')
    assert.equal(out.authorization, MOCK_PACK_REDACTED_VALUE, '空值也要替换：这条头存在本身就是信息')
    assert.equal(out.cookie, null, 'null 不是字符串，替换成掩码会让导入侧把它当成真实值')
    assert.equal(out['x-token'], undefined)
  })

  it('仅大小写不同的重复键各自命中，不做合并', () => {
    const out = redactPackHeaders({ authorization: 'one', Authorization: 'two' })
    assert.deepEqual(out, { authorization: MOCK_PACK_REDACTED_VALUE, Authorization: MOCK_PACK_REDACTED_VALUE })
  })

  it('返回新对象，不修改入参', () => {
    const source = { authorization: 'real-token', 'content-type': 'application/json' }
    const out = redactPackHeaders(source)
    assert.equal(source.authorization, 'real-token', '就地改会污染库内记录，导出后继续操作界面就把真值丢了')
    assert.notEqual(out, source)
  })

  it('头集合缺失时原样返回，不凭空造出一个空对象', () => {
    assert.equal(redactPackHeaders(undefined), undefined)
    assert.equal(redactPackHeaders(null), null)
  })

  function sampleRecord(): MockPackRecord {
    return {
      name: '登录',
      response: {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': ['sid=1', 'sid=2'] },
        body: '{"ok":true}',
        bodyType: 'json',
        delayMs: 0,
      },
      variants: [{
        id: 'v-1',
        name: '慢响应',
        statusCode: 500,
        headers: { authorization: 'variant-secret', 'x-trace': 'keep' },
        body: '',
        bodyType: 'text',
        delayMs: 100,
      }],
      activeVariantId: 'v-1',
      source: {
        method: 'POST',
        url: 'https://api.example.com/login?a=1',
        statusCode: 200,
        headers: { Authorization: 'real', 'x-mock-uid': 'uid-1' },
        capturedAt: 1700000000000,
      },
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
    }
  }

  it('记录级脱敏覆盖三处：source.headers、response.headers 与每个变体的 headers', () => {
    const out = redactPackRecord(sampleRecord(), true)
    assert.equal(out.response.headers['Set-Cookie'].length, 2)
    assert.deepEqual(out.response.headers['Set-Cookie'], [MOCK_PACK_REDACTED_VALUE, MOCK_PACK_REDACTED_VALUE])
    assert.equal(out.response.headers['Content-Type'], 'application/json')
    assert.equal(out.source.headers.Authorization, MOCK_PACK_REDACTED_VALUE)
    assert.equal(out.source.headers['x-mock-uid'], 'uid-1')
    assert.equal(out.variants[0].headers.authorization, MOCK_PACK_REDACTED_VALUE, '变体也是完整响应，漏它就是脱敏遗漏')
    assert.equal(out.variants[0].headers['x-trace'], 'keep')
  })

  it('记录级脱敏不改其余字段，也不改入参记录', () => {
    const record = sampleRecord()
    const before = JSON.stringify(record)
    const out = redactPackRecord(record, true)
    assert.equal(JSON.stringify(record), before, '导出用的必须是副本')
    assert.equal(out.name, record.name)
    assert.equal(out.activeVariantId, record.activeVariantId)
    assert.equal(out.createdAt, record.createdAt)
    assert.equal(out.updatedAt, record.updatedAt)
    assert.equal(out.variants[0].name, '慢响应')
    assert.equal(out.variants[0].delayMs, 100)
    assert.equal(out.source.url, record.source.url, 'source.url 的脱敏由「是否带来源快照」控制，不归这里')
  })

  it('redact=false 时原样返回同一条记录', () => {
    const record = sampleRecord()
    assert.equal(redactPackRecord(record, false), record, '关闭脱敏要走 -raw 分支，不能悄悄做半截替换')
    assert.equal(JSON.stringify(redactPackRecord(record, false)).includes('variant-secret'), true, 'raw 包必须真的带原值，只改文件名等于骗用户')
  })

  it('缺 response 或缺头集合的记录不因脱敏而崩', () => {
    assert.doesNotThrow(() => redactPackRecord({ response: { statusCode: 200, headers: {}, body: '', bodyType: 'text', delayMs: 0 } }, true))
    assert.doesNotThrow(() => redactPackRecord({ response: { statusCode: 200, body: '', bodyType: 'text', delayMs: 0 } }, true))
    assert.doesNotThrow(() => redactPackRecord({ response: { statusCode: 200, body: '', bodyType: 'text', delayMs: 0 }, variants: [] }, true))
  })
})
