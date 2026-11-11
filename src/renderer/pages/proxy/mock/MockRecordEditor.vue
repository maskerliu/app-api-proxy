<template>
  <div class="record-editor">
    <van-row class="editor-head" align="center" :wrap="false">
      <div class="head-fields">
        <van-field class="name-field" label-width="3.1em" center v-model="record.name" :label="$t('mock.editor.name')"
          :placeholder="$t('mock.editor.namePlaceholder')" />
        <van-field ref="pathField" class="path-field" label-width="3.1em" v-model="record.url"
          :label="$t('mock.editor.path')" :placeholder="$t('mock.editor.pathPlaceholder')" />
      </div>
      <van-row class="head-actions" align="center" :wrap="false">
        <van-tag v-if="dirty" type="warning" plain>{{ $t('mock.editor.unsaved') }}</van-tag>
        <van-button class="btn-icon-only" plain size="mini" type="primary" icon="success" :loading="saving"
          :disabled="!canSave" @click="emit('save')">
        </van-button>
      </van-row>
    </van-row>

    <van-tabs v-model:active="activeTab" class="editor-tabs" shrink>
      <van-tab :title="$t('mock.editor.tab.response')" name="response">
        <div class="tab-body response-tab">
          <mock-response-form ref="baseResponseForm" v-model="baseResponse" fill-body />
        </div>
      </van-tab>

      <van-tab :title="$t('mock.editor.tab.match')" name="match">
        <div class="tab-body match-tab">
          <mock-match-tab ref="matchForm" :record="record" />
        </div>
      </van-tab>

      <van-tab :title="$t('mock.editor.tab.variants')" name="variants">
        <div class="tab-body variants-tab">
          <van-row class="variant-bar" align="center" :wrap="false">
            <div ref="variantStrip" class="variant-strip">
              <van-button v-for="variant in record.variants" :key="variant.id" size="mini" class="variant-chip"
                :type="variant.id === selectedVariantId ? 'primary' : 'default'"
                :plain="variant.id !== selectedVariantId" :title="variant.name" @click="selectVariant(variant)">
                <span class="variant-chip-name">{{ variant.name || $t('mock.editor.variantName') }}</span>
                <span class="variant-chip-status" :class="statusTone(variant.statusCode)">{{ variant.statusCode
                }}</span>
                <van-icon v-if="record.activeVariantId === variant.id" name="success" class="variant-chip-check"
                  :title="$t('mock.editor.active')" />
              </van-button>
            </div>
            <van-tag type="primary" plain>
              {{ record.variants.length }}/{{ MOCK_MAX_VARIANTS }}
            </van-tag>
            <!-- 放在滚动区外，变体再多也始终可见 -->
            <van-button class="btn-icon-only" size="mini" plain type="primary" icon="plus" :disabled="atVariantLimit"
              @click="addVariant">
            </van-button>
          </van-row>

          <van-empty v-if="record.variants.length === 0" class="variant-empty" image="search" image-size="64"
            :description="$t('mock.editor.noVariants')" />

          <div v-else class="variant-editor">
            <van-row v-if="selectedVariant != null" class="variant-editor-bar" align="center" :wrap="false">
              <van-field class="variant-name-field" v-model="selectedVariant.name"
                :placeholder="$t('mock.editor.variantName')" />
              <van-field class="variant-meta-field variant-status-field" type="digit"
                :label="$t('mock.editor.statusCode')" :placeholder="$t('mock.editor.statusCode')"
                v-model="variantStatusText" />
              <van-field class="variant-meta-field variant-delay-field" type="digit" :label="$t('mock.editor.delay')"
                :placeholder="$t('mock.editor.delay')" v-model="variantDelayText">
                <template #extra>
                  <span class="meta-unit">ms</span>
                </template>
              </van-field>
              <van-row class="variant-active" align="center" :wrap="false">
                <van-switch :model-value="record.activeVariantId === selectedVariant.id"
                  @update:model-value="toggleActive(selectedVariant)" />
                <span class="variant-active-label">{{ $t('mock.editor.activeHint') }}</span>
              </van-row>
              <van-button class="btn-icon-only" size="mini" plain type="success" :disabled="atVariantLimit"
                :title="$t('mock.editor.duplicateVariant')" @click="duplicateVariant">
                <template #icon>
                  <van-icon class="iconfont icon-copy" style="padding: 0;" />
                </template>
              </van-button>
              <van-button class="btn-icon-only" size="mini" plain type="danger" :title="$t('mock.editor.deleteVariant')"
                @click="removeVariant(selectedVariant)">
                <template #icon>
                  <van-icon class="iconfont icon-delete" />
                </template>
              </van-button>
            </van-row>
            <mock-response-form v-if="selectedVariant != null" ref="variantForm" v-model="selectedVariantModel"
              fill-body :show-meta="false" />
            <div v-else class="variant-empty">{{ $t('mock.editor.selectVariant') }}</div>
          </div>
        </div>
      </van-tab>

      <van-tab :title="$t('mock.editor.tab.raw')" name="raw">
        <div class="tab-body raw-body">
          <van-row class="raw-head" align="center" :wrap="false">
            <span class="raw-hint">{{ $t('mock.editor.rawHint') }}</span>
            <van-button size="mini" plain type="primary" @click="applyRaw">{{ $t('mock.editor.rawApply') }}</van-button>
          </van-row>
          <van-notice-bar v-if="rawError" :text="rawError" mode="closeable" color="var(--van-danger-color)"
            background="color-mix(in srgb, var(--van-danger-color) 8%, transparent)" />
          <div class="raw-editor">
            <vue-ace-editor v-model:data="rawText" lang="json" :fold="false" searchable />
          </div>
        </div>
      </van-tab>
    </van-tabs>
  </div>
