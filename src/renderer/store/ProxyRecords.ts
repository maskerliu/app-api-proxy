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

type RecordItem = ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord

function isFiltered(record: RecordItem, types: string[], keyword: string): boolean {
  if (record.type == ProxyMock.PorxyType.REQUEST_START ||
    record.type == ProxyMock.PorxyType.REQUEST_END) {
    return types.indexOf(String(ProxyMock.PorxyType.REQUEST)) == -1 ||
      String((record as ProxyMock.ProxyRequestRecord).url ?? '').indexOf(keyword) == -1
  }

  if (record.type == ProxyMock.PorxyType.STATISTICS ||
    record.type == ProxyMock.PorxyType.SOCKET) {
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
      proxyTypes: [String(ProxyMock.PorxyType.REQUEST)],
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
      return result
    }
  },
  actions: {
    updateRecord(record: RecordItem) {
      switch (record.type) {
        case ProxyMock.PorxyType.REQUEST_START:
        case ProxyMock.PorxyType.STATISTICS:
          record.timelineColor = COLORS[record.timestamp % 10]

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
          break
        default:
          console.error("unsupport record type")
      }

      // 淘汰逻辑会跳过当前选中项，这里仅做兜底
      if (this.curRecordId != -1 && !this.records.has(this.curRecordId)) this.curRecordId = -1
      this.isChanged = new Date().getTime()
    },
    trimRecords() {
      while (this.order.length > MAX_RECORDS) {
        // 选中项不参与淘汰，避免正在查看的详情被删掉
        const evictedIdx = this.order.findIndex(id => id !== this.curRecordId)
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
    },
    mockRecordStart(id: number) {
      this.isChanged = new Date().getTime()
      let fakeRecord: ProxyMock.ProxyRequestRecord = {
        id,
        isMock: true,
        method: Math.random() > 0.5 ? 'POST' : 'GET',
        headers: {
          'x-udid': '202008211540279c88ca89d44e05dbc35b8740b31b5da00185ab3ad5569afe',
          'x-user-lang': 'zh_CN',
          'x-accesstoken': 'gjJihHDfqcuivHL1b2U05ngPPbDequNybWF0qBfUjXmPGFKStrPCepu9KdDpve7hmhb2N2mWTOJBWopdJs0Sh9ZbrHK5V19saq0',
          'x-biz-trace': 'db2d1c6238fc674fceaecf9f30cb41ed00',
          'x-user-agent': 'mapi/1.0 (Android 31;com.yitan.tangguo 3.11.0;Xiaomi Mi+10;tg;3609)',
        },
        requestData: null,
        timelineColor: "#FF9800",
        timestamp: new Date().getTime(),
        type: ProxyMock.PorxyType.REQUEST_START,
        url: "/tg-app/center/v1/config/mainPage/helloworld",
      }
      this.updateRecord(fakeRecord)
    },
    mockRecordEnd(id: number) {
      let respData = {
        code: '8000', msg: 'SUCCESS' + new Date().getMilliseconds(), success: true, result: {
          'x-udid': '202008211540279c88ca89d44e05dbc35b8740b31b5da00185ab3ad5569afe',
          'x-user-lang': 'zh_CN',
          'x-accesstoken': 'gjJihHDfqcuivHL1b2U05ngPPbDequNybWF0qBfUjXmPGFKStPCepu9KdDpve7hmhb2N2mWTOJBWopdJs0Sh9ZbrHK5V19saq0',
          'x-biz-trace': 'db2d1c6238fc674fceaecf9f30cb41ed00',
          'x-user-agent': 'mapi/1.0 (Android 31;com.yitan.tangguo 3.11.0;Xiaomi Mi+10;tg;3609)',
          test: {
            'x-udid': '202008211540279c88ca89d44e05dbc35b8740b31b5da00185ab3ad5569afe',
            'x-user-lang': 'zh_CN',
            'x-accesstoken': 'gjJihHDfqcuivHL1b2U05ngPPbDequNybWF0qBfUjXmPGFKStrPCepu9KdDpve7hmhb2N2mWTOJBWopdJs0Sh9ZbrHK5V19saq0',
            'x-biz-trace': 'db2d1c6238fc674fceaecf9f30cb41ed00',
            'x-user-agent': 'mapi/1.0 (Android 31;com.yitan.tangguo 3.11.0;Xiaomi Mi+10;tg;3609)',
          },
          media: {
            jpeg: 'https://14038277.s21i.faiusr.com/2/ABUIABACGAAgodiN2QUog9DHuwEwgAU46AU.jpg',
            gif: 'https://5b0988e595225.cdn.sohucs.com/images/20191115/dabecb1691094f8c96acb6a524803c71.gif',
            webp: 'https://gd-hbimg.huaban.com/cf3c8a7d9e2a329af80ff0ec49589c7438e86c3d50fef-2z1q8n_fw658',
            apng: 'https://jamesqi.com/sites/jamesqi.com/files/1f975.png',
            video: 'https://baikevideo.cdn.bcebos.com/media/mda-OxHkzPA8lgXMtZ6Q/e413b6455b3c432b6f65d1d08efaf3fc.mp4',
            audio: 'https://bqq.gtimg.com/CDN/source/audio/ring.mp3',
            zhibo: 'https://iovliveplay.radio.cn/fm/1600000001173.m3u8'
          },
        },
        tid: '0712ed382aff47e4877b5f55fce0832f'
      }
      this.isChanged = new Date().getTime()
      let fakeRecord: ProxyMock.ProxyRequestRecord = {
        id,
        isMock: true,
        method: "POST",
        requestData: null,
        responseData: JSON.stringify(respData),
        responseHeaders: { 'content-length': '2157', 'content-type': 'application/json;charset=UTF-8', date: 'Tue, 20 Sep 2022 09:27:05 GMT' },
        statusCode: 200,
        time: 406 + new Date().getMilliseconds(),
        timelineColor: "#FF9800",
        type: ProxyMock.PorxyType.REQUEST_END,
        url: "/tg-app/center/v1/config/mainPage/helloworld",
      }
      this.updateRecord(fakeRecord)
    }
  }
})
