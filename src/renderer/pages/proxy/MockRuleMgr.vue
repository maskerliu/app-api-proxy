<template>
  <van-row class="mgr-content">
    <van-row class="border-bg" ref="topBar" justify="start" style="width: calc(100% - 10px);">
      <van-col style="min-width: 348px; flex-grow: 1; flex-basis: 50%;">
        <van-collapse accordion v-model="activeSearchResult" :border="false" style="background-color: white;">
          <van-collapse-item name="0" :disabled="true" :is-link="false" style="padding-top: 2px;">
            <template #title>
              <van-search show-action :clearable="false" v-model="keyword" style="padding: 0;"
                :placeholder="$t('common.searchPlaceholder')">
                <template #action>
                  <van-icon plain type="primary" name="plus" size="small" @click="onRuleEdit(null)"
                    style="margin-right: 35px;" />
                </template>
              </van-search>
            </template>

            <van-list class="search-result" :error="rules?.length == 0" :error-text="$t('common.searchNoMatch')">
              <van-cell center class="rule-snap-item" is-link v-for="(rule, idx) in rules" :title="rule.name"
                :label="rule.desc" @click="onRuleSelect(rule)">
                <template #value>
                  <div>
                    <van-icon class="iconfont icon-edit" size="16" style="color: #3498db; padding: 5px"
                      @click="onRuleEdit(rule)" />
                    <van-icon class="iconfont icon-delete" size="16" style="color: red; padding: 5px"
                      @click="onRuleDelete(rule)" />
                    <van-icon class="iconfont icon-upload" size="16" style="color: red; padding: 5px"
                      @click="onSave(false)" />
                  </div>
                </template>
              </van-cell>
            </van-list>
          </van-collapse-item>
        </van-collapse>
      </van-col>
      <van-col style="min-width: 380px; flex-grow: 1; flex-basis: 50%;">
        <van-cell :clickable="false" center :title="`[${curRule?.name == null ? $t('mock.rule.name') : curRule?.name}]`"
          style="padding: 5px 10px;">
          <template #icon v-if="curRule._id != null">
            <van-icon class="iconfont icon-cancel" size="20" style="color: red; margin-right: 10px;"
              @click="onRuleSelect(null)" />
          </template>
          <template #label>
            <span style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              {{ curRule?.desc == null ? $t('mock.rule.desc') : curRule.desc }}
            </span>
          </template>
          <template #value>
            <van-button plain type="primary" size="small" @click="onRuleEdit(curRule)" :disabled="curRule._id == null">
              <van-icon class="iconfont icon-edit" size="14" />
            </van-button>
            <van-button plain type="danger" size="small" @click="onRuleDelete(curRule)" :disabled="curRule._id == null"
              style="margin-left: 10px;">
              <van-icon class="iconfont icon-delete" size="14" style="color: red;" />
            </van-button>
            <van-button plain type="primary" size="small" @click="onSave(false)" :disabled="curRule._id == null"
              style="margin-left: 10px;">
              <van-icon class="iconfont icon-cloud-sync" size="14" />
            </van-button>
          </template>
          <template #right-icon>
            <van-switch v-model="curRule.isMock" style="margin: 0 35px 0 10px;" @change="onMockSwitchChanged(curRule)"
              :disabled="curRule._id == null" />
          </template>
        </van-cell>
      </van-col>
    </van-row>
    <van-row :style="{ width: '100%', height: 'calc(100% - 10px - ' + topBarHeight + 'px)' }">
      <van-col class="border-bg" style="width: 300px; height: calc(100% - 10px);">
        <van-list v-if="curRule != null && curRule.requests != null">
          <van-cell center v-for="record in [...curRule.requests.values()]" @click="onRecordSelected(record)" clickable
            is-link>
            <template #title>
              <div class="record-snap">{{ record.url }}</div>
            </template>
            <template #label>
              <van-tag plain mark :type="record.statusCode == 200 ? 'success' : 'danger'">
                [http]{{ record.statusCode }}
              </van-tag>
              <van-tag plain mark style="margin-left: 5px"
                :type="record.responseData?.code == 8000 ? 'success' : 'danger'">
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
        <van-button type="primary" size="mini" icon="exchange" @click="addRecord" />
      </van-col>
      <van-col style="height: calc(100% - 10px); flex: 1; margin: 8px 5px 0 5px;">
        <vue-ace-editor ref="aceEditor" :read-only="false" :options="{ maxLines: topBarHeight > 100 ? 35 : 43 }"
          :data="JSON.stringify(curRecord, null, '\t')" />
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
import { showNotify, Row } from 'vant'
import { onMounted, onUnmounted, PropType, ref, watch } from 'vue'
import { deleteMockRule, getMockRuleDetail, saveMockRule, searchMockRules } from '../../../common/proxy.api'
import { ProxyMock } from '../../../common/proxy.models'
import { json2map, map2json } from '../../common'
import VueAceEditor from '../components/VueAceEditor.vue'
import { windowHeight } from 'vant/lib/utils'


