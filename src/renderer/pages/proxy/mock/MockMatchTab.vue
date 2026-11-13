<template>
  <div class="match-tab">
    <van-row class="level-bar" align="center">
      <span class="bar-label">{{ $t('mock.match.levelLabel') }}</span>
      <van-radio-group :model-value="currentLevel" direction="horizontal" class="level-chips"
        @update:model-value="onLevelClick">
        <van-radio v-for="level in MATCH_LEVELS" :key="level" :name="level">{{ $t(`mock.match.level.${level}`)
        }}</van-radio>
      </van-radio-group>
    </van-row>
    <p class="level-hint">{{ $t(`mock.match.levelHint.${currentLevel}`) }}</p>

    <van-row v-if="pending != null" class="level-preview" align="center" :wrap="false">
      <div v-if="pending.reason === 'sourceMissing'" class="preview-warn">
        {{ $t('mock.match.sourceMissing') }}
      </div>
      <div v-else-if="diffLines.length === 0" class="preview-empty">{{ $t('mock.match.diffEmpty') }}</div>
      <van-row v-else class="preview-tags">
        <span v-for="(line, idx) in diffLines" :key="idx" class="preview-tag">{{ line }}</span>
      </van-row>
      <van-row class="preview-actions" :wrap="false">
        <van-button size="mini" plain @click="pending = null">{{ $t('common.cancel') }}</van-button>
        <van-button size="mini" type="primary" :disabled="pending.reason === 'sourceMissing'" @click="applyPending">
          {{ $t('mock.match.apply') }}
        </van-button>
      </van-row>
    </van-row>

    <div class="section">
      <van-row class="section-title" align="center" justify="space-between" :wrap="false">
        {{ $t('mock.match.identity') }}
      </van-row>
      <van-row class="field-row identity-row" align="center" :wrap="false">
        <span class="row-label">{{ $t('mock.match.method') }}</span>
        <mini-select v-model="match.method" class="match-select method-select" :options="methodOptions" font-size="md"
          @change="touch" />
      </van-row>
      <van-row class="field-row identity-row" align="center" :wrap="false">
        <span class="row-label">{{ $t('mock.match.host') }}</span>
        <van-field ref="hostField" class="match-field" v-model="match.host"
          :placeholder="$t('mock.match.hostPlaceholder')" @update:model-value="touch" />
      </van-row>
      <van-row class="field-row identity-row path-row" align="center">
        <span class="row-label">{{ $t('mock.match.path') }}</span>
        <mini-select v-model="match.pathType" class="match-select path-type-select" :options="pathTypeOptions"
          font-size="md" @change="touch" />
        <van-field ref="pathField" class="path-input" v-model="match.path"
          :placeholder="$t('mock.match.pathPlaceholder')" @update:model-value="touch" />
      </van-row>
      <van-row v-if="match.pathOriginal && match.pathOriginal !== match.path" class="path-original" align="center"
        :wrap="false">
        <span>{{ $t('mock.match.pathParameterized', { original: match.pathOriginal, path: match.path }) }}</span>
        <van-button size="mini" plain type="primary" class="restore-path" @click="restorePath">
          {{ $t('mock.match.restorePath') }}
        </van-button>
      </van-row>
    </div>

    <div ref="querySection" class="section">
      <van-row class="section-title" align="center" justify="space-between" :wrap="false">
        <span>{{ $t('mock.match.queryMode') }}</span>
        <van-radio-group :model-value="match.query.mode" direction="horizontal" class="inline-radio"
          @update:model-value="onQueryModeChange">
          <van-radio name="ignore">{{ $t('mock.match.queryIgnore') }}</van-radio>
          <van-radio name="match">{{ $t('mock.match.queryMatch') }}</van-radio>
        </van-radio-group>
      </van-row>

      <div class="sub-block">
        <van-row class="sub-head" align="center" :wrap="false">
          <span class="sub-title">{{ $t('mock.match.queryIgnoreKeys') }}</span>
          <van-tag round>{{ match.query.ignoreKeys.length }}</van-tag>
        </van-row>
        <!-- 居中不是排版偏好：.tag-list 的 min-height 是空列表占位，换行 row 默认会把标签拉到那个高度 -->
        <van-row class="tag-list" align="center">
          <van-tag v-for="key in match.query.ignoreKeys" :key="key" closeable
            :type="ignoreSource(key) === 'suggestion' ? 'warning' : 'primary'" plain
            :title="$t(`mock.match.ignoreSource.${ignoreSource(key)}`)" @close="removeIgnoreKey(key)">
            {{ key }}
          </van-tag>
          <span v-if="match.query.ignoreKeys.length === 0" class="empty-tip">
            {{ $t('mock.match.queryIgnoreEmpty') }}
          </span>
        </van-row>
        <van-row class="add-row" align="center" :wrap="false">
          <van-field v-model="newIgnoreKey" class="add-input" :placeholder="$t('mock.match.addKeyPlaceholder')"
            @keyup.enter="addIgnoreKey" />
          <van-button class="btn-icon-only" size="mini" plain type="primary" icon="plus"
            :disabled="newIgnoreKey.trim() === ''" @click="addIgnoreKey" />
        </van-row>
      </div>

      <div v-if="match.query.mode === 'match'" class="sub-block">
        <van-row class="switch-row" align="center" :wrap="false">
          <span class="row-label">{{ $t('mock.match.queryAllowExtra') }}</span>
          <van-switch v-model="match.query.allowExtra" size="18px" @change="touch" />
          <span class="row-hint switch-hint">{{ $t('mock.match.queryAllowExtraHint') }}</span>
        </van-row>
        <van-row class="switch-row" align="center" :wrap="false">
          <span class="row-label">{{ $t('mock.match.queryMultiValue') }}</span>
          <van-radio-group :model-value="match.query.multiValue" direction="horizontal" class="inline-radio"
            @update:model-value="onMultiValueChange">
            <van-radio name="any">{{ $t('mock.match.multiAny') }}</van-radio>
            <van-radio name="all">{{ $t('mock.match.multiAll') }}</van-radio>
          </van-radio-group>
        </van-row>
      </div>
    </div>

    <div ref="conditionsSection" class="section">
      <van-collapse v-model="expandedSections" :border="false" class="condition-collapse">
        <van-collapse-item :name="CONDITIONS_PANEL" :border="false">
          <template #title>
            <van-row class="collapse-title" align="center" :wrap="false">
              <span class="sub-title">{{ $t('mock.match.conditions') }}</span>
              <van-tag round type="primary">{{ conditionRows.length }}</van-tag>
            </van-row>
          </template>
          <template #right-icon>
            <van-button class="btn-icon-only" size="mini" plain type="primary" icon="plus"
              :title="$t('mock.match.addCondition')" @click.stop="onAddCondition" />
          </template>
          <div v-if="conditionRows.length === 0" class="empty-tip">{{ $t('mock.match.conditionEmpty') }}</div>
          <van-row v-for="(row, idx) in conditionRows" :key="idx" class="condition-row"
            :class="{ 'is-inert': row.inert }" align="center" :wrap="false">
            <mini-select :model-value="row.location" class="match-select location-select" :options="locationOptions"
              font-size="md" @change="onLocationChange(row, $event)" />
            <van-field :model-value="conditionName(row)" class="condition-key"
              :placeholder="$t(row.location === 'header' ? 'mock.match.headerName' : 'mock.match.conditionKey')"
              @update:model-value="onRowName(row, $event)" />
            <mini-select v-model="row.condition.op" class="match-select op-select" :options="operatorOptions"
              font-size="md" @change="touch" />
            <!-- 值列常驻：随运算符拆掉整列会把行末宽度腾出来，键名列与删除钮都跟着平移 -->
            <van-field v-model="row.condition.value" class="condition-value" :disabled="!needsValue(row)"
              :placeholder="$t(needsValue(row) ? 'mock.match.conditionValue' : 'mock.match.conditionValueSkip')"
              @update:model-value="touch" />
            <van-icon name="cross" class="row-delete" @click="removeRow(row)" />
          </van-row>
          <!-- 置灰必须自己说明自己，否则看上去像控件坏了 -->
          <div v-if="inertCount > 0" class="inert-hint">
            {{ $t(inertHintKey, { count: inertCount }) }}
          </div>
          <van-row v-if="querySuggestions.length > 0" class="suggest-row" align="center">
            <span class="row-hint">{{ $t('mock.match.querySuggest') }}</span>
            <van-tag v-for="item in querySuggestions" :key="item.key" type="primary" class="suggest-tag query-suggest"
              :title="`${item.key}=${item.value}`" @click="addQuerySuggestion(item)">
              {{ item.key }}={{ item.value }}
            </van-tag>
          </van-row>
        </van-collapse-item>
      </van-collapse>
    </div>

    <div class="section">
      <van-row class="switch-row" align="center" :wrap="false">
        <span class="row-label">{{ $t('mock.match.priority') }}</span>
        <van-switch :model-value="match.priority != null" size="18px" @update:model-value="togglePriority" />
        <van-field v-if="match.priority != null" ref="priorityField" v-model="priorityText" type="digit"
          class="priority-input" :placeholder="$t('mock.match.priorityHint')" />
        <span v-else class="row-hint priority-hint">{{ $t('mock.match.priorityAuto') }}</span>
      </van-row>
    </div>

    <div class="section">
      <van-row class="switch-row" align="center" :wrap="false">
        <span class="row-label">{{ $t('mock.match.bodyLabel') }}</span>
        <span class="row-hint">{{ $t('mock.match.bodyHint') }}</span>
      </van-row>
    </div>

    <mock-stability-panel :record="record" />

    <div class="section test-section">
      <van-row class="section-title" align="center" justify="space-between" :wrap="false">
        <span>{{ $t('mock.match.test') }}</span>
      </van-row>
      <van-row class="test-row" align="center">
        <mini-select v-model="testMethod" class="match-select method-select" :options="methodOptions" font-size="md"
          :title="$t('mock.match.method')" />
        <van-field v-model="testUrl" class="test-url" :placeholder="$t('mock.match.testUrlPlaceholder')" />
        <van-button size="mini" type="primary" :loading="testing" @click="runTest">
          {{ $t('mock.match.testRun') }}
        </van-button>
        <van-button class="btn-icon-only" size="mini" plain icon="replay" :title="$t('mock.match.testSeed')"
          @click="seedTest" />
      </van-row>
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
          <van-row v-for="(condition, idx) in testHit.explain.conditions" :key="idx" class="explain-row"
            :class="{ 'is-failed': !condition.passed, 'is-ignored': condition.ignored }" align="center" :wrap="false">
            <van-tag round :type="condition.passed ? 'success' : 'danger'" class="explain-tag">
              {{ testHit.explain ? $t(`mock.miss.dim.${condition.dimension}`) : '' }}
            </van-tag>
            <span class="explain-key">{{ condition.key }}</span>
            <span class="explain-value">{{ condition.expected }}</span>
            <span v-if="condition.ignored" class="explain-ignored">{{ $t('mock.match.ignored') }}</span>
          </van-row>
        </div>
      </div>
      <mock-miss-panel v-if="testMiss != null" :miss="testMiss" @ignore-key="onIgnoreMissKey" @loosen="onLoosen"
        @edit="testMiss = null" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { matchMockRecord, ProxyMock } from '@shared'
