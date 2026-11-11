<template>
  <div class="response-form" :class="{ 'fill-body': fillBody, 'no-meta': !showMeta }">
    <van-row v-if="showMeta" class="form-row" :wrap="false">
      <van-field ref="statusField" class="status-field" type="digit" :label="$t('mock.editor.statusCode')"
        :placeholder="$t('mock.editor.statusCode')" v-model="statusText" />
      <van-field ref="delayField" class="delay-field" type="digit" :label="$t('mock.editor.delay')"
        :placeholder="$t('mock.editor.delay')" v-model="delayText">
        <template #extra>
          <span class="field-unit">ms</span>
        </template>
      </van-field>
    </van-row>

    <van-collapse v-model="expandedSections" :border="false" class="header-collapse" @transitionend="syncBodyFill">
      <van-collapse-item name="headers" :title="$t('mock.editor.headers')">
        <template #right-icon>
          <van-button class="header-add btn-icon-only" size="mini" plain type="primary" icon="plus" @click.stop="addHeader">
          </van-button>
        </template>
        <div ref="headerList" class="field-list">
          <van-row v-for="(row, idx) in headerRows" :key="idx" class="field-row" align="center" :wrap="false">
            <van-field class="field-key" v-model="row.key" :placeholder="$t('mock.editor.headerKey')"
              @update:model-value="applyHeaders" />
            <van-field class="field-value" v-model="row.value" :placeholder="$t('mock.editor.headerValue')"
              @update:model-value="applyHeaders" />
            <van-icon name="cross" class="row-delete" @click="removeHeader(idx)" />
          </van-row>
          <div v-if="headerRows.length === 0" class="empty-tip">{{ $t('mock.editor.noHeaders') }}</div>
        </div>
      </van-collapse-item>
    </van-collapse>

    <div ref="bodySection" class="form-section body-section"
      :style="fillBody ? { paddingBottom: `${sectionPadBottom}px` } : null">
      <van-row class="section-head body-head" align="center">
        <span class="section-title">{{ $t('mock.editor.body') }}</span>
        <van-radio-group v-model="bodyTypeValue" direction="horizontal" class="body-type">
          <van-radio v-for="type in bodyTypes" :key="type" :name="type">{{ type.toUpperCase() }}</van-radio>
        </van-radio-group>
        <van-row class="body-tools" align="center" :wrap="false">
          <span class="body-size">{{ $t('mock.editor.bodySize', { size: bodySizeText }) }}</span>
          <van-row class="body-actions" :class="{ 'is-inactive': bodyTypeValue !== 'json' }" :wrap="false">
            <van-button size="mini" plain class="tool-btn" @click="formatBody">
              <template #icon>
                <van-icon class="iconfont icon-format" />
              </template>
            </van-button>
            <van-button size="mini" plain class="tool-btn" @click="compactBody">
              <template #icon>
                <van-icon class="iconfont icon-compress" />
              </template>
            </van-button>
          </van-row>
        </van-row>
      </van-row>

      <van-row v-if="jsonError || bodyTooLarge" class="body-warning" justify="end" :wrap="false">
        <span v-if="jsonError" class="json-warning">{{ $t('mock.editor.invalidJson') }}</span>
        <span v-else class="json-warning">{{ $t('mock.editor.bodyTooLarge') }}</span>
      </van-row>

      <div v-if="isBinary" class="binary-tip">
        {{ $t('mock.editor.binaryTip', { size: bodySizeText }) }}
      </div>
      <div v-else ref="editorWrap" class="body-editor">
        <vue-ace-editor ref="bodyEditor" v-model:data="bodyValue" :lang="aceLang" :read-only="false" :fold="false"
          searchable :fill="fillBody" :fill-max-inset="fillInset" :max-lines="fillBody ? null : 16" />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { MOCK_MAX_BODY_BYTES, ProxyMock, base64ToText, textToBase64, utf8ByteLength } from '@shared'
import type { FieldInstance } from 'vant'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { compactJson, formatBytes, prettifyJson } from '../../../common/format'
import VueAceEditor from '../../components/VueAceEditor.vue'

