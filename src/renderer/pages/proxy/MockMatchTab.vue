<template>
  <div class="match-tab">
    <div class="level-bar">
      <span class="bar-label">{{ $t('mock.match.levelLabel') }}</span>
      <van-radio-group :model-value="currentLevel" direction="horizontal" class="level-chips"
        @update:model-value="onLevelClick">
        <van-radio v-for="level in MATCH_LEVELS" :key="level" :name="level">{{ $t(`mock.match.level.${level}`) }}</van-radio>
      </van-radio-group>
    </div>
    <p class="level-hint">{{ $t(`mock.match.levelHint.${currentLevel}`) }}</p>

    <div v-if="pending != null" class="level-preview">
      <div v-if="pending.reason === 'sourceMissing'" class="preview-warn">
        {{ $t('mock.match.sourceMissing') }}
      </div>
      <div v-else-if="diffLines.length === 0" class="preview-empty">{{ $t('mock.match.diffEmpty') }}</div>
      <div v-else class="preview-tags">
        <span v-for="(line, idx) in diffLines" :key="idx" class="preview-tag">{{ line }}</span>
      </div>
      <div class="preview-actions">
        <van-button size="mini" plain @click="pending = null">{{ $t('common.cancel') }}</van-button>
        <van-button size="mini" type="primary" :disabled="pending.reason === 'sourceMissing'"
          @click="applyPending">
          {{ $t('mock.match.apply') }}
        </van-button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">{{ $t('mock.match.identity') }}</div>
      <div class="field-row identity-row">
        <span class="row-label">{{ $t('mock.match.method') }}</span>
        <mini-select v-model="match.method" class="match-select method-select" :options="methodOptions"
          font-size="md" @change="touch" />
      </div>
      <div class="field-row identity-row">
        <span class="row-label">{{ $t('mock.match.host') }}</span>
        <van-field ref="hostField" class="match-field" v-model="match.host"
          :placeholder="$t('mock.match.hostPlaceholder')" @update:model-value="touch" />
      </div>
      <div class="field-row identity-row path-row">
        <span class="row-label">{{ $t('mock.match.path') }}</span>
        <mini-select v-model="match.pathType" class="match-select path-type-select" :options="pathTypeOptions"
          font-size="md" @change="touch" />
        <van-field ref="pathField" class="path-input" v-model="match.path"
          :placeholder="$t('mock.match.pathPlaceholder')" @update:model-value="touch" />
      </div>
      <div v-if="match.pathOriginal && match.pathOriginal !== match.path" class="path-original">
        <span>{{ $t('mock.match.pathParameterized', { original: match.pathOriginal, path: match.path }) }}</span>
        <van-button size="mini" plain type="primary" class="restore-path" @click="restorePath">
          {{ $t('mock.match.restorePath') }}
        </van-button>
      </div>
    </div>

    <div ref="querySection" class="section">
      <div class="section-title">
        <span>{{ $t('mock.match.queryMode') }}</span>
        <van-radio-group :model-value="match.query.mode" direction="horizontal" class="inline-radio"
          @update:model-value="onQueryModeChange">
          <van-radio name="ignore">{{ $t('mock.match.queryIgnore') }}</van-radio>
          <van-radio name="match">{{ $t('mock.match.queryMatch') }}</van-radio>
        </van-radio-group>
      </div>

      <div class="sub-block">
        <div class="sub-head">
          <span class="sub-title">{{ $t('mock.match.queryIgnoreKeys') }}</span>
          <van-tag plain type="primary">{{ match.query.ignoreKeys.length }}</van-tag>
        </div>
        <div class="tag-list">
          <van-tag v-for="key in match.query.ignoreKeys" :key="key" closeable
            :type="ignoreSourceOf(key) === 'suggestion' ? 'warning' : 'primary'" plain
            :title="$t(`mock.match.ignoreSource.${ignoreSourceOf(key)}`)" @close="removeIgnoreKey(key)">
            {{ key }}
          </van-tag>
          <span v-if="match.query.ignoreKeys.length === 0" class="empty-tip">
            {{ $t('mock.match.queryIgnoreEmpty') }}
          </span>
        </div>
        <div class="add-row">
          <van-field v-model="newIgnoreKey" class="add-input" :placeholder="$t('mock.match.addKeyPlaceholder')"
            @keyup.enter="addIgnoreKey" />
          <van-button size="mini" plain type="primary" icon="plus" :disabled="newIgnoreKey.trim() === ''"
            @click="addIgnoreKey" />
        </div>
      </div>

      <div v-if="match.query.mode === 'match'" class="sub-block">
        <van-collapse v-model="expandedSections" :border="false" class="condition-collapse">
          <van-collapse-item name="queryConditions" :border="false">
            <template #title>
              <span class="sub-title">{{ $t('mock.match.conditions') }}</span>
            </template>
            <template #right-icon>
              <van-button size="mini" plain type="primary" icon="plus" @click.stop="onAddCondition" />
            </template>
            <div v-if="match.query.conditions.length === 0" class="empty-tip">
              {{ $t('mock.match.conditionEmpty') }}
            </div>
            <div v-for="(condition, idx) in match.query.conditions" :key="idx" class="condition-row">
              <van-field v-model="condition.key" class="condition-key" :placeholder="$t('mock.match.conditionKey')"
                @update:model-value="touch" />
              <mini-select v-model="condition.op" class="match-select op-select" :options="operatorOptions"
                font-size="md" @change="touch" />
              <van-field v-if="operatorNeedsValue(condition.op)" v-model="condition.value" class="condition-value"
                :placeholder="$t('mock.match.conditionValue')" @update:model-value="touch" />
              <van-icon name="cross" class="row-delete" @click="removeCondition(idx)" />
            </div>
          </van-collapse-item>
        </van-collapse>
        <div class="switch-row">
          <span class="row-label">{{ $t('mock.match.queryAllowExtra') }}</span>
          <van-switch v-model="match.query.allowExtra" size="18px" @change="touch" />
        </div>
        <p class="row-hint">{{ $t('mock.match.queryAllowExtraHint') }}</p>
        <div class="switch-row">
          <span class="row-label">{{ $t('mock.match.queryMultiValue') }}</span>
          <van-radio-group :model-value="match.query.multiValue" direction="horizontal" class="inline-radio"
            @update:model-value="onMultiValueChange">
            <van-radio name="any">{{ $t('mock.match.multiAny') }}</van-radio>
            <van-radio name="all">{{ $t('mock.match.multiAll') }}</van-radio>
          </van-radio-group>
        </div>
      </div>
    </div>

    <div ref="headerSection" class="section">
      <div class="section-title">
        <span>{{ $t('mock.match.headerConditions') }}</span>
        <van-button size="mini" plain type="primary" icon="plus" @click="onAddHeader" />
      </div>
      <div v-if="match.headers.conditions.length === 0" class="empty-tip">{{ $t('mock.match.headerEmpty') }}</div>
      <div v-for="(condition, idx) in match.headers.conditions" :key="idx" class="condition-row">
        <van-field v-model="condition.name" class="condition-key" :placeholder="$t('mock.match.headerName')"
          @update:model-value="touch" />
        <mini-select v-model="condition.op" class="match-select op-select" :options="operatorOptions"
          font-size="md" @change="touch" />
        <van-field v-if="operatorNeedsValue(condition.op)" v-model="condition.value" class="condition-value"
          :placeholder="$t('mock.match.conditionValue')" @update:model-value="touch" />
        <van-icon name="cross" class="row-delete" @click="removeHeader(idx)" />
      </div>
      <div class="suggest-row">
        <span class="row-hint">{{ $t('mock.match.headerSuggest') }}</span>
        <van-tag v-for="name in HEADER_SUGGESTIONS" :key="name" plain type="primary" class="suggest-tag"
          @click="addHeaderSuggestion(name)">
          {{ name }}
        </van-tag>
      </div>
    </div>

    <div class="section">
      <div class="switch-row priority-row">
        <span class="row-label">{{ $t('mock.match.priority') }}</span>
        <van-switch :model-value="match.priority != null" size="18px" @update:model-value="togglePriority" />
        <van-field v-if="match.priority != null" ref="priorityField" v-model="priorityText" type="digit"
          class="priority-input" :placeholder="$t('mock.match.priorityHint')" />
        <span v-else class="row-hint priority-hint">{{ $t('mock.match.priorityAuto') }}</span>
      </div>
    </div>

    <div class="section">
      <div class="switch-row">
        <span class="row-label">{{ $t('mock.match.bodyLabel') }}</span>
        <span class="row-hint">{{ $t('mock.match.bodyHint') }}</span>
      </div>
    </div>

    <mock-stability-panel :record="record" />

    <div class="section test-section">
      <div class="section-title">
        <span>{{ $t('mock.match.test') }}</span>
      </div>
      <div class="test-row">
        <mini-select v-model="testMethod" class="match-select method-select" :options="methodOptions"
          font-size="md" :title="$t('mock.match.method')" />
        <van-field v-model="testUrl" class="test-url" :placeholder="$t('mock.match.testUrlPlaceholder')" />
        <van-button size="mini" type="primary" :loading="testing" @click="runTest">
          {{ $t('mock.match.testRun') }}
        </van-button>
        <van-button size="mini" plain icon="replay" :title="$t('mock.match.testSeed')" @click="seedTest" />
      </div>
      <div v-if="testError" class="test-error">{{ testError }}</div>
      <div v-if="testHit != null" class="test-hit">
        <div class="test-hit-title">
          {{ $t('mock.match.testHit', {
            record: testHit.record?.name || testHit.record?.url || testHit.recordId,
            level: testHit.meta?.level ? $t(`mock.match.level.${testHit.meta.level}`) : '-'
          }) }}
        </div>
        <div v-if="testHit.meta?.ignoredKeys?.length" class="test-hit-meta">
          {{ $t('mock.match.testIgnored', { keys: testHit.meta.ignoredKeys.join(',') }) }}
        </div>
        <div class="test-hit-meta">
          {{ $t('mock.match.testOrdering', {
            value: $t(orderingLabelKey(testHit.meta?.ordering ?? 'updated-at'))
          }) }}
        </div>
        <div v-if="testHit.explain?.conditions?.length" class="explain-list">
          <div v-for="(condition, idx) in testHit.explain.conditions" :key="idx" class="explain-row"
            :class="{ 'is-failed': !condition.passed, 'is-ignored': condition.ignored }">
            <van-tag plain :type="condition.passed ? 'success' : 'danger'" class="explain-tag">
              {{ testHit.explain ? $t(`mock.miss.dim.${condition.dimension}`) : '' }}
            </van-tag>
            <span class="explain-key">{{ condition.key }}</span>
            <span class="explain-value">{{ condition.expected }}</span>
            <span v-if="condition.ignored" class="explain-ignored">{{ $t('mock.match.ignored') }}</span>
          </div>
        </div>
      </div>
      <mock-miss-panel v-if="testMiss != null" :miss="testMiss" @ignore-key="onIgnoreMissKey"
        @loosen="onLoosen" @edit="testMiss = null" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { matchMockRecord, ProxyMock } from '@shared'
