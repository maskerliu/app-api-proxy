<template>
  <van-form ref="detailContainer" label-align="right" colon>
    <div ref="urlBar" class="url-bar" :style="{ top: `${stickyTop}px`, marginTop: `${stickyTop}px` }">
      <van-cell-group inset title="">
        <van-cell center>
          <template #title>
            <div class="van-ellipsis">{{ record.url }}</div>
          </template>
          <template #right-icon>
            <van-button style="margin: 0 10px;" plain size="small" type="success" icon="description"
              @click="copyLink" />
            <van-popover v-model:show="showRecordPanel" placement="bottom-end" teleport="body" class="record-popover"
              :offset="[0, 6]">
              <div class="record-panel">
                <div class="record-panel-head">
                  <span class="record-panel-title">{{ $t('mock.recordPanel.title') }}</span>
                  <span v-if="activeRuleName" class="record-panel-active">
                    {{ $t('mock.recordPanel.activeRule', { rule: activeRuleName }) }}
                  </span>
                </div>
                <div class="record-panel-url" :title="record?.url">{{ record?.method }} {{ record?.url }}</div>

                <van-field v-model="ruleKeyword" clearable class="record-rule-search"
                  :label="$t('mock.recordPanel.targetRule')" :placeholder="$t('mock.recordPanel.searchPlaceholder')" />
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

                <div class="record-panel-actions">
                  <van-button size="small" plain type="primary" :disabled="!canRecord" @click="onRecord(false)">
                    {{ duplicateRecord ? $t('mock.recordPanel.updateOnly') : $t('mock.recordPanel.recordOnly') }}
                  </van-button>
                  <van-button size="small" type="primary" :loading="recording" :disabled="!canRecord"
                    @click="onRecord(true)">
                    {{ duplicateRecord ? $t('mock.recordPanel.updateEnable') : $t('mock.recordPanel.recordEnable') }}
                  </van-button>
                </div>

                <div v-if="recentHistory.length > 0" class="record-history">
                  <div class="record-history-head">{{ $t('mock.recordPanel.historyTitle') }}</div>
                  <div v-for="entry in recentHistory" :key="entry.id" class="record-history-row">
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
                  </div>
                </div>
              </div>
              <template #reference>
                <van-button plain size="small" type="primary" icon="bookmark-o" :title="$t('mock.recordPanel.entry')">
                </van-button>
              </template>
            </van-popover>
          </template>
        </van-cell>
      </van-cell-group>
    </div>

    <section v-if="mockMeta?.hit" class="mock-hit">
      <header class="hit-head">
        <van-icon name="passed" class="hit-icon" />
        <span class="hit-title">{{ $t('mock.hit.title') }}</span>
        <van-tag v-if="mockMeta.level" plain type="primary">
          {{ $t(`mock.match.level.${mockMeta.level}`) }}
        </van-tag>
        <van-tag v-if="mockMeta.variantId" plain type="success">{{ $t('mock.hit.variant') }}</van-tag>
      </header>
      <div class="hit-line">
        <span class="hit-label">{{ $t('mock.hit.record') }}</span>
        <span class="hit-value">{{ hitRecord?.name || hitRecord?.url || mockMeta.recordId }}</span>
        <van-button size="mini" plain type="primary" @click="openHitRecord">{{ $t('mock.hit.open') }}</van-button>
      </div>
      <div v-if="hitRecord" class="hit-line">
        <span class="hit-label">{{ $t('mock.hit.conditions') }}</span>
        <span class="hit-value">{{ summaryText(hitRecord, $t) }}</span>
      </div>
      <div v-if="mockMeta.ignoredKeys?.length" class="hit-line">
        <span class="hit-label">{{ $t('mock.hit.ignored', { count: mockMeta.ignoredKeys.length }) }}</span>
        <span class="hit-value mono">{{ mockMeta.ignoredKeys.join(',') }}</span>
        <van-button size="mini" plain type="warning" @click="openHitRecord">{{ $t('mock.hit.tighten') }}</van-button>
      </div>
      <div class="hit-line hit-meta">
        <span v-if="mockMeta.ordering">{{ $t('mock.hit.orderingValue', { value: $t(orderingLabelKey(mockMeta.ordering)) }) }}</span>
        <span v-if="mockMeta.elapsedMs != null">{{ $t('mock.hit.elapsed', { ms: mockMeta.elapsedMs }) }}</span>
      </div>
      <div v-if="mockMeta.degraded" class="hit-degraded">{{ $t('mock.hit.degraded') }}</div>
    </section>

    <mock-miss-panel v-else-if="mockMeta?.miss" :miss="mockMeta.miss" :degraded="mockMeta.degraded"
      class="detail-miss" @ignore-key="onMissIgnore" @loosen="onMissLoosen" @edit="openMissRecord" />

    <van-collapse v-model="expandedHeaders" :border="false" class="header-collapse" @transitionend="syncResponseFill">
      <van-collapse-item name="requestHeader" :title="$t('proxy.requestHeader')">
        <div class="header-list">
          <div v-for="(item, idx) in requestHeaders" :key="`${item.key}-${idx}`" class="header-row">
            <span class="header-key">{{ item.key }}</span>
            <span class="header-value">{{ item.value }}</span>
          </div>
        </div>
      </van-collapse-item>
    </van-collapse>

    <van-collapse v-model="expandedHeaders" :border="false" class="header-collapse" @transitionend="syncResponseFill">
      <van-collapse-item name="responseHeader" :title="$t('proxy.responseHeader')">
        <div class="header-list">
          <div v-for="(item, idx) in responseHeaders" :key="`${item.key}-${idx}`" class="header-row">
            <span class="header-key">{{ item.key }}</span>
            <span class="header-value">{{ item.value }}</span>
          </div>
        </div>
      </van-collapse-item>
    </van-collapse>

    <van-collapse v-if="requestParams.length > 0" v-model="expandedHeaders" :border="false" class="header-collapse"
      @transitionend="syncResponseFill">
      <van-collapse-item name="requestParams" :title="$t('proxy.requestParams')">
        <div class="header-list">
          <div v-for="(item, idx) in requestParams" :key="`${item.key}-${idx}`" class="header-row">
            <span class="header-key">{{ item.key }}</span>
            <span class="header-value">{{ item.value }}</span>
          </div>
        </div>
      </van-collapse-item>
    </van-collapse>

    <van-cell-group class="detail-content body-group" inset :title="$t('proxy.requestBody')" v-if="record.data != null">
      <van-cell class="detail-content">
        <proxy-request-body :data="record.data" :headers="record.headers" />
      </van-cell>
    </van-cell-group>

    <van-cell-group ref="detailResp" class="detail-content body-group" inset :title="$t('proxy.responseBody')"
      style="margin-bottom: 5px;">
      <van-cell style="padding: 0;">
        <template #value>
          <vue-ace-editor ref="responseEditor" :fold="false" :fill="true" :fill-max-inset="stickyInset" searchable
            :data="record.responseData == null ? '{}' : JSON.stringify(record.responseData, null, '\t')" />
        </template>
      </van-cell>
    </van-cell-group>
  </van-form>
