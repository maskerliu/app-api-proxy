import { mapState } from 'pinia'
import { defineComponent, PropType } from 'vue'
import { ProxyStatRecord } from '../../../common/models/DataModels'
import { useCommonStore } from '../../store'
import { useProxyRecordStore } from '../../store/ProxyRecords'

type SateRule = { desc: string, rule: string[], ruleDesc: string }

const ProxyStatDetail = defineComponent({
  props: {
    record: { type: Object as PropType<ProxyStatRecord> }
  },
  mounted() {
    this.rows = []
    if (this.record.statistics.bps.length == 1) {
      this.onClicked(this.record.statistics.bps[0], 0)
    }
  },
  computed: {
    ...mapState(useProxyRecordStore, []),
    ...mapState(useCommonStore, ['serverConfig']),
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

    onClicked(row: any, index: number) {

    },

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
    }
  },
  watch: {
    record() {
      if (this.record.statistics.bps.length == 1) {
        this.onClicked(this.record.statistics.bps[0], 0)
      }
      this.statRule = null
    }
  }
})

export default ProxyStatDetail