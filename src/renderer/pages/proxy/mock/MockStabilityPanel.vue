<template>
  <section class="stability-panel">
    <van-row tag="header" class="panel-head" align="center" justify="space-between" :wrap="false">
      <span class="panel-title">{{ $t('mock.stability.title') }}</span>
      <van-button size="mini" plain type="primary" :loading="analyzing" :disabled="!canAnalyze"
        @click="analyze">
        {{ $t('mock.match.autoAnalyze') }}
      </van-button>
    </van-row>

    <div v-if="listSuggestions.length > 0" class="panel-block">
      <van-row class="block-head" align="center" justify="space-between" :wrap="false">
        <span class="block-title">{{ $t('mock.stability.suggestions') }}</span>
        <van-button v-if="applicableSuggestions.length > 1" size="mini" plain type="warning"
          @click="applyAllSuggestions">
          {{ $t('mock.stability.applyAll') }}
        </van-button>
      </van-row>
      <div class="key-list">
        <van-row v-for="item in listSuggestions" :key="`${item.evidence}-${item.key}`" class="key-row" align="center"
          :wrap="false">
          <van-row class="key-info" align="center" :wrap="false">
            <span class="key-name">{{ item.key }}</span>
            <van-tag plain :type="item.evidence === 'E5' ? 'primary' : 'warning'" class="evidence-tag">
              {{ item.evidence }}
            </van-tag>
            <span class="key-reason">{{ reasonText(item) }}</span>
          </van-row>
          <van-button v-if="item.evidence !== 'E5'" size="mini" plain type="primary" class="key-action"
            :disabled="isIgnored(item.key)" @click="applySuggestion(item)">
            {{ $t('mock.stability.apply') }}
          </van-button>
          <span v-else class="key-keep">{{ $t('mock.stability.semanticKeep') }}</span>
        </van-row>
      </div>
      <p v-if="hasSemanticSuggestion" class="panel-hint">{{ $t('mock.stability.suggestionHint') }}</p>
    </div>

    <div class="panel-block">
      <van-row class="block-head" align="center" justify="space-between" :wrap="false">
        <span class="block-title">{{ $t('mock.stability.autoIgnored') }}</span>
      </van-row>
      <div v-if="ignoredKeys.length === 0" class="panel-empty">{{ $t('mock.stability.noAutoIgnored') }}</div>
      <div v-else class="key-list">
        <van-row v-for="key in ignoredKeys" :key="key" class="key-row" align="center" :wrap="false">
          <van-row class="key-info" align="center" :wrap="false">
            <span class="key-name">{{ key }}</span>
            <van-tag v-if="RISK_KEYS.has(key)" plain type="warning" class="evidence-tag">E2</van-tag>
            <span class="key-reason">{{ evidenceText(key) }}</span>
          </van-row>
          <van-button size="mini" plain class="key-action" @click="undoIgnore(key)">{{ $t('mock.stability.undo') }}</van-button>
        </van-row>
      </div>
    </div>

    <div v-if="pathParameterized || isPathDynamic || pathSuggestion != null" class="panel-block">
      <van-row class="block-head" align="center" justify="space-between" :wrap="false">
        <span class="block-title">{{ $t('mock.stability.path') }}</span>
      </van-row>
      <van-row class="path-row" align="center" :wrap="false">
        <div class="path-info">
          <span class="path-value">{{ match.path }}</span>
          <span v-if="match.pathOriginal && match.pathOriginal !== match.path" class="path-original">
            {{ $t('mock.match.pathParameterized', { original: match.pathOriginal, path: match.path }) }}
          </span>
        </div>
        <van-button v-if="pathParameterized" size="mini" plain type="primary" @click="undoPath">
          {{ $t('mock.stability.pathUndo') }}
        </van-button>
        <van-button v-else size="mini" plain type="primary" :disabled="!canAnalyze" @click="analyze">
          {{ $t('mock.stability.pathApply') }}
        </van-button>
      </van-row>
    </div>

    <p v-if="listSuggestions.length === 0 && ignoredKeys.length === 0 && !pathParameterized && pathSuggestion == null"
      class="panel-empty">
      {{ $t('mock.stability.empty') }}
    </p>
  </section>
