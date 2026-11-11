<template>
  <van-row class="mgr-content">
    <van-row class="border-bg top-bar" justify="start" style="width: calc(100% - var(--card-gutter) * 2);"
      :style="{ paddingTop: isWeb ? '0' : 'calc(var(--van-font-size-md) * 0.8)' }">
      <van-col class="rule-search-col" :style="searchColStyle">
        <van-popover class="rule-search-popover" v-model:show="showSearchResult" trigger="manual"
          placement="bottom-start" :show-arrow="false" :offset="[0, 2]">
          <template #reference>
            <div ref="searchBox" style="width: 100%;" @click="onSearchBoxClick">
              <van-search class="rule-search" show-action :clearable="false" v-model="keyword"
                :placeholder="$t('common.searchPlaceholder')">
                <template #action>
                  <van-button class="rule-add-btn btn-icon-only" plain type="primary" size="small" icon="plus"
                    @click.stop="onRuleEdit(null)" />
                </template>
              </van-search>
            </div>
          </template>

          <OverlayScrollbarsComponent class="search-result"
            :style="searchWidth > 0 ? { width: searchWidth + 'px' } : null" :options="scrollOptions" defer>
            <van-list :error="rules?.length == 0" :error-text="$t('common.searchNoMatch')">
              <van-cell center class="rule-snap-item" is-link v-for="(rule, idx) in rules" :title="rule.name"
                :label="rule.desc" @click="onRuleSelect(rule)">
                <template #value>
                  <div>
                    <van-icon class="iconfont icon-edit result-action-icon result-action-icon--primary"
                      @click.stop="onRuleEdit(rule)" />
                    <van-icon class="iconfont icon-delete result-action-icon result-action-icon--danger"
                      @click.stop="onRuleDelete(rule)" />
                    <van-icon class="iconfont icon-upload result-action-icon result-action-icon--danger"
                      @click.stop="onSave" />
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
              <span class="rule-head-name">[{{ curRule?.name == null ? $t('mock.rule.name') : curRule?.name }}]</span>
              <van-tag v-if="curRule._id != null" class="rule-state-tag" plain
                :type="curRule.isMock ? 'success' : 'warning'" :title="mockStateTip">
                {{ curRule.isMock ? $t('mock.rule.enabled') : $t('mock.rule.disabled') }}
              </van-tag>
            </van-row>
          </template>
          <template #label>
            <span style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              {{ curRule?.desc || $t('mock.rule.desc') }}
            </span>
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
            </div>
          </template>
          <template #right-icon>
            <van-row class="rule-mock-switch" :title="mockStateTip" align="center" :wrap="false">
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
          <van-button class="record-new-btn btn-icon-only" plain type="primary" size="mini" icon="plus"
            :disabled="curRule._id == null" @click="addRecord"></van-button>
        </van-row>
        <van-row class="record-filter" align="center" :wrap="false">
          <van-field v-model="recordKeyword" class="record-field" clearable
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
                  <span class="record-title">{{ draft.name || $t('mock.editor.newRecord') }}</span>
                  <van-tag plain type="warning" class="record-draft-tag">{{ $t('mock.editor.unsaved') }}</van-tag>
                </div>
              </template>
              <!-- v-if 必须挂在插槽本身：挂在里面的 div 上时 Vant 仍会渲染空的 label 节点，
                   那 5.6px 上边距会把 title 列撑高，居中后文字与右侧 × 就错开了 -->
              <template v-if="draft.url" #label>
                <div class="record-line record-line--meta">
                  <span class="record-path">{{ draft.url }}</span>
                </div>
              </template>
              <template #right-icon>
                <van-icon name="cross" class="record-action record-action--muted" @click.stop="clearEditorState" />
              </template>
            </van-cell>
            <van-cell center clickable v-for="row in recordRows" :key="row.record.id"
              @click="onRecordSelected(row.record)" :data-record-id="row.record.id" class="record-row"
              :class="{ 'record-row--selected': row.record.id === curRecordId, 'record-flash': row.record.id === flashRecordId }">
              <template #title>
                <div class="record-line">
                  <van-tag v-if="row.summary" :type="methodTagType(row.summary.method)" class="record-method"
                    :title="row.summary.method">
                    {{ row.summary.method.charAt(0) }}
                  </van-tag>
                  <span class="record-title" :class="{ 'record-title--scroll': row.record.id === curRecordId }"
                    :title="row.titleHint">
                    <span class="record-title-text">{{ row.title }}</span>
                  </span>
                </div>
              </template>
              <template #label>
                <div class="record-line record-line--meta">
                  <span v-if="row.subPath" class="record-path" :title="row.subPath">{{ row.subPath }}</span>
                  <span v-if="row.active" class="record-meta record-meta--active">
                    {{ $t('mock.editor.active') }}
                  </span>
                  <van-tag v-if="row.warning" plain :type="warningTagType(row.warning.type)" class="record-warn"
                    :title="warningTitle(row.record)">
                    <van-icon name="warning-o" />
                    {{ $t(warningLabelKey(row.warning.type)) }}
                    <template v-if="row.warningExtra > 0">+{{ row.warningExtra }}</template>
                  </van-tag>
                  <span class="record-status-group">
                    <van-tag v-if="row.summary" plain :type="levelTagType(row.summary.level)" class="record-level"
                      :title="$t(`mock.match.levelHint.${row.summary.level}`)">
                      {{ $t(`mock.match.level.${row.summary.level}`) }}
                    </van-tag>
                    <van-tag plain :type="row.statusOk ? 'success' : 'danger'" class="record-status"
                      :title="`HTTP ${row.statusCode}`">
                      {{ row.statusCode }}
                    </van-tag>
                  </span>
                </div>
              </template>
              <template #right-icon>
                <van-icon class="iconfont icon-delete record-action record-action--danger"
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

  </van-row>
