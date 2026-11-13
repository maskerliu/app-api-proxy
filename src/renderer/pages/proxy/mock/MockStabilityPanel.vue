<template>
  <section class="stability-panel">
    <van-row tag="header" class="panel-head" align="center" justify="space-between" :wrap="false">
      <span class="panel-title">{{ $t('mock.stability.title') }}</span>
      <van-row class="head-side" align="center" :wrap="false">
        <span v-if="lastAnalyzed !== ''" class="panel-stamp">{{ $t('mock.stability.lastAnalyzed', { time: lastAnalyzed }) }}</span>
        <van-button size="mini" plain type="primary" :loading="analyzing" :disabled="!canAnalyze" @click="analyze">
          {{ $t('mock.match.autoAnalyze') }}
        </van-button>
      </van-row>
    </van-row>

    <div v-if="listSuggestions.length > 0" class="panel-block">
      <van-row class="block-head" align="center" :wrap="false">
        <span class="sev sev-warn" />
        <span class="block-title">{{ $t('mock.stability.suggestions') }}</span>
        <van-tag plain type="primary">{{ listSuggestions.length }}</van-tag>
        <span class="head-spacer" />
        <span v-if="applicableSuggestions.length > 1" class="link-action" @click="applyAllSuggestions">
          {{ $t('mock.stability.applyAll') }}
        </span>
      </van-row>
      <div class="key-list">
        <!-- 分级只画在最左侧的图标上：E1~E4 是要处理的「!」，E5 只是告知的「i」；档位码退到 title 备查，不再占一列 -->
        <van-row v-for="item in listSuggestions" :key="`${item.evidence}-${item.key}`" class="key-row" align="center"
          :wrap="false">
          <span class="sev" :class="item.evidence === 'E5' ? 'sev-info' : 'sev-warn'"
            :title="`${item.evidence} · ${reasonText(item)}`" />
          <span class="key-name" :title="item.key">{{ item.key }}</span>
          <span class="key-reason">
            {{ item.evidence === 'E5' ? $t('mock.stability.semanticKeep') : reasonText(item) }}
          </span>
          <span v-if="item.evidence !== 'E5'" class="link-action" @click="applySuggestion(item)">
            {{ $t('mock.stability.apply') }}
          </span>
        </van-row>
      </div>
      <p v-if="hasSemanticSuggestion" class="panel-hint">{{ $t('mock.stability.suggestionHint') }}</p>
    </div>

    <div class="panel-block">
      <van-row class="block-head" align="center" :wrap="false">
        <span class="sev sev-ok" />
        <span class="block-title">{{ $t('mock.stability.autoIgnored') }}</span>
        <van-tag plain type="primary">{{ ignoredKeys.length }}</van-tag>
      </van-row>
      <div v-if="ignoredKeys.length === 0" class="panel-empty">{{ $t('mock.stability.noAutoIgnored') }}</div>
      <!-- 已忽略态用和「Query 匹配 › 忽略参数」同款的可关闭标签：同一份状态的同一副面孔，✕ 即撤销 -->
      <van-row v-else class="tag-list">
        <van-tag v-for="key in ignoredKeys" :key="key" closeable plain :type="ignoreSource(key) === 'suggestion' ? 'warning' : 'primary'"
          :title="ignoreTitle(key)" @close="undoIgnore(key)">{{ key }}</van-tag>
      </van-row>
    </div>

    <div v-if="pathParameterized || isPathDynamic || pathSuggestion != null" class="panel-block">
      <van-row class="block-head" align="center" :wrap="false">
        <span class="sev" :class="pathParameterized ? 'sev-ok' : 'sev-info'" />
        <span class="block-title">{{ $t('mock.stability.path') }}</span>
      </van-row>
      <van-row class="path-row" align="center" :wrap="false">
        <div class="path-info">
          <span class="path-value">{{ match.path }}</span>
          <span v-if="match.pathOriginal && match.pathOriginal !== match.path" class="path-original">
            {{ $t('mock.match.pathParameterized', { original: match.pathOriginal, path: match.path }) }}
          </span>
        </div>
        <span v-if="pathParameterized" class="link-action" @click="undoPath">
          {{ $t('mock.stability.pathUndo') }}
        </span>
        <span v-else class="link-action" :class="{ 'link-action-off': !canAnalyze }" @click="analyze">
          {{ $t('mock.stability.pathApply') }}
        </span>
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
import type { MockMatchRule, MockMatchSuggestion } from '@shared/mock.models'
import { showConfirmDialog, showNotify } from 'vant'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ignoreSourceOf, RISK_KEYS, SEMANTIC_KEYS } from './match'

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
// 建议是某一次分析的快照，不写时间就分不清下面是新结论还是上次留下的
const lastAnalyzed = computed(() => {
  const at = Number(derivation.value?.analyzedAt) || 0
  if (at <= 0) return ''
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
})
const ignoreSource = (key: string) => ignoreSourceOf(match.value, key)

