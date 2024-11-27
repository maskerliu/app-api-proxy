<template>
  <van-list style="padding: 5px;">
    <van-cell v-for="(item, idx) in (record as ProxyMock.ProxyStatRecord).statistics.bps" :title="item.pageId" :label="item.elementId"
      :value="item.args" />
  </van-list>
</template>

<script lang="ts">
import { mapState } from 'pinia'
import { defineComponent, PropType } from 'vue'
import { ProxyMock } from '../../../common'
import { CommonStore,ProxyRecordStore } from '../../store'

type SateRule = { desc: string, rule: string[], ruleDesc: string }

const ProxyStatDetail = defineComponent({
  props: {
    record: { type: Object as PropType<ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord> },
  },
  mounted() {
    this.rows = []
    if (this.record.statistics.bps.length == 1) {
      this.onClicked(this.record.statistics.bps[0], 0)
    }
  },
  computed: {
    ...mapState(ProxyRecordStore, []),
    ...mapState(CommonStore, ['serverConfig']),
  },
  data() {
    return {
      statRule: null as SateRule,
      curStat: null as any,
      rows: [],
    }
  },
  methods: {
    tableRowClassName({ row, rowIndex }) {
      return this.rows[rowIndex] == null ? 'normal-row' : this.rows[rowIndex].rowClassName
    },

    onClicked(row: any, index: number) { },

    argsVailidate(rule: string[]): boolean {
      if (this.curStat.args.length == 0) return true

      let tmp: string[] = this.curStat.args.split(',')
      let args: Map<string, string> = new Map<string, string>()
      for (let pair of tmp) {
        let keyvalue = pair.split('=')
        args.set(keyvalue[0], keyvalue[1])
      }

      let validate = true
      for (let ruleKey of rule) {
        if (!args.has(ruleKey.trim()) || args.get(ruleKey.trim()) == null) {
          validate = false
        }
      }
      return validate
    },
  },
  watch: {
    record() {
      if (this.record.statistics.bps.length == 1) {
        this.onClicked(this.record.statistics.bps[0], 0)
      }
      this.statRule = null
    },
  },
})

export default ProxyStatDetail
</script>

<style>
.el-table .normal-row {
  height: 70px;
  max-height: 70px;
  font-size: 0.7rem;
  user-select: text;
}

.el-table .warning-row {
  height: 70px;
  max-height: 70px;
  font-size: 0.7rem;
  user-select: text;
  background: #eccc6858;
}

.el-table .error-row {
  height: 70px;
  max-height: 70px;
  font-size: 0.7rem;
  user-select: text;
  background: #ff767558;
}

.el-table .success-row {
  height: 70px;
  max-height: 70px;
  font-size: 0.7rem;
  user-select: text;
  background: #55efc458;
}

.table-expand {
  width: 100%;
  font-size: 0.7rem;
  height: 400px;
  overflow-y: scroll;
}

.table-expand label {
  width: 100px;
  font-size: 0.7rem;
  color: #99a9bf;
}

.el-form-item {
  margin-bottom: 0;
}

.el-form-item__content {
  font-size: 0.7rem;
  color: grey;
}

.el-table__expanded-cell[class*="cell"] {
  padding: 0;
}

.preview {
  font-size: 0.7rem;
  color: #2980b9;
  white-space: pre-wrap;
  word-wrap: break-word;
  user-select: text;
}
</style>