import type {
  MatchMockResponse, MockMatchLevel, MockMissDiagnostic, MockMissFailure, MockMultiValueMode,
} from '@shared/mock.models'
import type { FieldInstance } from 'vant'
import { showNotify } from 'vant'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MiniSelect from '../../common/MiniSelect.vue'
import MockMissPanel from './MockMissPanel.vue'
import MockStabilityPanel from './MockStabilityPanel.vue'
import {
  MATCH_LEVELS, MATCH_METHODS, PATH_TYPES, QUERY_OPERATORS, addHeaderCondition, addQueryCondition,
  ensureRecordMatch, operatorNeedsValue, orderingLabelKey, previewLevel, testSeedOf,
} from './mock/match.helper'
import type { LevelPresetPreview } from './mock/match.helper'

const props = defineProps<{ record: ProxyMock.MockRecord }>()
const { t } = useI18n()

const HEADER_SUGGESTIONS = ['x-tenant-id', 'x-user-role', 'x-exp']

const hostField = ref<FieldInstance>()
const pathField = ref<FieldInstance>()
const priorityField = ref<FieldInstance>()
const querySection = ref<HTMLElement>()
const headerSection = ref<HTMLElement>()
const newIgnoreKey = ref('')
const expandedSections = ref<string[]>([])
const priorityText = ref('')
const pending = ref<LevelPresetPreview>(null)
const testing = ref(false)
const testError = ref('')
const testMethod = ref('ANY')
const testUrl = ref('')
const testHit = ref<MatchMockResponse>(null)
const testMiss = ref<MockMissDiagnostic>(null)
let lastUrl = ''

