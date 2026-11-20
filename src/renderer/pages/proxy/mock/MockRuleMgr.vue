<template>
  <van-row class="mgr-content">
    <van-row class="border-bg top-bar" justify="start" style="width: calc(100% - var(--app-card-gutter) * 2);"
      :style="{ paddingTop: isWeb ? '0' : 'calc(var(--van-font-size-md) * 0.5)' }">
      <van-col class="rule-search-col" :style="searchColStyle">
        <van-popover class="rule-search-popover" v-model:show="showSearchResult" trigger="manual"
          placement="bottom-start" :show-arrow="false" :offset="[0, 2]">
          <template #reference>
            <div ref="searchBox" style="width: 100%;" @click="onSearchBoxClick">
              <van-search class="rule-search" show-action :clearable="false" v-model="keyword"
                :placeholder="$t('common.searchPlaceholder')">
                <template #action>
                  <van-button class="btn-icon-only" plain type="primary" size="small" icon="plus"
                    @click.stop="onRuleEdit(null)" />
                </template>
              </van-search>
            </div>
          </template>

          <OverlayScrollbarsComponent class="search-result"
            :style="searchWidth > 0 ? { width: searchWidth + 'px' } : null" :options="scrollOptions" defer>
            <van-list :error="rules?.length == 0" :error-text="$t('common.searchNoMatch')">
              <van-cell center class="rule-snap-item" is-link v-for="(rule, idx) in rules" @click="onRuleSelect(rule)">
                <template #title>
                  <van-row class="result-title-row" align="center" :wrap="false">
                    <span class="result-name truncate" v-tip="rule.name">{{ rule.name }}</span>
                    <span class="result-desc truncate" v-tip="rule.desc">{{ rule.desc }}</span>
                  </van-row>
                </template>
                <template #value>
                  <div>
                    <van-icon class="iconfont icon-edit icon-action result-action-icon result-action-icon--primary"
                      @click.stop="onRuleEdit(rule)" />
                    <van-icon class="iconfont icon-delete icon-action result-action-icon result-action-icon--danger"
                      @click.stop="onRuleDelete(rule)" />
                  </div>
                </template>
              </van-cell>
            </van-list>
          </OverlayScrollbarsComponent>
        </van-popover>
      </van-col>
      <van-col class="rule-head-col">
        <van-cell :clickable="false" center class="rule-head-cell" :title-style="{ flexGrow: 1.2 }"
          value-class="rule-mgr-cell-value">
          <template #icon>
            <van-icon class="iconfont icon-cancel rule-cancel-icon"
              :class="{ 'rule-cancel-disabled': curRule._id == null }"
              :style="{ color: curRule._id == null ? 'var(--van-gray-5)' : 'var(--van-danger-color)' }"
              @click="onRuleSelect(null)" />
          </template>
          <template #title>
            <van-row class="rule-head-title" align="center" :wrap="false">
              <span class="rule-head-name truncate" v-tip="curRule?.name">[{{ curRule?.name == null ? $t('mock.rule.name') : curRule?.name }}]</span>
              <van-tag v-if="curRule._id != null" class="rule-state-tag" plain
                :type="curRule.isMock ? 'success' : 'warning'" v-tip="mockStateTip">
                {{ curRule.isMock ? $t('mock.rule.enabled') : $t('mock.rule.disabled') }}
              </van-tag>
              <span class="rule-head-desc truncate" v-tip="curRule?.desc">{{ curRule?.desc || $t('mock.rule.desc') }}</span>
            </van-row>
          </template>
          <template #value>
            <div class="rule-head-actions">
              <van-button class="btn-icon-only" plain type="primary" size="small" @click="onRuleEdit(curRule)"
                :disabled="curRule._id == null">
                <van-icon class="iconfont icon-edit btn-action-icon" />
              </van-button>
              <van-button class="btn-icon-only" plain type="danger" size="small" @click="onRuleDelete(curRule)"
                :disabled="curRule._id == null">
                <van-icon class="iconfont icon-delete btn-action-icon btn-action-icon--danger" />
              </van-button>
              <van-button class="btn-icon-only" plain type="primary" size="small" @click="onSave"
                :disabled="curRule._id == null">
                <van-icon class="iconfont icon-cloud-sync btn-action-icon" />
              </van-button>
              <!-- 导入常驻占位但不启用：写库端点已接上仓库（R4C-18），缺的是弹窗与结果页接线（R4C-25~27）和「导入即生效」的验收（R4C-17），接上时只换 handler 与提示 -->
              <van-button class="btn-icon-only" plain type="primary" size="small" disabled
                v-tip="$t('mock.import.disabledTip')">
                <van-icon class="iconfont icon-import btn-action-icon" />
              </van-button>
              <!-- 导出不依赖当前场景（可选全部场景），所以按钮不置灰；未选中场景时对话框里禁掉「仅当前场景」 -->
              <van-button class="btn-icon-only" plain type="primary" size="small"
                v-tip="$t('mock.export.dialogTitle')" @click="onExportOpen">
                <van-icon class="iconfont icon-export btn-action-icon" />
              </van-button>
            </div>
          </template>
          <template #right-icon>
            <van-row class="rule-mock-switch" v-tip="mockStateTip" align="center" :wrap="false">
              <span class="rule-mock-switch-label">{{ $t('mock.rule.mockLabel') }}</span>
              <van-switch v-model="curRule.isMock" @change="onMockSwitchChanged(curRule)"
                :disabled="curRule._id == null || (curRule.limitState?.reject === true && !curRule.isMock)" />
            </van-row>
          </template>
        </van-cell>
      </van-col>
    </van-row>
    <van-row class="mgr-body">
      <van-col class="record-pane">
        <van-row class="record-pane-head" align="center" justify="space-between" :wrap="false">
          <span class="record-pane-title">{{ $t('mock.records') }}</span>
          <van-button class="btn-icon-only" plain type="primary" size="mini" icon="plus"
            :disabled="curRule._id == null" @click="addRecord"></van-button>
        </van-row>
        <van-row class="record-filter" align="center" :wrap="false">
          <van-field v-model="recordKeyword" class="control-field record-field" clearable
            :placeholder="$t('mock.list.searchPlaceholder')">
            <template #left-icon>
              <van-icon name="search" size="var(--van-font-size-md)" />
            </template>
          </van-field>
          <mini-select :model-value="recordSort" class="record-sort" :options="sortOptions" align="end"
            @update:model-value="onSortChange" />
        </van-row>
        <van-notice-bar v-if="curRule.limitState?.warn" class="record-limit" wrapable :scrollable="false"
          :class="{ 'is-reject': curRule.limitState.reject }" :text="curRule.limitState.reject
            ? $t('mock.list.limitReject', { count: curRule.limitState.count, limit: MOCK_RECORD_REJECT_LIMIT })
            : $t('mock.list.limitWarn', { count: curRule.limitState.count })" />
        <OverlayScrollbarsComponent ref="recordListRef" class="border-bg record-list" :options="scrollOptions" defer>
          <van-empty v-if="curRule._id != null && recordTotal === 0 && !isNew && !recordLoading" image="search"
            image-size="64" :description="$t('mock.recordsEmpty')" />
          <van-empty v-else-if="recordTotal > 0 && recordList.length === 0" image="search" image-size="64"
            :description="$t('mock.list.noMatch')">
            <van-button size="mini" plain type="primary" @click="recordKeyword = ''">
              {{ $t('mock.list.clearFilter') }}
            </van-button>
          </van-empty>
          <van-list>
            <van-cell v-if="isNew && draft != null" center clickable class="record-row record-draft-row"
              @click="recordEditorRef?.focusField({ code: 'urlEmpty', field: 'url' })">
              <template #title>
                <div class="record-line">
                  <span class="record-title truncate">{{ draft.name || $t('mock.editor.newRecord') }}</span>
                  <van-tag plain type="warning" class="record-draft-tag">{{ $t('mock.editor.unsaved') }}</van-tag>
                </div>
              </template>
              <!-- v-if 必须挂在插槽本身：挂在里面的 div 上时 Vant 仍会渲染空的 label 节点，
                   那 5.6px 上边距会把 title 列撑高，居中后文字与右侧 × 就错开了 -->
              <template v-if="draft.url" #label>
                <div class="record-line record-line--meta">
                  <span class="record-path mono truncate">{{ draft.url }}</span>
                </div>
              </template>
              <template #right-icon>
                <van-icon name="cross" class="icon-action record-action record-action--muted" @click.stop="clearEditorState" />
              </template>
            </van-cell>
            <van-cell center clickable v-for="row in recordRows" :key="row.record.id"
              @click="onRecordSelected(row.record)" :data-record-id="row.record.id" class="list-row record-row"
              :class="{ 'is-selected': row.record.id === curRecordId, 'record-flash': row.record.id === flashRecordId }">
              <template #title>
                <div class="record-line">
                  <van-tag v-if="row.summary" :type="methodTagType(row.summary.method)" class="method-square"
                    v-tip="row.summary.method">
                    {{ row.summary.method.charAt(0) }}
                  </van-tag>
                  <span class="record-title truncate" v-tip="row.titleHint">
                    <span class="record-title-text truncate">{{ row.title }}</span>
                  </span>
                </div>
              </template>
              <template #label>
                <div class="record-line record-line--meta">
                  <span v-if="row.servesVariant" class="record-meta truncate"
                    v-tip="$t('mock.editor.servesVariantHint', { name: row.servingVariantName || $t('mock.editor.variantName') })">
                    {{ $t(row.servingLabelKey, { name: row.servingVariantName }) }}
                  </span>
                  <van-tag v-if="row.warning" plain :type="warningTagType(row.warning.type)" class="record-warn"
                    v-tip="warningTitle(row.record)">
                    <van-icon name="warning-o" />
                    {{ $t(warningLabelKey(row.warning.type)) }}
                    <template v-if="row.warningExtra > 0">+{{ row.warningExtra }}</template>
                  </van-tag>
                  <span class="record-status-group">
                    <van-tag v-if="row.summary" plain :type="levelTagType(row.summary.level)" class="record-level"
                      v-tip="$t(`mock.match.levelHint.${row.summary.level}`)">
                      {{ $t(`mock.match.level.${row.summary.level}`) }}
                    </van-tag>
                    <van-tag plain :type="row.statusOk ? 'success' : 'danger'" class="record-status mono"
                      v-tip="`HTTP ${row.statusCode}`">
                      {{ row.statusCode }}
                    </van-tag>
                  </span>
                </div>
              </template>
              <template #right-icon>
                <van-icon class="iconfont icon-delete icon-action record-action record-action--danger"
                  @click.stop="onRecordDelete(row.record.id)" />
              </template>
            </van-cell>
            <van-cell v-if="recordHasMore" clickable center class="record-load-more-cell" @click="loadRecords()">
              <template #title>
                <span class="record-load-more">
                  {{ recordLoading ? $t('common.loading') : $t('mock.loadMore') }}
                </span>
              </template>
            </van-cell>
          </van-list>
        </OverlayScrollbarsComponent>
      </van-col>

      <van-col class="rule-editor-col">
        <mock-record-editor v-if="draft != null" ref="recordEditorRef" v-model:record="draft" :dirty="dirty"
          :saving="saving" :new-record="isNew" @save="onRecordSave" />
        <van-empty v-else class="editor-placeholder" image="search" image-size="96"
          :description="curRule._id == null ? $t('mock.editor.noRule') : $t('mock.editor.noRecord')" />
      </van-col>
    </van-row>

    <van-dialog :title="$t('mock.rule.delete.title')" v-model:show="showRuleDelete" show-cancel-button
      :cancel-button-text="$t('common.cancel')" :confirm-button-text="$t('common.done')" @confirm="onRuleDeleteConfirm"
      :message="$t('mock.rule.delete.confirm', { rule: curRule != null ? curRule.name : '' })" />

    <van-dialog :title="$t('mock.rule.title')" v-model:show="showRuleEdit" show-cancel-button
      :cancel-button-text="$t('common.cancel')" :confirm-button-text="$t('common.done')"
      :before-close="onRuleEditClose">
      <van-form ref="form" label-width="6.9em" v-if="curRule != null">
        <van-field :label="$t('mock.rule.name')" v-model="curRule.name" :placeholder="$t('mock.rule.name')" />
        <van-field rows="4" type="textarea" v-model="curRule.desc" :placeholder="$t('mock.rule.desc')" />
      </van-form>
    </van-dialog>

    <van-dialog :title="$t('mock.record.delete.title')" v-model:show="showRecordDelete" show-cancel-button
      :cancel-button-text="$t('common.cancel')" :confirm-button-text="$t('common.done')"
      @confirm="onRecordDeleteConfirm" :message="$t('mock.record.delete.confirm')" />

    <van-dialog v-model:show="showConflict" :title="$t('mock.record.conflictTitle')" :show-confirm-button="false">
      <div class="conflict-message">{{ $t('mock.record.conflictMessage') }}</div>
      <van-row class="conflict-actions actions-bar" align="center" justify="end" :wrap="false">
        <van-button size="small" plain @click="showConflict = false">{{ $t('common.cancel') }}</van-button>
        <van-button size="small" plain type="primary" @click="onConflictReload">
          {{ $t('mock.record.reload') }}
        </van-button>
        <van-button size="small" type="primary" :loading="saving" @click="onConflictOverwrite">
          {{ $t('mock.record.overwrite') }}
        </van-button>
      </van-row>
    </van-dialog>

    <van-dialog v-model:show="showExport" :title="$t('mock.export.dialogTitle')" show-cancel-button
      :cancel-button-text="$t('common.cancel')" :confirm-button-text="$t('common.done')"
      :before-close="onExportClose">
      <div class="export-form">
        <!-- 范围单独占一块：radio 与标签同一行时，英文两枚选项在 md14 会把第二枚挤到下一行 -->
        <div class="export-field">
          <span class="export-label">{{ $t('mock.export.scopeLabel') }}</span>
          <van-radio-group v-model="exportScope" direction="horizontal" class="export-radios">
            <van-radio name="rule" :disabled="curRule._id == null">{{ $t('mock.export.scopeCurrent') }}</van-radio>
            <van-radio name="all">{{ $t('mock.export.scopeAll') }}</van-radio>
          </van-radio-group>
        </div>
        <van-row class="export-row" align="center" justify="space-between" :wrap="false">
          <span class="export-label">{{ $t('mock.export.variants') }}</span>
          <van-switch v-model="exportVariants" />
        </van-row>
        <van-row class="export-row" align="center" justify="space-between" :wrap="false">
          <span class="export-label">{{ $t('mock.export.source') }}</span>
          <van-switch v-model="exportSource" />
        </van-row>
        <van-row class="export-row" align="center" justify="space-between" :wrap="false">
          <span class="export-label">{{ $t('mock.export.redact') }}</span>
          <van-switch v-model="exportRedact" />
        </van-row>
        <!-- Web 分支没有保存框，包文本要整份进浏览器内存：风险在导出前说，不等下载完再解释 -->
        <div v-if="isWeb" class="export-tip">{{ $t('mock.export.webTip') }}</div>
      </div>
    </van-dialog>

  </van-row>
