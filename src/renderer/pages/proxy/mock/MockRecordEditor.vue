<template>
  <div class="record-editor">
    <van-row class="editor-head" align="center" :wrap="false">
      <div class="head-fields">
        <van-field class="control-field name-field" label-width="3.1em" v-model="record.name"
          :label="$t('mock.editor.name')" :placeholder="$t('mock.editor.namePlaceholder')" />
        <van-field ref="pathField" class="control-field path-field" label-width="3.1em" v-model="record.url"
          :label="$t('mock.editor.path')" :placeholder="$t('mock.editor.pathPlaceholder')" />
      </div>
      <van-row class="head-actions" align="center" :wrap="false">
        <van-tag v-if="dirty" type="warning" plain>{{ $t('mock.editor.unsaved') }}</van-tag>
        <!-- 裸图标没有按钮的 loading 属性，保存中换成同档的转圈：字形与 spinner 都取 --app-glyph-size，
             替换时这一格不跳。不可用态靠置灰 + 点击守卫成对表达（同 MockRuleMgr 头部那排）。 -->
        <van-loading v-if="saving" type="spinner" size="var(--app-glyph-size)" color="var(--van-primary-color)" />
        <van-icon v-else name="success" class="icon-action action-glyph"
          :class="canSave ? 'action-glyph--primary' : 'action-glyph--disabled'" @click="canSave && emit('save')" />
      </van-row>
    </van-row>

    <van-tabs v-model:active="activeTab" class="editor-tabs" shrink>
      <van-tab :title="$t('mock.editor.tab.response')" name="response">
        <div class="tab-body response-tab">
          <mock-response-form ref="baseResponseForm" v-model="baseResponse" fill-body />
        </div>
      </van-tab>

      <van-tab :title="$t('mock.editor.tab.match')" name="match" class="match-panel">
        <OverlayScrollbarsComponent class="tab-scroll" :options="scrollOptions" defer>
          <div class="tab-body match-tab">
            <mock-match-tab ref="matchForm" :record="record" />
          </div>
        </OverlayScrollbarsComponent>
      </van-tab>

      <van-tab :title="$t('mock.editor.tab.variants')" name="variants">
        <div class="tab-body variants-tab">
          <van-row class="variant-bar" align="center" :wrap="false">
            <div ref="variantStrip" class="variant-strip" @wheel="onStripWheel">
              <van-button v-for="variant in record.variants" :key="variant.id" size="mini" class="variant-chip"
                :type="variant.id === selectedVariantId ? 'primary' : 'default'"
                :plain="variant.id !== selectedVariantId" v-tip="variant.name" @click="selectVariant(variant)">
                <span class="variant-chip-name truncate">{{ variant.name || $t('mock.editor.variantName') }}</span>
                <span class="variant-chip-status num" :class="statusTone(variant.statusCode)">{{ variant.statusCode
                  }}</span>
                <van-icon v-if="record.activeVariantId === variant.id" name="success" class="variant-chip-check"
                  v-tip="$t('mock.editor.servesVariantHint', { name: variant.name || $t('mock.editor.variantName') })" />
              </van-button>
            </div>
            <van-tag type="primary" plain>
              {{ record.variants.length }}/{{ MOCK_MAX_VARIANTS }}
            </van-tag>
            <!-- 放在滚动区外，变体再多也始终可见 -->
            <van-icon name="plus" class="icon-action action-glyph"
              :class="atVariantLimit ? 'action-glyph--disabled' : 'action-glyph--primary'" @click="addVariant" />
          </van-row>

          <van-empty v-if="record.variants.length === 0" class="variant-empty" image="search" image-size="64"
            :description="$t('mock.editor.noVariants')" />

          <div v-else class="variant-editor">
            <van-row v-if="selectedVariant != null" class="variant-editor-bar" align="center" :wrap="false">
              <van-field class="control-field variant-name-field" v-model="selectedVariant.name"
                :placeholder="$t('mock.editor.variantName')" />
              <van-field class="control-field variant-meta-field" type="digit"
                :label="$t('mock.editor.statusCode')" :placeholder="$t('mock.editor.statusCode')"
                v-model="variantStatusText" />
              <van-field class="control-field variant-meta-field" type="digit" :label="$t('mock.editor.delay')"
                :placeholder="$t('mock.editor.delay')" v-model="variantDelayText">
                <template #extra>
                  <span class="meta-unit">ms</span>
                </template>
              </van-field>
              <van-row class="variant-active" align="center" :wrap="false">
                <!-- 与同排复制/删除的字形同高，档位读 global.css 的 --app-switch-size（同 MockRuleMgr 头部开关） -->
                <van-switch :model-value="record.activeVariantId === selectedVariant.id"
                  size="var(--app-switch-size)"
                  v-tip="record.activeVariantId === selectedVariant.id ? $t('mock.editor.servesVariant') : $t('mock.editor.setServing')"
                  @update:model-value="toggleActive(selectedVariant)" />
              </van-row>
              <van-icon class="iconfont icon-copy icon-action action-glyph"
                :class="atVariantLimit ? 'action-glyph--disabled' : 'action-glyph--success'"
                v-tip="$t('mock.editor.duplicateVariant')" @click="duplicateVariant" />
              <van-icon class="iconfont icon-delete icon-action action-glyph action-glyph--danger"
                v-tip="$t('mock.editor.deleteVariant')" @click="removeVariant(selectedVariant)" />
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
            <span class="raw-hint hint">{{ $t('mock.editor.rawHint') }}</span>
            <van-button size="mini" plain type="primary" @click="applyRaw">{{ $t('mock.editor.rawApply') }}</van-button>
          </van-row>
          <van-notice-bar v-if="rawError" :text="rawError" mode="closeable" color="var(--van-danger-color)"
            background="color-mix(in srgb, var(--van-danger-color) 8%, transparent)" />
          <div class="raw-editor">
            <vue-ace-editor v-model:data="rawText" lang="json" :fold="false" :gutter="false" searchable />
          </div>
        </div>
      </van-tab>
    </van-tabs>
  </div>