const match = computed(() => props.record?.match)
const currentLevel = computed<MockMatchLevel>(() => match.value?.level ?? 'custom')

const methodOptions = computed(() => MATCH_METHODS.map(value => ({ value, label: value })))
const pathTypeOptions = computed(() => PATH_TYPES.map(value => ({
  value, label: t(`mock.match.pathTypes.${value}`)
})))
const operatorOptions = computed(() => QUERY_OPERATORS.map(value => ({
  value, label: t(`mock.match.op.${value}`)
})))

// 首次渲染就要有可编辑对象，否则模板读取 match.method 会报空
if (props.record != null) {
  ensureRecordMatch(props.record)
  lastUrl = props.record.url ?? ''
}

onMounted(() => {
  ensureMatch()
  seedTest()
})

watch(() => props.record?.id, () => {
  ensureMatch()
  seedTest()
  pending.value = null
  testHit.value = null
  testMiss.value = null
})

// 头部 URL 变化时同步派生 Path/Method，仅在新记录或路径仍跟随 URL 时生效
watch(() => props.record?.url, (url) => {
  const current = match.value
  if (current == null) return
  const nextPath = pathFromUrl(url)
  const previousPath = pathFromUrl(lastUrl)
  const follows = current.path === '' || current.path === previousPath
  lastUrl = url ?? ''
  if (!follows) return
  current.path = nextPath
  const method = props.record?.source?.method
  if (method && current.method === 'ANY') current.method = method
})