</template>

<script lang="ts" setup>
import {
  canonicalMatch, deleteMockRecord, deleteMockRule, getActiveMockRule, getMockRecord,
  getMockRecords, getMockRuleDetail, MOCK_RECORD_REJECT_LIMIT, ProxyMock, saveMockRecord,
  saveMockRule, searchMockRules, validateMockRecord
} from '@shared'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { showConfirmDialog, showNotify } from 'vant'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, Ref, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MiniSelect from '../../components/MiniSelect.vue'
import { scrollOptions } from '../../../common/scroll'
import MockRecordEditor from './MockRecordEditor.vue'
import { matchesKeyword, sortRecords, warningLabelKey } from './match'
import { levelTagType, methodTagType, recordRowOf, warningTagType } from './record.row'
import { describeMockSaveError, normalizeErrorText } from './save-error'
import { cloneRecord, emptyRecord, prettifyRecordJson, recordSnapshot } from './record'
import { findRecordByUrl, MockMgrTarget } from './recording'

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
</script>

<style scoped>
.mgr-content {
  flex-direction: column;
  /* van-row 默认 wrap，列方向下高度超出弹层时会把主体换到右侧列并移出可视区 */
  flex-wrap: nowrap;
  position: relative;
  width: var(--popup-w-lg);
  min-width: min(375px, 100vw);
  max-width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  /* background: var(--van-gray-1); */
}

.top-bar {
  flex: none;
  flex-wrap: nowrap;
}

.rule-search-col {
  /* 宽度由记录列表实测值内联覆盖，这里只作首帧兜底：列表宽度减去左右外边距 */
  flex: none;
  width: calc(var(--record-pane-width) - var(--sp-xl));
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
  width: var(--record-pane-width);
  /* 列表自带 5px 外边距，撑满主体高度后底边才能与右侧编辑器对齐 */
  height: 100%;
  min-height: 0;
}

.record-pane-head {
  flex: none;
  gap: var(--sp-lg);
  /* 左侧与筛选行搜索图标对齐：筛选 10px + 输入框 8px；右侧与单元格内边距对齐 */
  padding: calc(var(--van-font-size-md) * 0.3) calc(var(--van-font-size-md) * 1.5) calc(var(--van-font-size-md) * 0.3) calc(var(--van-font-size-md) * 1.4);
}

.record-pane-title {
  font-size: var(--van-font-size-md);
  font-weight: 500;
  color: var(--van-text-color);
}

/* 列表头的小按钮高度与内边距随全局字号缩放，图标继承按钮字号 */
.record-pane-head :deep(.van-button--mini) {
  height: calc(var(--van-font-size-md) * 1.9);
  padding: 0 var(--sp-sm);
  border-radius: calc(var(--van-font-size-md) * 0.3);
}

.record-new-btn {
  flex: none;
}

.record-filter {
  gap: var(--sp-md);
  padding: 0 var(--sp-xl) var(--sp-sm);
  /* 搜索框与筛选下拉共享同一行高，字号切换时始终对齐 */
  --record-row-h: calc(var(--van-font-size-md) * 2.3);
}

.record-field {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 0;
  height: var(--record-row-h);
  --van-field-input-height: var(--record-row-h);
  --van-cell-vertical-padding: 0;
  --van-cell-padding: calc(var(--van-font-size-md) * 0.3) calc(var(--van-font-size-md) * 0.6);
}

.record-field :deep(.van-cell) {
  padding: var(--van-cell-padding);
  height: var(--record-row-h);
}

.record-field :deep(.van-field__left-icon) {
  margin-right: var(--sp-tight);
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
  margin: 0 var(--sp-tight) var(--sp-sm);
  padding: var(--sp-sm) var(--sp-lg);
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

.record-row:hover {
  background: var(--van-active-color);
}

/* 选中态：左侧色条 + 淡底，替代只靠点击态区分 */
.record-row--selected {
  background: color-mix(in srgb, var(--van-primary-color) 8%, transparent);
}

.record-row--selected::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: calc(var(--record-line-font) * 0.2);
  background: var(--van-primary-color);
}