function ignoreTitle(key: string): string {
  // 自动忽略的键把依据带在标签上；手动与建议来源沿用忽略参数列表的说法
  const source = ignoreSource(key)
  return source === 'auto' ? evidenceText(key) : t(`mock.match.ignoreSource.${source}`)
}

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
  padding: var(--app-sp-lg);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-lg);
  background: var(--van-background-2);
  color: var(--van-text-color);
}

/* 次要说明的一档（text-3 + sm）只写一次，各站点规则只留自己的排布 */
.panel-stamp,
.key-reason,
.path-original,
.panel-empty {
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

/* 分级靠图标本身，不写文字：DevTools Issues 用同一支圆点，靠颜色和字形区分待处理 / 只告知 / 已解决 */
.sev {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--van-font-size-md) * 1.25);
  height: calc(var(--van-font-size-md) * 1.25);
  border-radius: 50%;
  color: var(--van-white);
  font-size: var(--van-font-size-sm);
  font-weight: 500;
  line-height: 1;
}

.sev-warn {
  background: var(--van-warning-color);
}

.sev-warn::before {
  content: '!';
}

.sev-info {
  background: var(--van-primary-color);
}

.sev-info::before {
  content: 'i';
}

.sev-ok {
  background: var(--van-success-color);
}

.sev-ok::before {
  content: '✓';
}

.panel-head {
  gap: var(--app-sp-lg);
}

.panel-title {
  font-size: var(--van-font-size-md);
  font-weight: 500;
}

.head-side {
  gap: var(--app-sp-md);
  flex: none;
}

.panel-stamp {
  white-space: nowrap;
}

.panel-block {
  margin-top: var(--app-sp-md);
  padding-top: var(--app-sp-md);
  border-top: 1px solid var(--van-border-color);
}

.panel-block:first-of-type {
  border-top: 0;
  margin-top: var(--app-sp-xs);
  padding-top: var(--app-sp-sm);
}

.block-head {
  gap: var(--app-sp-md);
  margin-bottom: var(--app-sp-xs);
}

/* 标题与计数靠左、批量动作靠右，比 justify=space-between 更能在长标题下保住右缘 */
.head-spacer {
  flex: 1 1 auto;
}

.block-title {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
}

.key-list {
  display: flex;
  flex-direction: column;
}

/* 行是平的：铺底色会把说明文字框成控件，这里只留一条发丝线，行高仍取上层 .match-tab 的控件高度 */
.key-row {
  gap: var(--app-sp-md);
  min-height: var(--match-control-height);
  border-bottom: 1px solid var(--van-border-color);
}

.key-row:last-child {
  border-bottom: 0;
}

/* 动作收成文字链接：DevTools 的 issue 动作（Learn more / Ignore issue）不是描边按钮。
   带 loading 的面板工具（重新分析）仍用按钮，链接给不出进行中状态。 */
.link-action {
  flex: none;
  color: var(--van-primary-color);
  font-size: var(--van-font-size-md);
  white-space: nowrap;
  cursor: pointer;
}

.link-action:hover {
  text-decoration: underline;
}

.link-action-off {
  color: var(--van-text-color-3);
  cursor: default;
}

.link-action-off:hover {
  text-decoration: none;
}

/* 键名列定宽，说明列才不会被上一条的键长推来推去 */
.key-name {
  flex: none;
  width: calc(var(--van-font-size-md) * 8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--app-mono-font);
  font-size: var(--van-font-size-md);
}

/* 说明是唯一要说服人的字段，宁可折行也不打点 */
.key-reason {
  flex: 1 1 0;
  min-width: 0;
  line-height: calc(var(--van-font-size-sm) * 1.5);
}

.tag-list {
  gap: var(--app-sp-md);
  min-height: calc(var(--van-font-size-md) * 1.7);
}

.tag-list :deep(.van-tag) {
  font-family: var(--app-mono-font);
}

.path-row {
  gap: var(--app-sp-md);
}

.path-info {
  flex: 1 1 auto;
  min-width: 0;
}

.path-value {
  display: block;
  font-family: var(--app-mono-font);
  font-size: var(--van-font-size-md);
  word-break: break-all;
}

.path-original {
  display: block;
  margin-top: var(--app-sp-xs);
  word-break: break-all;
}

.panel-empty {
  margin: var(--app-sp-sm) 0 0;
}

.panel-hint {
  margin: var(--app-sp-md) 0 0;
  color: var(--van-warning-color);
  font-size: var(--van-font-size-sm);
}
</style>