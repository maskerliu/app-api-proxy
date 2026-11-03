<template>
  <van-form ref="detailContainer" label-align="right" colon>
    <div class="url-bar" :style="{ top: `${stickyTop}px`, marginTop: `${stickyTop}px` }">
      <van-cell-group inset title="">
        <van-cell center>
          <template #title>
            <span class="van-ellipsis">{{ record.url }}</span>
          </template>
          <template #right-icon>
            <van-button style="margin: 0 10px;" plain size="small" type="success" icon="description"
              @click="copyLink" />
            <van-button plain size="small" type="primary" icon="bookmark-o" @click="addToMockRule" />
          </template>
        </van-cell>
      </van-cell-group>
    </div>

    <van-collapse v-model="expandedHeaders" :border="false" class="header-collapse" @transitionend="syncResponseFill">
      <van-collapse-item name="requestHeader" :title="$t('proxy.requestHeader')">
        <div class="header-list">
          <div v-for="(item, idx) in requestHeaders" :key="`${item.key}-${idx}`" class="header-row">
            <span class="header-key">{{ item.key }}</span>
            <span class="header-value">{{ item.value }}</span>
          </div>
        </div>
      </van-collapse-item>
    </van-collapse>

    <van-collapse v-model="expandedHeaders" :border="false" class="header-collapse" @transitionend="syncResponseFill">
      <van-collapse-item name="responseHeader" :title="$t('proxy.responseHeader')">
        <div class="header-list">
          <div v-for="(item, idx) in responseHeaders" :key="`${item.key}-${idx}`" class="header-row">
            <span class="header-key">{{ item.key }}</span>
            <span class="header-value">{{ item.value }}</span>
          </div>
        </div>
      </van-collapse-item>
    </van-collapse>

    <van-collapse v-if="requestParams.length > 0" v-model="expandedHeaders" :border="false" class="header-collapse"
      @transitionend="syncResponseFill">
      <van-collapse-item name="requestParams" :title="$t('proxy.requestParams')">
        <div class="header-list">
          <div v-for="(item, idx) in requestParams" :key="`${item.key}-${idx}`" class="header-row">
            <span class="header-key">{{ item.key }}</span>
            <span class="header-value">{{ item.value }}</span>
          </div>
        </div>
      </van-collapse-item>
    </van-collapse>

    <van-cell-group class="detail-content body-group" inset :title="$t('proxy.requestBody')" v-if="record.data != null">
      <van-cell class="detail-content">
        <proxy-request-body :data="record.data" :headers="record.headers" />
      </van-cell>
    </van-cell-group>

    <van-cell-group ref="detailResp" class="detail-content body-group" inset :title="$t('proxy.responseBody')"
      style="margin-bottom: 5px;">
      <van-cell style="padding: 0;">
        <template #value>
          <vue-ace-editor ref="responseEditor" :fold="false" :fill="true"
            :data="record.responseData == null ? '{}' : JSON.stringify(record.responseData, null, '\t')" />
        </template>
      </van-cell>
    </van-cell-group>
  </van-form>
</template>

<script lang="ts" setup>
import { ProxyMock } from '@shared'
import { Form, showToast } from 'vant'
import { computed, inject, nextTick, PropType, ref, watch } from 'vue'
import VueAceEditor from '../components/VueAceEditor.vue'
import ProxyRequestBody from './ProxyRequestBody.vue'

// 吸顶位置相对右侧滚动容器计算：electron 标题栏拖拽区 32px，容器顶部距窗口 5px，
// 留 25px 使卡片上沿稳定停在拖拽区下方。margin-top 同步加同样距离，
// 让卡片原位就等于吸顶位置，否则吸顶后会压住下方请求头，破坏与其它区块一致的间距
const stickyTop = window.isWeb ? 0 : 25

const props = defineProps({
  record: { type: Object as PropType<ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord> },
})

const detailContainer = ref<typeof Form>()
const detailResp = ref()
const responseEditor = ref<InstanceType<typeof VueAceEditor>>()
const apiDesc = ref<string>(null)
const openMockRuleMgr = inject<(withRecord: boolean) => void>('openMockRuleMgr')

const expandedHeaders = ref<string[]>([])

interface HeaderEntry {
  key: string
  value: string
}

// 值可能是数组（如 set-cookie、同名 query 参数），按多行展示，和 Chrome 一致
function toKeyValueEntries(source: Record<string, any> | null | undefined): HeaderEntry[] {
  if (source == null) return []
  return Object.keys(source).map(key => {
    const value = source[key]
    const text = Array.isArray(value) ? value.map(it => String(it ?? '')).join('\n')
      : typeof value === 'object' && value != null ? JSON.stringify(value) : String(value ?? '')
    return { key, value: text }
  })
}

const requestHeaders = computed(() => toKeyValueEntries(props.record?.headers))
const responseHeaders = computed(() => toKeyValueEntries(props.record?.responseHeaders))
const requestParams = computed(() => toKeyValueEntries(props.record?.requestData))

function syncResponseFill() {
  // 展开折叠块时保留响应体当前高度，让页面滚动高度随内容增长；收起时再补足剩余空间
  responseEditor.value?.syncFillHeight(false)
}

// 请求体区块随记录有没有而增减，responseBody 的顶部位置会变，需要重新贴合父容器底部
watch(() => props.record, () => nextTick(() => responseEditor.value?.syncFillHeight()))

// watch(props.record, () => {
//   updated()
// })

async function copyLink() {
  const url = props.record?.url
  if (url == null) {
    showToast('请先选择一条请求记录')
    return
  }

  try {
    if (window.mainApi) {
      await window.mainApi.writeClipboard(url)
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
    } else {
      fallbackCopy(url)
    }
    showToast(`[ ${url} ] 已复制到剪贴板`)
  } catch (err) {
    showToast('复制失败，请手动复制')
  }
}

function fallbackCopy(text: string) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) throw new Error('copy failed')
}

function addToMockRule() {
  if (props.record == null) {
    showToast('请先选择一条请求记录')
    return
  }
  openMockRuleMgr(true)
}

function updated() {
  this.$refs.inspectorPanel.scrollTop = 0
  this.$nextTick(() => {
    // detailContainer.value.$el.scrollTop = detailResp.value.$el.getBoundingClientRect().top
  })
}
</script>

<style scoped>
.detail-content {
  padding: 0;
}

.url-bar {
  position: sticky;
  z-index: 99;
}

.header-collapse {
  margin: var(--van-padding-md) var(--van-padding-md) 0;
  overflow: hidden;
  border-radius: var(--van-radius-lg);
  background: var(--van-cell-group-background);
}

/* 内容区块与折叠头部同宽：抵消 cell-group inset 的默认 5px 边距 */
.body-group {
  margin-left: var(--van-padding-md);
  margin-right: var(--van-padding-md);
}

.header-list {
  display: grid;
  grid-template-columns: fit-content(40%) minmax(0, 1fr);
  column-gap: 16px;
  row-gap: 6px;
  padding: 5px 15px;
  /* 与 Ace 编辑器（ace.css .ace_editor 默认栈）保持一致 */
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'Source Code Pro', 'source-code-pro', monospace;
  font-size: var(--van-font-size-md);
  user-select: text;
}

.header-row {
  display: contents;
}

.header-key {
  color: var(--van-text-color-2);
  word-break: break-all;
}

.header-value {
  color: var(--van-text-color);
  white-space: pre-line;
  word-break: break-all;
}
</style>