</template>

<script lang="ts" setup>
import {
  canonicalMatch, deleteMockRecord, deleteMockRule, exportMockPack, getActiveMockRule,
  getMockRecord, getMockRecords, getMockRuleDetail, MOCK_RECORD_REJECT_LIMIT, ProxyMock,
  saveMockRecord, saveMockRule, searchMockRules, validateMockRecord
} from '@shared'
import { MOCK_PACK_MAX_RECORDS } from '@shared/mock.pack'
import type { MockPackExportOptions, MockPackScope } from '@shared/mock.pack'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { showConfirmDialog, showLoadingToast, showNotify, type ToastWrapperInstance } from 'vant'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, Ref, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { scrollOptions } from '../../../common/scroll'
import { methodTagType } from '../../../common/tag'
import MiniSelect from '../../components/MiniSelect.vue'
import MockRecordEditor from './MockRecordEditor.vue'
import { isOverImportLimit, packFileName } from './pack.export'
import { cloneRecord, emptyRecord, prettifyRecordJson, recordSnapshot } from './record'
import {
  levelTagType, matchesKeyword, recordRowOf, sortRecords, warningLabelKey, warningTagType,
} from './record.row'
import { findRecordByUrl, MockMgrTarget } from './recording'
import { describeMockSaveError, normalizeErrorText } from './save-error'

