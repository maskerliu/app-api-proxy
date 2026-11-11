<template>
  <van-popover v-model:show="showRecordPanel" placement="bottom-end" teleport="body" class="record-popover"
    :offset="[0, 6]">
    <div class="record-panel">
      <van-row class="record-panel-head" align="center" justify="space-between" :wrap="false">
        <span class="record-panel-title">{{ $t('mock.recordPanel.title') }}</span>
        <span v-if="activeRuleName" class="record-panel-active">
          {{ $t('mock.recordPanel.activeRule', { rule: activeRuleName }) }}
        </span>
      </van-row>
      <div class="record-panel-url" :title="record?.url">{{ record?.method }} {{ record?.url }}</div>

      <van-search v-model="ruleKeyword" class="record-rule-search"
        :placeholder="$t('mock.recordPanel.searchPlaceholder')" />
      <OverlayScrollbarsComponent class="record-rule-list" :options="scrollOptions" defer>
        <div v-if="rulesLoading" class="record-rule-empty">{{ $t('mock.recordPanel.loading') }}</div>
        <template v-else>
          <van-cell v-for="rule in recordingRules" :key="rule._id" clickable
            :class="{ 'record-rule-selected': selectedRule?._id === rule._id }" @click="selectRule(rule)">
            <template #title>
              <div class="record-rule-title">
                <span class="record-rule-name" :title="rule.name">{{ rule.name }}</span>
                <span v-if="rule.desc" class="record-rule-desc" :title="rule.desc">{{ rule.desc }}</span>
              </div>
            </template>
            <template v-if="rule._id === activeRuleId" #value>
              <van-tag type="success" plain>{{ $t('mock.editor.activeHint') }}</van-tag>
            </template>
          </van-cell>
          <van-cell v-if="showCreateRow" clickable class="record-rule-create" icon="plus"
            :title="$t('mock.recordPanel.createRule', { name: ruleKeyword.trim() })" @click="useCreateName" />
          <div v-if="recordingRules.length === 0 && !showCreateRow" class="record-rule-empty">
            {{ $t('mock.recordPanel.noRules') }}
          </div>
        </template>
      </OverlayScrollbarsComponent>

      <div class="record-target">
        {{ $t('mock.recordPanel.target', { target: targetLabel }) }}
      </div>
      <div v-if="duplicateRecord" class="record-hint record-hint-warn">
        {{ $t('mock.recordPanel.duplicate', {
          variants: duplicateRecord.variants?.length
            ? $t('mock.recordPanel.duplicateVariants', { count: duplicateRecord.variants.length })
            : ''
        }) }}
      </div>
      <div v-if="willReplaceActive" class="record-hint record-hint-info">
        {{ $t('mock.recordPanel.replaceHint', { rule: activeRuleName || activeRuleId }) }}
      </div>

      <van-row class="record-panel-actions actions-bar" align="center" justify="end" :wrap="false">
        <van-button size="small" plain type="primary" :disabled="!canRecord" @click="onRecord(false)">
          {{ duplicateRecord ? $t('mock.recordPanel.updateOnly') : $t('mock.recordPanel.recordOnly') }}
        </van-button>
        <van-button size="small" type="primary" :loading="recording" :disabled="!canRecord"
          @click="onRecord(true)">
          {{ duplicateRecord ? $t('mock.recordPanel.updateEnable') : $t('mock.recordPanel.recordEnable') }}
        </van-button>
      </van-row>

      <div v-if="recentHistory.length > 0" class="record-history">
        <div class="record-history-head">{{ $t('mock.recordPanel.historyTitle') }}</div>
        <van-row v-for="entry in recentHistory" :key="entry.id" class="record-history-row" align="center"
          :wrap="false">
          <div class="record-history-info">
            <span class="record-history-name" :title="entry.recordName || entry.url">
              {{ entry.recordName || entry.url }}
            </span>
            <span class="record-history-meta">
              {{ entry.ruleName }} ·
              {{ entry.created ? $t('mock.recordPanel.actionCreated') : $t('mock.recordPanel.actionUpdated')
              }}
            </span>
          </div>
          <van-button v-if="entry.id === recordHistory[0]?.id" size="mini" plain type="primary"
            :loading="undoing" @click="onUndoRecord(entry)">
            {{ $t('mock.recordPanel.undo') }}
          </van-button>
        </van-row>
      </div>
    </div>
    <template #reference>
      <van-button class="btn-icon-only" plain size="small" type="primary" icon="bookmark-o"
        :title="$t('mock.recordPanel.entry')">
      </van-button>
    </template>
  </van-popover>
