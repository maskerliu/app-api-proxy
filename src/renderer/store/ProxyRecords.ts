import { defineStore } from 'pinia'
import { reactive, ref, shallowRef } from 'vue'
import { PorxyType, ProxyRequestRecord, ProxyStatRecord } from "../../common/models"

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
      proxyTypes: [String(PorxyType.REQUEST)],
      filterKeyword: '' as string,
      curRecordId: -1,
      records: new Map() as Map<number, (ProxyRequestRecord | ProxyStatRecord)>,
    }
  },
  actions: {
    updateRecord(record: ProxyRequestRecord | ProxyStatRecord) {
      if (this.shouldFilter(record)) return

      switch (record.type) {
        case PorxyType.REQUEST_START:
        case PorxyType.STATISTICS:
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
        case PorxyType.REQUEST_END:
          if (!this.records.has(record.id)) { return }
          let proxyRecord = record as ProxyRequestRecord
          let tmpRecord = this.records.get(record.id) as ProxyRequestRecord
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
    shouldFilter(record: ProxyRequestRecord | ProxyStatRecord): boolean {
      if (record.type == PorxyType.REQUEST_START || record.type == PorxyType.REQUEST_END) {
        if (this.proxyTypes.indexOf(String(PorxyType.REQUEST)) == -1) {
          return true
        }
      }

      if (record.type == PorxyType.STATISTICS || record.type == PorxyType.SOCKET) {
        if (this.proxyTypes.indexOf(String(record.type)) == -1) {
          return true
        }
      }

      if (record.type !== PorxyType.STATISTICS && this.filterKeyword != null && this.filterKeyword.length > 0) {
        if ((record as ProxyRequestRecord).url.indexOf(this.filterKeyword) === -1)
          return true
      }

      return false
    },
    mockRecord() {
      let fakeRecord = {
        headers: {
          'x-udid': '202008211540279c88ca89d44e05dbc35b8740b31b5da00185ab3ad5569afe',
          'x-user-lang': 'zh_CN',
          'x-accesstoken': 'gjJihHDfqcuivHL1b2U05ngPPbDequNybWF0qBfUjXmPGFKStr…PCepu9KdDpve7hmhb2N2mWTOJBWopdJs0Sh9ZbrHK5V19saq0',
          'x-biz-trace': 'db2d1c6238fc674fceaecf9f30cb41ed00',
          'x-user-agent': 'mapi/1.0 (Android 31;com.yitan.tangguo 3.11.0;Xiaomi Mi+10;tg;3609)',
        },
        id: 277 + new Date().getMilliseconds(),
        isMock: false,
        method: "POST",
        requestData: null,
        responseData: { code: '8000', msg: 'SUCCESS' + new Date().getMilliseconds(), success: true, result: {}, tid: '0712ed382aff47e4877b5f55fce0832f' },
        responseHeaders: { 'content- length': '2157', 'content- type': 'application/json;charset=UTF-8', date: 'Tue, 20 Sep 2022 09:27:05 GMT' },
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
    mockUpdateRecord() {

    },

  }
})