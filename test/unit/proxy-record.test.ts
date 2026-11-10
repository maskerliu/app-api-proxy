import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ProxyMock } from '@shared/proxy.models'
import { requestEnd, requestStart, statRecord } from '@main/service/proxy.record'

// 2026-11-01 00:00:00.000Z，刻意用毫秒级大数锁死 timestamp 的单位
const AT = 1761955200000

describe('proxy.record 请求开始记录', () => {
  it('id 取会话号、timestamp 取请求发起毫秒', () => {
    const record = requestStart({
      sessionId: 7, at: AT, url: 'http://a/b', method: 'POST',
      headers: { host: 'a' }, requestData: { k: 1 }, data: '{"a":1}',
    })

    assert.equal(record.id, 7)
    assert.equal(record.type, ProxyMock.ProxyType.REQUEST_START)
    assert.equal(record.timestamp, AT)
    assert.equal(record.url, 'http://a/b')
    assert.equal(record.method, 'POST')
    assert.deepEqual(record.headers, { host: 'a' })
    assert.deepEqual(record.requestData, { k: 1 })
    assert.equal(record.data, '{"a":1}')
  })

  it('不带响应字段', () => {
    const record = requestStart({ sessionId: 1, at: AT, url: '/x', method: 'GET', headers: {}, requestData: null, data: null })
    assert.equal(record.statusCode, undefined)
    assert.equal(record.responseData, undefined)
    assert.equal(record.time, undefined)
  })
})

describe('proxy.record 请求结束记录', () => {
  it('elapsed 落到 time，命中与未命中元数据原样带上', () => {
    const mock = { hit: false, miss: { ruleId: 'r1', reason: 'no-rule' } } as any
    const record = requestEnd({
      sessionId: 7, url: 'http://a/b', elapsed: 1234, statusCode: 200,
      responseHeaders: { 'content-type': 'application/json' }, responseData: '{"a":1}',
      isMock: false, mock,
    })

    assert.equal(record.id, 7)
    assert.equal(record.type, ProxyMock.ProxyType.REQUEST_END)
    assert.equal(record.time, 1234)
    assert.equal(record.statusCode, 200)
    assert.equal(record.isMock, false)
    assert.deepEqual(record.mock, mock)
  })

  it('转发失败沿用 -100 状态码', () => {
    const record = requestEnd({
      sessionId: 8, url: '/x', elapsed: 15, statusCode: -100,
      responseHeaders: null, responseData: JSON.stringify({ error: 'boom' }), isMock: false,
    })

    assert.equal(record.statusCode, -100)
    assert.equal(record.responseHeaders, null)
    assert.equal(record.mock, undefined)
  })

  it('命中 Mock 时 isMock 为真', () => {
    const record = requestEnd({
      sessionId: 9, url: '/x', elapsed: 0, statusCode: 201,
      responseHeaders: {}, responseData: null, isMock: true, mock: { hit: true } as any,
    })

    assert.equal(record.isMock, true)
    assert.equal(record.type, ProxyMock.ProxyType.REQUEST_END)
  })
})

describe('proxy.record 统计上报记录', () => {
  it('id 与 timestamp 同为上报毫秒', () => {
    const record = statRecord(AT, { bps: [] })

    assert.equal(record.id, AT)
    assert.equal(record.timestamp, AT)
    assert.equal(record.type, ProxyMock.ProxyType.STATISTICS)
    assert.deepEqual(record.statistics, { bps: [] })
  })
})