.record-row--selected:hover {
  background: color-mix(in srgb, var(--van-primary-color) 12%, transparent);
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

/* 方法色块：边长与字号取自全局 --method-square*，与 ProxyRecordSnap 的 .method-tag 同一来源，
   不再需要「改一边记得改另一边」；圆角仍是 Vant van-tag 的默认 2px。 */
.record-method {
  flex: none;
  min-width: var(--method-square);
  height: var(--method-square);
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--method-square-font);
  font-weight: 700;
  line-height: 1;
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
  font-family: var(--mono-font);
  font-weight: 600;
}

.record-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--van-text-color);
  font-size: var(--van-font-size-md);
  font-weight: 600;
  line-height: 1.54;
}

.record-title-text {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  vertical-align: bottom;
  /* 仅选中行滚动：取消选中后立即回到默认省略状态 */
  transform: none;
  animation: none;
}

/* 选中行的记录名在可视宽度内来回滚动，长路径无需悬停即可看全 */
.record-title--scroll {
  container-type: inline-size;
}

.record-title--scroll .record-title-text {
  max-width: none;
  padding-right: calc(var(--record-line-font) * 0.9);
  animation: record-title-marquee 5s ease-in-out infinite alternate;
}

@keyframes record-title-marquee {

  0%,
  12% {
    transform: translateX(0);
  }

  88%,
  100% {
    transform: translateX(min(0px, calc(-100% + 100cqw)));
  }
}

.record-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--van-text-color-3);
  font-family: var(--mono-font);
}

.record-meta {
  flex: none;
  white-space: nowrap;
}

.record-meta--active {
  color: var(--van-success-color);
}

/* 告警只显示第一条，其余折叠成 +N，完整说明放在 title 里 */
.record-warn {
  flex: none;
}

.record-warn :deep(.van-icon) {
  /* 文本行内图标跟随所在行的字号 */
  font-size: 1em;
}

/* 行内操作：裸图标，热区与字号同比缩放，悬停才强调 */
.record-action {
  flex: none;
  padding: .27em;
  margin-left: .4em;
  border-radius: .27em;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-lg);
  cursor: pointer;
  transition: color .15s, background-color .15s;
}

.record-action--danger:hover {
  color: var(--van-danger-color);
  background: color-mix(in srgb, var(--van-danger-color) 8%, transparent);
}

.record-action--muted:hover {
  color: var(--van-text-color);
  background: var(--van-active-color);
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
  height: calc(100% - calc(var(--van-font-size-md) * 0.8));
  /* 左侧列表有外边距，这里同步下移，两侧底边才能对齐 */
  padding: 0 var(--sp-tight);
  position: relative;
}

.editor-placeholder {
  margin: auto;
  color: var(--van-text-color-3);
}

/* 规则状态收拢在头部：名称后的标签是唯一状态说明，避免与开关重复 */
.rule-head-title {
  gap: var(--sp-md);
  min-width: 0;
}

.rule-head-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.rule-state-tag {
  flex: none;
}

.rule-mock-switch {
  gap: var(--sp-md);
  margin-left: var(--sp-xl);
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

.conflict-message {
  padding: var(--sp-2xl) var(--sp-3xl) 0;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
  line-height: 1.5;
}

.conflict-actions {
  padding: var(--sp-3xl);
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
  margin-right: var(--sp-xl);
}

.rule-head-cell :deep(.van-cell) {
  padding: var(--sp-tight) var(--sp-xl);
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
  font-size: calc(var(--van-font-size-md) * 1.2);
  padding: var(--sp-tight);
  border-radius: calc(var(--van-font-size-md) * 0.4);
  cursor: pointer;
  transition: background-color 0.15s;
}

.result-action-icon--primary {
  color: var(--van-primary-color);
}

.result-action-icon--primary:hover {
  background: color-mix(in srgb, var(--van-primary-color) 8%, transparent);
}

.result-action-icon--danger {
  color: var(--van-danger-color);
}

.result-action-icon--danger:hover {
  background: color-mix(in srgb, var(--van-danger-color) 8%, transparent);
}

.btn-action-icon {
  font-size: calc(var(--van-font-size-md) * 1.1);
}

.btn-action-icon--danger {
  color: var(--van-danger-color);
}

.rule-mgr-cell-value {
  display: flex !important;
  align-items: center;
  flex-wrap: nowrap;
  white-space: nowrap;
  flex: none !important;
}

.rule-head-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-tight);
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

/* 收窄 search action 的可点击区域，避免 + 按钮被撑成长条 */
.rule-search :deep(.van-search__action) {
  display: flex;
  align-items: stretch;
  align-self: stretch;
  height: var(--van-search-input-height);
  padding: 0 var(--sp-sm);
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
  height: var(--van-search-input-height);
  padding: 0;
}

.search-result {
  max-height: 50vh;
}

.rule-snap-item {
  width: 100%;
}

/* 与 Onboarding 的分栏阈值一致：popup 宽约 80vw，此处需 >=720px 才能容下列表 300 + 编辑器 340 */
@media (max-width: 720px) {
  .mgr-body {
    flex-direction: column;
  }

  .record-pane {
    width: 100%;
    height: 36%;
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
