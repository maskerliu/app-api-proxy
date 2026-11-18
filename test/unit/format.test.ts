import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  compactJson, formatBitrate, formatBytes, formatClock, formatDuration, formatElapsed, formatFrameOffset,
  formatSampleRate, formatUptime, prettifyJson,
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

describe('媒体元信息格式化', () => {
  it('formatDuration 按 m:ss / h:mm:ss，取整秒', () => {
    assert.equal(formatDuration(0.5), '')
    assert.equal(formatDuration(32), '0:32')
    assert.equal(formatDuration(65), '1:05')
    assert.equal(formatDuration(5_999), '1:39:59')
    assert.equal(formatDuration(3_600), '1:00:00')
  })

  it('formatDuration 对直播流的 Infinity 与无效值给空串，由调用方省略该项', () => {
    assert.equal(formatDuration(Infinity), '')
    assert.equal(formatDuration(NaN), '')
    assert.equal(formatDuration(undefined), '')
    assert.equal(formatDuration(-1), '')
  })

  it('formatSampleRate 转 kHz，整数档不带小数', () => {
    assert.equal(formatSampleRate(8000), '8 kHz')
    assert.equal(formatSampleRate(44100), '44.1 kHz')
    assert.equal(formatSampleRate(48000), '48 kHz')
    assert.equal(formatSampleRate(22050), '22.1 kHz')
    assert.equal(formatSampleRate(0), '')
    assert.equal(formatSampleRate(undefined), '')
  })

  it('formatBitrate 一兆以下 kbps，以上 Mbps', () => {
    assert.equal(formatBitrate(32_000), '32 kbps')
    assert.equal(formatBitrate(128_050), '128 kbps')
    assert.equal(formatBitrate(999_999), '1.0 Mbps')
    assert.equal(formatBitrate(3_300_000), '3.3 Mbps')
    assert.equal(formatBitrate(0), '')
    assert.equal(formatBitrate(Infinity), '')
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

describe('formatClock 墙上时钟', () => {
  it('按本地时分成 HH:mm:ss.SSS，各段补零', () => {
    const at = new Date(2026, 10, 18, 9, 5, 3, 42).getTime()
    assert.equal(formatClock(at), '09:05:03.042')
  })

  it('时分与毫秒同时到顶', () => {
    const at = new Date(2026, 10, 18, 23, 59, 59, 999).getTime()
    assert.equal(formatClock(at), '23:59:59.999')
  })

  it('无效值返回空串，调用方据此不渲染时间戳', () => {
    assert.equal(formatClock(), '')
    assert.equal(formatClock(NaN), '')
  })
})
