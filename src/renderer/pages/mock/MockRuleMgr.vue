<template>
  <van-row class="full-row">
    <van-row class="bg-border" gutter="20" justify="start" align="center" style="
        width: calc(100% - 10px);
        background-color: white;
      ">
      <van-col style="background: white; width: 375px">
        <van-popover :show="showSearchResult" placement="bottom-start" trigger="manual" :overlay="true"
          :close-on-click-overlay="true" @click-overlay="onRuleSelect(null)">
          <van-list class="search-result" style="width: 300px;">
            <van-cell class="rule-snap-item" is-link v-for="(rule, idx) in rules" :key="idx" :title="rule.name"
              :label="rule.desc" @click="onRuleSelect(rule)">
              <template #value>
                <div style="margin-top: 0">
                  <van-icon class="iconfont icon-edit" size="16" style="color: #3498db; padding: 5px"
                    @click="onRuleEdit(rule)" />
                  <van-icon class="iconfont icon-delete" size="16" style="color: red; padding: 5px"
                    @click="onRuleDelete(rule)" />
                  <van-icon class="iconfont icon-upload" size="16" style="color: red; padding: 5px"
                    @click="onRuleUpload(rule)" />
                </div>
              </template>
            </van-cell>
          </van-list>
          <template #reference>
            <van-search :clearable="false" show-action v-model="keyword" @focus="fetchPagedMockRules"
              :placeholder="$t('mock.searchKeyword')" style="width: 280px">
              <template #action>
                <van-icon plain type="primary" name="plus" size="mini" @click="onRuleEdit(null)" />
              </template>
            </van-search>
          </template>
        </van-popover>
      </van-col>
      <van-col span="12" style="min-width: 310px; padding: 0">
        <van-cell :title="`【${curRule?.name == null ? '规则名' : curRule?.name}】`">
          <template #value>
            <div align="center">
              <van-icon class="iconfont icon-edit" size="18" style="color: #3498db" @click="onRuleEdit(curRule)" />
              <van-icon class="iconfont icon-delete" size="18" style="color: red; margin-left: 10px"
                @click="onRuleDelete(curRule)" />
              <van-icon class="iconfont icon-upload" size="18" style="color: red; margin-left: 10px"
                @click="onRuleUpload(curRule)" />
              <van-switch size="14" v-model="curRule.isMock" style="margin-left: 10px"
                @change="onMockSwitchChanged(curRule)" />
            </div>
          </template>
          <template #label>

          </template>
          <template #right-icon>
            <van-icon class="iconfont icon-cancel" size="20" style="color: red;" @click="onRuleSelect(null)" />
          </template>
        </van-cell>
      </van-col>
      <van-col style="min-width: 30px; padding: 0" align="center">
        <van-button plain type="primary" size="mini" :loading="isSaving" @click="onSave(false)">保存</van-button>
      </van-col>
    </van-row>

    <van-row style="width: 100%; height: calc(100% - 80px); display: flex">
      <van-col class="bg-border" style="width: 300px">
        <van-list v-if="curRule != null && curRule.requests != null">
          <van-cell v-for="record in [...curRule.requests.values()]" :key="record.url" @click="curRecord = record"
            clickable is-link>
            <template #title>
              <div class="record-snap">{{ record.url }}</div>
            </template>
            <template #label>
              <van-tag :type="record.statusCode == 200 ? 'success' : 'danger'">
                [http]{{ record.statusCode }}
              </van-tag>
              <van-tag style="margin-left: 5px" :type="record.responseData?.code == 8000 ? 'success' : 'danger'">
                [biz]{{ record.responseData?.code }}
              </van-tag>
            </template>
            <template #right-icon>
              <van-button plain type="danger" size="small" icon="delete-o" @click="onRecordDelete(record.url)" />
            </template>
          </van-cell>
        </van-list>
      </van-col>
      <van-col style="padding-top: 50px">
        <van-button type="primary" size="mini" icon="exchange" @click="addRule"></van-button>
      </van-col>
      <van-col class="bg-border" style="flex: 1">
        <vue-json-editor class="json-editor" v-model="curRecord" :options="jeOption" />
      </van-col>
    </van-row>

    <van-dialog title="警告" :show="showRuleDelete" show-cancel-button @cancel="showRuleDelete = false"
      @confirm="onRuleDeleteConfirm" :message="`确定要删除规则[ ${curRule != null ? curRule.name : ''}]吗?`" />

    <van-dialog title="规则详情" :show="showRuleEdit" show-cancel-button @cancel="showRuleEdit = false"
      @confirm="onSave(true)">
      <van-form ref="form" labvan-width="90px" v-if="curRule != null">
        <van-field label="规则组名" v-model="curRule.name" placeholder="规则组名" />
        <van-field rows="4" type="textarea" v-model="curRule.desc" placeholder="规则组描述" />
      </van-form>
    </van-dialog>

    <van-dialog title="警告" message="确认要删除这条请求数据？" :show="showRecordDelete" show-cancel-button
      @cancel="showRecordDelete = false" @confirm="onRecordDeleteConfirm" />
  </van-row>
