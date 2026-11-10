import { defineStore } from 'pinia'
import { ProxyMock } from '@shared/proxy.models'


const COLORS: string[] = [
  "#F44336",
  "#3F51B5",
  "#2196F3",
  "#00BCD4",
  "#009688",
  "#FF9800",
  "#795548",
  "#9C27B0",
  "#607D8B",
  "#673AB7"
]

// 单条响应在主进程已截断到 1MB，40 条是展示上限，避免长时间挂机内存持续增长
const MAX_RECORDS = 40

type RecordItem = ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord | ProxyMock.SocketRecord

function isSocket(record: RecordItem): record is ProxyMock.SocketRecord {
  return record.type === ProxyMock.PorxyType.SOCKET
}

function isLiveSocket(record: RecordItem): boolean {
  return isSocket(record) && record.wsPhase !== 'close'
}

function isFiltered(record: RecordItem, types: string[], keyword: string): boolean {
  if (record.type == ProxyMock.PorxyType.REQUEST_START ||
    record.type == ProxyMock.PorxyType.REQUEST_END) {
    return types.indexOf(String(ProxyMock.PorxyType.REQUEST)) == -1 ||
      String((record as ProxyMock.ProxyRequestRecord).url ?? '').indexOf(keyword) == -1
  }

  if (isSocket(record)) {
    return types.indexOf(String(record.type)) == -1 ||
      (keyword.length > 0 && String(record.url ?? '').indexOf(keyword) == -1)
  }

  if (record.type == ProxyMock.PorxyType.STATISTICS) {
    return types.indexOf(String(record.type)) == -1
  }

  if (record.type !== ProxyMock.PorxyType.STATISTICS && keyword.length > 0) {
    return String((record as ProxyMock.ProxyRequestRecord).url ?? '').indexOf(keyword) == -1
  }

  return false
}

