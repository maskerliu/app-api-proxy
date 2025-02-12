import { defineStore } from 'pinia'
import { ProxyMock } from '../../common'


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

export const ProxyRecordStore = defineStore('ProxyRecords', {
  state: () => {
    return {
      proxyTypes: [String(ProxyMock.PorxyType.REQUEST)],
      filterKeyword: '' as string | number,
      curRecordId: -1,
      records: new Map() as Map<number, (ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord)>,
      isChanged: 0, // is a random number to identify the records change,

    }
  },
  actions: {
    updateRecord(record: ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord) {
      if (this.shouldFilter(record)) return

      switch (record.type) {
        case ProxyMock.PorxyType.REQUEST_START:
        case ProxyMock.PorxyType.STATISTICS:
          if (this.records.size > 40) {
            let keys = [...this.records.keys()]
            for (let i = 0; i < 10; ++i) {
              this.records.delete(keys[i])
            }
          }

          record.timelineColor = COLORS[record.timestamp % 10]

          this.records.set(record.id, record)
          if (!this.records.has(this.curRecordId)) this.curRecordId = -1
          break
        case ProxyMock.PorxyType.REQUEST_END:
          if (!this.records.has(record.id)) { return }
          let proxyRecord = record as ProxyMock.ProxyRequestRecord
          let tmpRecord = this.records.get(record.id) as ProxyMock.ProxyRequestRecord
          tmpRecord.isMock = proxyRecord.isMock
          tmpRecord.type = proxyRecord.type
          tmpRecord.responseHeaders = proxyRecord.responseHeaders
          tmpRecord.responseData = JSON.parse(proxyRecord.responseData)
          tmpRecord.statusCode = proxyRecord.statusCode
          tmpRecord.time = proxyRecord.time
          break
        default:
          console.error("unsupport record type")
      }
      this.isChanged = new Date().getTime()
    },
    updateFilter() {
      [...this.records.keys()].forEach(key => {
        let record = this.records.get(key)
        if (this.shouldFilter(record)) this.records.delete(key)
      })
    },
    clearRecords(): void {
      this.records.clear()
      this.curRecordId = -1
    },
    curRecord() {
      return this.records.get(this.curRecordId)
    },
    shouldFilter(record: ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord): boolean {
      if (record.type == ProxyMock.PorxyType.REQUEST_START ||
        record.type == ProxyMock.PorxyType.REQUEST_END) {
        return this.proxyTypes.indexOf(String(ProxyMock.PorxyType.REQUEST)) == -1 ||
          (record as ProxyMock.ProxyRequestRecord).url.indexOf(this.filterKeyword) == -1
      }

      if (record.type == ProxyMock.PorxyType.STATISTICS ||
        record.type == ProxyMock.PorxyType.SOCKET) {
        return this.proxyTypes.indexOf(String(record.type)) == -1
      }

      if (record.type !== ProxyMock.PorxyType.STATISTICS &&
        this.filterKeyword != null && this.filterKeyword.length > 0) {
        return (record as ProxyMock.ProxyRequestRecord).url.indexOf(this.filterKeyword) == -1
      }

      return false
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