import type {
  MatchMockResponse, MockMatchLevel, MockMissDiagnostic, MockMissFailure, MockMultiValueMode,
} from '@shared/mock.models'
import { parseLooseUrl } from '@shared/url'
import type { FieldInstance } from 'vant'
import { showNotify } from 'vant'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MiniSelect from '../../components/MiniSelect.vue'
import MockMissPanel from './MockMissPanel.vue'
import MockStabilityPanel from './MockStabilityPanel.vue'
import type { ConditionLocation, ConditionRow, LevelPresetPreview, QuerySuggestion } from './match'
import {
  addQueryCondition,
  applyQuerySuggestion, conditionName, conditionRowsOf, diffLinesOf, ensureRecordMatch, ignoreSourceOf,
  MATCH_LEVELS, MATCH_METHODS,
  operatorNeedsValue, orderingLabelKey,
  PATH_TYPES,
  previewLevel,
  QUERY_OPERATORS,
  querySuggestionsOf, relocateCondition, removeCondition,
  setConditionName, testSeedOf,
} from './match'

const props = defineProps<{ record: ProxyMock.MockRecord }>()
const { t } = useI18n()

const CONDITION_LOCATIONS: ConditionLocation[] = ['query', 'header']

const hostField = ref<FieldInstance>()
const pathField = ref<FieldInstance>()
const priorityField = ref<FieldInstance>()
const querySection = ref<HTMLElement>()
const conditionsSection = ref<HTMLElement>()
const newIgnoreKey = ref('')
// 折叠面板名：模板的 :name 与点「+」时的自动展开取同一个值，写两处必然漂移
const CONDITIONS_PANEL = 'matchConditions'
// 默认展开：条件表现在承担了「忽略档下也要看得见」的职责，收起就只剩一个数字
const expandedSections = ref<string[]>([CONDITIONS_PANEL])
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
const locationOptions = computed(() => CONDITION_LOCATIONS.map(value => ({
  value, label: t(`mock.match.location.${value}`)
})))