const response = defineModel<ProxyMock.MockResponseDef>({ required: true })
// showMeta 用显式默认值：布尔 prop 缺省会被 Vue 转成 false
const props = withDefaults(defineProps<{ fillBody?: boolean, showMeta?: boolean }>(), { showMeta: true })

const bodyTypes: ProxyMock.MockBodyType[] = ['json', 'xml', 'text', 'binary']
const headerRows = ref<Array<{ key: string, value: string }>>([])
const expandedSections = ref<string[]>([])
const bodyEditor = ref<InstanceType<typeof VueAceEditor>>()
const editorWrap = ref<HTMLElement>()
const bodySection = ref<HTMLElement>()
const headerList = ref<HTMLElement>()
const statusField = ref<FieldInstance>()
const delayField = ref<FieldInstance>()
const fillInset = ref(0)
// Ace 按整行决定高度，不足一行的余量补进卡片下内边距，底边才能贴合面板底部
const sectionPadBottom = ref(4)
let editingHeaders = false

const statusText = computed({
  get: () => String(response.value?.statusCode ?? ''),
  set: (value: string) => {
    const num = Number.parseInt(value)
    response.value.statusCode = Number.isFinite(num) ? num : 0
  }
})

const delayText = computed({
  get: () => String(response.value?.delayMs ?? 0),
  set: (value: string) => {
    const num = Number.parseInt(value)
    response.value.delayMs = Number.isFinite(num) ? num : 0
  }
})

const bodyTypeValue = computed({
  get: () => response.value?.bodyType ?? 'json',
  set: (value: ProxyMock.MockBodyType) => {
    const previous = response.value.bodyType
    if (value === previous) return
    // binary 的内容按 base64 存储与发送，切换时转换，避免把可见文本直接当 base64 解出乱码
    if (value === 'binary') {
      response.value.body = textToBase64(response.value.body)
      response.value.bodyEncoding = 'base64'
    } else if (previous === 'binary') {
      const text = base64ToText(response.value.body)
      if (text != null) response.value.body = text
      response.value.bodyEncoding = undefined
    }
    response.value.bodyType = value
  }
})

const bodyValue = computed({
  get: () => response.value?.body ?? '',
  set: (value: string) => { response.value.body = value }
})

const isBinary = computed(() => bodyTypeValue.value === 'binary')
const aceLang = computed(() => {
  if (bodyTypeValue.value === 'json') return 'json'
  if (bodyTypeValue.value === 'xml') return 'xml'
  return 'text'
})

const bodySizeText = computed(() => formatBytes(utf8ByteLength(bodyValue.value), 2))
const bodyTooLarge = computed(() => utf8ByteLength(bodyValue.value) > MOCK_MAX_BODY_BYTES)
const jsonError = computed(() => {
  if (bodyTypeValue.value !== 'json') return false
  const text = (bodyValue.value ?? '').trim()
  if (text === '') return false
  try {
    JSON.parse(text)
    return false
  } catch (err) {
    return true
  }
})

watch(() => response.value?.headers, () => {
  if (!editingHeaders) syncHeaders()
}, { deep: true, immediate: true })

watch(() => response.value?.bodyType, (type) => {
  if (type === 'binary' && response.value.bodyEncoding !== 'base64') {
    response.value.bodyEncoding = 'base64'
  }
}, { immediate: true })

// 二进制与编辑器切换会重建 Ace，重新贴合剩余高度
watch(isBinary, () => nextTick(syncBodyFill))

// 增删响应头会改变响应体上方高度
watch(() => headerRows.value.length, () => nextTick(syncBodyFill))

// 校验提示出现/消失会让编辑器位置变化
watch(() => jsonError.value || bodyTooLarge.value, () => nextTick(syncBodyFill))

// 把编辑器上方内容的高度作为尺寸上限：长正文在 Ace 内部滚动，
// 否则编辑器会把外层面板撑高，滚动时格式化那一行会被一起滚出可视区
function syncBodyFill() {
  const wrap = editorWrap.value
  const panel = scrollPanelOf(wrap)
  // 面板隐藏时尺寸为 0，保留上一次的 inset，等真正显示时再重算
  if (wrap != null && panel != null && panel.clientHeight > 0) {
    fillInset.value = Math.max(0, Math.round(
      wrap.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop
    ))
  }
  nextTick(() => {
    bodyEditor.value?.syncFillHeight()
    alignSectionBottom()
  })
}

