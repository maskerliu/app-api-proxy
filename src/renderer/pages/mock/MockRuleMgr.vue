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
              :placeholder="$t('common.searchPlaceholder')" style="width: 280px">
              <template #action>
                <van-icon plain type="primary" name="plus" size="mini" @click="onRuleEdit(null)" />
              </template>
            </van-search>
          </template>
        </van-popover>
      </van-col>
      <van-col span="12" style="min-width: 310px; padding: 0">
        <van-cell :title="`【${curRule?.name == null ? $t('mock.rule.name') : curRule?.name}】`">
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
        <van-button plain type="primary" size="small" :loading="isSaving" @click="onSave(false)">{{ $t('common.save')
        }}
        </van-button>
      </van-col>
    </van-row>

    <van-row style="width: 100%; height: calc(100% - 63px); display: flex">
      <van-col class="bg-border" style="width: 300px">
        <van-list v-if="curRule != null && curRule.requests != null">
          <van-cell v-for="record in [...curRule.requests.values()]" :key="record.url" @click="onRecordSelected(record)"
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
        <!-- <vue-json-editor class="json-editor" v-model="curRecord" :options="jeOption" /> -->
        <!-- <v-ace-editor class="json-editor" v-model:value="content" lang="json"></v-ace-editor> -->
        <!-- <ace-editor class="json-editor" v-model:codeContent="content" lang="json"></ace-editor> -->
        <vue-ace-editor class="json-editor" v-model:codeContent="content" lang="json" :options="aceOptions" theme="monokai"></vue-ace-editor>
      </van-col>
    </van-row>

    <van-dialog :title="$t('mock.rule.delete.title')" :show="showRuleDelete" show-cancel-button
      :cancel-button-text="$t('common.cancel')" @cancel="showRuleDelete = false"
      :confirm-button-text="$t('common.done')" @confirm="onRuleDeleteConfirm"
      :message="$t('mock.rule.delete.confirm', { rule: curRule != null ? curRule.name : '' })" />

    <van-dialog :title="$t('mock.rule.title')" :show="showRuleEdit" show-cancel-button
      :cancel-button-text="$t('common.cancel')" @cancel="showRuleEdit = false" :confirm-button-text="$t('common.done')"
      @confirm="onSave(true)">
      <van-form ref="form" labvan-width="90px" v-if="curRule != null">
        <van-field :label="$t('mock.rule.name')" v-model="curRule.name" :placeholder="$t('mock.rule.name')" />
        <van-field rows="4" type="textarea" v-model="curRule.desc" :placeholder="$t('mock.rule.desc')" />
      </van-form>
    </van-dialog>

    <van-dialog :title="$t('mock.record.delete.title')" :show="showRecordDelete" show-cancel-button
      :cancel-button-text="$t('common.cancel')" @cancel="showRecordDelete = false"
      :confirm-button-text="$t('common.done')" @confirm="onRecordDeleteConfirm"
      :message="$t('mock.record.delete.confirm')" />
  </van-row>
</template>

<script lang="ts" setup>
import { Notify } from 'vant'
import { onMounted, PropType, ref, watch } from 'vue'
import { VAceEditor } from 'vue3-ace-editor'
import AceEditor from 'ace-editor-vue3'
import { deleteMockRule, getMockRuleDetail, saveMockRule, searchMockRules } from '../../../common/proxy.api'
import { ProxyMock } from '../../../common/proxy.models'
import { json2map, map2json } from '../../common'
import { useProxyRecordStore } from '../../store/ProxyRecords'

import VueAceEditor from '../components/VueAceEditor.vue'
import 'brace/mode/javascript'
import 'brace/mode/json'
import 'brace/theme/monokai'

const props = defineProps({
  isMock: { type: Boolean, require: false, default: false },
  record: {
    type: Object as PropType<ProxyMock.ProxyRequestRecord>,
    require: false,
    default: null,
  },
})