</template>

<script lang="ts" setup>
import {
  deleteMockRecord, getActiveMockRule, getMockRecord, getMockRuleDetail, ProxyMock, saveMockRecord, saveMockRule,
  searchMockRules
} from '@shared'
import type { MockHitMeta, MockMissFailure } from '@shared/mock.models'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { Form, showConfirmDialog, showNotify, showToast } from 'vant'
import { computed, inject, nextTick, onMounted, onUnmounted, PropType, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { scrollOptions } from '../../common/scroll'
import VueAceEditor from '../components/VueAceEditor.vue'
import MockMissPanel from './MockMissPanel.vue'
import { ensureRecordMatch, orderingLabelKey, previewLevel, summaryText } from './mock/match.helper'
import { describeMockSaveError } from './mock/mock.errors'
import { cloneRecord } from './mock/mock.record'
import type { MockRecordHistoryEntry } from './mock/record.history'
import { listRecordHistory, pushRecordHistory, removeRecordHistory } from './mock/record.history'
import { findRecordForRequest, MockMgrTarget, RecordRequestResult, recordRequestToRule } from './mock/recording'
import ProxyRequestBody from './ProxyRequestBody.vue'

// 吸顶位置相对右侧滚动容器计算：electron 标题栏拖拽区 32px，容器顶部距窗口 5px，
// 留 25px 使卡片上沿稳定停在拖拽区下方。margin-top 同步加同样距离，
// 让卡片原位就等于吸顶位置，否则吸顶后会压住下方请求头，破坏与其它区块一致的间距
const stickyTop = window.isWeb ? 0 : 25

const props = defineProps({
  record: { type: Object as PropType<ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord> },
})

const { t } = useI18n()

const detailContainer = ref<typeof Form>()
const detailResp = ref()
const urlBar = ref<HTMLElement>()
const responseEditor = ref<InstanceType<typeof VueAceEditor>>()
// 吸顶区块占据的高度：响应体编辑器的最大高度 = 父容器高度 - 该值
const stickyInset = ref(stickyTop)
const apiDesc = ref<string>(null)
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
const hitRecord = ref<ProxyMock.MockRecord>(null)
const mockMeta = computed<MockHitMeta>(() => (props.record as ProxyMock.ProxyRequestRecord)?.mock ?? null)

let duplicateSeq = 0
let ruleSearchSeq = 0
let ruleSearchTimer: ReturnType<typeof setTimeout> = null

const RECENT_RULE_KEY = 'mock.lastRuleId'
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

const expandedHeaders = ref<string[]>([])

interface HeaderEntry {
  key: string
  value: string
}

// 值可能是数组（如 set-cookie、同名 query 参数），按多行展示，和 Chrome 一致
function toKeyValueEntries(source: Record<string, any> | null | undefined): HeaderEntry[] {
  if (source == null) return []
  return Object.keys(source).map(key => {
    const value = source[key]
    const text = Array.isArray(value) ? value.map(it => String(it ?? '')).join('\n')
      : typeof value === 'object' && value != null ? JSON.stringify(value) : String(value ?? '')
    return { key, value: text }
  })
}

const requestHeaders = computed(() => toKeyValueEntries(props.record?.headers))
const responseHeaders = computed(() => toKeyValueEntries(props.record?.responseHeaders))
const requestParams = computed(() => toKeyValueEntries(props.record?.requestData))

function syncResponseFill() {
  // 展开折叠块时保留响应体当前高度，让页面滚动高度随内容增长；收起时再补足剩余空间
  responseEditor.value?.syncFillHeight(false)
}

// 请求体区块随记录有没有而增减，responseBody 的顶部位置会变，需要重新贴合父容器底部
watch(() => props.record, () => nextTick(() => responseEditor.value?.syncFillHeight()))

// 命中元数据只带 recordId，详情区按 id 补名称并支持跳转编辑
watch(() => mockMeta.value?.recordId, async (recordId) => {
  hitRecord.value = null
  if (recordId == null) return
  try {
    hitRecord.value = await getMockRecord(recordId, { silentError: true })
  } catch (err) {
    // 记录可能已被删除，保留 id 展示即可
  }
}, { immediate: true })

function openHitRecord() {
  const record = hitRecord.value
  if (record?.ruleId != null) {
    openMockRuleMgr?.({ ruleId: record.ruleId, record })
    return
  }
  showToast(t('mock.record.missing'))
}

async function openMissRecord() {
  const miss = mockMeta.value?.miss
  if (miss == null) return
  try {
    const record = await getMockRecord(miss.recordId, { silentError: true })
    if (record?.ruleId == null) {
      showToast(t('mock.record.missing'))
      return
    }
    openMockRuleMgr?.({ ruleId: record.ruleId, record })
  } catch (err) {
    showToast(t('mock.record.missing'))
  }
}

// 未命中动作直接写回记录：先取最新版本，避免覆盖其他窗口的修改
async function saveMatch(recordId: string, mutate: (record: ProxyMock.MockRecord) => void): Promise<boolean> {
  if (recordId == null) return false
  try {
    const latest = await getMockRecord(recordId, { silentError: true })
    if (latest == null) {
      showNotify({ message: t('mock.record.missing'), type: 'warning', duration: 1200 })
      return false
    }
    ensureRecordMatch(latest)
    mutate(latest)
    await saveMockRecord(latest, latest.updatedAt, { silentError: true })
    return true
  } catch (err) {
    const info = describeMockSaveError(err)
    const message = info.kind === 'conflict'
      ? t('mock.recordPanel.conflictMessage')
      : t('mock.miss.applyFailed')
    showNotify({ message, type: 'warning', duration: 1500 })
    return false
  }
}

async function onMissIgnore(failure: MockMissFailure) {
  const recordId = mockMeta.value?.miss?.recordId
  if (recordId == null || failure?.key == null) return
  const saved = await saveMatch(recordId, (record) => {
    if (record.match == null) return
    const target = failure.dimension === 'header'
      ? record.match.headers.ignoreKeys
      : record.match.query.ignoreKeys
    if (target.indexOf(failure.key) === -1) target.push(failure.key)
    if (record.match.level !== 'custom') record.match.level = 'custom'
  })
  if (saved) showNotify({ message: t('mock.miss.ignoreSaved', { key: failure.key }), type: 'success', duration: 1200 })
}

async function onMissLoosen() {
  const recordId = mockMeta.value?.miss?.recordId
  if (recordId == null) return
  const saved = await saveMatch(recordId, (record) => {
    record.match = previewLevel('loose', record).match
  })
  if (saved) showNotify({ message: t('mock.miss.loosenSaved'), type: 'success', duration: 1200 })
}

function measureStickyInset() {
  stickyInset.value = stickyTop + (urlBar.value?.offsetHeight ?? 0)
}

// 吸顶卡片高度随内容/主题变化，同步更新响应体可用的最大高度
let urlBarObserver: ResizeObserver

onMounted(() => {
  measureStickyInset()
  urlBarObserver = new ResizeObserver(measureStickyInset)
  if (urlBar.value) urlBarObserver.observe(urlBar.value)
})

onUnmounted(() => {
  urlBarObserver?.disconnect()
  if (ruleSearchTimer != null) clearTimeout(ruleSearchTimer)
})

// watch(props.record, () => {
//   updated()
// })

async function copyLink() {
  const url = props.record?.url
  if (url == null) {
    showToast(t('mock.recordPanel.selectRecordFirst'))
    return
  }

  try {
    if (window.mainApi) {
      await window.mainApi.writeClipboard(url)
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
    } else {
      fallbackCopy(url)
    }
    showToast(`[ ${url} ] ${t('mock.recordPanel.copied')}`)
  } catch (err) {
    showToast(t('common.copyFailed'))
  }
}

function fallbackCopy(text: string) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) throw new Error('copy failed')
}

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