function ensureMatch() {
  ensureRecordMatch(props.record)
  lastUrl = props.record?.url ?? ''
}

function pathFromUrl(url: string): string {
  try {
    return new URL(String(url ?? ''), 'http://placeholder.local').pathname
  } catch (err) {
    return ''
  }
}

function touch() {
  if (match.value != null && match.value.level !== 'custom') match.value.level = 'custom'
  pending.value = null
}

// Vant RadioGroup 在 modelValue 被程序替换时也会触发 change，
// 分档应用会因此被误判为手动编辑；这里只处理用户交互产生的 update
function onQueryModeChange(value: 'ignore' | 'match') {
  if (match.value == null) return
  match.value.query.mode = value
  touch()
}

function onMultiValueChange(value: MockMultiValueMode) {
  if (match.value == null) return
  match.value.query.multiValue = value
  touch()
}

// 忽略键来源：自动分析写入 vs 建议待应用 vs 手动添加
function ignoreSourceOf(key: string): 'auto' | 'suggestion' | 'manual' {
  const derivation = match.value?.derivation
  if (derivation?.autoIgnoredKeys?.indexOf(key) >= 0) return 'auto'
  if (derivation?.suggestions?.some(it => it.key === key) === true) return 'suggestion'
  return 'manual'
}

function onLevelClick(level: MockMatchLevel) {
  if (match.value == null) return
  const preview = previewLevel(level, props.record)
  // 已在当前档位且条件无差异时不再弹预览
  if (!preview.changed || (match.value.level === level && preview.diff.empty)) {
    pending.value = null
    return
  }
  pending.value = preview
}