export const ProxyRecordStore = defineStore('ProxyRecords', {
  state: () => {
    return {
      proxyTypes: [String(ProxyMock.PorxyType.REQUEST), String(ProxyMock.PorxyType.SOCKET)],
      filterKeyword: '' as string | number,
      curRecordId: -1,
      records: new Map() as Map<number, RecordItem>,
      // 记录插入顺序，淘汰时按队列头部清理
      order: [] as number[],
      isChanged: 0, // is a random number to identify the records change,
    }
  },
  getters: {
    // 过滤只影响展示，原始记录保留，清空关键字后可以恢复
    visibleRecords(state): RecordItem[] {
      const types = state.proxyTypes.map(it => String(it))
      const keyword = String(state.filterKeyword ?? '')
      const result: RecordItem[] = []
      for (let i = state.order.length - 1; i >= 0; i--) {
        const record = state.records.get(state.order[i])
        if (record == null || isFiltered(record, types, keyword)) continue
        result.push(record)
      }
      // Socket 连接始终排在最前
      result.sort((a, b) => {
        const aIsSocket = isSocket(a) ? 0 : 1
        const bIsSocket = isSocket(b) ? 0 : 1
        return aIsSocket - bIsSocket
      })
      return result
    },
    // 5030 入口徽标：只统计仍在进行的连接，不受列表淘汰影响
    activeSocketCount(state): number {
      let count = 0
      state.records.forEach(it => { if (isLiveSocket(it)) count++ })
      return count
    },
    },
  actions: {
    // 刷新/新窗口时恢复仍在进行的连接（只补缺失项，不覆盖实时帧）
    applySocketSnapshot(records: ProxyMock.SocketRecord[]) {
      for (const record of records ?? []) {
        if (this.records.has(record.id)) continue
        this.insertRecord(record)
      }
      this.isChanged = new Date().getTime()
    },
    insertRecord(record: RecordItem) {
      record.timelineColor = COLORS[record.id % COLORS.length]
      if (!this.records.has(record.id)) this.order.push(record.id)
      this.records.set(record.id, record)
      this.trimRecords()
    },
    updateRecord(record: RecordItem) {
      switch (record.type) {
        case ProxyMock.PorxyType.REQUEST_START:
        case ProxyMock.PorxyType.STATISTICS:
          record.timelineColor = COLORS[record.timestamp % COLORS.length]

          if (!this.records.has(record.id)) this.order.push(record.id)
          this.records.set(record.id, record)
          this.trimRecords()
          break
        case ProxyMock.PorxyType.REQUEST_END:
          if (!this.records.has(record.id)) { return }
          let proxyRecord = record as ProxyMock.ProxyRequestRecord
          let tmpRecord = this.records.get(record.id) as ProxyMock.ProxyRequestRecord
          tmpRecord.isMock = proxyRecord.isMock
          tmpRecord.type = proxyRecord.type
          tmpRecord.responseHeaders = proxyRecord.responseHeaders
          tmpRecord.responseData = this.parseResponseData(proxyRecord.responseData)
          tmpRecord.statusCode = proxyRecord.statusCode
          tmpRecord.time = proxyRecord.time
          // 命中/未命中元数据随 REQUEST_END 合并，详情页据此渲染 Mock 区块
          tmpRecord.mock = proxyRecord.mock
          break
        case ProxyMock.PorxyType.SOCKET:
          this.updateSocketRecord(record as ProxyMock.SocketRecord)
          break
        default:
          console.error("unsupport record type")
      }

      // 淘汰逻辑会跳过当前选中项，这里仅做兜底
      if (this.curRecordId != -1 && !this.records.has(this.curRecordId)) this.curRecordId = -1
      this.isChanged = new Date().getTime()
    },
    updateSocketRecord(record: ProxyMock.SocketRecord) {
      const existing = this.records.get(record.id) as ProxyMock.SocketRecord
      if (existing == null) {
        // 失败连接只推 close；刷新后也可能先收到 frames/close，都按新行补入
        record.frames = record.wsPhase === 'frames' ? (record.frames ?? []) : []
        this.insertRecord(record)
        return
      }

      if (record.wsPhase === 'frames') {
        const frames = (existing.frames ?? []).concat(record.frames ?? [])
        // 主进程已按同一个上限截断，这里兜底防止窗口重开/异常批次突破上限
        existing.frames = frames.length > ProxyMock.SOCKET_MAX_FRAMES
          ? frames.slice(frames.length - ProxyMock.SOCKET_MAX_FRAMES) : frames
        existing.frameCount = record.frameCount ?? existing.frameCount
        existing.droppedFrames = record.droppedFrames ?? existing.droppedFrames
        existing.bytesSent = record.bytesSent ?? existing.bytesSent
        existing.bytesReceived = record.bytesReceived ?? existing.bytesReceived
        existing.wsPhase = 'frames'
        return
      }

      if (record.wsPhase === 'open') {
        existing.wsPhase = 'open'
        existing.url = record.url ?? existing.url
        existing.subprotocol = record.subprotocol ?? existing.subprotocol
        existing.requestHeaders = record.requestHeaders ?? existing.requestHeaders
        existing.responseHeaders = record.responseHeaders ?? existing.responseHeaders
        return
      }

      // close：断开后从列表中移除
      this.removeRecord(record.id)
    },
    removeRecord(id: number) {
      const idx = this.order.indexOf(id)
      if (idx >= 0) this.order.splice(idx, 1)
      this.records.delete(id)
      if (this.curRecordId === id) this.curRecordId = -1
    },
    trimRecords() {
      while (this.order.length > MAX_RECORDS) {
        // 选中项与进行中的连接不参与淘汰，避免详情或 5030 徽标失真
        const evictedIdx = this.order.findIndex(id => id !== this.curRecordId
          && !isLiveSocket(this.records.get(id)))
        if (evictedIdx < 0) break
        const [evicted] = this.order.splice(evictedIdx, 1)
        this.records.delete(evicted)
      }
    },
    parseResponseData(data: any) {
      if (data == null) return null
      if (typeof data !== 'string') return data
      try {
        return JSON.parse(data)
      } catch (err) {
        // 非 JSON 响应（如 text/plain、错误信息）直接按原文展示
        return data
      }
    },
    clearRecords(): void {
      this.records.clear()
      this.order.length = 0
      this.curRecordId = -1
    },
    curRecord() {
      return this.records.get(this.curRecordId)
    }
  }
})