</template>

<script lang="ts" setup>
import {
  deleteMockRecord, getActiveMockRule, getMockRecord, getMockRuleDetail, ProxyMock, saveMockRecord, saveMockRule,
  searchMockRules
} from '@shared'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { showConfirmDialog, showNotify, showToast } from 'vant'
import { computed, inject, onUnmounted, PropType, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { scrollOptions } from '../../../common/scroll'
import { describeMockSaveError } from './save-error'
import { cloneRecord } from './record'
import {
  findRecordForRequest, listRecordHistory, MockMgrTarget, MockRecordHistoryEntry, pushRecordHistory,
  RecordRequestResult, recordRequestToRule, removeRecordHistory,
} from './recording'
import { readRecentRuleId, rememberRule } from './rule.recent'

const props = defineProps({
  record: { type: Object as PropType<ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord> },
})

const { t } = useI18n()
const openMockRuleMgr = inject<(target?: MockMgrTarget) => void>('openMockRuleMgr')

const showRecordPanel = ref(false)
const recordingRules = ref<ProxyMock.MockRule[]>([])
const ruleKeyword = ref('')
const selectedRule = ref<ProxyMock.MockRule>(null)
const createMode = ref(false)
const activeRuleId = ref('')
const activeRuleName = ref('')
const duplicateRecord = ref<ProxyMock.MockRecord>(null)
const rulesLoading = ref(false)
const recording = ref(false)
const undoing = ref(false)
const recordHistory = ref<MockRecordHistoryEntry[]>([])

let duplicateSeq = 0
let ruleSearchSeq = 0
let ruleSearchTimer: ReturnType<typeof setTimeout> = null

const recentHistory = computed(() => recordHistory.value.slice(0, 3))

const createName = computed(() => createMode.value ? ruleKeyword.value.trim() : '')
const hasTarget = computed(() => selectedRule.value != null || createName.value !== '')
const showCreateRow = computed(() => {
  const name = ruleKeyword.value.trim()
  if (name === '') return false
  return !recordingRules.value.some(it => it.name === name)
})
const targetLabel = computed(() => {
  if (selectedRule.value != null) return selectedRule.value.name
  if (createName.value !== '') return t('mock.recordPanel.createRule', { name: createName.value })
  return t('mock.recordPanel.noTarget')
})
const willReplaceActive = computed(() => hasTarget.value && activeRuleId.value !== '' &&
  (selectedRule.value == null || selectedRule.value._id !== activeRuleId.value))
const canRecord = computed(() => !recording.value && props.record?.url != null && hasTarget.value)

watch(showRecordPanel, (show) => {
  if (show) onRecordPanelOpen()
})

watch(ruleKeyword, (value) => {
  if (!showRecordPanel.value) return
  if (ruleSearchTimer != null) clearTimeout(ruleSearchTimer)
  if (value.trim() === '') {
    createMode.value = false
    return
  }
  ruleSearchTimer = setTimeout(() => searchRules(value.trim()), 250)
})

async function onRecordPanelOpen() {
  if (props.record?.url == null) {
    showRecordPanel.value = false
    showToast(t('mock.recordPanel.selectRecordFirst'))
    return
  }
  ruleKeyword.value = ''
  createMode.value = false
  selectedRule.value = null
  duplicateRecord.value = null
  recordHistory.value = listRecordHistory()
  await loadRuleList()
  // 优先当前启用规则，其次上次使用过的规则，最后退回列表首项
  const recentId = readRecentRuleId()
  const initial = recordingRules.value.find(it => it._id === activeRuleId.value)
    ?? recordingRules.value.find(it => it._id === recentId)
    ?? recordingRules.value[0] ?? null
  selectRule(initial)
}

async function loadRuleList() {
  rulesLoading.value = true
  try {
    const [activeId, list] = await Promise.all([
      getActiveMockRule().catch(() => ''),
      searchMockRules('').catch(() => [] as ProxyMock.MockRule[])
    ])
    activeRuleId.value = activeId ?? ''
    const items = list ?? []
    let active = items.find(it => it._id === activeRuleId.value)
    // 启用规则可能不在前 15 条搜索结果里，单独补齐名称用于展示
    if (activeRuleId.value !== '' && active == null) {
      const detail = await getMockRuleDetail(activeRuleId.value).catch(() => null)
      if (detail != null) {
        items.unshift(detail)
        active = detail
      }
    }
    activeRuleName.value = active?.name ?? ''
    recordingRules.value = items
  } finally {
    rulesLoading.value = false
  }
}

async function searchRules(keyword: string) {
  const seq = ++ruleSearchSeq
  try {
    const list = await searchMockRules(keyword)
    if (seq !== ruleSearchSeq) return
    recordingRules.value = list ?? []
  } catch (err) {
    // 搜索失败保留上一次列表，避免输入过程中列表闪空
  }
}

function selectRule(rule: ProxyMock.MockRule) {
  selectedRule.value = rule
  createMode.value = false
  void checkDuplicate()
}

function useCreateName() {
  createMode.value = true
  selectedRule.value = null
  duplicateRecord.value = null
}

async function checkDuplicate() {
  const rule = selectedRule.value
  const record = props.record
  const seq = ++duplicateSeq
  duplicateRecord.value = null
  if (rule?._id == null || record?.url == null) return
  // 与录制共用匹配去重：动态参数不再被当成新接口
  const found = await findRecordForRequest(rule._id, record)
  if (seq !== duplicateSeq) return
  duplicateRecord.value = found.record
}

async function onRecord(enable: boolean) {
  if (!canRecord.value) return
  recording.value = true
  try {
    let rule = selectedRule.value
    if (rule == null) {
      const created = new ProxyMock.MockRule()
      created.name = createName.value
      created.desc = ''
      const ruleId = await saveMockRule(created)
      rule = created
      rule._id = ruleId
      selectedRule.value = rule
      recordingRules.value = [rule, ...recordingRules.value]
    }

    const result = await recordRequestToRule({
      rule,
      request: props.record as ProxyMock.ProxyRequestRecord,
      enable,
      existing: duplicateRecord.value,
    })

    recordHistory.value = pushRecordHistory({
      ruleId: rule._id,
      recordId: result.record.id,
      ruleName: rule.name,
      recordName: result.record.name || result.record.url,
      url: result.record.url,
      created: result.created,
      enabled: result.enabled,
      previous: result.previous,
    })
    rememberRule(rule._id)

    if (result.enableError) {
      showNotify({
        message: t('mock.recordPanel.enableFailed', {
          reason: result.enableError || t('mock.recordPanel.enableFailedUnknown')
        }),
        type: 'warning',
        duration: 2500,
        onClick: () => openRecordManager(result),
      })
    } else {
      const action = result.created
        ? t('mock.recordPanel.actionCreated')
        : t('mock.recordPanel.actionUpdated')
      const message = result.enabled
        ? t('mock.recordPanel.successEnabled', { action, rule: rule.name })
        : t('mock.recordPanel.successRecorded', { action, rule: rule.name })
      showNotify({ message, type: 'success', duration: 2500, onClick: () => openRecordManager(result) })
      if (result.enabled) {
        activeRuleId.value = rule._id
        activeRuleName.value = rule.name
      }
    }
    showRecordPanel.value = false
  } catch (err) {
    showNotify({ message: recordErrorMessage(err), type: 'danger', duration: 2000 })
  } finally {
    recording.value = false
  }
}

function openRecordManager(result: RecordRequestResult) {
  openMockRuleMgr?.({ ruleId: result.rule._id, record: result.record })
}

// 只允许撤销最近一次录制：更早的记录可能已被后续录制覆盖，快照不再可靠
async function onUndoRecord(entry: MockRecordHistoryEntry) {
  if (undoing.value || entry.id !== recordHistory.value[0]?.id) return
  try {
    await showConfirmDialog({
      title: t('mock.recordPanel.undoTitle'),
      message: entry.created
        ? t('mock.recordPanel.undoCreateMessage')
        : t('mock.recordPanel.undoUpdateMessage'),
      confirmButtonText: t('mock.recordPanel.undo'),
      cancelButtonText: t('common.cancel')
    })
  } catch (err) {
    return
  }

  undoing.value = true
  try {
    if (entry.created) {
      await deleteMockRecord(entry.recordId)
    } else if (entry.previous != null) {
      // 用最新 updatedAt 写回旧快照，避免覆盖期间的其他窗口修改再次报冲突
      const latest = await getMockRecord(entry.recordId, { silentError: true })
      if (latest == null) {
        recordHistory.value = removeRecordHistory(entry.id)
        showNotify({ message: t('mock.record.missing'), type: 'warning', duration: 1500 })
        return
      }
      const restored = cloneRecord(entry.previous)
      restored.id = latest.id
      restored.updatedAt = latest.updatedAt
      await saveMockRecord(restored, latest.updatedAt, { silentError: true })
    }
    recordHistory.value = removeRecordHistory(entry.id)
    await checkDuplicate()
    showNotify({ message: t('mock.recordPanel.undoSuccess'), type: 'success', duration: 1500 })
  } catch (err) {
    const info = describeMockSaveError(err)
    if (info.kind === 'conflict') {
      showNotify({ message: t('mock.recordPanel.conflictMessage'), type: 'warning', duration: 1800 })
    } else {
      showNotify({ message: t('mock.recordPanel.undoFailed'), type: 'danger', duration: 1800 })
    }
  } finally {
    undoing.value = false
  }
}

function recordErrorMessage(err: unknown): string {
  const info = describeMockSaveError(err)
  if (info.kind === 'duplicateUrl') return t('mock.recordPanel.duplicateMessage')
  if (info.kind === 'conflict') return t('mock.recordPanel.conflictMessage')
  if (info.kind === 'validation') {
    return info.code ? t(`mock.editor.validation.${info.code}`) : t('mock.recordPanel.validationMessage')
  }
  return info.message || t('mock.recordPanel.recordFailed')
}

onUnmounted(() => {
  if (ruleSearchTimer != null) clearTimeout(ruleSearchTimer)
})
</script>

<style scoped>
/* 录制面板：目标规则 + 重复提示 + 录制并启用 */
.record-panel {
  box-sizing: border-box;
  width: min(340px, calc(100vw - 32px));
  padding: var(--app-sp-xl) var(--app-sp-2xl);
}

.record-panel-head {
  gap: var(--app-sp-lg);
}

.record-panel-title {
  font-size: var(--van-font-size-md);
  font-weight: 600;
}

.record-panel-active {
  flex: none;
  color: var(--van-success-color);
  font-size: var(--van-font-size-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 50%;
}

.record-panel-url {
  margin-top: var(--app-sp-md);
  padding: var(--app-sp-sm) var(--app-sp-lg);
  border-radius: var(--van-radius-md);
  background: var(--van-gray-1);
  color: var(--van-text-color-2);
  font-family: var(--app-mono-font);
  font-size: var(--van-font-size-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.record-rule-search {
  margin-top: var(--app-sp-lg);
  padding: var(--app-sp-xs) 0;
  font-size: var(--van-font-size-sm);
  --van-cell-vertical-padding: 0;
}

.record-rule-list {
  max-height: 160px;
  margin-top: var(--app-sp-sm);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
}

.record-rule-list :deep(.van-cell) {
  padding: var(--app-sp-md) var(--app-sp-xl);
}

.record-rule-list :deep(.van-cell__title) {
  min-width: 0;
}

.record-rule-selected {
  background: var(--van-gray-2);
}

.record-rule-title {
  display: flex;
  align-items: baseline;
  gap: var(--app-sp-md);
  min-width: 0;
}

.record-rule-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-rule-desc {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-xs);
}

.record-rule-selected :deep(.van-cell__title),
.record-rule-create :deep(.van-cell__title) {
  color: var(--van-primary-color);
}

.record-rule-empty {
  padding: var(--app-sp-2xl) var(--app-sp-lg);
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
  text-align: center;
}

.record-target {
  margin-top: var(--app-sp-lg);
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.record-hint {
  margin-top: var(--app-sp-md);
  padding: var(--app-sp-sm) var(--app-sp-lg);
  border-radius: var(--van-radius-md);
  font-size: var(--van-font-size-xs);
  line-height: 1.4;
}

.record-hint-warn {
  color: var(--van-warning-color);
  background: color-mix(in srgb, var(--van-warning-color) 12%, transparent);
}

.record-hint-info {
  color: var(--van-primary-color);
  background: color-mix(in srgb, var(--van-primary-color) 8%, transparent);
}

.record-panel-actions {
  margin-top: var(--app-sp-xl);
}

.record-history {
  margin-top: var(--app-sp-xl);
  padding-top: var(--app-sp-lg);
  border-top: 1px solid var(--van-border-color);
}

.record-history-head {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-xs);
}

.record-history-row {
  gap: var(--app-sp-lg);
  margin-top: var(--app-sp-md);
}

.record-history-info {
  display: flex;
  align-items: baseline;
  gap: var(--app-sp-md);
  flex: 1 1 auto;
  min-width: 0;
}

.record-history-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--van-text-color);
  font-size: var(--van-font-size-md);
}

.record-history-meta {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}
</style>