// 行数取整后卡片底部会剩不足一行的空隙，补进下内边距让底边贴住列底部。
// 以编辑器底边为基准计算，结果只取决于布局，重复调用不会累加
function alignSectionBottom() {
  if (!props.fillBody || editorWrap.value == null) return
  const panel = scrollPanelOf(editorWrap.value)
  if (panel == null || panel.clientHeight === 0) return
  const panelRect = panel.getBoundingClientRect()
  const limit = panelRect.height + panel.scrollTop
  const editorBottom = editorWrap.value.getBoundingClientRect().bottom - panelRect.top + panel.scrollTop
  // 向下取整，避免四舍五入把面板撑出 1px 滚动条；再减去卡片 1px 下边框
  const next = Math.max(4, Math.floor(limit - editorBottom - 1))
  if (next !== sectionPadBottom.value) sectionPadBottom.value = next
}

function scrollPanelOf(el: HTMLElement): HTMLElement {
  return (el?.closest('.van-tab__panel') as HTMLElement) ?? null
}

let panelObserver: ResizeObserver
let editorObserver: ResizeObserver

// Ace 换行数后高度要等渲染器更新，尺寸稳定后再补底部空隙，避免切换类型时错位
watch(editorWrap, (el) => {
  editorObserver?.disconnect()
  editorObserver = null
  if (el == null) return
  editorObserver = new ResizeObserver(() => alignSectionBottom())
  editorObserver.observe(el)
  alignSectionBottom()
})

onMounted(() => {
  syncBodyFill()
  const panel = scrollPanelOf(editorWrap.value)
  if (panel != null) {
    panelObserver = new ResizeObserver(() => syncBodyFill())
    panelObserver.observe(panel)
  }
})

onBeforeUnmount(() => {
  panelObserver?.disconnect()
  panelObserver = null
  editorObserver?.disconnect()
  editorObserver = null
})

function syncHeaders() {
  const rows: Array<{ key: string, value: string }> = []
  const headers = response.value?.headers ?? {}
  for (const key of Object.keys(headers)) {
    const raw = headers[key]
    const values = Array.isArray(raw) ? raw : [raw]
    for (const value of values) rows.push({ key, value: String(value ?? '') })
  }
  headerRows.value = rows
}

function buildHeaders(): ProxyMock.MockResponseHeaders {
  const headers: ProxyMock.MockResponseHeaders = {}
  for (const row of headerRows.value) {
    const key = row.key.trim()
    if (key === '') continue
    const value = row.value
    const previous = headers[key]
    if (previous == null) headers[key] = value
    else if (Array.isArray(previous)) previous.push(value)
    else headers[key] = [previous, value]
  }
  return headers
}

function applyHeaders() {
  editingHeaders = true
  response.value.headers = buildHeaders()
  nextTick(() => { editingHeaders = false })
}

function addHeader() {
  // 折叠状态下新增行不可见，先展开再插入
  if (!expandedSections.value.includes('headers')) {
    expandedSections.value = [...expandedSections.value, 'headers']
  }
  headerRows.value.unshift({ key: '', value: '' })
}

function removeHeader(index: number) {
  headerRows.value.splice(index, 1)
  applyHeaders()
}

function formatBody() {
  // 非法 JSON 保持原样，状态栏已提示
  response.value.body = prettifyJson(response.value.body)
}

function compactBody() {
  response.value.body = compactJson(response.value.body)
}

// 校验失败时把用户带到对应控件：能聚焦的字段直接聚焦，其余滚动到可视区
function focusField(code: string) {
  if (code === 'statusRange') {
    statusField.value?.focus()
    return
  }
  if (code === 'delayRange') {
    delayField.value?.focus()
    return
  }
  if (code === 'headerName' || code === 'headerValue') {
    if (!expandedSections.value.includes('headers')) {
      expandedSections.value = [...expandedSections.value, 'headers']
    }
    nextTick(() => {
      const selector = code === 'headerName' ? '.field-key input' : '.field-value input'
      const input = headerList.value?.querySelector(selector) as HTMLInputElement
      input?.focus()
      input?.scrollIntoView({ block: 'nearest' })
    })
    return
  }
  bodySection.value?.scrollIntoView({ block: 'nearest' })
}

