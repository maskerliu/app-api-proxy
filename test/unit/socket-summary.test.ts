import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ProxyMock } from '@shared/proxy.models'
import { dirIcon, socketStatsOf, socketStatusOf } from '@renderer/pages/proxy/socket'

type AnyRecord = Record<string, any>

// t 的桩：带参文案把参数拼进返回值，便于断言 dropped / failed 这类插值
function t(key: string, params?: AnyRecord) {
  return params === undefined ? key : `${key}=${JSON.stringify(params)}`
}

function socketRecord(extra: AnyRecord = {}): ProxyMock.SocketRecord {
  return {
    id: 1,
    wsId: 1,
    type: ProxyMock.ProxyType.SOCKET,
    wsPhase: 'frames',
    method: 'WS',
    url: 'wss://api.example.com/ws',
    timestamp: 1,
    frames: [],
    bytesSent: 2048,
    bytesReceived: 1024,
    ...extra,
  } as AnyRecord as ProxyMock.SocketRecord
}

function statsOf(extra: AnyRecord = {}) {
  return socketStatsOf(socketRecord(extra), { t, duration: '3s', frameTotal: 7 })
}

function stat(stats: ReturnType<typeof statsOf>, key: string) {
  return stats.find(it => it.key === key)
}

describe('socketStatusOf · 状态标签单源', () => {
  it('未关闭一律是已连接 + success', () => {
    assert.deepEqual(socketStatusOf(socketRecord({ wsPhase: 'open' }), t), { text: 'proxy.socket.connected', tagType: 'success' })
    assert.deepEqual(socketStatusOf(socketRecord({ wsPhase: 'frames' }), t), { text: 'proxy.socket.connected', tagType: 'success' })
  })

  it('关闭码 1000/1001 归 success，其余归 warning', () => {
    assert.equal(socketStatusOf(socketRecord({ wsPhase: 'close', closeCode: 1001 }), t).tagType, 'success')
    assert.equal(socketStatusOf(socketRecord({ wsPhase: 'close', closeCode: 1006 }), t).tagType, 'warning')
    assert.equal(socketStatusOf(socketRecord({ wsPhase: 'close' }), t).text, 'proxy.socket.closed')
  })

  it('带错误码时状态是失败 + HTTP 码，配色归 danger', () => {
    const status = socketStatusOf(socketRecord({ wsPhase: 'close', errorCode: 'WS-E04', statusCode: 502 }), t)
    assert.deepEqual(status, { text: 'proxy.socket.failed 502', tagType: 'danger' })
  })
})

describe('socketStatsOf · 单行信息带', () => {
  it('按 时长 → 字节 → 帧数 排列，缺省不追加后续条目', () => {
    const stats = statsOf()
    assert.deepEqual(stats.map(it => it.key), ['duration', 'bytes', 'frames'])
    assert.deepEqual([stat(stats, 'duration').label, stat(stats, 'frames').label],
      ['proxy.socket.duration', 'proxy.socket.frameCount'])
    assert.deepEqual(stat(stats, 'duration').values, [{ text: '3s' }])
  })

  it('字节条目不带标签，用 title 说明且两个值按 上行/下行 取图标', () => {
    const bytes = stat(statsOf(), 'bytes')
    assert.equal(bytes.label, undefined)
    assert.equal(bytes.title, 'proxy.socket.bytesTitle')
    assert.deepEqual(bytes.values, [
      { text: '2.0 KB', icon: 'icon-upstream' },
      { text: '1.0 KB', icon: 'icon-downlink' },
    ])
  })

  it('帧数优先取记录统计值，丢弃数只在大于 0 时追加', () => {
    assert.deepEqual(stat(statsOf({ frameCount: 12 }), 'frames').values, [{ text: '12' }])
    assert.deepEqual(stat(statsOf(), 'frames').values, [{ text: '7' }])
    assert.deepEqual(stat(statsOf({ droppedFrames: 0 }), 'frames').values, [{ text: '7' }] as any)
    assert.deepEqual(stat(statsOf({ droppedFrames: 2 }), 'frames').values,
      [{ text: '7' }, { text: 'proxy.socket.dropped={"count":2}', cls: 'is-warn' }])
  })

  it('子协议只有协商成功才占一格', () => {
    assert.equal(stat(statsOf(), 'subprotocol'), undefined)
    assert.deepEqual(stat(statsOf({ subprotocol: 'mqtt' }), 'subprotocol').values, [{ text: 'mqtt' }])
  })

  it('关闭条目只在 close 相位出现，非正常码标红并带上关闭方与原因', () => {
    assert.equal(stat(statsOf(), 'close'), undefined)
    const close = stat(statsOf({
      wsPhase: 'close', closeCode: 1006, closeBy: 'upstream', closeReason: 'abnormal',
    }), 'close')
    assert.equal(close.label, 'proxy.socket.closeCode')
    assert.deepEqual(close.values, [
      { text: '1006', cls: 'is-danger' },
      { text: 'proxy.socket.closeBy.upstream' },
      { text: 'abnormal', title: 'abnormal' },
    ])
  })

  it('关闭码与关闭信息缺省时回落成 -, 且不带 is-danger', () => {
    const close = stat(statsOf({ wsPhase: 'close', closeCode: 1000 }), 'close')
    assert.deepEqual(close.values, [{ text: '1000', cls: undefined }])
  })
})

describe('dirIcon · 方向图标映射', () => {
  it('上行 upstream、下行 downlink', () => {
    assert.equal(dirIcon('c2s'), 'icon-upstream')
    assert.equal(dirIcon('s2c'), 'icon-downlink')
  })
})