const diffLines = computed<string[]>(() => {
  const preview = pending.value
  if (preview == null || preview.reason === 'sourceMissing') return []
  const diff = preview.diff
  const lines: string[] = []
  if (diff.addedKeys.length > 0) lines.push(t('mock.match.diffAdd', { keys: diff.addedKeys.join(', ') }))
  if (diff.removedKeys.length > 0) lines.push(t('mock.match.diffRemove', { keys: diff.removedKeys.join(', ') }))
  if (diff.ignoredAdded.length > 0) lines.push(t('mock.match.diffIgnore', { keys: diff.ignoredAdded.join(', ') }))
  if (diff.ignoredRemoved.length > 0) {
    lines.push(t('mock.match.diffIgnoreRemove', { keys: diff.ignoredRemoved.join(', ') }))
  }
  if (diff.allowExtraFrom !== diff.allowExtraTo) {
    lines.push(t('mock.match.diffAllowExtra', { value: diff.allowExtraTo ? 'ON' : 'OFF' }))
  }
  if (diff.headersCleared > 0) lines.push(t('mock.match.diffHeaders', { count: diff.headersCleared }))
  if (diff.pathChanged) lines.push(t('mock.match.diffPath'))
  return lines
})

function applyPending() {
  if (pending.value == null || pending.value.reason === 'sourceMissing') return
  props.record.match = pending.value.match
  pending.value = null
}

function restorePath() {
  if (match.value == null) return
  match.value.path = match.value.pathOriginal ?? match.value.path
  match.value.pathOriginal = undefined
  match.value.parameterizedSegmentIndex = null
  touch()
}

function addIgnoreKey() {
  const key = newIgnoreKey.value.trim()
  if (key === '' || match.value == null) return
  if (match.value.query.ignoreKeys.indexOf(key) === -1) match.value.query.ignoreKeys.push(key)
  newIgnoreKey.value = ''
  touch()
}

function removeIgnoreKey(key: string) {
  if (match.value == null) return
  const index = match.value.query.ignoreKeys.indexOf(key)
  if (index >= 0) match.value.query.ignoreKeys.splice(index, 1)
  touch()
}

function onAddCondition() {
  if (match.value == null) return
  addQueryCondition(match.value)
  touch()
}

function removeCondition(index: number) {
  match.value?.query.conditions.splice(index, 1)
  touch()
}

function onAddHeader() {
  if (match.value == null) return
  addHeaderCondition(match.value)
  touch()
}

function addHeaderSuggestion(name: string) {
  if (match.value == null) return
  if (match.value.headers.conditions.some(it => it.name.toLowerCase() === name)) return
  addHeaderCondition(match.value, name)
  touch()
}

function removeHeader(index: number) {
  match.value?.headers.conditions.splice(index, 1)
  touch()
}

function togglePriority(enabled: boolean) {
  if (match.value == null) return
  match.value.priority = enabled ? 0 : null
  priorityText.value = enabled ? '0' : ''
  touch()
}

watch(priorityText, (value) => {
  if (match.value == null || match.value.priority == null) return
  const num = Number.parseInt(value)
  match.value.priority = Number.isFinite(num) ? num : 0
  if (match.value.level !== 'custom') match.value.level = 'custom'
})

function seedTest() {
  const seed = testSeedOf(props.record)
  testMethod.value = seed.method || 'ANY'
  testUrl.value = seed.url ?? ''
}