const conditionRows = computed(() => conditionRowsOf(match.value))
const needsValue = (row: ConditionRow) => operatorNeedsValue(row.condition.op)
const inertCount = computed(() => conditionRows.value.filter(row => row.inert).length)
// 忽略档下 testQuery 整段放行，置灰的是全部 Query 行，说「N 条」会被读成「其中几条」，两种成因各用一句
const inertHintKey = computed(() => (match.value?.query?.mode === 'ignore'
  ? 'mock.match.conditionsInertAllHint'
  : 'mock.match.conditionsInertHint'))
const querySuggestions = computed(() => querySuggestionsOf(props.record, match.value))

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
  return parseLooseUrl(String(url ?? ''))?.pathname ?? ''
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

// 模板只关心当前匹配条件，来源判断本身在 match.ts 里
const ignoreSource = (key: string) => ignoreSourceOf(match.value, key)

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

const diffLines = computed(() => diffLinesOf(pending.value, t))

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

// 折叠态下只改数据不出图，写条件前先把这一栏展开
function expandConditions() {
  if (expandedSections.value.indexOf(CONDITIONS_PANEL) === -1) {
    expandedSections.value = [CONDITIONS_PANEL]
  }
}

function onAddCondition() {
  if (match.value == null) return
  expandConditions()
  addQueryCondition(match.value)
  touch()
}

