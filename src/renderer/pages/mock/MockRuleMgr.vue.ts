import { mapState } from 'pinia'
import { Notify } from 'vant'
import { defineComponent, PropType, ref } from 'vue'
import { MockRule, ProxyRequestRecord } from '../../../common/models'
import { deleteMockRule, getMockRuleDetail, saveMockRule, searchMockRules } from '../../../common/remoteApis'
import { json2map, map2json } from '../../common'
import { useProxyRecordStore } from '../../store/ProxyRecords'
import VueJsonEditor from '../components/VueJsonEditor.vue'

const MockRuleMgr = defineComponent({
  components: {
    VueJsonEditor,
  },
  props: {
    isMock: { type: Boolean, require: false, default: false },
    record: { type: Object as PropType<ProxyRequestRecord>, require: false, default: null }
  },
  computed: {
    ...mapState(useProxyRecordStore, ['records', 'curRecordId']),
  },
  data() {
    return {
      jeOption: {
        mode: 'tree',
        search: false,
        navigationBar: true,
        statusBar: false,
        mainMenuBar: false,
      },
      keyword: null as string,
      showSearchResult: ref(false),
      rules: [] as Array<MockRule>,
      curRule: new MockRule(),
      curRuleMock: false,
      curRecord: ref() as ProxyRequestRecord,
      curRecordKey: null as string,
      showRuleEdit: false,
      showRuleDelete: false,
      showRecordEdit: false,
      showRecordDelete: false,
      isSaving: false
    }
  },
  mounted() {
    this.curRecord = this.record
    // if (this.curRecordId != null) {
    //   this.curRecord = this.records.get(this.curRecordId)
    //   this.fetchMockRuleDetail()
    // }
  },
  methods: {
    async fetchPagedMockRules() {
      try {
        this.rules = await searchMockRules(this.keyword)
        this.showSearchResult = this.rules != null && this.rules.length > 0
      } catch (err) {
        Notify({ message: "未找到匹配的规则", type: 'danger' })
      }
    },
    addRule() {
      if (this.curRecord == null) return
      if (this.curRule == null) this.curRule = new MockRule()
      if (this.curRule.requests == null) this.curRule.requests = new Map()
      this.curRule.requests.set(this.curRecord.url, this.curRecord)
    },
    onRuleSelect(rule: MockRule) {
      this.curRule = rule == null ? new MockRule() : rule
      this.showSearchResult = false
      this.fetchMockRuleDetail()
    },
    async fetchMockRuleDetail() {
      if (this.curRule.name == null && this.curRule._id == null) return

      try {
        this.curRule = await getMockRuleDetail(this.curRule._id)
        this.curRule.requests = json2map(this.curRule.jsonRequests)
      } catch (err) {
        Notify({ message: '未找到对应规则', type: 'warning', duration: 500 })
      }
    },
    onRuleEdit(rule?: MockRule) {
      this.showSearchResult = false
      this.curRule = rule == null ? new MockRule() : rule
      this.showRuleEdit = true
    },
    onRuleDelete(rule: MockRule) {
      if (this.curRule.name == null || this.curRule._id == null) return
      this.curRule = rule
      this.showRuleDelete = true
    },
    async onRuleDeleteConfirm() {
      try {
        await deleteMockRule(this.curRule._id)
        this.curRule = new MockRule()
        this.showRuleDelete = false
      } catch (err) {
        Notify({ message: "删除失败", type: "warning", duration: 500 })
      }
    },
    onRuleUpload(rule: MockRule) {
      this.curRule = rule
    },
    onMockSwitchChanged(rule: MockRule) {
      this.curRule = rule
      this.onSave(true)
    },
    async onSave(isSnap: boolean) {
      if (this.curRule == null) return

      if (this.curRule.name == null) {
        this.showRuleEdit = true
        return
      }

      try {

        this.curRule.jsonRequests = map2json(this.curRule.requests)
        await saveMockRule(this.curRule, isSnap)
        await this.fetchMockRuleDetail()
        Notify({ message: '规则更新成功', type: 'success', duration: 500 })
      } catch (err) { Notify({ message: '规则更新失败', type: 'danger', duration: 500 }) }
      if (isSnap) this.showRuleEdit = false
    },
    onRecordDelete(key: string) {
      this.showRecordDelete = true
      this.curRecordKey = key
    },
    onRecordDeleteCancel() {
      this.curRecord = null
      this.curRecordKey = null
      this.showRecordDelete = false
    },
    onRecordDeleteConfirm() {
      this.curRule.requests.delete(this.curRecordKey)
      this.curRecord = null
      this.showRecordDelete = false
    },
  },
  watch: {
    record() {
      this.curRecord = this.record
    },
    keyword() {
      this.fetchPagedMockRules()
      // throttle(this.fetchPagedMockRules, 500)
    }
  }
})

export default MockRuleMgr
