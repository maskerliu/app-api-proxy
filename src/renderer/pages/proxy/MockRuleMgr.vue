<template>
  <van-row class="mgr-content">
    <van-row class="border-bg top-bar" justify="start" style="width: calc(100% - 10px);"
      :style="{ paddingTop: isWeb ? '0' : '10px' }">
      <van-col class="rule-search-col">
        <van-popover class="rule-search-popover" v-model:show="showSearchResult" trigger="manual"
          placement="bottom-start" :show-arrow="false" :offset="[0, 2]">
          <template #reference>
            <div ref="searchBox" style="width: 100%;" @click="onSearchBoxClick">
              <van-search class="rule-search" show-action :clearable="false" v-model="keyword" style="padding: 0;"
                :placeholder="$t('common.searchPlaceholder')">
                <template #action>
                  <van-button class="rule-add-btn" plain type="primary" size="small" icon="plus"
                    @click.stop="onRuleEdit(null)" />
                </template>
              </van-search>
            </div>
          </template>

          <OverlayScrollbarsComponent class="search-result"
            :style="searchWidth > 0 ? { width: searchWidth + 'px' } : null" :options="scrollOptions" defer>
            <van-list :error="rules?.length == 0" :error-text="$t('common.searchNoMatch')">
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
          </OverlayScrollbarsComponent>
        </van-popover>
      </van-col>
      <van-col class="rule-head-col">
        <van-cell :clickable="false" center :title="`[${curRule?.name == null ? $t('mock.rule.name') : curRule?.name}]`"
          style="padding: 5px 10px;" :title-style="{ flexGrow: 1.2 }" value-class="rule-mgr-cell-value">
          <template #icon>
            <van-icon class="iconfont icon-cancel" :class="{ 'rule-cancel-disabled': curRule._id == null }" size="20"
              style="margin-right: 10px;" :style="{ color: curRule._id == null ? 'var(--van-gray-5)' : 'red' }"
              @click="onRuleSelect(null)" />
          </template>
          <template #label>
            <span style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              {{ curRule?.desc || $t('mock.rule.desc') }}
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
            <van-button plain type="primary" size="small" @click="onSave" :disabled="curRule._id == null"
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
      <OverlayScrollbarsComponent class="border-bg record-list" :options="scrollOptions" defer>
        <van-list>
          <van-cell center v-for="record in [...curRule.requests.values()]" :key="record.id"
            @click="onRecordSelected(record)" v-if="curRule != null && curRule.requests != null" clickable is-link>
            <template #title>
              <div class="record-snap">{{ record.name || record.url }}</div>
            </template>
            <template #label>
              <van-tag plain :type="effectiveResponse(record).statusCode == 200 ? 'success' : 'danger'">
                [http]{{ effectiveResponse(record).statusCode }}
              </van-tag>
              <van-tag v-if="record.variants.length > 0" plain type="primary" style="margin-left: 5px">
                {{ $t('mock.editor.variantCount', { count: record.variants.length }) }}
              </van-tag>
              <van-tag v-if="record.activeVariantId" plain type="success" style="margin-left: 5px">
                {{ $t('mock.editor.active') }}
              </van-tag>
            </template>
            <template #right-icon>
              <van-button plain type="danger" size="mini" @click.stop="onRecordDelete(record.id)">
                <template #icon>
                  <van-icon class="iconfont icon-delete" />
                </template>
              </van-button>
            </template>
          </van-cell>
          <van-cell v-if="recordHasMore" clickable center @click="loadRecords()">
            <template #title>
              <span class="record-load-more">{{ recordLoading ? '加载中...' : '加载更多' }}</span>
            </template>
          </van-cell>
        </van-list>
      </OverlayScrollbarsComponent>
      <van-col class="record-actions" style="padding-top: 50px">
        <van-icon class="iconfont icon-cloud-sync" :class="{ 'record-save-disabled': !canSaveRecord }" size="16"
          style="color: #3498db; padding: 5px" :title="$t('mock.record.update')" @click="onRecordSave" />
        <van-icon class="iconfont icon-add-rule" size="16" style="color: #3498db; padding: 5px; margin-top: 10px;"
          :title="$t('mock.editor.newRecord')" @click="addRecord" />
      </van-col>

      <van-col class="rule-editor-col">
        <mock-record-editor v-if="draft != null" v-model:record="draft" :dirty="dirty" :saving="saving"
          :new-record="isNew" @save="onRecordSave" />
        <div v-else class="editor-placeholder">{{ $t('mock.editor.noRecord') }}</div>
      </van-col>
    </van-row>

    <van-dialog :title="$t('mock.rule.delete.title')" :show="showRuleDelete" show-cancel-button
      :cancel-button-text="$t('common.cancel')" @cancel="showRuleDelete = false"
      :confirm-button-text="$t('common.done')" @confirm="onRuleDeleteConfirm"
      :message="$t('mock.rule.delete.confirm', { rule: curRule != null ? curRule.name : '' })" />

    <van-dialog :title="$t('mock.rule.title')" :show="showRuleEdit" show-cancel-button
      :cancel-button-text="$t('common.cancel')" @cancel="showRuleEdit = false" :confirm-button-text="$t('common.done')"
      @confirm="onSave">
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
import {
  deleteMockRecord, deleteMockRule, getActiveMockRule, getMockRecords, getMockRuleDetail, ProxyMock,
  saveMockRecord, saveMockRule, searchMockRules, validateMockRecord
} from '@shared'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { showConfirmDialog, showNotify } from 'vant'
import { computed, inject, onBeforeUnmount, onMounted, Ref, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { scrollOptions } from '../../common/scroll'
import { ProxyRecordStore } from '../../store'
import MockRecordEditor from './mock/MockRecordEditor.vue'
import { cloneRecord, prettifyRecordJson, recordFromRequest } from './mock/mock.record'

const { t } = useI18n()
const recordStore = ProxyRecordStore()
const searchBox = ref<HTMLElement>()
const keyword = ref<string>('')
const showSearchResult = ref<boolean>(false)
const searchWidth = ref<number>(0)
const rules = ref<Array<ProxyMock.MockRule>>(null)
const curRecordId = ref<string>(null)
const pendingDeleteId = ref<string>(null)
const showRuleEdit = ref(false)
const showRuleDelete = ref(false)
const showRecordDelete = ref(false)
const curRule = ref<ProxyMock.MockRule>(new ProxyMock.MockRule())
const draft = ref<ProxyMock.MockRecord>(null)
const savedSnapshot = ref<string>('')
const saving = ref(false)
const isNew = ref(false)
const recordOffset = ref(0)
const recordHasMore = ref(false)
const recordLoading = ref(false)

const dirty = computed(() => draft.value != null && !isNew.value && JSON.stringify(draft.value) !== savedSnapshot.value)
const canSaveRecord = computed(() => draft.value != null && !saving.value && (dirty.value || isNew.value))
const effectiveResponse = ProxyMock.effectiveResponse

const RECORD_PAGE_SIZE = 100

let detailTask: Promise<void> = null
let recordLoadSeq = 0

const withCurRecord = inject<Ref<boolean>>('withCurRecord')

const isWeb = window.isWeb

onMounted(() => {
  window.addEventListener('resize', updateSearchWidth)
  updateSearchWidth()

  curRule.value = new ProxyMock.MockRule()
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
  if (isWithRecord && curRule.value?._id != null && draft.value == null) startNewRecord()
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

function startNewRecord() {
  if (curRule.value?._id == null) return
  const source = withCurRecord.value ? recordStore.curRecord() : null
  draft.value = recordFromRequest(curRule.value._id, source)
  savedSnapshot.value = ''
  isNew.value = true
  curRecordId.value = null
}

async function addRecord() {
  if (curRule.value?._id == null) {
    showNotify({ message: t('mock.editor.selectRuleFirst'), type: 'warning', duration: 800 })
    return
  }
  if (!await confirmDiscard()) return
  if (detailTask != null) await detailTask
  startNewRecord()
}

async function onRecordSave() {
  if (curRule.value?._id == null) {
    showNotify({ message: t('mock.editor.selectRuleFirst'), type: 'warning', duration: 800 })
    return
  }
  if (draft.value == null) return
  // 无改动时重复保存会推进 updatedAt，让其他窗口的锁提前失效
  if (!dirty.value && !isNew.value) return

  const issues = validateMockRecord(draft.value)
  if (issues.length > 0) {
    showNotify({ message: t(`mock.editor.validation.${issues[0].code}`), type: 'warning', duration: 1200 })
    return
  }

  if (detailTask != null) await detailTask
  saving.value = true
  try {
    const expectedUpdatedAt = isNew.value ? null : draft.value.updatedAt
    const result = await saveMockRecord(draft.value, expectedUpdatedAt)
    const saved = cloneRecord(draft.value)
    saved.id = result.id
    saved.updatedAt = result.updatedAt

    if (curRule.value.requests == null) curRule.value.requests = new Map()
    curRule.value.requests.set(saved.id, saved)
    curRecordId.value = saved.id
    draft.value = saved
    savedSnapshot.value = JSON.stringify(saved)
    isNew.value = false
    showNotify({ message: t('mock.editor.saveSuccess'), type: 'success', duration: 600 })
  } catch (err: any) {
    const message = String(err ?? '')
    showNotify({
      message: message.indexOf('已被其他人修改') >= 0 ? t('mock.editor.saveConflict') : t('mock.editor.saveFailed'),
      type: 'danger',
      duration: 1500
    })
  } finally {
    saving.value = false
  }
}

async function confirmDiscard(): Promise<boolean> {
  if (!dirty.value) return true
  try {
    await showConfirmDialog({
      title: t('mock.editor.unsavedTitle'),
      message: t('mock.editor.unsavedConfirm'),
      confirmButtonText: t('common.done'),
      cancelButtonText: t('common.cancel')
    })
    return true
  } catch (err) {
    return false
  }
}

async function onRuleSelect(rule: ProxyMock.MockRule) {
  // 未选中规则时取消按钮置灰不可用
  if (rule == null && curRule.value?._id == null) return
  if (!await confirmDiscard()) return

  if (rule != null) {
    curRule.value = rule
    curRule.value.requests = new Map()
    detailTask = fetchMockRuleDetail()
  } else {
    curRule.value = new ProxyMock.MockRule()
    detailTask = null
  }
  curRecordId.value = null
  draft.value = null
  savedSnapshot.value = ''
  isNew.value = false
  recordOffset.value = 0
  recordHasMore.value = false
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

  const ruleId = curRule.value._id
  try {
    const detail = await getMockRuleDetail(ruleId)
    // 快速切换规则时丢弃过期响应，避免覆盖后选中的规则
    if (curRule.value?._id !== ruleId) return
    curRule.value = detail
    curRule.value.requests = new Map()
    curRecordId.value = null
    draft.value = null
    savedSnapshot.value = ''
    isNew.value = false
    await loadRecords(true)
    if (withCurRecord.value && draft.value == null) startNewRecord()
  } catch (err) {
    if (curRule.value?._id !== ruleId) return
    showNotify({ message: '未找到对应规则', type: 'warning', duration: 1000 })
  }
}

// 记录按 createdAt 分页加载，避免大规则一次性读全量
async function loadRecords(reset: boolean = false) {
  const rule = curRule.value
  if (rule?._id == null) return
  if (!reset && (recordLoading.value || !recordHasMore.value)) return

  const seq = ++recordLoadSeq
  if (reset) {
    recordOffset.value = 0
    recordHasMore.value = false
    if (rule.requests == null) rule.requests = new Map()
    else rule.requests.clear()
  }

  recordLoading.value = true
  try {
    const page = await getMockRecords(rule._id, recordOffset.value, RECORD_PAGE_SIZE)
    if (seq !== recordLoadSeq || curRule.value?._id !== rule._id) return
    if (rule.requests == null) rule.requests = new Map()
    for (const record of page?.items ?? []) rule.requests.set(record.id, record)
    recordOffset.value += page?.items?.length ?? 0
    recordHasMore.value = page?.hasMore === true
  } catch (err) {
    if (seq === recordLoadSeq) showNotify({ message: '记录加载失败', type: 'danger', duration: 1200 })
  } finally {
    if (seq === recordLoadSeq) recordLoading.value = false
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
    curRecordId.value = null
    draft.value = null
    savedSnapshot.value = ''
    isNew.value = false
    recordOffset.value = 0
    recordHasMore.value = false
    showRuleDelete.value = false
  } catch (err) {
    showNotify({ message: '删除失败', type: 'warning', duration: 1000 })
  }
}

function onMockSwitchChanged(rule: ProxyMock.MockRule) {
  curRule.value = rule
  onSave()
}

async function onSave() {
  if (curRule.value == null || curRule.value.name == null) return

  const isNewRule = curRule.value._id == null
  try {
    // 只保存规则元信息，请求记录由 onRecordSave 单独落盘
    curRule.value._id = await saveMockRule(curRule.value)
    // 已有规则无需重载记录，避免切换开关/改名时丢掉已加载的分页
    if (isNewRule) await fetchMockRuleDetail()
    showNotify({ message: '规则更新成功', type: 'success', duration: 500 })
  } catch (err) {
    showNotify({ message: '规则更新失败', type: 'danger', duration: 1200 })
  }
  showRuleEdit.value = false
}

async function onRecordSelected(record: ProxyMock.MockRecord) {
  if (record.id === curRecordId.value && !isNew.value) return
  if (!await confirmDiscard()) return
  curRecordId.value = record.id
  draft.value = prettifyRecordJson(cloneRecord(record))
  // 快照取自格式化后的草稿，仅改变展示时不会出现“未保存”
  savedSnapshot.value = JSON.stringify(draft.value)
  isNew.value = false
}

function onRecordDelete(id: string) {
  pendingDeleteId.value = id
  showRecordDelete.value = true
}

async function onRecordDeleteConfirm() {
  const id = pendingDeleteId.value
  pendingDeleteId.value = null
  showRecordDelete.value = false
  if (curRule.value?._id == null || id == null) return

  try {
    await deleteMockRecord(id)
    curRule.value.requests?.delete(id)
    // 删除的是已加载区间内的记录，游标同步回退一位，避免下次翻页漏读
    recordOffset.value = Math.max(0, recordOffset.value - 1)
    if (curRecordId.value === id) {
      curRecordId.value = null
      draft.value = null
      savedSnapshot.value = ''
      isNew.value = false
    }
  } catch (err) {
    showNotify({ message: '删除失败', type: 'warning', duration: 1000 })
  }
}
</script>

<style scoped>
.mgr-content {
  display: flex;
  flex-direction: column;
  /* van-row 默认 wrap，列方向下高度超出弹层时会把主体换到右侧列并移出可视区 */
  flex-wrap: nowrap;
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
  /* 基准宽度固定为 0，避免右侧规则名称/描述变长时挤压搜索框 */
  flex: 1 1 0;
  min-width: min(348px, 100%);
}

/* 与右侧两行高度的规则信息居中对齐 */
.rule-search-col {
  display: flex;
  align-items: center;
}

.mgr-body {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  /* 编辑器列的内容宽度较大，允许换行会把编辑区挤到列表下方并被弹层裁掉 */
  flex-wrap: nowrap;
}

.record-list {
  width: min(300px, 34%);
  height: calc(100% - 10px);
}

.record-load-more {
  color: var(--van-primary-color);
  font-size: var(--van-font-size-sm);
}

/* 保存/新增记录按钮在记录与编辑器之间纵向排列 */
.record-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.rule-editor-col {
  display: flex;
  flex-direction: column;
  /* flex-basis 归零，避免内容固有宽度参与换行判断 */
  flex: 1 1 0;
  min-width: 0;
  height: calc(100% - 10px);
  /* 左侧列表有 5px 外边距，这里同步下移，两侧底边才能对齐 */
  margin-top: 5px;
  padding: 0 5px;
  position: relative;
}

.editor-placeholder {
  margin: auto;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

.record-save-disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.mgr-content :deep(.van-popover__wrapper) {
  display: block;
  width: 100%;
}

/* 规则名/描述过长时收缩并省略，避免把右侧操作按钮挤出可视区 */
.rule-cancel-disabled {
  cursor: not-allowed;
}

.rule-head-col :deep(.van-cell__title) {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 结果面板只淡入，避免默认 zoom 缩放在宽面板上产生横向拉伸 */
:global(.rule-search-popover.van-popover-zoom-enter-from),
:global(.rule-search-popover.van-popover-zoom-leave-active) {
  transform: none;
}

/* 收窄 search action 的可点击区域，避免 + 按钮被撑成长条 */
.rule-search :deep(.van-search__action) {
  display: flex;
  align-items: stretch;
  align-self: stretch;
  height: var(--van-search-input-height);
  padding: 0 4px;
  cursor: default;
}

.rule-search :deep(.van-search__action:active) {
  background-color: transparent;
}

/* 高度直接取自搜索输入框，保证严格一致 */
.rule-add-btn {
  flex: none;
  box-sizing: border-box;
  width: var(--van-search-input-height);
  height: 32px;
  padding: 0;
}

.search-result {
  max-height: 50vh;
}

.rule-snap-item {
  width: 100%;
}

.record-snap {
  border-radius: 4px;
  /* border: 1px #ddd dashed; */
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
    flex-direction: row;
    justify-content: center;
    padding-bottom: 5px;
  }

  .rule-editor-col {
    flex: 1 1 0;
    width: 100%;
    height: auto;
    min-height: 0;
    padding: 0;
  }
}
</style>