function addQuerySuggestion(item: QuerySuggestion) {
  if (match.value == null) return
  if (match.value.query.conditions.some(it => it.key === item.key)) return
  expandConditions()
  applyQuerySuggestion(match.value, item)
  touch()
}

// 切位置只换归属：条件本身跟着走，不顺手改动 Query 档位——用户刚设成忽略就该停在忽略
function onLocationChange(row: ConditionRow, value: string) {
  if (match.value == null) return
  relocateCondition(match.value, row, value as ConditionLocation)
  touch()
}

function onRowName(row: ConditionRow, value: string) {
  setConditionName(row, value)
  touch()
}

function removeRow(row: ConditionRow) {
  if (match.value == null) return
  removeCondition(match.value, row)
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

// 条件行合并后 query/header 两类校验错误落在同一区块，只看 code 分不开：
// queryOperatorInvalid 既可能是档位非法也可能是运算符非法，归属要靠 field
function focusField(code: string, field?: string) {
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
  if (code.startsWith('header') || field?.includes('.conditions[') === true) {
    focusConditions()
    return
  }
  querySection.value?.scrollIntoView({ block: 'nearest' })
  nextTick(() => {
    const input = querySection.value?.querySelector('input') as HTMLInputElement
    input?.focus()
  })
}

// 折叠起来就没有 input 可聚焦，定位前先展开
function focusConditions() {
  expandConditions()
  conditionsSection.value?.scrollIntoView({ block: 'nearest' })
  nextTick(() => {
    const input = conditionsSection.value?.querySelector('input') as HTMLInputElement
    input?.focus()
  })
}

defineExpose({ focusField })
</script>

<style scoped>
.match-tab {
  /* 控件尺寸统一由字号推导：md 13px 时 28px 高，与改动前的固定值一致 */
  --match-control-height: calc(var(--van-font-size-md) * 2.2);
  --match-control-padding-y: calc(var(--van-font-size-md) * 0.3);
  --mini-select-bar-height: var(--match-control-height);
  display: flex;
  flex-direction: column;
  gap: var(--app-sp-lg);
  padding-bottom: var(--app-sp-lg);
}

/* mini 按钮默认继承 xs，表单里统一提到 sm，高度也随字号一起变化 */
.match-tab :deep(.van-button--mini) {
  height: var(--match-control-height);
  padding: 0 var(--match-control-padding-y);
  font-size: var(--van-font-size-sm);
  box-sizing: border-box;
}

/* 次要说明的一档（text-3 + sm）只写一次，各站点的规则只留自己的排布 */
.row-hint,
.level-hint,
.empty-tip,
.preview-empty,
.inert-hint,
.path-original {
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

/* 区块小标题与行标签共用同一档正文（text-2 + md），列宽由 .row-label 自己补 */
.sub-title,
.bar-label,
.row-label {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
}

.level-bar {
  gap: var(--app-sp-lg);
  margin-top: var(--app-sp-lg);
}

.level-chips {
  display: flex;
  gap: var(--app-sp-md);
  flex-wrap: wrap;
}

.level-hint {
  margin: calc(var(--app-sp-xs) * -1) 0 0;
}

.level-preview {
  gap: var(--app-sp-md);
  padding: var(--app-sp-sm) var(--app-sp-md);
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
}

.preview-tags {
  flex: 1;
  gap: var(--app-sp-xs);
}

.preview-tag {
  padding: var(--app-sp-xs) var(--app-sp-lg);
  border-radius: var(--van-radius-sm);
  background: color-mix(in srgb, var(--van-primary-color) 12%, transparent);
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-xs);
  line-height: 1.5;
}

.preview-actions {
  gap: var(--app-sp-xs);
  flex-shrink: 0;
}

.section {
  padding: var(--app-sp-lg);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-lg);
  background: var(--van-background-2);
}

