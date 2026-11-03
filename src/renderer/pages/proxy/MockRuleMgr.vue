<template>
  <van-row class="mgr-content">
    <van-row class="border-bg top-bar" justify="start" style="width: calc(100% - 10px);"
      :style="{ paddingTop: isWeb ? '0' : '10px' }">
      <van-col class="rule-search-col">
        <van-popover v-model:show="showSearchResult" trigger="manual" placement="bottom-start" :show-arrow="false"
          :offset="[0, 2]">
          <template #reference>
            <div ref="searchBox" style="width: 100%;" @click="onSearchBoxClick">
              <van-search show-action :clearable="false" v-model="keyword" style="padding: 0;"
                :placeholder="$t('common.searchPlaceholder')">
                <template #action>
                  <van-icon plain type="primary" name="plus" size="small" @click.stop="onRuleEdit(null)"
                    style="margin-right: 35px;" />
                </template>
              </van-search>
            </div>
          </template>

          <van-list class="search-result" :style="searchWidth > 0 ? { width: searchWidth + 'px' } : null"
            :error="rules?.length == 0" :error-text="$t('common.searchNoMatch')">
            <van-cell center class="rule-snap-item1" is-link v-for="(rule, idx) in rules" :title="rule.name"
              :label="rule.desc" @click="onRuleSelect(rule)">
              <template #value>
                <div>
                  <van-icon class="iconfont icon-edit" size="16" style="color: #3498db; padding: 5px"
                    @click.stop="onRuleEdit(rule)" />
                  <van-icon class="iconfont icon-delete" size="16" style="color: red; padding: 5px"
                    @click.stop="onRuleDelete(rule)" />
                  <van-icon class="iconfont icon-upload" size="16" style="color: red; padding: 5px"
                    @click.stop="onSave" />
                </div>
              </template>
            </van-cell>
          </van-list>
        </van-popover>
      </van-col>
      <van-col class="rule-head-col">
        <van-cell :clickable="false" center :title="`[${curRule?.name == null ? $t('mock.rule.name') : curRule?.name}]`"
          style="padding: 5px 10px;" :title-style="{ flexGrow: 1.2 }" value-class="rule-mgr-cell-value">
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
    <van-row class="mgr-body">
      <van-list class="border-bg record-list">
        <van-cell center v-for="record in [...curRule.requests.values()]" @click="onRecordSelected(record)"
          v-if="curRule != null && curRule.requests != null" clickable is-link>
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
      <van-col class="record-actions" style="padding-top: 50px">
        <van-button type="primary" size="mini" icon="exchange" @click="addRecord" />
      </van-col>

      <van-col class="rule-editor-col">
        <vue-ace-editor :read-only="false" :fold="false" v-model:data="content" />
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
import { showNotify } from 'vant'
import { inject, onBeforeUnmount, onMounted, Ref, ref, watch } from 'vue'
import { ProxyMock, deleteMockRule, getActiveMockRule, getMockRuleDetail, saveMockRule, searchMockRules } from '@shared'
import { json2map, map2json } from '../../common'
import { ProxyRecordStore } from '../../store'
import VueAceEditor from '../components/VueAceEditor.vue'

const recordStore = ProxyRecordStore()
const searchBox = ref<HTMLElement>()
const keyword = ref<string>('')
const showSearchResult = ref<boolean>(false)
const searchWidth = ref<number>(0)
const rules = ref<Array<ProxyMock.MockRule>>(null)
const curRecordKey = ref<string>(null)
const showRuleEdit = ref(false)
const showRuleDelete = ref(false)
const showRecordDelete = ref(false)
const curRule = ref<ProxyMock.MockRule>(new ProxyMock.MockRule())
const content = ref<string>(null)

let detailTask: Promise<void> = null

const withCurRecord = inject<Ref<boolean>>('withCurRecord')

const isWeb = window.isWeb

onMounted(() => {
  window.addEventListener('resize', updateSearchWidth)
  updateSearchWidth()

  curRule.value = new ProxyMock.MockRule()
  content.value = withCurRecord.value ? JSON.stringify(recordStore.curRecord(), null, '\t') : null
  selectActiveMockRule()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateSearchWidth)
})

watch(showSearchResult, (show) => {
  if (show) updateSearchWidth()
})

function updateSearchWidth() {
  searchWidth.value = searchBox.value?.offsetWidth ?? 0
}

function onSearchBoxClick() {
  if (keyword.value != '' && rules.value?.length > 0) showSearchResult.value = true
}

watch(withCurRecord, (isWithRecord) => {
  content.value = isWithRecord ? JSON.stringify(recordStore.curRecord(), null, '\t') : null
})

watch(keyword, async () => {
  if (keyword.value == '') {
    showSearchResult.value = false
    rules.value = null
    return
  }

  const kw = keyword.value
  try {
    const result = await searchMockRules(kw)
    if (keyword.value !== kw) return
    rules.value = result ?? []
  } catch (err) {
    if (keyword.value !== kw) return
    rules.value = []
    showNotify({ message: '未找到匹配的规则', type: 'danger', duration: 800 })
  }
  showSearchResult.value = true
})