</template>

<script lang="ts" setup>
import { MOCK_MAX_VARIANTS, ProxyMock } from '@shared'
import type { FieldInstance } from 'vant'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import VueAceEditor from '../../components/VueAceEditor.vue'
import MockMatchTab from './MockMatchTab.vue'
import MockResponseForm from './MockResponseForm.vue'
import { createVariant, toRawJson } from './mock.record'

const record = defineModel<ProxyMock.MockRecord>('record', { required: true })
const props = defineProps<{
  dirty: boolean
  saving: boolean
  newRecord: boolean
}>()
const emit = defineEmits<{ save: [], change: [] }>()
const { t } = useI18n()

const activeTab = ref<'response' | 'match' | 'variants' | 'raw'>('response')
const selectedVariantId = ref<string>(null)
const variantStrip = ref<HTMLElement>()
const pathField = ref<FieldInstance>()
const baseResponseForm = ref<InstanceType<typeof MockResponseForm>>()
const matchForm = ref<InstanceType<typeof MockMatchTab>>()
const variantForm = ref<InstanceType<typeof MockResponseForm>>()
const rawText = ref<string>('')
const rawError = ref<string>('')

const baseResponse = computed({
  get: () => record.value.response,
  set: (value) => { record.value.response = value }
})

const selectedVariant = computed(() =>
  record.value?.variants?.find(it => it.id === selectedVariantId.value) ?? null
)
const selectedVariantModel = computed({
  get: () => selectedVariant.value,
  set: (value) => {
    const index = record.value.variants.findIndex(it => it.id === selectedVariantId.value)
    if (index >= 0) record.value.variants[index] = value
  }
})

const variantStatusText = computed({
  get: () => String(selectedVariant.value?.statusCode ?? ''),
  set: (value: string) => {
    if (selectedVariant.value == null) return
    const num = Number.parseInt(value)
    selectedVariant.value.statusCode = Number.isFinite(num) ? num : 0
  }
})

const variantDelayText = computed({
  get: () => String(selectedVariant.value?.delayMs ?? 0),
  set: (value: string) => {
    if (selectedVariant.value == null) return
    const num = Number.parseInt(value)
    selectedVariant.value.delayMs = Number.isFinite(num) ? num : 0
  }
})