.section-title {
  gap: var(--app-sp-lg);
  margin-bottom: var(--app-sp-md);
  color: var(--van-text-color);
  font-size: var(--van-font-size-md);
  font-weight: 500;
}

.field-row {
  gap: var(--app-sp-lg);
  padding: var(--app-sp-xs) 0;
}

.row-label {
  flex: none;
  min-width: calc(var(--van-font-size-md) * 3.7);
}

/* 请求标识三行统一：标签固定列宽、置灰、右对齐，控件同宽描边 */
.identity-row .row-label {
  width: calc(var(--van-font-size-md) * 4.8);
  min-width: calc(var(--van-font-size-md) * 4.8);
  text-align: right;
}

.match-field,
.path-input,
.add-input {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--match-control-height);
  padding: 0 var(--app-sp-lg);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
  background: var(--van-background-2);
  box-sizing: border-box;
}

.match-field::after,
.path-input::after,
.add-input::after {
  display: none;
}

.match-field :deep(.van-field__body),
.path-input :deep(.van-field__body),
.add-input :deep(.van-field__body) {
  height: 100%;
}

.match-field :deep(.van-field__value),
.path-input :deep(.van-field__value),
.add-input :deep(.van-field__value) {
  padding: 0;
}

.match-field :deep(.van-field__control),
.path-input :deep(.van-field__control),
.add-input :deep(.van-field__control) {
  height: var(--match-control-height);
}

