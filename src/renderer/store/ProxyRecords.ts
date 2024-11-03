import { defineStore } from 'pinia'
import { ProxyMock } from '../../common/proxy.models'


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

export const useProxyRecordStore = defineStore('ProxyRecords', {
  state: () => {
    return {
      proxyTypes: [String(ProxyMock.PorxyType.REQUEST)],
      filterKeyword: '' as string | number,
      curRecordId: -1,
      curRecord: null as ProxyMock.ProxyRequestRecord,
      records: new Map() as Map<number, (ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord)>,
      isChanged: 0, // is a random number to identify the records change,
      showMockRuleMgr: false,
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

          record._idx = record.id + ""
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
      this.isChanged = Math.random()
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
    shouldFilter(record: ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord): boolean {
      if (record.type == ProxyMock.PorxyType.REQUEST_START ||
        record.type == ProxyMock.PorxyType.REQUEST_END) {
        return this.proxyTypes.indexOf(String(ProxyMock.PorxyType.REQUEST)) == -1
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
    mockRecord() {
      this.isChanged = Number(Math.random())
      let fakeRecord = {
        headers: {
          'x-udid': '202008211540279c88ca89d44e05dbc35b8740b31b5da00185ab3ad5569afe',
          'x-user-lang': 'zh_CN',
          'x-accesstoken': 'gjJihHDfqcuivHL1b2U05ngPPbDequNybWF0qBfUjXmPGFKStr…PCepu9KdDpve7hmhb2N2mWTOJBWopdJs0Sh9ZbrHK5V19saq0',
          'x-biz-trace': 'db2d1c6238fc674fceaecf9f30cb41ed00',
          'x-user-agent': 'mapi/1.0 (Android 31;com.yitan.tangguo 3.11.0;Xiaomi Mi+10;tg;3609)',
        },
        id: 277 + new Date().getMilliseconds(),
        isMock: true,
        method: "POST",
        requestData: null,
        responseData: {
          code: '8000', msg: 'SUCCESS' + new Date().getMilliseconds(), success: true, result: {
            'x-udid': '202008211540279c88ca89d44e05dbc35b8740b31b5da00185ab3ad5569afe',
            'x-user-lang': 'zh_CN',
            'x-accesstoken': 'gjJihHDfqcuivHL1b2U05ngPPbDequNybWF0qBfUjXmPGFKStr…PCepu9KdDpve7hmhb2N2mWTOJBWopdJs0Sh9ZbrHK5V19saq0',
            'x-biz-trace': 'db2d1c6238fc674fceaecf9f30cb41ed00',
            'x-user-agent': 'mapi/1.0 (Android 31;com.yitan.tangguo 3.11.0;Xiaomi Mi+10;tg;3609)',
            test: {
              'x-udid': '202008211540279c88ca89d44e05dbc35b8740b31b5da00185ab3ad5569afe',
              'x-user-lang': 'zh_CN',
              'x-accesstoken': 'gjJihHDfqcuivHL1b2U05ngPPbDequNybWF0qBfUjXmPGFKStr…PCepu9KdDpve7hmhb2N2mWTOJBWopdJs0Sh9ZbrHK5V19saq0',
              'x-biz-trace': 'db2d1c6238fc674fceaecf9f30cb41ed00',
              'x-user-agent': 'mapi/1.0 (Android 31;com.yitan.tangguo 3.11.0;Xiaomi Mi+10;tg;3609)',
            },
            snap: 'https://img1.baidu.com/it/u=1251298942,390054395&fm=253&fmt=auto&app=138&f=JPEG?w=500&h=500https://14038277.s21i.faiusr.com/2/ABUIABACGAAgodiN2QUog9DHuwEwgAU46AU.jpg',
            video: 'https://img1.baidu.com/it/u=1251298942,390054395&fm=253&fmt=auto&app=138&f=JPEG?w=500&h=500https://14038277.s21i.faiusr.com/2/ABUIABACGAAgodiN2QUog9DHuwEwgAU46AU.jpg',
            audio: 'https://img1.baidu.com/it/u=1251298942,390054395&fm=253&fmt=auto&app=138&f=JPEG?w=500&h=500https://14038277.s21i.faiusr.com/2/ABUIABACGAAgodiN2QUog9DHuwEwgAU46AU.jpg'
          }, tid: '0712ed382aff47e4877b5f55fce0832f'
        },
        responseHeaders: { 'content-length': '2157', 'content-type': 'application/json;charset=UTF-8', date: 'Tue, 20 Sep 2022 09:27:05 GMT' },
        statusCode: 200,
        time: 406 + new Date().getMilliseconds(),
        timelineColor: "#FF9800",
        timestamp: 5,
        type: 5011,
        url: "/tg-app/center/v1/config/mainPage",
        _idx: "277" + new Date().getMilliseconds(),
      }
      this.updateRecord(fakeRecord)
    },
  }
})