</template>

<script lang="ts" setup>
import { MOCK_MAX_VARIANTS, ProxyMock } from '@shared'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import type { FieldInstance } from 'vant'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { scrollOptions } from '../../../common/scroll'
import VueAceEditor from '../../components/VueAceEditor.vue'
import MockMatchTab from './MockMatchTab.vue'
import MockResponseForm from './MockResponseForm.vue'
import { createVariant, toRawJson } from './record'

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

// 条内 overflow-y 是 hidden，滚轮默认既滚不动横向也传不上去；把纵向增量转给 scrollLeft。
// 到端点或不溢出时不拦事件，纵向翻页仍归外层面板，否则鼠标停在条上就滚不动响应体了。
function onStripWheel(event: WheelEvent) {
  const strip = variantStrip.value
  if (strip == null) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  const max = strip.scrollWidth - strip.clientWidth
  if (delta === 0 || max <= 0) return
  if (delta < 0 ? strip.scrollLeft <= 0 : strip.scrollLeft >= max) return
  strip.scrollLeft += delta
  event.preventDefault()
}
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
    nextTick(() => nextTick(() => matchForm.value?.focusField(issue.code, issue.field)))
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
  gap: var(--app-sp-lg);
  padding: 0 var(--app-sp-sm);
  flex: none;
}

.head-fields {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  gap: var(--app-sp-sm);
  min-width: 0;
}

/* 名称与路径各占一行，长路径可以完整看到。
   控件外观（高 / 左右内边距 / 下边那条线）、Vant 发丝线的隐藏与 Field 内部三层的适配全部读 global.css 的 .control-field，
   与匹配 tab 的输入框、右侧的纯图标按钮同一档；标签颜色见 global.css 的 .van-field__label，
   垂直居中走 .control-field 里的 align-items:center（原先是这两格各带一个 Vant center 属性，效果同一条声明）。
   这里只剩本地的一条：定高控件不许被容器压扁。 */
.name-field,
.path-field {
  flex: none;
}

.editor-tabs {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  margin-top: var(--app-sp-md);
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
  padding: 0 var(--app-sp-sm);
  /* 预留滚动条宽度：展开响应头等操作触发溢出时，内容不会左右跳动 */
  scrollbar-gutter: stable;
}

/* 匹配面板的滚动交给 OverlayScrollbars（浮层手柄，不占内容宽度）。
   原生 overflow 和为它预留的 gutter 一起撤掉：这一页不再给不存在的滚动条让位，
   与 Settings / 右侧详情等 OS 页面同一口径。代价是切到其余三页时右缘要退回一条滚动条宽。 */
.editor-tabs :deep(.match-panel) {
  overflow: hidden;
  scrollbar-gutter: auto;
}

.tab-scroll {
  height: 100%;
}

.tab-body {
  padding-bottom: var(--app-sp-lg);
}

/* 响应体已贴合面板底部，额外的下边距会撑出滚动条 */
.response-tab {
  padding-bottom: 0;
}

.variants-tab {
  display: flex;
  flex-direction: column;
  gap: var(--app-sp-lg);
  height: 100%;
  min-height: 0;
  /* 变体编辑区已贴合面板底部 */
  padding-bottom: 0;
}

/* 变体条固定在顶部，高度不随变体数量增长，把剩余高度全留给响应体 */
.variant-bar {
  gap: var(--app-sp-lg);
  flex: none;
  min-width: 0;
  /* 固定高度：出现横向滚动条时不改变编辑区位置 */
  height: calc(var(--van-font-size-md) * 2.5);
  margin-top: var(--app-sp-tight);
}