.match-select {
  flex: none;
}

.method-select {
  width: calc(var(--van-font-size-md) * 6.8);
}

.path-type-select {
  width: calc(var(--van-font-size-md) * 6.3);
}

.path-input {
  flex: 1 1 calc(var(--van-font-size-md) * 12.3);
}

.path-original {
  gap: var(--app-sp-lg);
  margin-top: var(--app-sp-sm);
  word-break: break-all;
}

/* 长路径只挤说明文字，按钮保持单行 */
.path-original .restore-path {
  flex: none;
  white-space: nowrap;
}

.inline-radio :deep(.van-radio) {
  margin-right: var(--app-sp-xl);
}

.inline-radio :deep(.van-radio__label) {
  font-size: var(--van-font-size-md);
}

/* 虚线只作为分组的上边界：留一档给上一组收尾、贴紧下一组，上下各留一档会把两个子块推远 */
.sub-block {
  margin-top: var(--app-sp-lg);
  padding-top: var(--app-sp-sm);
  border-top: 1px dashed var(--van-border-color);
}

/* 计数标签紧跟标题，间距与折叠标题、面板区块头同档；居右会让它看起来像行末动作 */
.sub-head {
  gap: var(--app-sp-md);
  margin-bottom: var(--app-sp-sm);
}

/* 匹配条件用折叠面板，标题行贴合区块样式，内容区不额外缩进 */
/* 标题行按控件那一档定高：Vant 的 24px 单元格行高是死值，不随字号走，且右侧 + 按钮本来就把行撑到等高 */
.condition-collapse :deep(.van-collapse-item > .van-cell) {
  padding: 0;
  line-height: var(--match-control-height);
}

.condition-collapse :deep(.van-collapse-item__content) {
  padding: var(--app-sp-xs) 0 0;
}

.condition-collapse :deep(.van-collapse-item__title) {
  min-width: 0;
}

/* 折叠态也要看得出条件数，和「忽略参数」那块的计数同款 */
.collapse-title {
  gap: var(--app-sp-md);
}

.tag-list {
  gap: var(--app-sp-md);
  min-height: calc(var(--van-font-size-md) * 1.7);
  margin-top: 5px;
}

.tag-list :deep(.van-tag) {
  font-family: var(--app-mono-font);
}

.add-row {
  gap: var(--app-sp-md);
  margin-top: var(--app-sp-sm);
}

.empty-tip {
  padding: var(--app-sp-xs) 0;
}

.condition-row {
  gap: var(--app-sp-sm);
  margin-bottom: var(--app-sp-sm);
}

.condition-key {
  /* 多了一列位置，键名列要能让位：地板按「参数名」三个字留，压到地板由输入自身裁切 */
  flex: 0 1 26%;
  min-width: calc(var(--van-font-size-md) * 5);
  height: var(--match-control-height);
  padding: 0 var(--app-sp-lg);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
  background: var(--van-background-2);
  box-sizing: border-box;
}

.condition-key::after {
  display: none;
}

.condition-key :deep(.van-field__body) {
  height: 100%;
}

.condition-key :deep(.van-field__value) {
  padding: 0;
}

.condition-key :deep(.van-field__control) {
  height: var(--match-control-height);
}

/* 位置列只装 Query / Header 两个词，宽度按较长的那个留 */
.location-select {
  width: calc(var(--van-font-size-md) * 7.6);
}

/* 8.5 档是按英文留的，四个运算符里最长的「不存在」只要 6.2 档，多出来的宽度让给期望值 */
.op-select {
  width: calc(var(--van-font-size-md) * 6.2);
}