const recordStore = useProxyRecordStore()
const keyword = ref<string>(null)
const showSearchResult = ref(false)
const rules = ref([])
const curRecord = ref<ProxyMock.ProxyRequestRecord>(null)
const curRecordKey = ref<string>(null)
const showRuleEdit = ref(false)
const showRuleDelete = ref(false)
const showRecordEdit = ref(false)
const showRecordDelete = ref(false)
const isSaving = ref(false)
const curRule = ref<ProxyMock.MockRule>(new ProxyMock.MockRule())
const content = ref<string>('hello world')

let jeOption = {
  mode: 'tree',
  search: false,
  navigationBar: true,
  statusBar: false,
  mainMenuBar: false,
}

let aceOptions = { "showPrintMargin": false }

onMounted(() => {
  curRule.value = new ProxyMock.MockRule()
  curRecord.value = props.record
  content.value = JSON.stringify(curRecord.value)
})

watch(() => props.record, () => {
  curRecord.value = props.record
  content.value = JSON.stringify(curRecord.value)
})

watch(() => keyword, () => {
  fetchPagedMockRules()
})

async function fetchPagedMockRules() {
  try {
    rules.value = await searchMockRules(keyword.value)
    showSearchResult.value = rules.value != null && rules.value.length > 0
  } catch (err) {
    Notify({ message: '未找到匹配的规则', type: 'danger' })
  }
}

function addRule() {
  if (curRecord.value == null) return
  if (curRule.value == null) curRule.value = new ProxyMock.MockRule()
  if (curRule.value.requests == null) curRule.value.requests = new Map()
  curRule.value.requests.set(curRecord.value.url, curRecord.value)
}

function onRuleSelect(rule: ProxyMock.MockRule) {
  curRule.value = rule == null ? new ProxyMock.MockRule() : rule
  showSearchResult.value = false
  fetchMockRuleDetail()
}

async function fetchMockRuleDetail() {
  if (curRule.value.name == null && curRule.value._id == null) return

  try {
    curRule.value = await getMockRuleDetail(curRule.value._id)
    curRule.value.requests = json2map(curRule.value.jsonRequests)
  } catch (err) {
    Notify({ message: '未找到对应规则', type: 'warning', duration: 500 })
  }
}

function onRuleEdit(rule?: ProxyMock.MockRule) {
  showSearchResult.value = false
  curRule.value = rule == null ? new ProxyMock.MockRule() : rule
  showRuleEdit.value = true
}

function onRuleDelete(rule: ProxyMock.MockRule) {
  if (curRule.value.name == null || curRule.value._id == null) return
  curRule.value = rule
  showRuleDelete.value = true
}

async function onRuleDeleteConfirm() {
  try {
    await deleteMockRule(curRule.value._id)
    curRule.value = new ProxyMock.MockRule()
    showRuleDelete.value = false
  } catch (err) {
    Notify({ message: '删除失败', type: 'warning', duration: 500 })
  }
}

function onRuleUpload(rule: ProxyMock.MockRule) {
  curRule.value = rule
}

function onMockSwitchChanged(rule: ProxyMock.MockRule) {
  curRule.value = rule
  onSave(true)
}

async function onSave(isSnap: boolean) {
  if (curRule.value == null) return

  if (curRule.value.name == null) {
    showRuleEdit.value = true
    return
  }

  try {
    curRule.value.jsonRequests = map2json(curRule.value.requests)
    await saveMockRule(curRule.value, isSnap)
    await fetchMockRuleDetail()
    Notify({ message: '规则更新成功', type: 'success', duration: 500 })
  } catch (err) {
    Notify({ message: '规则更新失败', type: 'danger', duration: 500 })
  }
  if (isSnap) showRuleEdit.value = false
}

function onRecordSelected(record: ProxyMock.ProxyRequestRecord) {
  curRecord.value = record
  
  content.value = JSON.stringify(curRecord.value, null, '\t')
  console.log(content.value)
}

function onRecordDelete(key: string) {
  showRecordDelete.value = true
  curRecordKey.value = key
}

function onRecordDeleteCancel() {
  curRecord.value = null
  content.value = null
  curRecordKey.value = null
  showRecordDelete.value = false
}

function onRecordDeleteConfirm() {
  curRule.value.requests.delete(curRecordKey.value)
  curRecord.value = null
  content.value = null
  showRecordDelete.value = false
}
</script>

<style scoped>
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
</style>