const atVariantLimit = computed(() => record.value.variants.length >= MOCK_MAX_VARIANTS)
const canSave = computed(() => !props.saving && (props.dirty || props.newRecord))

watch(record, () => emit('change'), { deep: true })
// 切换记录后旧变体可能已不存在，进入变体页时总有一个可编辑对象
watch(record, () => {
  if (activeTab.value === 'variants') ensureVariantSelected()
})
watch(activeTab, (tab) => {
  if (tab === 'raw') {
    rawText.value = toRawJson(record.value)
    rawError.value = ''
  }
  if (tab === 'variants') ensureVariantSelected()
})
watch(selectedVariantId, () => {
  nextTick(() => {
    variantStrip.value?.querySelector('.variant-chip.van-button--primary')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
})
watch(() => record.value?.variants, () => {
  if (selectedVariantId.value != null && !record.value.variants.some(it => it.id === selectedVariantId.value)) {
    selectedVariantId.value = null
  }
}, { deep: true })

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (canSave.value) emit('save')
  }
}

function ensureVariantSelected() {
  const variants = record.value?.variants ?? []
  if (variants.length === 0) {
    selectedVariantId.value = null
    return
  }
  if (variants.some(it => it.id === selectedVariantId.value)) return
  selectedVariantId.value = record.value.activeVariantId ?? variants[0].id
}

function selectVariant(variant: ProxyMock.MockVariant) {
  selectedVariantId.value = variant.id
}

function statusTone(code: number): string {
  if (code >= 200 && code < 300) return 'is-success'
  if (code >= 300 && code < 400) return 'is-warning'
  if (code >= 400) return 'is-danger'
  return 'is-muted'
}

function addVariant() {
  if (atVariantLimit.value) return
  const variant = createVariant(record.value.response, record.value.variants.length + 1)
  record.value.variants.push(variant)
  selectedVariantId.value = variant.id
}

function duplicateVariant() {
  if (atVariantLimit.value) return
  const source = selectedVariant.value ?? record.value.response
  const variant = createVariant(source, record.value.variants.length + 1)
  variant.name = `${selectedVariant.value?.name ?? t('mock.editor.variantName')} - ${t('mock.editor.copySuffix')}`
  record.value.variants.push(variant)
  selectedVariantId.value = variant.id
}

function removeVariant(variant: ProxyMock.MockVariant) {
  const variants = record.value.variants
  const index = variants.findIndex(it => it.id === variant.id)
  if (index < 0) return
  variants.splice(index, 1)
  if (record.value.activeVariantId === variant.id) record.value.activeVariantId = null
  // 删除当前编辑项后落到相邻变体，避免编辑区突然空掉
  if (selectedVariantId.value === variant.id) {
    selectedVariantId.value = variants[Math.min(index, variants.length - 1)]?.id ?? null
  }
}

function toggleActive(variant: ProxyMock.MockVariant) {
  record.value.activeVariantId = record.value.activeVariantId === variant.id ? null : variant.id
}

// 校验失败后定位：路径直接聚焦，响应/变体字段切到对应页签再聚焦
// 入参刻意不绑 MockValidationIssue，新建记录也用它聚焦路径，那个码不属服务端校验
function focusField(issue: { code: string; field?: string }) {
  const field = issue.field ?? ''
  if (field === 'url') {
    pathField.value?.focus()
    return
  }
  if (field.startsWith('match')) {
    activeTab.value = 'match'
    nextTick(() => nextTick(() => matchForm.value?.focusField(issue.code)))
    return
  }
  if (field.startsWith('variants') || field === 'activeVariantId') {
    const index = Number.parseInt(field.match(/^variants\[(\d+)\]/)?.[1] ?? '')
    const variant = Number.isInteger(index) ? record.value.variants[index] : null
    if (variant != null) selectedVariantId.value = variant.id
    activeTab.value = 'variants'
    ensureVariantSelected()
    nextTick(() => nextTick(() => variantForm.value?.focusField(issue.code)))
    return
  }
  activeTab.value = 'response'
  nextTick(() => nextTick(() => baseResponseForm.value?.focusField(issue.code)))
}