function readRecentRuleId(): string {
  try {
    return window.localStorage.getItem(RECENT_RULE_KEY) ?? ''
  } catch (err) {
    return ''
  }
}

function rememberRule(ruleId: string) {
  if (ruleId == null || ruleId === '') return
  try {
    window.localStorage.setItem(RECENT_RULE_KEY, ruleId)
  } catch (err) {
    // 隐私模式等场景写不进去，不影响录制
  }
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

function updated() {
  this.$refs.inspectorPanel.scrollTop = 0
  this.$nextTick(() => {
    // detailContainer.value.$el.scrollTop = detailResp.value.$el.getBoundingClientRect().top
  })
}
</script>

<style scoped>
.detail-content {}

.url-bar {
  position: sticky;
  z-index: 99;
}

/* 长 URL 不换行时标题项默认不收缩，会把右侧录制按钮挤出 van-cell（其 overflow:hidden 会直接裁掉） */
.url-bar :deep(.van-cell__title) {
  min-width: 0;
}

.header-collapse {
  margin: var(--van-padding-md) var(--van-padding-md) 0;
  overflow: hidden;
  border-radius: var(--van-radius-lg);
  background: var(--van-cell-group-background);
}

/* 内容区块与折叠头部同宽：抵消 cell-group inset 的默认 5px 边距 */
.body-group {
  margin-left: var(--van-padding-md);
  margin-right: var(--van-padding-md);
}

/* inset 模式下标题渲染为分组的上一个兄弟节点，与上方折叠区块的间距需加在标题上 */
:deep(.van-cell-group__title--inset) {
  margin-top: calc(var(--van-padding-md));
}

.header-list {
  display: grid;
  grid-template-columns: fit-content(40%) minmax(0, 1fr);
  column-gap: 16px;
  row-gap: 6px;
  padding: 5px 15px;
  /* 与 Ace 编辑器（ace.css .ace_editor 默认栈）保持一致 */
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'Source Code Pro', 'source-code-pro', monospace;
  font-size: var(--van-font-size-md);
  user-select: text;
}

.header-row {
  display: contents;
}

.header-key {
  color: var(--van-text-color-2);
  word-break: break-all;
}

.header-value {
  color: var(--van-text-color);
  white-space: pre-line;
  word-break: break-all;
}

/* 命中解释：命中记录、忽略键、排序依据与耗时同属一个区块 */
.mock-hit {
  margin: var(--van-padding-md) var(--van-padding-md) 0;
  padding: 8px 12px;
  border: 1px solid var(--van-success-color);
  border-radius: var(--van-radius-lg);
  background: rgba(7, 193, 96, 0.08);
}

.hit-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hit-icon {
  color: var(--van-success-color);
}

.hit-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--van-font-size-md);
  font-weight: 600;
}