</template>

<script lang="ts" setup>
import { analyzeMockMatch, ProxyMock } from '@shared'
import type { MockMatchSuggestion } from '@shared/mock.models'
import { showConfirmDialog, showNotify } from 'vant'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RISK_KEYS, SEMANTIC_KEYS } from './match'

const props = defineProps<{ record: ProxyMock.MockRecord }>()
const { t } = useI18n()
const analyzing = ref(false)

const match = computed(() => props.record?.match)
const derivation = computed(() => match.value?.derivation)
const suggestions = computed(() => derivation.value?.suggestions ?? [])
// Path 参数化是独立动作，不能当作忽略键批量应用
const pathSuggestion = computed(() => suggestions.value.find(it => it.reason === 'pathParameterizable'))
const listSuggestions = computed(() => suggestions.value.filter(it => it.reason !== 'pathParameterizable'))
const applicableSuggestions = computed(() => listSuggestions.value.filter(it => it.evidence !== 'E5'))
const hasSemanticSuggestion = computed(() => listSuggestions.value.some(it => it.evidence === 'E5'))
const ignoredKeys = computed(() => match.value?.query?.ignoreKeys ?? [])
const pathParameterized = computed(() => derivation.value?.pathParameterized === true)
const isPathDynamic = computed(() => /\*/.test(match.value?.path ?? ''))
const canAnalyze = computed(() => {
  const url = props.record?.source?.url ?? props.record?.url ?? ''
  return url !== '' && props.record?.ruleId != null
})

function reasonText(item: MockMatchSuggestion): string {
  return t(`mock.stability.reason.${item.reason ?? 'dynamicValueShape'}`)
}

function evidenceText(key: string): string {
  if (RISK_KEYS.has(key)) return t('mock.stability.reason.highRisk')
  if (SEMANTIC_KEYS.has(key)) return t('mock.stability.reason.semanticKey')
  return t('mock.stability.reason.dynamicValueShape')
}

function isIgnored(key: string): boolean {
  return ignoredKeys.value.indexOf(key) >= 0
}

function applySuggestion(item: MockMatchSuggestion) {
  if (match.value == null || isIgnored(item.key)) return
  const query = match.value.query
  if (query.ignoreKeys == null) query.ignoreKeys = []
  query.ignoreKeys.push(item.key)
  // 应用后从建议中移除，避免重复展示
  const list = derivation.value?.suggestions
  if (list != null) {
    const index = list.findIndex(it => it.key === item.key && it.evidence === item.evidence)
    if (index >= 0) list.splice(index, 1)
  }
}

async function applyAllSuggestions() {
  if (applicableSuggestions.value.length === 0) return
  try {
    await showConfirm(t('mock.stability.applyAllConfirm', { count: applicableSuggestions.value.length }))
  } catch (err) {
    return
  }
  for (const item of [...applicableSuggestions.value]) applySuggestion(item)
}

function undoIgnore(key: string) {
  const query = match.value?.query
  if (query?.ignoreKeys != null) {
    const index = query.ignoreKeys.indexOf(key)
    if (index >= 0) query.ignoreKeys.splice(index, 1)
  }
  const auto = derivation.value?.autoIgnoredKeys
  if (auto != null) {
    const index = auto.indexOf(key)
    if (index >= 0) auto.splice(index, 1)
  }
}

function undoPath() {
  if (match.value == null) return
  if (match.value.pathOriginal != null && match.value.pathOriginal !== '') {
    match.value.path = match.value.pathOriginal
  }
  match.value.pathOriginal = undefined
  match.value.parameterizedSegmentIndex = null
  if (derivation.value != null) derivation.value.pathParameterized = false
}

