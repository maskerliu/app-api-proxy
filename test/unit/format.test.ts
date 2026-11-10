import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  compactJson, formatBytes, formatElapsed, formatFrameOffset, formatUptime, prettifyJson,
} from '@renderer/common/format'

describe('formatBytes 字节阶梯', () => {
  it('B 取整，KB/MB 按 digits 保留小数', () => {
    assert.equal(formatBytes(0), '0 B')
    assert.equal(formatBytes(1023), '1023 B')
    assert.equal(formatBytes(1024), '1.0 KB')
    assert.equal(formatBytes(1536), '1.5 KB')
    assert.equal(formatBytes(1024 * 1024), '1.0 MB')
    assert.equal(formatBytes(1024 * 1024 * 2.5), '2.5 MB')
  })

  it('digits 同时作用于 KB 与 MB', () => {
    assert.equal(formatBytes(1536, 2), '1.50 KB')
    assert.equal(formatBytes(1024 * 1024 * 1.5, 2), '1.50 MB')
  })

  it('缺失、负数与 NaN 都按 0 处理', () => {
    assert.equal(formatBytes(undefined), '0 B')
    assert.equal(formatBytes(-1), '0 B')
    assert.equal(formatBytes(NaN), '0 B')
  })
})

describe('时长格式化', () => {
  it('formatElapsed 以毫秒为入参，分 ms / s / 分秒三档', () => {
    assert.equal(formatElapsed(0), '0 ms')
    assert.equal(formatElapsed(999), '999 ms')
    assert.equal(formatElapsed(1000), '1.0 s')
    assert.equal(formatElapsed(59_999), '60.0 s')
    assert.equal(formatElapsed(60_000), '1m 0s')
    assert.equal(formatElapsed(90_000), '1m 30s')
    assert.equal(formatElapsed(-5), '0 ms')
  })

  it('formatUptime 以秒为入参，整秒阶梯，超过一小时只到分', () => {
    assert.equal(formatUptime(undefined), '0s')
    assert.equal(formatUptime(0), '0s')
    assert.equal(formatUptime(59), '59s')
    assert.equal(formatUptime(60), '1m 0s')
    assert.equal(formatUptime(3600), '1h 0m')
    assert.equal(formatUptime(3661), '1h 1m')
    assert.equal(formatUptime(-5), '0s')
  })

  it('formatFrameOffset 秒内给 ms，之后按 mm:ss / hh:mm:ss 补零', () => {
    assert.equal(formatFrameOffset(0), '0ms')
    assert.equal(formatFrameOffset(999), '999ms')
    assert.equal(formatFrameOffset(1000), '0:01')
    assert.equal(formatFrameOffset(65_000), '1:05')
    assert.equal(formatFrameOffset(3_600_000), '1:00:00')
    assert.equal(formatFrameOffset(3_661_000), '1:01:01')
    assert.equal(formatFrameOffset(-1), '0ms')
  })
})

describe('JSON 美化与压缩', () => {
  it('能解析才重写，非法 JSON 原样返回', () => {
    assert.equal(prettifyJson('{"a":1}'), '{\n  "a": 1\n}')
    assert.equal(prettifyJson('not json'), 'not json')
    assert.equal(prettifyJson(''), '')
    assert.equal(compactJson('{\n  "a": 1\n}'), '{"a":1}')
    assert.equal(compactJson('not json'), 'not json')
    assert.equal(compactJson(''), '')
  })

  it('标量与 null 也按 JSON 重写', () => {
    assert.equal(prettifyJson('"a"'), '"a"')
    assert.equal(prettifyJson('123'), '123')
    assert.equal(prettifyJson('null'), 'null')
    assert.equal(compactJson('[1,  2]'), '[1,2]')
  })
})