const props = defineProps({
  isMock: { type: Boolean, require: false, default: false },
  record: {
    type: Object as PropType<ProxyMock.ProxyRequestRecord>,
    require: false,
    default: null,
  },
})
const topBar = ref<typeof Row>()
const keyword = ref<string>('')
const activeSearchResult = ref<string>('-1')
const rules = ref<Array<ProxyMock.MockRule>>(null)
const curRecord = ref<ProxyMock.ProxyRequestRecord>(null)
const curRecordKey = ref<string>(null)
const showRuleEdit = ref(false)
const showRuleDelete = ref(false)
const showRecordDelete = ref(false)
const curRule = ref<ProxyMock.MockRule>(new ProxyMock.MockRule())
const content = ref<string>('')
const windowWidth = ref<number>(0)
const topBarHeight = ref<number>(0)
const aceEditor = ref<typeof VueAceEditor>()

onMounted(() => {
  window.onresize = () => {
    windowWidth.value = document.body.clientWidth
    topBarHeight.value = topBar.value.$el.offsetHeight
  }
  windowWidth.value = document.body.clientWidth
  topBarHeight.value = topBar.value.$el.offsetHeight
  curRule.value = new ProxyMock.MockRule()
  curRecord.value = props.record
  content.value = JSON.stringify(curRecord.value, null, '\t')
})

onUnmounted(() => {
  window.onresize = null
})

watch(() => topBarHeight.value, () => {
  console.log(topBarHeight.value)
  let maxLines = document.body.clientWidth - topBar.value.$el.offsetHeight
  console.log(maxLines / 15)
  if (topBarHeight.value > 100) {
    // aceEditor.value.updateOptions()
  }
})

watch(() => props.record, () => {
  curRecord.value = props.record
  content.value = JSON.stringify(curRecord.value, null, '\t')
})

watch(() => keyword.value, () => {
  if (keyword.value == '') {
    activeSearchResult.value = '-1'
    return
  }
  fetchPagedMockRules()
  activeSearchResult.value = '0'
})

async function fetchPagedMockRules() {
  try {
    rules.value = await searchMockRules(keyword.value)
  } catch (err) {
    showNotify({ message: '未找到匹配的规则', type: 'danger', duration: 800 })
  }
}

function addRecord() {
  if (curRecord.value == null) return
  if (curRule.value == null) curRule.value = new ProxyMock.MockRule()
  if (curRule.value.requests == null) curRule.value.requests = new Map()

  curRecord.value = JSON.parse(content.value)
  curRule.value.requests.set(curRecord.value.url, curRecord.value)
}

function onRuleSelect(rule: ProxyMock.MockRule) {
  if (rule != null) {
    curRule.value = rule
    fetchMockRuleDetail()
  } else {
    let requests = curRule.value.requests
    curRule.value = new ProxyMock.MockRule()
    curRule.value.requests
    curRule.value.requests = requests
    content.value = ''
  }
  keyword.value = ''
  activeSearchResult.value = '-1'
}

async function fetchMockRuleDetail() {
  if (curRule.value.name == null && curRule.value._id == null) return

  try {
    curRule.value = await getMockRuleDetail(curRule.value._id)
    curRule.value.requests = json2map(curRule.value.jsonRequests)
  } catch (err) {
    showNotify({ message: '未找到对应规则', type: 'warning', duration: 1000 })
  }
}

function onRuleEdit(rule?: ProxyMock.MockRule) {
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
    showNotify({ message: '删除失败', type: 'warning', duration: 1000 })
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
  console.log(curRule.value)
  if (curRule.value == null || curRule.value.name == null) return

  try {
    curRule.value.jsonRequests = map2json(curRule.value.requests)
    curRule.value._id = await saveMockRule(curRule.value, isSnap)
    await fetchMockRuleDetail()
    showNotify({ message: '规则更新成功', type: 'success', duration: 500 })
  } catch (err) {
    showNotify({ message: '规则更新失败', type: 'danger', duration: 1200 })
  }
  if (isSnap) showRuleEdit.value = false
}

function onRecordSelected(record: ProxyMock.ProxyRequestRecord) {
  curRecord.value = record

  content.value = JSON.stringify(curRecord.value, null, '\t')
  // console.log(content.value)
}

function onRecordDelete(key: string) {
  showRecordDelete.value = true
  curRecordKey.value = key
}

function onRecordDeleteCancel() {
  curRecord.value = null
  content.value = ''
  curRecordKey.value = null
  showRecordDelete.value = false
}

function onRecordDeleteConfirm() {
  curRule.value.requests.delete(curRecordKey.value)
  curRecord.value = null
  content.value = ''
  showRecordDelete.value = false
}
</script>

<style scoped>
.mgr-content {
  width: 80vw;
  min-width: 375px;
  height: 100vh;
  overflow: hidden;
  background: #ebecef;
}

.search-result {
  min-width: 200px;
  height: 50vh;
  background: white;
  overflow-y: scroll;
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
</style>
