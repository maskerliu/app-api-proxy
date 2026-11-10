import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { ProxyMock } from '@shared/proxy.models'
import { ProxyRecordStore } from '@renderer/store/ProxyRecords'

type AnyRecord = Record<string, any>

function httpRecord(id: number, url: string = `/api/${id}`): AnyRecord {
  return {
    id,
    type: ProxyMock.ProxyType.REQUEST_START,
    method: 'GET',
    url,
    headers: {},
    timestamp: id,
  }
}

function socketRecord(id: number, wsPhase: ProxyMock.SocketPhase, extra: AnyRecord = {}): AnyRecord {
  return {
    id,
    wsId: id,
    type: ProxyMock.ProxyType.SOCKET,
    wsPhase,
    method: 'WS',
    url: `wss://api.example.com/ws/${id}`,
    timestamp: id,
    frames: [],
    ...extra,
  }
}

function frame(seq: number): ProxyMock.SocketFrame {
  return {
    seq,
    dir: 'c2s',
    opcode: 'text',
    at: seq,
    size: 1,
    data: String(seq),
    encoding: 'utf8',
  }
}

function newStore() {
  return ProxyRecordStore()
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('Socket 记录快照', () => {
  it('只补缺失连接，不覆盖已收到的实时数据', () => {
    const store = newStore()
    store.applySocketSnapshot([socketRecord(1, 'open')])
    store.applySocketSnapshot([
      socketRecord(1, 'open', { url: 'wss://changed.example.com/ws' }),
      socketRecord(2, 'open'),
    ])

    assert.equal(store.records.size, 2)
    assert.equal(store.records.get(1).url, 'wss://api.example.com/ws/1')
    assert.equal(store.activeSocketCount, 2)
  })
})

describe('updateSocketRecord 合并语义', () => {
  it('frames 批次按顺序追加并更新统计', () => {
    const store = newStore()
    store.insertRecord(socketRecord(5, 'open'))
    store.updateSocketRecord(socketRecord(5, 'frames', {
      frames: [frame(1)], frameCount: 1, bytesSent: 10, bytesReceived: 20, droppedFrames: 0,
    }))
    store.updateSocketRecord(socketRecord(5, 'frames', {
      frames: [frame(2), frame(3)], frameCount: 3, bytesSent: 30, bytesReceived: 40, droppedFrames: 1,
    }))

    const record = store.records.get(5)
    assert.deepEqual(record.frames.map(it => it.seq), [1, 2, 3])
    assert.equal(record.frameCount, 3)
    assert.equal(record.bytesSent, 30)
    assert.equal(record.bytesReceived, 40)
    assert.equal(record.droppedFrames, 1)
    // 帧批次会把相位推进到 frames，列表据此区分「刚建连」与「已在通信」
    assert.equal(record.wsPhase, 'frames')
  })

  it('单连接帧数上限 1000，保留最新帧', () => {
    const store = newStore()
    store.insertRecord(socketRecord(6, 'open'))
    const many = Array.from({ length: 1200 }, (_, i) => frame(i + 1))
    store.updateSocketRecord(socketRecord(6, 'frames', { frames: many, frameCount: 1200 }))

    const record = store.records.get(6)
    assert.equal(record.frames.length, 1000)
    assert.equal(record.frames[0].seq, 201)
    assert.equal(record.frames[999].seq, 1200)
  })

  it('close 后连接从列表移除，选中项一并清空', () => {
    const store = newStore()
    store.insertRecord(socketRecord(7, 'open'))
    store.updateSocketRecord(socketRecord(7, 'frames', { frames: [frame(1), frame(2)], frameCount: 2 }))
    store.curRecordId = 7
    store.updateSocketRecord(socketRecord(7, 'close', {
      closeCode: 1000, closeReason: 'bye', closeBy: 'client', time: 1200,
    }))

    assert.equal(store.records.has(7), false)
    assert.equal(store.order.includes(7), false)
    assert.equal(store.curRecordId, -1)
    assert.equal(store.activeSocketCount, 0)
  })

  it('失败连接只收到 close 时按新行补入', () => {
    const store = newStore()
    store.updateSocketRecord(socketRecord(8, 'close', {
      closeBy: 'proxy', errorCode: 'WS-E04', errorMessage: 'refused', statusCode: 502,
    }))
    assert.equal(store.records.size, 1)
    assert.equal(store.records.get(8).errorCode, 'WS-E04')
    assert.equal(store.activeSocketCount, 0)
  })
})

describe('activeSocketCount', () => {
  it('只统计未结束的连接', () => {
    const store = newStore()
    store.insertRecord(socketRecord(1, 'open'))
    store.insertRecord(socketRecord(2, 'open'))
    store.insertRecord(socketRecord(3, 'close', { closeCode: 1000 }))
    assert.equal(store.activeSocketCount, 2)

    store.updateSocketRecord(socketRecord(1, 'close', { closeCode: 1001 }))
    assert.equal(store.activeSocketCount, 1)

    store.clearRecords()
    assert.equal(store.activeSocketCount, 0)
  })
})

describe('5030 列表筛选', () => {
  it('只展示勾选类型，关键字仅作用于 URL', () => {
    const store = newStore()
    store.insertRecord(httpRecord(10))
    store.insertRecord(socketRecord(11, 'open'))
    store.insertRecord(socketRecord(12, 'open'))

    store.proxyTypes = [String(ProxyMock.ProxyType.SOCKET)]
    assert.deepEqual(store.visibleRecords.map(it => it.id), [12, 11])

    store.filterKeyword = 'ws/11'
    assert.deepEqual(store.visibleRecords.map(it => it.id), [11])

    store.filterKeyword = 'nothing'
    assert.equal(store.visibleRecords.length, 0)

    store.filterKeyword = ''
    store.proxyTypes = [String(ProxyMock.ProxyType.REQUEST)]
    assert.deepEqual(store.visibleRecords.map(it => it.id), [10])
  })
})

describe('40 条上限淘汰', () => {
  it('进行中的连接与当前选中项不会被淘汰', () => {
    const store = newStore()
    for (let id = 1; id <= 40; id++) store.insertRecord(httpRecord(id))
    store.insertRecord(socketRecord(1_000_000_001, 'open'))
    assert.equal(store.records.size, 40)
    assert.equal(store.records.has(1_000_000_001), true)

    for (let id = 41; id <= 60; id++) store.insertRecord(httpRecord(id))
    assert.equal(store.records.size, 40)
    assert.equal(store.records.has(1_000_000_001), true)

    const selected = newStore()
    selected.insertRecord(httpRecord(100))
    selected.curRecordId = 100
    for (let id = 200; id < 250; id++) selected.insertRecord(httpRecord(id))
    assert.equal(selected.records.has(100), true)
    assert.equal(selected.records.size, 40)
  })
})