.condition-value {
  /* basis 不能留 auto：Vant 的 .van-cell 自带 width:100%，auto 会让值列按整行宽参加收缩，
     把同行的键名列（0 1 26%）压掉一半。0 基准＝只吃余量，键名列才拿得到设计里那 26%。 */
  flex: 1 1 0;
  min-width: 0;
  height: var(--match-control-height);
  padding: 0 var(--app-sp-lg);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
  background: var(--van-background-2);
  box-sizing: border-box;
}

.condition-value::after {
  display: none;
}

.condition-value :deep(.van-field__body) {
  height: 100%;
}

.condition-value :deep(.van-field__value) {
  padding: 0;
}

.condition-value :deep(.van-field__control) {
  height: var(--match-control-height);
}

/* 无值运算符（存在/不存在）下值列整格改虚线：Vant 的禁用只灰文本（--van-field-input-disabled-text-color），
   描边照旧会看着像待填。不用 opacity 收——.is-inert 行已经压了 0.55，再乘一次这格就没了。 */
.condition-value.van-field--disabled {
  border-style: dashed;
}

/* 删除图标收成与同行控件等高的方格：Vant 图标自带 line-height:1，靠行高而不是内边距居中 */
.row-delete {
  flex: none;
  width: var(--match-control-height);
  height: var(--match-control-height);
  line-height: var(--match-control-height);
  text-align: center;
  color: var(--van-danger-color);
  cursor: pointer;
}

.is-inert {
  /* 忽略档下的 Query 行仍留在表里，只是不参与匹配：压暗而不是抽走，配套下面那行说明 */
  opacity: 0.55;
}

.inert-hint {
  margin-top: var(--app-sp-xs);
}

.switch-row {
  gap: var(--app-sp-lg);
  padding: var(--app-sp-xs) 0;
  /* 标签行一律占满控件那一档高度：开关与输入框切换时行高不变，纯文字行（Body）也和带控件的行同节奏。
     内容盒 28.6 + 上下内边距 2.6×2 = 33.8，与带输入框的行实测等高 */
  min-height: var(--match-control-height);
}

/* 说明与开关同行排，空间不够时折的是说明自己，不能把开关挤扁 */
.switch-row .van-switch {
  flex: none;
}

.switch-hint {
  min-width: 0;
}

.priority-input {
  width: calc(var(--van-font-size-md) * 7.4);
  padding: 0 var(--app-sp-lg);
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
  gap: var(--app-sp-md);
  margin-top: var(--app-sp-md);
}

.suggest-tag {
  cursor: pointer;
}

/* 建议正文是 key=value，值常是长 token：Vant 的 tag 是 inline-flex，text-overflow 要落到 inline-block 上才出省略号，
   全文由 title 给出 */
.query-suggest {
  display: inline-block;
  max-width: calc(var(--van-font-size-md) * 13);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}

.test-row {
  gap: var(--app-sp-md);
}

.test-url {
  flex: 1 1 calc(var(--van-font-size-md) * 15.4);
  min-width: 0;
  height: var(--match-control-height);
  padding: 0 var(--app-sp-lg);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
  background: var(--van-background-2);
  box-sizing: border-box;
}

.test-url::after {
  display: none;
}

.test-url :deep(.van-field__body) {
  height: 100%;
}

.test-url :deep(.van-field__value) {
  padding: 0;
}

.test-url :deep(.van-field__control) {
  height: var(--match-control-height);
}

.test-error {
  margin-top: var(--app-sp-md);
  color: var(--van-danger-color);
  font-size: var(--van-font-size-sm);
}

.test-hit {
  margin-top: var(--app-sp-lg);
  padding: var(--app-sp-lg);
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
  margin-top: var(--app-sp-xs);
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.explain-list {
  margin-top: var(--app-sp-md);
  display: flex;
  flex-direction: column;
  gap: var(--app-sp-xs);
}

.explain-row {
  gap: var(--app-sp-md);
  font-size: var(--van-font-size-sm);
}

.explain-tag {
  flex: none;
}

.explain-key {
  flex: none;
  font-family: var(--app-mono-font);
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