async function runTest() {
  const url = testUrl.value.trim()
  if (url === '') {
    testError.value = t('mock.match.testUrlRequired')
    return
  }
  if (props.record?.ruleId == null || testing.value) return
  testing.value = true
  testError.value = ''
  testHit.value = null
  testMiss.value = null
  try {
    const result = await matchMockRecord({
      ruleId: props.record.ruleId,
      method: testMethod.value,
      url,
      headers: props.record.source?.headers,
    }, { silentError: true })
    if (result?.matched) testHit.value = result
    else testMiss.value = result?.meta?.miss ?? null
    if (!result?.matched && testMiss.value == null) testError.value = t('mock.match.testNotEnabled')
  } catch (err) {
    testError.value = t('mock.match.testFailed')
  } finally {
    testing.value = false
  }
}

// 测试面板中的「忽略该参数」写回当前草稿，保存后即可命中
function onIgnoreMissKey(failure: MockMissFailure) {
  if (match.value == null || failure?.key == null) return
  const target = failure.dimension === 'header'
    ? match.value.headers.ignoreKeys
    : match.value.query.ignoreKeys
  if (target.indexOf(failure.key) === -1) target.push(failure.key)
  touch()
  testMiss.value = null
  showNotify({ message: t('mock.match.ignoreApplied', { key: failure.key }), type: 'success', duration: 800 })
}

function onLoosen() {
  if (match.value == null) return
  const preview = previewLevel('loose', props.record)
  props.record.match = preview.match
  testMiss.value = null
  showNotify({ message: t('mock.match.loosenApplied'), type: 'success', duration: 800 })
}

function focusField(code: string) {
  if (match.value == null) ensureMatch()
  if (code === 'methodInvalid') {
    querySection.value?.scrollIntoView({ block: 'nearest' })
    return
  }
  if (code === 'hostInvalid') {
    hostField.value?.focus()
    return
  }
  if (code === 'pathEmpty' || code.startsWith('pathRegex')) {
    pathField.value?.focus()
    return
  }
  if (code === 'priorityInvalid') {
    priorityField.value?.focus()
    return
  }
  if (code.startsWith('header')) {
    headerSection.value?.scrollIntoView({ block: 'nearest' })
    nextTick(() => {
      const input = headerSection.value?.querySelector('input') as HTMLInputElement
      input?.focus()
    })
    return
  }
  querySection.value?.scrollIntoView({ block: 'nearest' })
  nextTick(() => {
    const input = querySection.value?.querySelector('input') as HTMLInputElement
    input?.focus()
  })
}

defineExpose({ focusField })
</script>

<style scoped>
.match-tab {
  /* 控件尺寸统一由字号推导：md 13px 时 28px 高、24px 行高，与改动前的固定值一致 */
  --match-control-height: calc(var(--van-font-size-md) * 2.1538);
  --match-control-line-height: calc(var(--van-font-size-md) * 1.8462);
  --match-control-padding-y: calc(var(--van-font-size-md) * .3077);
  --mini-select-bar-height: var(--match-control-height);
  /* 间距档位：全部由字号推导，切换字号时等比缩放 */
  --sp-xl: calc(var(--van-font-size-md) * 0.7692);
  --sp-lg: calc(var(--van-font-size-md) * 0.6154);
  --sp-md: calc(var(--van-font-size-md) * 0.4615);
  --sp-sm: calc(var(--van-font-size-md) * 0.3077);
  --sp-xs: calc(var(--van-font-size-md) * 0.1538);
  display: flex;
  flex-direction: column;
  gap: var(--sp-lg);
  padding-bottom: var(--sp-lg);
}

/* mini 按钮默认继承 xs，表单里统一提到 sm，高度也随字号一起变化 */
.match-tab :deep(.van-button--mini) {
  height: var(--match-control-line-height);
  padding: 0 var(--match-control-padding-y);
  font-size: var(--van-font-size-sm);
}

