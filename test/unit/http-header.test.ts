import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  emptyToNull, headerFirst, headerValuesOf, HOP_BY_HOP_HEADERS, isHeaderName,
  pickHeader, pickHeaderList, splitConnectionTokens,
} from '@shared/http-header'

describe('http-header 取值语义', () => {

  it('值级取单值保留空白，缺失与空串区分开', () => {
    assert.equal(headerFirst(undefined), null)
    assert.equal(headerFirst(''), '')
    assert.equal(headerFirst('  '), '  ')
    assert.equal(headerFirst(['a', 'b']), 'a')
  })

  it('值级取多值逐项 trim，缺失返回 null', () => {
    assert.equal(headerValuesOf(undefined), null)
    assert.deepEqual(headerValuesOf(''), [''])
    assert.deepEqual(headerValuesOf([' a ', 'b', undefined]), ['a', 'b'])
  })

  it('map 级取值大小写不敏感，先命中小写 key', () => {
    const headers = { 'X-Mock-Host': 'upper.local', 'content-type': 'application/json' }
    assert.equal(pickHeader(headers, 'x-mock-host'), 'upper.local')
    assert.equal(pickHeader(headers, 'Content-Type'), 'application/json')
    assert.equal(pickHeader(headers, 'missing'), null)
    assert.equal(pickHeader(undefined, 'missing'), null)
  })

  it('小写键优先命中，其余按声明顺序做大小写不敏感匹配', () => {
    // Node/Express 的 req.headers 天然是小写键，这条快路径必须稳定
    assert.equal(pickHeader({ 'X-Uid': 'first', 'x-uid': 'second' }, 'x-uid'), 'second')
    assert.equal(pickHeader({ 'X-Uid': 'first' }, 'x-uid'), 'first')
    assert.equal(pickHeader({ 'X-Uid': 'first', 'X-UID': 'second' }, 'x-uid'), 'first')
  })

  it('原型链上的属性名不会被当成请求头', () => {
    assert.equal(pickHeader({}, 'constructor'), null)
    assert.equal(pickHeader({ toString: 'literal' }, 'toString'), 'literal')
  })

  it('多值头按列表返回，缺失与空列表可区分', () => {
    assert.deepEqual(pickHeaderList({ 'Set-Cookie': ['a=1', 'b=2'] }, 'set-cookie'), ['a=1', 'b=2'])
    assert.equal(pickHeaderList({ 'Set-Cookie': undefined }, 'set-cookie'), null)
  })

  it('emptyToNull 只按 trim 后是否为空判定', () => {
    assert.equal(emptyToNull('  '), null)
    assert.equal(emptyToNull('a'), 'a')
    assert.equal(emptyToNull(null), null)
  })

  it('Connection 逐跳声明按小写去空', () => {
    assert.deepEqual(splitConnectionTokens('Keep-Alive, X-Foo ,, Upgrade'), ['keep-alive', 'x-foo', 'upgrade'])
    assert.deepEqual(splitConnectionTokens(undefined), [])
    assert.ok(HOP_BY_HOP_HEADERS.includes('transfer-encoding'))
  })

  it('头名校验沿用 RFC 7230 token 字符集', () => {
    assert.ok(isHeaderName("x-mock-uid"))
    assert.ok(isHeaderName("X-Token!#$%&'*+-.^_`|~09azAZ"))
    assert.ok(!isHeaderName('x bad'))
    assert.ok(!isHeaderName('x:bad'))
    assert.ok(!isHeaderName(''))
  })
})