.variant-strip {
  display: flex;
  align-items: center;
  gap: var(--app-sp-md);
  flex: 1 1 auto;
  min-width: 0;
  padding-bottom: var(--app-sp-xs);
  overflow-x: auto;
  overflow-y: hidden;
}

.variant-strip::-webkit-scrollbar {
  height: var(--app-sp-xs);
}

.variant-strip::-webkit-scrollbar-thumb {
  border-radius: var(--app-sp-xs);
  background: var(--van-border-color);
}

.variant-bar :deep(.van-tag) {
  font-size: var(--van-font-size-sm);
}

/* 变体胶囊直接用 van-button（mini + round），选中态由 primary 实心样式提供；
   高度走全站控件档 --app-control-height，胶囊不再自己占一档。同行右侧那枚「+」已是裸图标
   （盒高 = --app-action-square 的热区，比胶囊矮），靠 align=center 居中，不再与它对齐 */
.variant-chip {
  flex: none;
  max-width: calc(var(--van-font-size-md) * 13.8);
  height: var(--app-control-height);
  padding: 0 var(--app-sp-xl);
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
  gap: var(--app-sp-md);
  min-width: 0;
  max-width: 100%;
}

.variant-chip-name {
  min-width: 0;
}

.variant-chip-status {
  flex: none;
  font-size: var(--van-font-size-sm);
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

/* 名称编辑与变体级操作合并到一行，替代原来单独的”编辑变体：xxx”标题。
   这一行的地板（各子项 min-width 之和 27.9md + Vant 相邻 mini 按钮写死的 4px margin）曾是右侧编辑列里最宽的一行，
   MockRuleMgr 的 @container mgr 阈值当时就从它反推（取 50em）。现在更宽的是响应表单的响应体头部行
   （整行固有宽 331.7~477.9px，随语言与字号变），阈值已按它重算到 60em，这一行自然仍在覆盖范围内：
   动这里的 min-width / gap / 按钮个数，还是要回 MockRuleMgr 那段注释核对阈值要不要再抬，
   否则窄窗口又会回到「断点还没到、行已经放不下」的那段。 */
.variant-editor-bar {
  gap: var(--app-sp-md);
  margin-bottom: var(--app-sp-lg);
  min-width: 0;
}

/* 外观（下划线、定高、左右内边距）走 global.css 的 .control-field，与匹配 tab 的 host、记录列表搜索框同一口径。
   基准宽度取 0，收缩判定只按最小宽计算，让名称占满剩余空间而不是先挤掉右侧操作。 */
.variant-name-field {
  flex: 1 1 0;
  min-width: calc(var(--van-font-size-md) * 5.5);
}

.variant-name-field :deep(.van-field__control) {
  font-weight: 500;
}

/* 状态码与延迟作为名称行的紧凑元信息，标签内联不占整行。
   可收缩是这一行不撑破面板的关键：原先六个子项全是 flex:none + 写死宽，最小宽之和在字号 10 约 561px，
   已超过默认窗口下编辑列的实测宽（约 557px），多出来的部分只能把右侧按钮顶出面板并撑出横向滚动。
   现在窄的时候先压这两列，开关与按钮始终留在行内。
   两列合并成同一档（基准 10em / 地板 7em）：与原先分开的 10.5+9.5、7.5+6.5 之和相等，
   所以统一宽度不会把这一行的最小宽之和推回撑破面板的那条线。
   基准按英文全称 “Status Code” + 数值预留，地板只保证标签与两三位数字，压到地板时由输入框自身裁切。
   外观同样走 .control-field，这里只剩这一行的宽度分配与字号。 */
.variant-meta-field {
  flex: 0 1 auto;
  width: calc(var(--van-font-size-md) * 10);
  min-width: calc(var(--van-font-size-md) * 7);
  font-size: var(--van-font-size-md);
}

.variant-meta-field :deep(.van-field__label) {
  flex: none;
  margin-right: var(--app-sp-sm);
  width: auto;
  font-size: var(--van-font-size-md);
}

.variant-meta-field :deep(.van-field__control) {
  font-size: var(--van-font-size-md);
  font-variant-numeric: tabular-nums;
}

.meta-unit {
  flex: none;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

/* 生效开关组只剩开关本身，不收缩；同排的复制/删除是裸图标，flex: none 已在 global.css 的 .icon-action 里 */
.variant-active {
  flex: none;
}

.variant-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--app-sp-lg);
  flex: 1 1 auto;
  min-height: 0;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-md);
}

.raw-body {
  display: flex;
  flex-direction: column;
  gap: var(--app-sp-md);
  height: 100%;
  /* 高度已由面板限定，额外的下内边距会撑出滚动条 */
  padding-bottom: 0;
}

.raw-head {
  gap: var(--app-sp-lg);
  flex: none;
}

.raw-hint {
  flex: 1 1 auto;
  /* 所在行不换行：缺少这条的话提示语不能收缩，会把右侧「应用」按钮顶出面板 */
  min-width: 0;
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