const { t } = useI18n()
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
const showConflict = ref(false)
// 导出选项只在打开对话框时按当前场景重置，默认值与服务端一致（三个开关全开）
const showExport = ref(false)
const exportScope = ref<MockPackScope>('rule')
const exportVariants = ref(true)
const exportSource = ref(true)
const exportRedact = ref(true)
const curRule = ref<ProxyMock.MockRule>(new ProxyMock.MockRule())
const recordListWidth = ref<number>(0)
let recordListObserver: ResizeObserver = null
const draft = ref<ProxyMock.MockRecord>(null)
const savedSnapshot = ref<string>('')
const saving = ref(false)
const isNew = ref(false)
const recordOffset = ref(0)
const recordHasMore = ref(false)
const recordLoading = ref(false)
const recordListRef = ref<InstanceType<typeof OverlayScrollbarsComponent>>()
const flashRecordId = ref<string>(null)
const recordEditorRef = ref<InstanceType<typeof MockRecordEditor>>()
const recordKeyword = ref('')
type RecordSort = 'updated' | 'created' | 'priority'
const recordSort = ref<RecordSort>('updated')

// 新建草稿的初始快照同样参与比较，填入内容后才会进入未保存状态
const dirty = computed(() => draft.value != null && recordSnapshot(draft.value) !== savedSnapshot.value)

const recordCount = computed(() => curRule.value?.requests?.size ?? 0)
const recordTotal = computed(() => curRule.value?.limitState?.count ?? recordCount.value)
// 列表筛选与排序都在已加载页内完成，翻页后同样生效
const recordList = computed(() => sortRecords(
  [...(curRule.value?.requests?.values() ?? [])].filter(it => matchesKeyword(it, recordKeyword.value)),
  recordSort.value))

// 行内容一次性算好：标题取名称/Path，副标题只在能补充信息时展示，避免与标题重复
const recordRows = computed(() => recordList.value.map(recordRowOf))

const sortOptions = computed(() => [
  { value: 'updated', label: t('mock.list.sortUpdated') },
  { value: 'created', label: t('mock.list.sortCreated') },
  { value: 'priority', label: t('mock.list.sortPriority') },
])

function onSortChange(value: string) {
  recordSort.value = value as RecordSort
}

function warningTitle(record: ProxyMock.MockRecord): string {
  return (record.matchWarnings ?? []).map(it => t(warningLabelKey(it.type))).join(' / ')
}

// 开关与状态标签共用同一提示，避免两处文案不一致
const mockStateTip = computed(() => {
  if (curRule.value?._id == null) return t('mock.editor.selectRuleFirst')
  // 超过上限只阻止开启；已开启时仍允许关闭
  if (curRule.value.limitState?.reject === true && !curRule.value.isMock) {
    return t('mock.list.limitReject', {
      count: curRule.value.limitState.count, limit: MOCK_RECORD_REJECT_LIMIT
    })
  }
  return curRule.value.isMock ? t('mock.rule.enabledTip') : t('mock.rule.disabledTip')
})

// 顶部搜索框与左侧记录列表同宽：列表宽度受窗口宽度影响，测量后同步
const searchColStyle = computed(() => recordListWidth.value > 0 ? { width: `${recordListWidth.value}px` } : null)

const RECORD_PAGE_SIZE = 100

let detailTask: Promise<void> = null
let recordLoadSeq = 0
let flashTimer: ReturnType<typeof setTimeout> = null

const mockMgrTarget = inject<Ref<MockMgrTarget>>('mockMgrTarget', null)

const isWeb = window.isWeb