/* 键名/建议 Header 等标签是内容而非徽标，跟随 sm */
.match-tab :deep(.van-tag) {
  font-size: var(--van-font-size-sm);
}

.level-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-lg);
  flex-wrap: wrap;
  margin-top: var(--sp-lg);
}

.bar-label {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
}

.level-chips {
  display: flex;
  gap: var(--sp-md);
  flex-wrap: wrap;
}

.level-hint {
  margin: calc(var(--sp-xs) * -1) 0 0;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

.level-preview {
  display: flex;
  align-items: center;
  gap: var(--sp-md);
  padding: var(--sp-sm) var(--sp-md);
  border: 1px solid var(--van-primary-color);
  border-radius: var(--van-radius-lg);
  background: color-mix(in srgb, var(--van-primary-color) 6%, transparent);
}

.preview-warn {
  flex: 1;
  color: var(--van-warning-color);
  font-size: var(--van-font-size-sm);
}

.preview-empty {
  flex: 1;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

.preview-tags {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-xs);
}

.preview-tag {
  padding: 2px 8px;
  border-radius: var(--van-radius-sm);
  background: color-mix(in srgb, var(--van-primary-color) 12%, transparent);
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-xs);
  line-height: 1.5;
}

.preview-actions {
  display: flex;
  gap: var(--sp-xs);
  flex-shrink: 0;
}

.section {
  padding: var(--sp-lg);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-lg);
  background: var(--van-background-2);
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-lg);
  margin-bottom: var(--sp-md);
  color: var(--van-text-color);
  font-size: var(--van-font-size-md);
  font-weight: 500;
}

.field-row {
  display: flex;
  align-items: center;
  gap: var(--sp-lg);
  padding: var(--sp-xs) 0;
}

.path-row {
  flex-wrap: wrap;
}

.row-label {
  flex: none;
  min-width: calc(var(--van-font-size-md) * 3.692);
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
}

/* 请求标识三行统一：标签固定列宽、置灰、右对齐，控件同宽描边 */
.identity-row .row-label {
  width: calc(var(--van-font-size-md) * 4.769);
  min-width: calc(var(--van-font-size-md) * 4.769);
  text-align: right;
}

.match-field,
.path-input {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--match-control-height);
  padding: 0 var(--sp-lg);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
  background: var(--van-background-2);
}

.match-field::after,
.path-input::after {
  display: none;
}

.match-field :deep(.van-field__body),
.path-input :deep(.van-field__body) {
  height: 100%;
}

.match-select {
  flex: none;
}

.method-select {
  width: calc(var(--van-font-size-md) * 6.769);
}

.path-type-select {
  width: calc(var(--van-font-size-md) * 6.308);
}

.path-input {
  flex: 1 1 calc(var(--van-font-size-md) * 12.308);;
}

.path-original {
  display: flex;
  align-items: center;
  gap: var(--sp-lg);
  margin-top: var(--sp-sm);
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
  word-break: break-all;
}

/* 长路径只挤说明文字，按钮保持单行 */
.path-original .restore-path {
  flex: none;
  white-space: nowrap;
}

.inline-radio :deep(.van-radio) {
  margin-right: calc(var(--van-font-size-md) * 0.769);
}

.inline-radio :deep(.van-radio__label) {
  font-size: var(--van-font-size-md);
}

.sub-block {
  margin-top: var(--sp-lg);
  padding-top: var(--sp-lg);
  border-top: 1px dashed var(--van-border-color);
}

.sub-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-lg);
  margin-bottom: var(--sp-sm);
}

.sub-title {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
}

/* 匹配条件用折叠面板，标题行贴合区块样式，内容区不额外缩进 */
.condition-collapse :deep(.van-collapse-item > .van-cell) {
  padding: var(--sp-xs) 0;
}

.condition-collapse :deep(.van-collapse-item__content) {
  padding: var(--sp-sm) 0 0;
}

.condition-collapse :deep(.van-collapse-item__title) {
  min-width: 0;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-md);
  min-height: calc(var(--van-font-size-md) * 1.692);
}