defineExpose({ focusField })
</script>

<style scoped>
.response-form {
  padding: 0 var(--app-sp-sm) var(--app-sp-lg);
}

/* 响应体贴合弹层底部时去掉外围留白，避免多出可滚动的空白 */
.response-form.fill-body {
  padding-bottom: 0;
}

.form-row {
  gap: var(--app-sp-xl);
}

.status-field,
.delay-field {
  flex: 1 1 0;
}

.status-field :deep(.van-field__label),
.delay-field :deep(.van-field__label) {
  flex: none;
  width: auto;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
}

.field-unit {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.form-section {
  margin-top: var(--app-sp-xl);
  padding: var(--app-sp-lg);
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-lg);
  background: var(--van-background-2);
}

/* 状态行并入上方工具栏时，折叠卡片直接贴住上一行 */
.response-form.no-meta .header-collapse {
  margin-top: 0;
}

/* 卡片外观（描边/圆角/底色/裁切）统一由 global.css 的 .header-collapse 提供，
   这里只留本面板的间距与撑满需求 */
.header-collapse {
  margin-top: var(--app-sp-xl);
  width: 100%;
}

/* 只调整折叠标题行，内容区的字段不要一起改 */
.header-collapse :deep(.van-collapse-item > .van-cell) {
  padding: var(--app-sp-lg);
}

.header-collapse :deep(.van-collapse-item__content) {
  padding: 0 var(--app-sp-lg) var(--app-sp-lg);
}

.header-add {
  flex: none;
}

.section-head {
  gap: var(--app-sp-lg);
  margin-bottom: var(--app-sp-md);
}

.section-title {
  flex: none;
  color: var(--van-text-color);
  font-size: var(--van-font-size-md);
  font-weight: 500;
}

.field-list {
  display: flex;
  flex-direction: column;
  gap: var(--app-sp-sm);
}

.field-row {
  gap: var(--app-sp-sm);
}

.field-key {
  /* 与只读键值网格同一条 key 列宽口径，见 global.css 的 --app-header-key-width */
  flex: 0 0 var(--app-header-key-width);
  min-width: 0;
  padding: var(--app-sp-md) var(--app-sp-lg);
  border-radius: var(--van-radius-md);
}

.field-value {
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--app-sp-md) var(--app-sp-lg);
  border-radius: var(--van-radius-md);
}

.row-delete {
  flex: none;
  padding: var(--app-sp-md);
  color: var(--van-danger-color);
  cursor: pointer;
}

.empty-tip {
  padding: var(--app-sp-sm) var(--app-sp-xs);
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

.body-head {
  flex-wrap: wrap;
}

.body-type {
  flex: 1 1 auto;
}

.body-type :deep(.van-radio) {
  margin-right: var(--app-sp-xl);
}

.body-type :deep(.van-radio__label) {
  font-size: var(--van-font-size-sm);
}

.body-tools {
  gap: var(--app-sp-md);
  margin-left: auto;
}

.body-actions {
  gap: var(--app-sp-md);
}

/* 仅隐藏可见性，仍占位，保证顶部行高恒定 */
.body-actions.is-inactive {
  visibility: hidden;
}

/* 体积紧贴格式化按钮左侧，不参与按钮等宽 */
.body-size {
  flex: none;
  margin-right: var(--app-sp-xs);
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
  white-space: nowrap;
}

.tool-btn {
  flex: none;
  width: calc(var(--van-font-size-md) * 1.8);
}

.body-editor {
  min-height: calc(var(--van-font-size-md) * 9.2);
}

/* 填充模式下高度由 Ace 行数决定，最小高度会妨碍收缩 */
.fill-body .body-editor {
  min-height: 0;
}

.fill-body .body-section {
  padding-bottom: var(--app-sp-sm);
}

.binary-tip {
  padding: var(--app-sp-xl);
  border: 1px dashed var(--van-border-color);
  border-radius: var(--van-radius-md);
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

/* 状态行移到编辑器上方，让编辑器成为区块末尾元素，便于贴合底部 */
.body-warning {
  margin: 0 0 var(--app-sp-sm);
  font-size: var(--van-font-size-sm);
}

.json-warning {
  color: var(--van-warning-color);
}
</style>