onMounted(() => {
  window.addEventListener('resize', updateSearchWidth)
  updateSearchWidth()

  // 记录列表宽度随窗口/媒体查询变化，直接测量后回写给搜索列
  const listHost = recordListRef.value?.$el as HTMLElement
  if (listHost != null) {
    recordListObserver = new ResizeObserver(() => {
      recordListWidth.value = listHost.offsetWidth
    })
    recordListObserver.observe(listHost)
  }

  curRule.value = new ProxyMock.MockRule()
  const target = mockMgrTarget?.value
  if (target?.ruleId != null) {
    void openTargetRule(target)
  } else {
    selectActiveMockRule()
  }
})

// 面板打开期间再次录制并点击「查看」时，直接切换定位
watch(() => mockMgrTarget?.value, (target) => {
  if (target?.ruleId != null) void openTargetRule(target)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateSearchWidth)
  recordListObserver?.disconnect()
  recordListObserver = null
  if (flashTimer != null) clearTimeout(flashTimer)
})

watch(showSearchResult, (show) => {
  if (show) updateSearchWidth()
})

// 搜索列宽度变化后，结果面板宽度需要按新的输入框宽度重算
watch(recordListWidth, () => nextTick(updateSearchWidth))

function updateSearchWidth() {
  searchWidth.value = searchBox.value?.offsetWidth ?? 0
}

function onSearchBoxClick() {
  if (keyword.value != '' && rules.value?.length > 0) showSearchResult.value = true
}

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
    showNotify({ message: t('common.searchNoMatch'), type: 'danger', duration: 800 })
  }
  showSearchResult.value = true
})

function startNewRecord() {
  if (curRule.value?._id == null) return
  draft.value = emptyRecord(curRule.value._id)
  savedSnapshot.value = recordSnapshot(draft.value)
  isNew.value = true
  curRecordId.value = null
  nextTick(() => recordEditorRef.value?.focusField({ code: 'urlEmpty', field: 'url' }))
}

// 深链 / 重复 URL / 冲突恢复共用：把一条记录装入列表并进入编辑态
function openRecord(record: ProxyMock.MockRecord) {
  if (record == null) return
  if (curRule.value.requests == null) curRule.value.requests = new Map()
  curRule.value.requests.set(record.id, record)
  curRecordId.value = record.id
  draft.value = prettifyRecordJson(cloneRecord(record))
  savedSnapshot.value = recordSnapshot(draft.value)
  isNew.value = false
}

// 草稿、快照、脏标记与列表选中项必须一起归零，漏一行就会出现「编辑器空了但列表仍高亮」
function clearEditorState() {
  draft.value = null
  savedSnapshot.value = ''
  isNew.value = false
  curRecordId.value = null
}

// 保存成功后的回显：本地草稿换成服务端生成的 id 与最新 updatedAt，再落到列表并闪一下
function applySavedRecord(result: ProxyMock.MockRecordSaveResult) {
  const saved = cloneRecord(draft.value)
  saved.id = result.id
  saved.updatedAt = result.updatedAt
  openRecord(saved)
  locateRecord(saved.id, true)
  showNotify({ message: t('mock.editor.saveSuccess'), type: 'success', duration: 1000 })
}

