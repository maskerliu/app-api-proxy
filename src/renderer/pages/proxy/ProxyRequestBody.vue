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
      <div class="form-body">
        <div v-for="(field, idx) in activeView.fields" :key="`${field.key}-${idx}`" class="form-row">
          <span class="form-key">{{ field.key }}</span>
          <span class="form-value">{{ field.value }}</span>
        </div>
      </div>
    </OverlayScrollbarsComponent>
    <div v-else class="body-text">{{ activeView?.content }}</div>
  </div>
</template>

<script lang="ts" setup>
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { computed, ref, watch } from 'vue'
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

function headerValue(headers: Record<string, any> | undefined, name: string): string {
  if (headers == null) return ''
  const key = Object.keys(headers).find(it => it.toLowerCase() == name)
  const value = key == null ? null : headers[key]
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

const contentTypeRaw = computed(() => headerValue(props.headers, 'content-type'))
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
  column-gap: 16px;
  row-gap: 4px;
  padding: 10px 0;
}

.form-body-scroll {
  max-height: 8rem;
}

.form-body {
  display: grid;
  grid-template-columns: fit-content(40%) minmax(0, 1fr);
  column-gap: 16px;
  row-gap: 6px;
  padding: 5px 15px;
  /* 抵消外层 van-cell__value 的右对齐，与请求头键值样式保持一致 */
  text-align: left;
  /* label 与 input 统一为 Ace 编辑器字体 */
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'Source Code Pro', 'source-code-pro', monospace;
  font-size: var(--van-font-size-md);
  user-select: text;
}

.form-row {
  display: contents;
}

.form-key {
  color: var(--van-text-color-2);
  word-break: break-all;
}

.form-value {
  color: var(--van-text-color);
  white-space: pre-line;
  word-break: break-all;
}

.body-text {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'Source Code Pro', 'source-code-pro', monospace;
  white-space: pre-wrap;
  word-break: break-all;
  text-align: left;
  /* 代码区已隐藏行号槽，文本内边距与 Ace 内容起始位置对齐 */
  padding: 4px 15px 4px 20px;
  user-select: text;
}
</style>