defineExpose({ focusField })

function applyRaw() {
  try {
    const parsed = JSON.parse(rawText.value)
    if (parsed == null || typeof parsed !== 'object') throw new Error('invalid')
    record.value.name = parsed.name ?? record.value.name
    record.value.url = parsed.url ?? record.value.url
    record.value.match = parsed.match ?? record.value.match
    record.value.response = parsed.response ?? record.value.response
    record.value.variants = Array.isArray(parsed.variants) ? parsed.variants : []
    record.value.activeVariantId = parsed.activeVariantId ?? null
    record.value.source = parsed.source ?? record.value.source
    rawError.value = ''
  } catch (err) {
    rawError.value = t('mock.editor.rawInvalid')
  }
}
</script>

<style scoped>
.record-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.editor-head {
  gap: var(--sp-lg);
  padding: 0 var(--sp-sm);
  flex: none;
}

.head-fields {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  gap: var(--sp-sm);
  min-width: 0;
}

/* 名称与路径各占一行，长路径可以完整看到 */
.name-field,
.path-field {
  flex: none;
  width: 100%;
  padding: var(--sp-md) var(--sp-lg);
  border-radius: var(--van-radius-md);
}

.head-actions {
  gap: var(--sp-lg);
  flex: none;
}

/* 保存是主操作，图标随正文字号走，不再继承 mini 的 xs */
.editor-head :deep(.van-button--mini) {
  font-size: var(--van-font-size-md);
}

.editor-tabs {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  margin-top: var(--sp-md);
}

.editor-tabs :deep(.van-tabs__content) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/* 面板内容溢出时，flex 收缩会把导航条压矮（28.8px -> 21.6px），导致 tab 区整体上移 */
.editor-tabs :deep(.van-tabs__wrap) {
  flex: none;
}

.editor-tabs :deep(.van-tab__panel) {
  height: 100%;
  overflow: auto;
  padding: 0 var(--sp-sm);
  /* 预留滚动条宽度：展开响应头等操作触发溢出时，内容不会左右跳动 */
  scrollbar-gutter: stable;
}

.tab-body {
  padding-bottom: var(--sp-lg);
}

/* 响应体已贴合面板底部，额外的下边距会撑出滚动条 */
.response-tab {
  padding-bottom: 0;
}

.variants-tab {
  display: flex;
  flex-direction: column;
  gap: var(--sp-lg);
  height: 100%;
  min-height: 0;
  /* 变体编辑区已贴合面板底部 */
  padding-bottom: 0;
}

/* 变体条固定在顶部，高度不随变体数量增长，把剩余高度全留给响应体 */
.variant-bar {
  gap: var(--sp-lg);
  flex: none;
  min-width: 0;
  /* 固定高度：出现横向滚动条时不改变编辑区位置 */
  height: calc(var(--van-font-size-md) * 2.5);
  margin-top: var(--sp-tight);
}

.variant-strip {
  display: flex;
  align-items: center;
  gap: var(--sp-md);
  flex: 1 1 auto;
  min-width: 0;
  padding-bottom: var(--sp-xs);
  overflow-x: auto;
  overflow-y: hidden;
}

.variant-strip::-webkit-scrollbar {
  height: var(--sp-xs);
}

.variant-strip::-webkit-scrollbar-thumb {
  border-radius: var(--sp-xs);
  background: var(--van-border-color);
}

/* 变体条内的按钮/胶囊统一用正文字号，图标按钮不再继承 mini 的 xs */
.variant-bar :deep(.van-button--mini) {
  font-size: var(--van-font-size-md);
}

.variant-bar :deep(.van-tag) {
  font-size: var(--van-font-size-sm);
}