async function analyze() {
  if (!canAnalyze.value || analyzing.value) return
  analyzing.value = true
  try {
    const request = props.record.id != null
      ? { ruleId: props.record.ruleId, recordId: props.record.id }
      : {
        ruleId: props.record.ruleId,
        method: props.record.source?.method,
        url: props.record.source?.url ?? props.record.url,
      }
    const result = await analyzeMockMatch(request, { silentError: true })
    if (result?.derivation == null || match.value == null) return
    match.value.derivation = result.derivation
    if (result.pathSuggested != null) {
      match.value.pathOriginal = result.pathOriginal ?? match.value.pathOriginal ?? match.value.path
      match.value.path = result.pathSuggested
      match.value.pathType = 'glob'
      match.value.derivation.pathParameterized = true
      // 已应用参数化，移除对应建议避免重复提示
      match.value.derivation.suggestions = match.value.derivation.suggestions
        .filter(it => it.reason !== 'pathParameterizable')
    }
  } catch (err) {
    showNotify({ message: t('mock.match.analyzeFailed'), type: 'warning', duration: 1200 })
  } finally {
    analyzing.value = false
  }
}

async function showConfirm(message: string) {
  await showConfirmDialog({
    title: t('mock.stability.applyAll'),
    message,
    confirmButtonText: t('mock.stability.apply'),
    cancelButtonText: t('common.cancel'),
  })
}
</script>

<style scoped>
.stability-panel {
  padding: var(--sp-lg);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-lg);
  background: var(--van-background-2);
  color: var(--van-text-color);
}

.panel-head {
  gap: var(--sp-lg);
}

.panel-title {
  font-size: var(--van-font-size-md);
  font-weight: 500;
}

.panel-block {
  margin-top: var(--sp-lg);
  padding-top: var(--sp-lg);
  border-top: 1px dashed var(--van-border-color);
}

.panel-block:first-of-type {
  border-top: 0;
  padding-top: var(--sp-sm);
}

.block-head {
  gap: var(--sp-lg);
  margin-bottom: var(--sp-sm);
}

.block-title {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
}

.key-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-sm);
}

.key-row {
  gap: var(--sp-lg);
  padding: var(--sp-sm) var(--sp-md);
  border-radius: var(--van-radius-md);
  background: var(--van-gray-1);
}

/* 行内「应用 / 撤销」被上层 .match-tab 的 mini 统一内边距压到 ~4px，这里按字号放宽留白 */
.key-row :deep(.key-action.van-button--mini) {
  flex: none;
  height: calc(var(--van-font-size-md) * 2.2);
  padding: 0 var(--sp-xl);
  box-sizing: border-box;
}

.key-info {
  gap: var(--sp-md);
  flex: 1 1 auto;
  min-width: 0;
}

.key-name {
  flex: none;
  max-width: 60%;
  font-family: var(--mono-font);
  font-size: var(--van-font-size-md);
  word-break: break-all;
}

.evidence-tag {
  flex: none;
}

.key-reason {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

.key-keep {
  flex: none;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

.path-row {
  gap: var(--sp-lg);
}

/* 长路径挤占空间时按钮不收缩，文案保持单行 */
.path-row :deep(.van-button--mini) {
  flex: none;
  white-space: nowrap;
}

.path-info {
  flex: 1 1 auto;
  min-width: 0;
}

.path-value {
  display: block;
  font-family: var(--mono-font);
  font-size: var(--van-font-size-md);
  word-break: break-all;
}

.path-original {
  display: block;
  margin-top: var(--sp-xs);
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
  word-break: break-all;
}

.panel-empty {
  margin: var(--sp-sm) 0 0;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

.panel-hint {
  margin: var(--sp-md) 0 0;
  color: var(--van-warning-color);
  font-size: var(--van-font-size-sm);
}
</style>