</template>

<script lang="ts">
import { mapState } from 'pinia'
import { Notify } from 'vant'
import { defineComponent, PropType, ref } from 'vue'
import { deleteMockRule, getMockRuleDetail, saveMockRule, searchMockRules } from '../../../common/proxy.api'
import { ProxyMock } from '../../../common/proxy.models'
import { json2map, map2json } from '../../common'
import { useProxyRecordStore } from '../../store/ProxyRecords'

import VueJsonEditor from '../components/VueJsonEditor.vue'

const MockRuleMgr = defineComponent({
  components: {
    VueJsonEditor,
  },
  props: {
    isMock: { type: Boolean, require: false, default: false },
    record: {
      type: Object as PropType<ProxyMock.ProxyRequestRecord>,
      require: false,
      default: null,
    },
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
      rules: [] as Array<ProxyMock.MockRule>,
      curRule: new ProxyMock.MockRule(),
      curRuleMock: false,
      curRecord: null as ProxyMock.ProxyRequestRecord,
      curRecordKey: null as string,
      showRuleEdit: false,
      showRuleDelete: false,
      showRecordEdit: false,
      showRecordDelete: false,
      isSaving: false,
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
        Notify({ message: '未找到匹配的规则', type: 'danger' })
      }
    },
    addRule() {
      if (this.curRecord == null) return
      if (this.curRule == null) this.curRule = new ProxyMock.MockRule()
      if (this.curRule.requests == null) this.curRule.requests = new Map()
      this.curRule.requests.set(this.curRecord.url, this.curRecord)
    },
    onRuleSelect(rule: ProxyMock.MockRule) {
      this.curRule = rule == null ? new ProxyMock.MockRule() : rule
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
    onRuleEdit(rule?: ProxyMock.MockRule) {
      this.showSearchResult = false
      this.curRule = rule == null ? new ProxyMock.MockRule() : rule
      this.showRuleEdit = true
    },
    onRuleDelete(rule: ProxyMock.MockRule) {
      if (this.curRule.name == null || this.curRule._id == null) return
      this.curRule = rule
      this.showRuleDelete = true
    },
    async onRuleDeleteConfirm() {
      try {
        await deleteMockRule(this.curRule._id)
        this.curRule = new ProxyMock.MockRule()
        this.showRuleDelete = false
      } catch (err) {
        Notify({ message: '删除失败', type: 'warning', duration: 500 })
      }
    },
    onRuleUpload(rule: ProxyMock.MockRule) {
      this.curRule = rule
    },
    onMockSwitchChanged(rule: ProxyMock.MockRule) {
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
      } catch (err) {
        Notify({ message: '规则更新失败', type: 'danger', duration: 500 })
      }
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
    },
  },
})

export default MockRuleMgr
</script>

<style scoped>
:root {
  --van-cell-vertical-padding: 2px;
}

.search-result {
  width: 280px;
  height: 500px;
  background: white;
}

.rule-snap-item {
  width: 100%;
}

.record-snap {
  border: 1px #ddd dashed;
  font-size: 0.7rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 200px;
  display: block;
  direction: rtl;
  padding: 2px 6px;
}

.json-editor {
  width: calc(100% - 6px);
  height: calc(100% - 6px);
  padding: 3px;
}

.jsoneditor {
  border: 0;
}

.ace-jsoneditor {
  font-size: 0.8rem !important;
}
</style>