.tag-list :deep(.van-tag) {
  font-family: var(--mono-font);
}

.add-row {
  display: flex;
  align-items: center;
  gap: var(--sp-md);
  margin-top: var(--sp-md);
}

.add-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--match-control-padding-y) var(--sp-lg);
  line-height: var(--match-control-line-height);
  border-radius: var(--van-radius-md);
}

.empty-tip {
  padding: var(--sp-xs) 0;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

.condition-row {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  margin-bottom: var(--sp-sm);
}

.condition-key {
  flex: 0 0 32%;
  min-width: 0;
  height: var(--match-control-height);
  padding: 0 var(--sp-lg);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
  background: var(--van-background-2);
}

.condition-key::after {
  display: none;
}

.condition-key :deep(.van-field__body) {
  height: 100%;
}

.op-select {
  width: calc(var(--van-font-size-md) * 8.462);
}

.condition-value {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--match-control-height);
  padding: 0 var(--sp-lg);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
  background: var(--van-background-2);
}

.condition-value::after {
  display: none;
}

.condition-value :deep(.van-field__body) {
  height: 100%;
}

.row-delete {
  flex: none;
  padding: var(--sp-md);
  color: var(--van-danger-color);
  cursor: pointer;
}

.row-hint {
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

.switch-row {
  display: flex;
  align-items: center;
  gap: var(--sp-lg);
  padding: var(--sp-xs) 0;
}

/* 开关与输入框切换时保持行高不变，避免整行跳动 */
.priority-row {
  min-height: calc(var(--match-control-height) + var(--match-control-padding-y));
}

.priority-input {
  width: calc(var(--van-font-size-md) * 7.385);
  padding: 0 var(--sp-lg);
  border-radius: var(--van-radius-md);
}

.priority-input :deep(.van-field__value) {
  padding: 0;
}

.priority-input :deep(.van-field__control) {
  height: var(--match-control-height);
}

.priority-hint {
  overflow: hidden;
  line-height: var(--match-control-height);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggest-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-md);
  margin-top: var(--sp-md);
}

.suggest-tag {
  cursor: pointer;
}

.test-row {
  display: flex;
  align-items: center;
  gap: var(--sp-md);
  flex-wrap: wrap;
}

.test-url {
  flex: 1 1 calc(var(--van-font-size-md) * 15.385);
  min-width: 0;
  height: var(--match-control-height);
  padding: 0 var(--sp-lg);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
  background: var(--van-background-2);
}

.test-url::after {
  display: none;
}

.test-url :deep(.van-field__body) {
  height: 100%;
}

.test-error {
  margin-top: var(--sp-md);
  color: var(--van-danger-color);
  font-size: var(--van-font-size-sm);
}

.test-hit {
  margin-top: var(--sp-lg);
  padding: var(--sp-lg);
  border: 1px solid var(--van-success-color);
  border-radius: var(--van-radius-lg);
  background: color-mix(in srgb, var(--van-success-color) 6%, transparent);
}

.test-hit-title {
  color: var(--van-success-color);
  font-size: var(--van-font-size-md);
  font-weight: 500;
}

.test-hit-meta {
  margin-top: var(--sp-xs);
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.explain-list {
  margin-top: var(--sp-md);
  display: flex;
  flex-direction: column;
  gap: var(--sp-xs);
}

.explain-row {
  display: flex;
  align-items: center;
  gap: var(--sp-md);
  font-size: var(--van-font-size-sm);
}

.explain-tag {
  flex: none;
}

.explain-key {
  flex: none;
  font-family: var(--mono-font);
}

.explain-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--van-text-color-2);
}

.explain-ignored {
  flex: none;
  color: var(--van-text-color-3);
}

.is-failed .explain-value {
  color: var(--van-danger-color);
}

.is-ignored {
  opacity: 0.65;
}
</style>