function locateRecord(id: string, flash: boolean = false) {
  if (id == null) return
  if (flash) {
    flashRecordId.value = id
    if (flashTimer != null) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      flashRecordId.value = null
      flashTimer = null
    }, 1200)
  }
  nextTick(() => {
    const host = recordListRef.value?.$el as HTMLElement
    host?.querySelector(`[data-record-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })
  })
}

async function openTargetRule(target: MockMgrTarget) {
  if (target.record != null && target.record.ruleId != null && target.record.ruleId !== target.ruleId) return
  curRule.value = { _id: target.ruleId } as ProxyMock.MockRule
  detailTask = fetchMockRuleDetail()
  await detailTask
  if (target.record != null && curRule.value?._id === target.ruleId) {
    openRecord(target.record)
    locateRecord(target.record.id)
  }
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
  // 重入保护：保存中重复点击不再发请求，否则新建可能落两条同 url 记录
  if (saving.value) return
  if (curRule.value?._id == null) {
    showNotify({ message: t('mock.editor.selectRuleFirst'), type: 'warning', duration: 800 })
    return
  }
  if (draft.value == null) return
  // 无改动时重复保存会推进 updatedAt，让其他窗口的锁提前失效
  if (!dirty.value && !isNew.value) return

  const issues = validateMockRecord(draft.value)
  if (issues.length > 0) {
    const issue = issues[0]
    showNotify({ message: t(`mock.editor.validation.${issue.code}`), type: 'warning', duration: 1500 })
    recordEditorRef.value?.focusField(issue)
    return
  }

  if (detailTask != null) await detailTask
  saving.value = true
  try {
    // 保存前先查重，避免拿服务端错误去提示；唯一性以匹配条件为准
    const duplicate = await findRecordByUrl(curRule.value._id, draft.value.url)
    if (duplicate != null && duplicate.id !== draft.value.id && isSameMatch(duplicate, draft.value)) {
      if (await confirmOpenExisting()) openRecord(duplicate)
      return
    }

    const expectedUpdatedAt = isNew.value ? undefined : draft.value.updatedAt
    const result = await saveMockRecord(draft.value, expectedUpdatedAt, { silentError: true })
    applySavedRecord(result)
  } catch (err) {
    const info = describeMockSaveError(err)
    if (info.kind === 'conflict') {
      // 冲突时保留本地内容，由用户选择覆盖保存或加载最新版本
      showConflict.value = true
      return
    }
    if (info.kind === 'duplicateUrl') {
      const existing = info.existingRecordId != null
        ? await getMockRecord(info.existingRecordId, { silentError: true })
        : await findRecordByUrl(curRule.value._id, draft.value.url)
      if (existing != null && existing.id !== draft.value.id && await confirmOpenExisting()) {
        openRecord(existing)
        return
      }
      showNotify({ message: t('mock.recordPanel.duplicateMessage'), type: 'warning', duration: 1500 })
      return
    }
    if (info.kind === 'validation' && info.code) {
      showNotify({ message: t(`mock.editor.validation.${info.code}`), type: 'warning', duration: 1500 })
      return
    }
    showNotify({ message: t('mock.editor.saveFailed'), type: 'danger', duration: 1500 })
  } finally {
    saving.value = false
  }
}

/** 双方都有 match 时按匹配条件判断重复；旧记录无 match 时退回 url 比较 */
function isSameMatch(left: ProxyMock.MockRecord, right: ProxyMock.MockRecord): boolean {
  if (left?.match == null || right?.match == null) return true
  return canonicalMatch(left.match) === canonicalMatch(right.match)
}

async function confirmOpenExisting(): Promise<boolean> {
  try {
    await showConfirmDialog({
      title: t('mock.record.openExistingTitle'),
      message: t('mock.record.openExistingMessage', { rule: curRule.value?.name ?? '' }),
      confirmButtonText: t('mock.record.openExisting'),
      cancelButtonText: t('mock.record.keepEditing')
    })
    return true
  } catch (err) {
    return false
  }
}

async function onConflictReload() {
  showConflict.value = false
  await reloadLatest()
}

// 覆盖保存：以服务端最新 updatedAt 作为期望值重试，保留本地内容
async function onConflictOverwrite() {
  showConflict.value = false
  const recordId = draft.value?.id
  if (recordId == null || saving.value) return
  saving.value = true
  try {
    const latest = await getMockRecord(recordId, { silentError: true })
    if (latest == null) {
      showNotify({ message: t('mock.record.missing'), type: 'warning', duration: 1500 })
      return
    }
    const result = await saveMockRecord(draft.value, latest.updatedAt, { silentError: true })
    applySavedRecord(result)
  } catch (err) {
    const info = describeMockSaveError(err)
    if (info.kind === 'conflict') {
      showConflict.value = true
      return
    }
    if (info.kind === 'duplicateUrl') {
      showNotify({ message: t('mock.recordPanel.duplicateMessage'), type: 'warning', duration: 1500 })
      return
    }
    showNotify({ message: t('mock.editor.saveFailed'), type: 'danger', duration: 1500 })
  } finally {
    saving.value = false
  }
}

async function reloadLatest() {
  const recordId = draft.value?.id
  if (recordId == null) return
  try {
    const latest = await getMockRecord(recordId, { silentError: true })
    if (latest == null) {
      showNotify({ message: t('mock.record.missing'), type: 'warning', duration: 1500 })
      return
    }
    openRecord(latest)
    showNotify({ message: t('mock.record.latestLoaded'), type: 'success', duration: 800 })
  } catch (err) {
    showNotify({ message: t('mock.record.latestLoadFailed'), type: 'danger', duration: 1200 })
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
  clearEditorState()
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
    clearEditorState()
    await loadRecords(true)
  } catch (err) {
    if (curRule.value?._id !== ruleId) return
    showNotify({ message: t('mock.ruleNotFound'), type: 'warning', duration: 1000 })
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
    if (seq === recordLoadSeq) showNotify({ message: t('mock.recordLoadFailed'), type: 'danger', duration: 1200 })
  } finally {
    if (seq === recordLoadSeq) recordLoading.value = false
  }
}

// 弹窗直接绑定 curRule，取消或保存失败时回滚，避免标题栏显示未保存的名称
const ruleEditBackup = ref<{ name: string, desc: string }>(null)

function onRuleEdit(rule?: ProxyMock.MockRule) {
  curRule.value = rule == null ? new ProxyMock.MockRule() : rule
  ruleEditBackup.value = { name: curRule.value.name ?? '', desc: curRule.value.desc ?? '' }
  showSearchResult.value = false
  showRuleEdit.value = true
}

function onRuleEditClose(action: string): Promise<boolean> | boolean {
  if (action === 'confirm') return saveRule(true)
  if (ruleEditBackup.value != null && curRule.value != null) {
    curRule.value.name = ruleEditBackup.value.name
    curRule.value.desc = ruleEditBackup.value.desc
  }
  ruleEditBackup.value = null
  return true
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
    clearEditorState()
    recordOffset.value = 0
    recordHasMore.value = false
    showRuleDelete.value = false
  } catch (err) {
    showNotify({ message: t('mock.deleteFailed'), type: 'warning', duration: 1000 })
  }
}

async function onMockSwitchChanged(rule: ProxyMock.MockRule) {
  curRule.value = rule
  const next = rule.isMock
  // 状态切换用专用提示，保存失败必须回退开关，避免界面与实际生效状态不一致
  if (!await saveRule(false)) {
    rule.isMock = !next
    return
  }
  showNotify({
    message: next ? t('mock.rule.enabledToast') : t('mock.rule.disabledToast'),
    type: next ? 'success' : 'warning',
    duration: 800
  })
}

function onSave(): Promise<boolean> {
  return saveRule(true)
}

async function saveRule(notifySuccess: boolean): Promise<boolean> {
  if (curRule.value == null) return false

  const name = (curRule.value.name ?? '').trim()
  if (name === '') {
    showNotify({ message: t('mock.rule.nameRequired'), type: 'warning', duration: 1000 })
    return false
  }
  curRule.value.name = name

  const isNewRule = curRule.value._id == null
  let saved = false
  try {
    // 只保存规则元信息，请求记录由 onRecordSave 单独落盘
    curRule.value._id = await saveMockRule(curRule.value)
    // 已有规则无需重载记录，避免切换开关/改名时丢掉已加载的分页
    if (isNewRule) await fetchMockRuleDetail()
    saved = true
    if (notifySuccess) showNotify({ message: t('mock.ruleSaveSuccess'), type: 'success', duration: 500 })
    // 搜索结果带名称缓存，改名后不刷新会继续显示旧名字
    await refreshRuleSearch()
  } catch (err) {
    // 规则在别处被删除时服务端只会返回“不存在”，提示重新选择比笼统失败更明确
    const message = normalizeErrorText(err).includes('不存在')
      ? t('mock.ruleNotFound')
      : t('mock.ruleSaveFailed')
    showNotify({ message, type: 'danger', duration: 1200 })
  }
  // 保存失败时保留弹窗，避免用户丢失刚输入的名称
  if (saved) {
    ruleEditBackup.value = null
    showRuleEdit.value = false
  }
  return saved
}

async function refreshRuleSearch() {
  const kw = keyword.value
  if (kw === '') return
  try {
    const result = await searchMockRules(kw)
    if (keyword.value !== kw) return
    rules.value = result ?? []
  } catch (err) {
    // 刷新失败不影响已保存结果
  }
}

async function onRecordSelected(record: ProxyMock.MockRecord) {
  if (record.id === curRecordId.value && !isNew.value) return
  if (!await confirmDiscard()) return
  curRecordId.value = record.id
  draft.value = prettifyRecordJson(cloneRecord(record))
  // 快照取自格式化后的草稿，仅改变展示时不会出现“未保存”
  savedSnapshot.value = recordSnapshot(draft.value)
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
      clearEditorState()
    }
  } catch (err) {
    showNotify({ message: t('mock.deleteFailed'), type: 'warning', duration: 1000 })
  }
}

function onExportOpen() {
  // 未选中场景时「仅当前场景」是禁用的，默认值只能落在全部场景上
  exportScope.value = curRule.value?._id == null ? 'all' : 'rule'
  exportVariants.value = true
  exportSource.value = true
  exportRedact.value = true
  showExport.value = true
}

async function onExportClose(action: string): Promise<boolean> {
  if (action !== 'confirm') return true
  // 关掉脱敏就是导出明文凭证，确认框必须出现在落盘之前而不是选项行里
  if (exportRedact.value) {
    startExport()
    return true
  }
  try {
    await showConfirmDialog({
      title: t('mock.export.rawTitle'),
      message: t('mock.export.rawConfirm'),
      showCancelButton: true,
      confirmButtonText: t('common.done'),
      cancelButtonText: t('common.cancel')
    })
    startExport()
    return true
  } catch (err) {
    // 取消明文导出停在当前对话框，用户还能改回脱敏
    return false
  }
}

function exportOptions(): MockPackExportOptions {
  const scope = exportScope.value
  return {
    scope,
    ruleId: scope === 'rule' ? curRule.value._id : null,
    includeVariants: exportVariants.value,
    includeSource: exportSource.value,
    redact: exportRedact.value
  }
}

// Web 分支的落盘就是浏览器的下载：文件名交给 a.download，落到哪儿由浏览器/用户决定
function downloadPack(fileName: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = fileName
  a.click()
  // 同步 revoke 会把浏览器还没接手的下载一起取消
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// 选路径与写盘分两次 IPC：包文本由主进程边拼边写进文件，渲染层经手的只有几十字节的回执。
// Web 分支没有主进程可用，只能把整份包文本取进浏览器再交 Blob 下载——峰值与包大小同阶，
// 所以风险写在对话框里（webTip），条数超限的提示也就给不出来（回执里没有条数）。
async function startExport() {
  const options = exportOptions()
  const fileName = packFileName({
    scope: options.scope,
    ruleName: options.scope === 'rule' ? curRule.value.name : undefined,
    redact: options.redact
  })
  let loading: ToastWrapperInstance = null
  try {
    if (isWeb) {
      loading = showLoadingToast({ message: t('mock.export.saving'), forbidClick: true, duration: 0 })
      // silentError：base.api 对 FAIL/ERROR 自己会弹一次提示，这里再由导出统一报「导出失败：原因」
      downloadPack(fileName, await exportMockPack(options, { silentError: true }))
      showNotify({ message: t('mock.export.savedWeb', { fileName }), type: 'success', duration: 2000 })
      return
    }
    const picked = await window.mainApi.selectSavePath(t('mock.export.saveTitle'), fileName)
    // 用户在系统保存框里取消不是失败，什么都不提示
    if (picked.status !== 'selected' || picked.filePath == null) return
    loading = showLoadingToast({ message: t('mock.export.saving'), forbidClick: true, duration: 0 })
    const result = await window.mainApi.exportMockPack(picked.filePath, options)
    if (result.status === 'failed') {
      showNotify({
        message: t('mock.export.failed', { reason: normalizeErrorText(result.error) }),
        type: 'danger',
        duration: 2000
      })
      return
    }
    const ruleCount = result.ruleCount ?? 0
    const recordCount = result.recordCount ?? 0
    showNotify({ message: t('mock.export.saved', { ruleCount, recordCount }), type: 'success', duration: 1500 })
    // 导出侧只按体积放行了，导入侧还会按条数整包拒绝，落盘当场说明比事后失败便宜
    if (isOverImportLimit(recordCount)) {
      showNotify({
        message: t('mock.export.overLimit', { recordCount, limit: MOCK_PACK_MAX_RECORDS }),
        type: 'warning',
        duration: 5000
      })
    }
  } catch (err) {
    showNotify({
      message: t('mock.export.failed', { reason: normalizeErrorText(err) }),
      type: 'danger',
      duration: 2000
    })
  } finally {
    loading?.close()
  }
}
</script>

<style scoped>
/* 分栏阈值要跟着字号走，所以这里做成查询容器而不是用视口 @media：容器查询里的 em 按容器的 font-size
   解析（#app 继承下来的 --van-font-size-md，中间没有任何一层改过字号），与右侧编辑区那些 min-width
   全部用 md 倍数的行是同一把尺子。@container 管不到容器自己，本条查询的三条规则都在后代上。
   副作用 checked 过：inline-size containment 带出的 layout containment 会让本元素成为 fixed 后代的包含块，
   而子树里的浮层都绕开了——MiniSelect 的下拉 teleport="body"、确认弹窗挂 body、van-popover 是 absolute
   且本元素早已是 position:relative。 */
.mgr-content {
  flex-direction: column;
  /* van-row 默认 wrap，列方向下高度超出弹层时会把主体换到右侧列并移出可视区 */
  flex-wrap: nowrap;
  position: relative;
  width: var(--app-popup-w-lg);
  min-width: min(375px, 100vw);
  max-width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  container-type: inline-size;
  container-name: mgr;
  /* background: var(--van-gray-1); */
}

.top-bar {
  flex: none;
  flex-wrap: nowrap;
}

.rule-search-col {
  /* 宽度由记录列表实测值内联覆盖，这里只作首帧兜底：列表宽度减去左右外边距 */
  flex: none;
  width: calc(var(--app-record-pane-width) - var(--app-sp-xl));
  /* 与右侧两行高度的规则信息居中对齐 */
  display: flex;
  align-items: center;
}

.rule-head-col {
  /* 搜索列宽度固定后，剩余空间全部给规则信息列 */
  flex: 1 1 0;
  min-width: 0;
  white-space: nowrap;
}

.mgr-body {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  /* 编辑器列的内容宽度较大，允许换行会把编辑区挤到列表下方并被弹层裁掉 */
  flex-wrap: nowrap;
}

.record-pane {
  display: flex;
  flex-direction: column;
  width: var(--app-record-pane-width);
  /* 列表自带 5px 外边距，撑满主体高度后底边才能与右侧编辑器对齐 */
  height: 100%;
  min-height: 0;
}

.record-pane-head {
  flex: none;
  gap: var(--app-sp-lg);
  /* 左侧与筛选行搜索图标对齐：筛选 10px + 输入框 8px；右侧与单元格内边距对齐 */
  padding: calc(var(--van-font-size-md) * 0.3) calc(var(--van-font-size-md) * 1.5) calc(var(--van-font-size-md) * 0.3) calc(var(--van-font-size-md) * 1.4);
}

.record-pane-title {
  font-size: var(--van-font-size-md);
  font-weight: 500;
  color: var(--van-text-color);
}

.record-filter {
  gap: var(--app-sp-md);
  padding: 0 var(--app-sp-xl) var(--app-sp-sm);
  /* 搜索框与筛选下拉共享同一行高，字号切换时始终对齐。
     行高直接取全局控件高度：搜索框的外观已经并进 global.css 的 .control-field，
     再在这里留一档 md*2.3 就会和下拉差出 1.3px。 */
  --record-row-h: var(--app-control-height);
}

/* 下划线、定高、左右内边距全在 .control-field，这里只剩这一行自己的排版。 */
.record-field {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}

.record-field :deep(.van-field__left-icon) {
  margin-right: var(--app-sp-tight);
  color: var(--van-text-color-3);
}

.record-sort {
  flex: none;
  width: auto;
  min-width: calc(var(--van-font-size-md) * 6);
  height: var(--record-row-h);
  box-sizing: border-box;
  --mini-select-bar-height: var(--record-row-h);
}

.record-limit {
  flex: none;
  margin: 0 var(--app-sp-tight) var(--app-sp-sm);
  padding: var(--app-sp-sm) var(--app-sp-lg);
  /* 限额提示是告警文案，不应落在最小号 */
  font-size: var(--van-font-size-sm);
}

.record-limit.is-reject {
  --van-notice-bar-text-color: var(--van-danger-color);
  --van-notice-bar-background: color-mix(in srgb, var(--van-danger-color) 8%, transparent);
}

/* 记录行：两行固定结构（标识行 + 元信息行），行高收住，长文本统一尾部省略 */
.record-row {
  /* 行内尺寸随全局字号缩放：正文 md 为基准，配色块按 md 的 0.77 倍跟随 */
  --record-line-font: var(--van-font-size-md);
  --record-chip-font: calc(var(--record-line-font) * 0.8);
  font-size: var(--record-line-font);
  padding: calc(var(--record-line-font) * 0.5) calc(var(--record-line-font) * 0.8);
  min-height: calc(var(--record-line-font) * 3.7);
}

.record-row :deep(.van-cell__title) {
  min-width: 0;
}

.record-row :deep(.van-cell__label) {
  margin-top: calc(var(--record-line-font) * 0.4);
  min-width: 0;
}

.record-line {
  display: flex;
  align-items: center;
  gap: calc(var(--record-line-font) * 0.4);
  min-width: 0;
  overflow: hidden;
}

.record-line--meta {
  gap: calc(var(--record-line-font) * 0.5);
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-xs);
  line-height: 1.78;
  min-width: 0;
}

.record-status-group {
  display: inline-flex;
  align-items: center;
  gap: calc(var(--record-line-font) * 0.3);
  margin-left: auto;
  flex-shrink: 0;
}

.record-level {
  flex: none;
  cursor: default;
}

.record-status {
  flex: none;
  font-weight: 600;
}

.record-title {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--van-text-color);
  font-size: var(--van-font-size-md);
  font-weight: 600;
  line-height: 1.54;
}

.record-title-text {
  display: inline-block;
  max-width: 100%;
  vertical-align: bottom;
}

.record-path {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--van-text-color-3);
}

/* 徽标带变体名，允许收缩截断（nowrap/ellipsis 走全局 .truncate），上限用 em 跟着本行字号缩放。
   变体应答是「返回哪份响应」的属性而不是开关状态，所以不跟规则的启用一样用绿色，
   否则同一行里绿字既表示启用又表示选过变体，读不出区别。 */
.record-meta {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 10em;
  color: var(--van-text-color-2);
}

/* 告警只显示第一条，其余折叠成 +N，完整说明放在 title 里 */
.record-warn {
  flex: none;
}

.record-warn :deep(.van-icon) {
  /* 文本行内图标跟随所在行的字号 */
  font-size: 1em;
}

/* 行内操作：内边距、圆角、hover 底色读 global.css 的 .icon-action，这里只留字号与颜色语义 */
.record-action {
  margin-left: .4em;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-lg);
}

.record-action--danger:hover {
  color: var(--van-danger-color);
}

.record-action--muted:hover {
  color: var(--van-text-color);
}

.record-load-more-cell {
  padding: .46em .77em;
}

.record-list {
  flex: 1 1 auto;
  min-height: 0;
}

.record-load-more {
  color: var(--van-primary-color);
  font-size: var(--van-font-size-sm);
}

.rule-editor-col {
  display: flex;
  flex-direction: column;
  /* flex-basis 归零，避免内容固有宽度参与换行判断 */
  flex: 1 1 0;
  min-width: 0;
  /* 让位量取列表卡片的外边距（.border-bg 的 --app-card-gutter），两侧底边才对得齐。
     原先按顶部拖拽区高度 md*0.8 扣，字号 13 档实测编辑器列比列表卡片底高出 5.4px，字号越大差得越多。 */
  height: calc(100% - var(--app-card-gutter));
  padding: 0 var(--app-sp-tight);
  position: relative;
}

.editor-placeholder {
  margin: auto;
  color: var(--van-text-color-3);
}

/* 规则状态收拢在头部：名称后的标签是唯一状态说明，避免与开关重复 */
.rule-head-title {
  gap: var(--app-sp-md);
  min-width: 0;
}

.rule-head-name {
  flex: none;
  max-width: calc(var(--van-font-size-md) * 12);
  min-width: 0;
}

.rule-state-tag {
  flex: none;
}

.rule-head-desc {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.rule-mock-switch {
  gap: var(--app-sp-md);
  margin-left: var(--app-sp-xl);
}

.rule-mock-switch-label {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

/* 草稿行：与正式记录区分，避免用户以为已落盘 */
.record-draft-row {
  background: color-mix(in srgb, var(--van-warning-color) 12%, transparent);
}

.record-flash {
  animation: record-flash 1.2s ease-out;
}

@keyframes record-flash {
  0% {
    background: color-mix(in srgb, var(--van-primary-color) 24%, transparent);
  }

  100% {
    background: transparent;
  }
}

/* 保存冲突走的是自定义内容 + 自定义动作区，不经过 van-dialog 的 message/footer，
   所以这里逐档复刻标准弹窗的间距：8/24/8 的正文 + 8/24/16 的动作区，
   与标题共用同一条沟道，否则正文比标题窄半档、底部还会多出一条白带 */
.conflict-message {
  padding: var(--van-padding-xs) var(--app-dialog-gutter);
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
  line-height: 1.5;
}

.conflict-actions {
  padding: var(--van-padding-xs) var(--app-dialog-gutter) var(--van-padding-md);
}

/* 自带内容的弹窗沿用上面的沟道口径（见 .conflict-message 的注释）。
   弹窗正文读 --van-font-size-lg（随字号设置走），这里不再另定一档。 */
.export-form {
  padding: var(--van-padding-xs) var(--app-dialog-gutter);
}

/* 三条开关行与一块范围选项共用同一档行距：加一种行型不用补规则 */
.export-form > * + * {
  margin-top: var(--app-sp-md);
}

.export-field {
  display: flex;
  flex-direction: column;
  gap: var(--app-sp-sm);
}

/* 置灰的「仅当前场景」：Vant 用 --van-text-color-3，暗色下覆成 #4d4d4d 压在弹窗底色上几乎读不出，
   与时间戳同一口径改走 text-color-2（能看出比同行淡，但读得清） */
.export-field :deep(.van-radio--disabled .van-radio__label) {
  color: var(--van-text-color-2);
}

/* Web 分支的说明文字没有复用全局 .hint：那一档读 --van-text-color-3，Vant 暗色把它钉成字面量 #4d4d4d
   （store 的灰阶反转只覆盖 --van-gray-*，动不到它），压在弹窗底色上几乎读不出——与上面禁用态同一口径走 text-2。
   .hint 全站十几处要不要整体提一档是另一件事，不在本批改。 */
.export-tip {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.mgr-content :deep(.van-popover__wrapper) {
  display: block;
  width: 100%;
}

/* 规则名/描述过长时收缩并省略，避免把右侧操作按钮挤出可视区 */
.rule-cancel-disabled {
  cursor: not-allowed;
}

.rule-cancel-icon {
  font-size: calc(var(--van-font-size-md) * 1.5);
  margin-right: var(--app-sp-xl);
}

.rule-head-cell :deep(.van-cell) {
  padding: var(--app-sp-tight) var(--app-sp-xl);
  flex-wrap: nowrap;
}

.rule-head-cell :deep(.van-cell__title) {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.rule-head-cell :deep(.van-cell__value),
.rule-head-cell :deep(.van-cell__right-icon) {
  flex: none;
  white-space: nowrap;
}

.result-action-icon {
  /* 内边距、圆角、hover 底色读 global.css 的 .icon-action，这里只留字形尺寸 */
  font-size: calc(var(--van-font-size-md) * 1.2);
}

.result-action-icon--primary {
  color: var(--van-primary-color);
}

.result-action-icon--danger {
  color: var(--van-danger-color);
}

/* 图标尺寸已由 global.css 的 .btn-icon-only .van-icon 单源，这里只保留配色语义 */
.btn-action-icon--danger {
  color: var(--van-danger-color);
}

.rule-head-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--app-sp-tight);
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

.rule-search {
  --van-search-padding: calc(var(--van-font-size-md) * 0.3) calc(var(--van-font-size-md) * 0.6);
  --van-search-input-height: calc(var(--van-font-size-md) * 2.3);
  --van-cell-vertical-padding: 0;
}

/* 收窄 search action 的可点击区域，避免 + 按钮被撑成长条：容器仍占满搜索行高，按钮只居中 */
.rule-search :deep(.van-search__action) {
  display: flex;
  align-items: center;
  align-self: stretch;
  height: var(--van-search-input-height);
  padding: 0 var(--app-sp-sm);
  cursor: default;
}

.rule-search :deep(.van-search__action:active) {
  background-color: transparent;
}

.search-result {
  max-height: 50vh;
}

.rule-snap-item {
  width: 100%;
}

/* Vant 把 __title 与 __value 都设成 flex:1（均分），__title 的 min-width 默认 auto 又按内容撑开，
   名称+描述一长就把放编辑/删除图标的 __value 顶出可见区。这里让标题可缩、值只占自身宽：
   截断交还给标题里的 .result-desc，按钮恒在右侧。 */
.rule-snap-item :deep(.van-cell__title) {
  flex: 1 1 0;
  min-width: 0;
}

.rule-snap-item :deep(.van-cell__value) {
  flex: none;
}

/* 名称与描述单行并排（与顶部规则头部同款口径）：名称封顶一档、可缩，描述吃剩余并截断。 */
.result-title-row {
  gap: var(--app-sp-md);
  min-width: 0;
}

.result-name {
  flex: 0 1 auto;
  max-width: calc(var(--van-font-size-md) * 12);
  min-width: 0;
}

.result-desc {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

/* 阈值由右侧编辑区最宽的那一行反推，不是拍的。今天这一行是响应表单的响应体头部：
   「响应体」+ JSON/XML/TEXT/BINARY 四枚单选 + 体积数字 + 两枚工具按钮，两头都不许折行
   （见 MockResponseForm 的 .section-head 与 .body-type），所以它排不开时只能靠分栏来救。
   整行固有宽（字号 7~10 = md 11~14）：中文 335.7 / 365.4 / 395.2 / 425.0px，英文 380.3 / 414.2 / 448.0 / 481.9px；
   这一版把行内密度收了（单选右边距 sp-xl→sp-md、头部 gap sp-lg→sp-md）并去掉「体积：」前缀，数字只剩 '1.2 KB' 那一量级。
   再扣编辑器列自身的 3.2md + 2px（editor-col 2×0.4md、tab 面板 2×0.3md、response-form 2×0.3md、卡片 2×0.6md 加描边）、
   并排记录列 min(max(300px, 23md), 38%)（两个分支都算取较严的），另留 12px 建模余量，换算成容器宽：
     整行完整——中文最坏 56.4em，英文最坏 63.0em（数字宽到 '123.5 KB' 则 64.4em）；
     只保标题+单选+按钮、数字让位——最坏 59.0em。
   取 63em：中文无论字号与数字宽窄都整行完整；英文数字在 3sm 那一量级时全字号完整，宽一档则字号 7~8 会把数字省略号掉约 8px，
   单选组最多让出末枚那 0.5md 的尾边距（是空白不是字形，看不出来）——先缩数字而不是先裁单选，靠的是 .body-size 的 shrink 20。
   窗口门槛：字号 9 时并排保到约 1024px，上一版 68em 是约 1105px；再低到 59em 才轮到单选自己挨裁。
   方法账也要记一笔：上一版那组 411.5~539.1 出自一个复刻页没带上 scoped 属性（:deep 规则整条没生效、单选标签按 md 而非 sm 排）的测量，
   整行高估约 20px、阈值跟着抬了 5em。这次是 dist 里抽出的真 scoped CSS + Vant 组件 SSR 出来的真 markup，在 Chromium 里直接量。
   原先的 50em 只保证变体行（29.3md + 8px）排得开。Onboarding 的 720px 不跟着改：那量的是窗口，不是这个 80vw 抽屉的自身宽度。 */
@container mgr (max-width: 63em) {
  .mgr-body {
    flex-direction: column;
  }

  .record-pane {
    width: 100%;
    /* 堆叠时上下两段抢同一份高度。列表 32% 是常规档（670px 高的窗口给列表卡片约 3 行）；
       30md 是编辑器地板：编辑器列扣掉两行表头、tab 标签栏和响应区上方 11md 的固定开销后，
       正文至少要能显示 8 行，所以窗口偏矮时以这一项接管。104px 只防极矮窗口把列表压没。
       原先写死 36% 时，670px 高的窗口正文只剩 4~6 行，即「窄窗口里编辑器显示不全」。 */
    height: max(104px, min(32%, calc(100% - calc(var(--van-font-size-md) * 30))));
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
