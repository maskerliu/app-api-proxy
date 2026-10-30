<template>
  <van-tabs v-if="views.length > 0" v-model:active="active" shrink sticky style="width: 100%;">
    <van-tab v-for="view in views" :key="view.name" :name="view.name" :title="view.title">
      <vue-ace-editor v-if="view.kind == 'code'" style="width: 100%;" :fold="false" :max-lines="22" :lang="view.lang"
        :data="view.content" />
      <van-row v-else-if="view.kind == 'form'" class="form-body">
        <van-field v-for="(field, idx) in view.fields" :key="`${field.key}-${idx}`" readonly :label="field.key">
          <template #input>
            <span class="body-text">{{ field.value }}</span>
          </template>
        </van-field>
      </van-row>
      <div v-else class="body-text">{{ view.content }}</div>
    </van-tab>
  </van-tabs>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
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

const contentType = computed(() => headerValue(props.headers, 'content-type').toLowerCase())

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
const isXml = computed(() => contentType.value.includes('xml'))
const isJson = computed(() => body.value.json
  || contentType.value.includes('json')
  || contentType.value.includes('graphql'))
const isBinary = computed(() => !body.value.json && !isForm.value && !isXml.value
  && /^\[binary[^\]]*\]$/.test(body.value.text))

const views = computed<BodyView[]>(() => {
  const { text } = body.value
  if (isForm.value) {
    const params = new URLSearchParams(text)
    return [{
      name: 'form',
      title: 'Form',
      kind: 'form',
      fields: [...params.entries()].map(([key, value]) => ({ key, value }))
    }]
  }
  if (isJson.value) {
    return [{ name: 'json', title: 'JSON', kind: 'code', lang: 'json', content: text }]
  }
  if (isXml.value) {
    return [{ name: 'xml', title: 'XML', kind: 'code', lang: 'xml', content: text }]
  }
  if (isBinary.value) {
    return [{ name: 'binary', title: 'Binary', kind: 'text', content: text }]
  }
  return [{ name: 'text', title: 'Text', kind: 'code', lang: 'text', content: text }]
})

watch(views, value => {
  if (!value.some(it => it.name == active.value)) active.value = value[0]?.name ?? ''
}, { immediate: true })
</script>

<style scoped>
.form-body {
  max-height: 8rem;
  overflow-y: auto;
}

.body-text {
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}
</style>