.hit-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.hit-label {
  flex: none;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.hit-value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--van-font-size-sm);
}

.hit-value.mono {
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
}

.hit-meta {
  gap: 16px;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-xs);
}

.hit-degraded {
  margin-top: 6px;
  color: var(--van-warning-color);
  font-size: var(--van-font-size-xs);
}

.detail-miss {
  margin: var(--van-padding-md) var(--van-padding-md) 0;
}

/* 录制面板：目标规则 + 重复提示 + 录制并启用 */
.record-panel {
  box-sizing: border-box;
  width: min(340px, calc(100vw - 32px));
  padding: 10px 12px;
}

.record-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
  margin-top: 6px;
  padding: 4px 8px;
  border-radius: var(--van-radius-md);
  background: var(--van-gray-1);
  color: var(--van-text-color-2);
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: var(--van-font-size-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.record-rule-search {
  margin-top: 8px;
  padding: 2px 0;
  font-size: var(--van-font-size-sm);
}

.record-rule-search :deep(.van-field__label) {
  color: var(--van-text-color-2);
}

.record-rule-list {
  max-height: 160px;
  margin-top: 4px;
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
}

.record-rule-list :deep(.van-cell) {
  padding: 6px 10px;
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
  gap: 6px;
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
  padding: 12px 8px;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
  text-align: center;
}

.record-target {
  margin-top: 8px;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.record-hint {
  margin-top: 6px;
  padding: 4px 8px;
  border-radius: var(--van-radius-md);
  font-size: var(--van-font-size-xs);
  line-height: 1.4;
}

.record-hint-warn {
  color: var(--van-warning-color);
  background: rgba(255, 151, 106, 0.12);
}

.record-hint-info {
  color: var(--van-primary-color);
  background: rgba(25, 137, 250, 0.08);
}

.record-panel-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.record-history {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--van-border-color);
}

.record-history-head {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-xs);
}

.record-history-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.record-history-info {
  display: flex;
  align-items: baseline;
  gap: 6px;
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