async function addRecord() {
  if (curRule.value?._id == null) {
    showNotify({ message: '请先选择Mock规则', type: 'warning', duration: 800 })
    return
  }

  let record: ProxyMock.ProxyRequestRecord
  try {
    record = JSON.parse(content.value)
  } catch (err) {
    showNotify({ message: '数据格式错误', type: 'danger', duration: 800 })
    return
  }
  if (record?.url == null) {
    showNotify({ message: '请求数据缺少url字段', type: 'danger', duration: 800 })
    return
  }

  if (detailTask != null) await detailTask
  if (curRule.value.requests == null) curRule.value.requests = new Map()
  curRule.value.requests.set(record.url, record)
  await onSave(false)
}

function onRuleSelect(rule: ProxyMock.MockRule) {
  if (rule != null) {
    curRule.value = rule
    curRule.value.requests = new Map()
    detailTask = fetchMockRuleDetail()
  } else {
    curRule.value = new ProxyMock.MockRule()
    detailTask = null
  }
  keyword.value = ''
  showSearchResult.value = false
}

async function selectActiveMockRule() {
  try {
    const ruleId = await getActiveMockRule()
    // 用户已手动选择了规则时不再覆盖
    if (ruleId && curRule.value._id == null) onRuleSelect({ _id: ruleId } as ProxyMock.MockRule)
  } catch (err) {
    // 当前没有开启的规则时保持默认空规则
  }
}

async function fetchMockRuleDetail() {
  if (curRule.value.name == null && curRule.value._id == null) return

  try {
    curRule.value = await getMockRuleDetail(curRule.value._id)
    curRule.value.requests = curRule.value.jsonRequests == null ? new Map() : json2map(curRule.value.jsonRequests)
  } catch (err) {
    showNotify({ message: '未找到对应规则', type: 'warning', duration: 1000 })
  }
}

function onRuleEdit(rule?: ProxyMock.MockRule) {
  curRule.value = rule == null ? new ProxyMock.MockRule() : rule
  showSearchResult.value = false
  showRuleEdit.value = true
}

function onRuleDelete(rule: ProxyMock.MockRule) {
  if (rule == null || rule._id == null) return
  curRule.value = rule
  showSearchResult.value = false
  showRuleDelete.value = true
}

async function onRuleDeleteConfirm() {
  try {
    await deleteMockRule(curRule.value._id)
    curRule.value = new ProxyMock.MockRule()
    detailTask = null
    content.value = null
    showRuleDelete.value = false
  } catch (err) {
    showNotify({ message: '删除失败', type: 'warning', duration: 1000 })
  }
}

function onMockSwitchChanged(rule: ProxyMock.MockRule) {
  curRule.value = rule
  onSave(true)
}

async function onSave(onlySnap: boolean = false) {
  if (curRule.value == null || curRule.value.name == null) return

  try {
    curRule.value.jsonRequests = map2json(curRule.value.requests)
    curRule.value._id = await saveMockRule(curRule.value, onlySnap)
    await fetchMockRuleDetail()
    showNotify({ message: '规则更新成功', type: 'success', duration: 500 })
  } catch (err) {
    showNotify({ message: '规则更新失败', type: 'danger', duration: 1200 })
  }
  if (onlySnap) showRuleEdit.value = false
}

function onRecordSelected(record: ProxyMock.ProxyRequestRecord) {
  content.value = JSON.stringify(record, null, '\t')
}

function onRecordDelete(key: string) {
  showRecordDelete.value = true
  curRecordKey.value = key
}

function onRecordDeleteConfirm() {
  curRule.value.requests.delete(curRecordKey.value)
  content.value = null
  showRecordDelete.value = false
}
</script>

<style scoped>
.mgr-content {
  display: flex;
  flex-direction: column;
  width: min(80vw, 1600px);
  min-width: min(375px, 100vw);
  max-width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  /* background: var(--van-gray-1); */
}

.top-bar {
  flex: none;
}

.rule-search-col,
.rule-head-col {
  flex: 1 1 auto;
  min-width: min(348px, 100%);
}

.mgr-body {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
}

.record-list {
  width: min(300px, 34%);
  height: calc(100% - 10px);
}

.rule-editor-col {
  flex: 1 1 auto;
  min-width: 0;
  position: relative;
}

.mgr-content :deep(.van-popover__wrapper) {
  display: block;
  width: 100%;
}

.search-result {
  max-height: 50vh;
  overflow-y: auto;
  overflow-x: hidden;
}

.rule-snap-item {
  width: 100%;
}

.record-snap {
  border-radius: 4px;
  border: 2px #ddd dashed;
  font-size: var(--van-font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
  max-width: 220px;
  display: block;
  direction: rtl;
  margin-bottom: 5px;
}

/* 窄屏下记录列表与编辑区上下排列，避免编辑区被挤到不可用宽度 */
@media (max-width: 640px) {
  .mgr-body {
    flex-direction: column;
  }

  .record-list {
    width: calc(100% - 10px);
    height: 36%;
  }

  .record-actions {
    padding-top: 0 !important;
    display: flex;
    justify-content: center;
    padding-bottom: 5px;
  }

  .rule-editor-col {
    flex: 1 1 0;
    width: 100%;
    min-height: 0;
  }
}
</style>