/* 变体胶囊直接用 van-button（mini + round），选中态由 primary 实心样式提供 */
.variant-chip {
  flex: none;
  max-width: calc(var(--van-font-size-md) * 13.8);
  height: calc(var(--van-font-size-md) * 2.5);
  padding: 0 var(--sp-xl);
  font-size: var(--van-font-size-md);
}

/* mini 按钮自带相邻外边距，条内统一交给 gap 控制 */
.variant-strip .variant-chip {
  margin-left: 0;
}

.variant-chip :deep(.van-button__content)::before {
  display: none;
}

.variant-chip :deep(.van-button__text) {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-md);
  min-width: 0;
  max-width: 100%;
}

.variant-chip-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.variant-chip-status {
  flex: none;
  font-size: var(--van-font-size-sm);
  font-variant-numeric: tabular-nums;
}

.variant-chip-status.is-success {
  color: var(--van-success-color);
}

.variant-chip-status.is-warning {
  color: var(--van-warning-color);
}

.variant-chip-status.is-danger {
  color: var(--van-danger-color);
}

.variant-chip-status.is-muted {
  color: var(--van-text-color-3);
}

.variant-chip.van-button--primary .variant-chip-status {
  color: rgba(255, 255, 255, 0.82);
}

.variant-chip-check {
  flex: none;
  font-size: 1em;
  color: var(--van-success-color);
}

.variant-chip.van-button--primary .variant-chip-check {
  color: var(--van-white);
}

.variant-editor {
  flex: 1 1 auto;
  min-height: 0;
}

/* 名称编辑与变体级操作合并到一行，替代原来单独的”编辑变体：xxx”标题 */
.variant-editor-bar {
  gap: var(--sp-md);
  margin-bottom: var(--sp-lg);
  min-width: 0;
}

/* 基准宽度取 0，换行判定只按最小宽计算，让名称占满剩余空间而不是先挤掉右侧操作 */
.variant-name-field {
  flex: 1 1 0;
  min-width: calc(var(--van-font-size-md) * 7.4);
  padding: var(--sp-sm) var(--sp-lg);
  border-radius: var(--van-radius-md);
}

.variant-name-field :deep(.van-field__control) {
  font-weight: 500;
}

/* 状态码与延迟作为名称行的紧凑元信息，标签内联不占整行 */
.variant-meta-field {
  flex: none;
  padding: var(--sp-sm) var(--sp-md);
  border-radius: var(--van-radius-md);
  font-size: var(--van-font-size-md);
}

.variant-meta-field :deep(.van-field__label) {
  flex: none;
  margin-right: var(--sp-sm);
  width: auto;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
}

.variant-meta-field :deep(.van-field__control) {
  font-size: var(--van-font-size-md);
  font-variant-numeric: tabular-nums;
}

/* 宽度按英文 “Status Code” + 数值预留，避免最大字号下标签挤掉输入值 */
.variant-status-field {
  width: calc(var(--van-font-size-md) * 10.5);
}

.variant-delay-field {
  width: calc(var(--van-font-size-md) * 9.5);
}

.meta-unit {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.variant-active {
  gap: var(--sp-md);
  flex: none;
}

.variant-active-label {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
  white-space: nowrap;
}

.variant-editor-bar :deep(.van-button) {
  flex: none;
}

.variant-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-lg);
  flex: 1 1 auto;
  min-height: 0;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-md);
}

.raw-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-md);
  height: 100%;
  /* 高度已由面板限定，额外的下内边距会撑出滚动条 */
  padding-bottom: 0;
}

.raw-head {
  gap: var(--sp-lg);
  flex: none;
}

.raw-hint {
  flex: 1 1 auto;
  /* 所在行不换行：缺少这条的话提示语不能收缩，会把右侧「应用」按钮顶出面板 */
  min-width: 0;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

.raw-editor {
  position: relative;
  flex: 1 1 auto;
  min-height: calc(var(--van-font-size-md) * 12.3);
}

/* 铺满剩余高度，编辑器底边与面板/左侧列表底边对齐 */
.raw-editor :deep(.ace-editor) {
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
}
</style>
