<template>
  <div v-if="views.length > 0" style="width: 100%;">
    <van-radio-group v-model="active" direction="horizontal" class="body-types">
      <van-radio v-for="view in views" :key="view.name" :name="view.name" icon-size="14px">{{ view.title }}
      </van-radio>
    </van-radio-group>
    <vue-ace-editor v-if="activeView?.kind == 'code'" style="width: 100%;" :fold="false" :gutter="false" :max-lines="22"
      :lang="activeView.lang" :data="activeView.content" />
    <OverlayScrollbarsComponent v-else-if="activeView?.kind == 'form'" class="form-body-scroll"
      :options="scrollOptions" defer>
      <div class="form-body header-list">
        <div v-for="(field, idx) in activeView.fields" :key="`${field.key}-${idx}`" class="header-row">
          <span class="header-key">{{ field.key }}</span>
          <span class="header-value">{{ field.value }}</span>
        </div>
      </div>
    </OverlayScrollbarsComponent>
    <div v-else class="body-text">{{ activeView?.content }}</div>
  </div>
</template>

<script lang="ts" setup>
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { computed, ref, watch } from 'vue'
import { pickHeader } from '@shared/http-header'
import { scrollOptions } from '../../common/scroll'
import VueAceEditor from '../components/VueAceEditor.vue'

interface FormField {
  key: string
  value: string
}

interface BodyView {
  name: string
  title: string
  kind: 'code' | 'form' | 'text'
  lang?: string
  content?: string
  fields?: FormField[]
}

const props = defineProps<{
  data?: unknown
  headers?: Record<string, any>
}>()

const active = ref('')

const contentTypeRaw = computed(() => pickHeader(props.headers, 'content-type') ?? '')
const contentType = computed(() => contentTypeRaw.value.toLowerCase())

// 主进程记录时会把文本类 body 编码成 JSON 字符串字面量，二进制类 body 编码成 "[binary N bytes]"
const body = computed<{ text: string; json: boolean }>(() => {
  const data = props.data
  if (data == null) return { text: '', json: false }
  if (typeof data != 'string') return { text: JSON.stringify(data, null, '\t'), json: true }
  try {
    const parsed = JSON.parse(data)
    if (typeof parsed == 'string') return { text: parsed, json: false }
    return { text: JSON.stringify(parsed, null, '\t'), json: true }
  } catch (err) {
    return { text: data, json: false }
  }
})

const isForm = computed(() => contentType.value.includes('x-www-form-urlencoded'))
const isMultipart = computed(() => contentType.value.includes('multipart/'))
const multipartBoundary = computed(() => {
  // boundary 大小写敏感，需从原始 header 提取，不能用小写化的 contentType
  const value = /boundary\s*=\s*"?([^;"\s]+)"?/i.exec(contentTypeRaw.value)?.[1]
  return value ?? ''
})
const isXml = computed(() => contentType.value.includes('xml'))
const isJson = computed(() => body.value.json
  || contentType.value.includes('json')
  || contentType.value.includes('graphql'))
const isBinary = computed(() => !body.value.json && !isForm.value && !isXml.value
  && /^\[binary[^\]]*\]$/.test(body.value.text))

// 按 boundary 拆分段，头部取 Content-Disposition 的 name/filename，文本段取值、文件段取文件名
function parseMultipart(text: string, boundary: string): FormField[] {
  const fields: FormField[] = []
  if (!boundary) return fields
  for (const segment of text.split(`--${boundary}`)) {
    const part = segment.replace(/^\r\n/, '').replace(/\r\n$/, '')
    if (!part || part == '--') continue
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd < 0) continue
    const head = part.slice(0, headerEnd)
    const value = part.slice(headerEnd + 4)
    const name = /name="([^"]*)"/.exec(head)?.[1] ?? ''
    const filename = /filename="([^"]*)"/.exec(head)?.[1]
    fields.push({ key: name, value: filename ?? value })
  }
  return fields
}

// 参照 Postman：body 类型全部展示，默认选中由 content-type 推导出的实际类型
const BODY_TYPES: ReadonlyArray<Omit<BodyView, 'content' | 'fields'>> = [
  { name: 'formData', title: 'Form Data', kind: 'form' },
  { name: 'form', title: 'Form', kind: 'form' },
  { name: 'json', title: 'JSON', kind: 'code', lang: 'json' },
  { name: 'xml', title: 'XML', kind: 'code', lang: 'xml' },
  { name: 'text', title: 'Text', kind: 'code', lang: 'text' },
  { name: 'binary', title: 'Binary', kind: 'text' },
]

const detectedType = computed(() => {
  if (isMultipart.value) return 'formData'
  if (isForm.value) return 'form'
  if (isJson.value) return 'json'
  if (isXml.value) return 'xml'
  if (isBinary.value) return 'binary'
  return 'text'
})

function parseFormFields(text: string): FormField[] {
  // multipart 文本带 '=' 但不是 urlencoded，不能硬拆出伪参数
  if (text == '' || !text.includes('=') || isMultipart.value) return []
  return [...new URLSearchParams(text).entries()]
    .filter(([key]) => key != '')
    .map(([key, value]) => ({ key, value }))
}

const views = computed<BodyView[]>(() => {
  const { text } = body.value
  return BODY_TYPES.map(view => {
    if (view.name == 'formData') return { ...view, fields: parseMultipart(text, multipartBoundary.value) }
    if (view.name == 'form') return { ...view, fields: parseFormFields(text) }
    return { ...view, content: text }
  })
})

watch(() => props.data, () => { active.value = detectedType.value }, { immediate: true })

const activeView = computed(() => views.value.find(it => it.name == active.value) ?? views.value[0])
</script>

<style scoped>
.body-types {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--sp-3xl);
  row-gap: var(--sp-sm);
  padding: var(--sp-xl) 0;
}

.form-body-scroll {
  /* 8rem 是恒定 128px，字号 10 时每行更高、可见行数反而更少，改成随正文缩放 */
  max-height: calc(var(--van-font-size-md) * 9.8);
}

.form-body {
  text-align: left;
  /* 左侧与代码视图（Ace 内容起点 / .body-text 的 20px）对齐，栅格本身由全局 .header-list 单源提供 */
  padding: var(--sp-tight) var(--sp-3xl) var(--sp-tight) var(--sp-4xl);
}

.body-text {
  font-family: var(--mono-font);
  white-space: pre-wrap;
  word-break: break-all;
  text-align: left;
  /* 代码区已隐藏行号槽，文本内边距与 Ace 内容起始位置对齐 */
  padding: var(--sp-sm) var(--sp-3xl) var(--sp-sm) var(--sp-4xl);
  user-select: text;
}
</style>
