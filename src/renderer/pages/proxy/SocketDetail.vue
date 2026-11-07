<template>
  <div v-if="socket != null" class="socket-detail">
    <van-cell-group inset class="socket-summary">
      <van-cell center>
        <template #title>
          <div class="socket-url" :title="socket.url">{{ socket.url }}</div>
        </template>
        <template #right-icon>
          <van-button plain size="small" type="primary" icon="description" @click="copyText(socket.url)" />
        </template>
      </van-cell>
      <div class="socket-stats">
        <div class="socket-stat">
          <span class="stat-label">{{ $t('proxy.socket.status') }}</span>
          <van-tag :type="statusTagType">{{ statusText }}</van-tag>
        </div>
        <div v-if="socket.subprotocol" class="socket-stat">
          <span class="stat-label">{{ $t('proxy.socket.subprotocol') }}</span>
          <span class="stat-value">{{ socket.subprotocol }}</span>
        </div>
        <div class="socket-stat">
          <span class="stat-label">{{ $t('proxy.socket.duration') }}</span>
          <span class="stat-value">{{ durationText }}</span>
        </div>
        <div class="socket-stat">
          <span class="stat-label">{{ $t('proxy.socket.sent') }}</span>
          <span class="stat-value">{{ formatBytes(socket.bytesSent) }}</span>
        </div>
        <div class="socket-stat">
          <span class="stat-label">{{ $t('proxy.socket.received') }}</span>
          <span class="stat-value">{{ formatBytes(socket.bytesReceived) }}</span>
        </div>
        <div class="socket-stat">
          <span class="stat-label">{{ $t('proxy.socket.frameCount') }}</span>
          <span class="stat-value">{{ socket.frameCount ?? frames.length }}</span>
        </div>
        <div v-if="(socket.droppedFrames ?? 0) > 0" class="socket-stat">
          <span class="stat-label">{{ $t('proxy.socket.droppedCount') }}</span>
          <span class="stat-value is-warn">{{ socket.droppedFrames }}</span>
        </div>
        <div v-if="socket.wsPhase === 'close'" class="socket-stat">
          <span class="stat-label">{{ $t('proxy.socket.closeCode') }}</span>
          <span class="stat-value" :class="{ 'is-danger': socket.closeCode !== 1000 && socket.closeCode !== 1001 }">
            {{ socket.closeCode ?? '-' }}
          </span>
        </div>
        <div v-if="socket.closeReason" class="socket-stat is-wide">
          <span class="stat-label">{{ $t('proxy.socket.closeReason') }}</span>
          <span class="stat-value" :title="socket.closeReason">{{ socket.closeReason }}</span>
        </div>
        <div v-if="socket.closeBy" class="socket-stat">
          <span class="stat-label">{{ $t('proxy.socket.closeByLabel') }}</span>
          <span class="stat-value">{{ closeByText }}</span>
        </div>
      </div>
      <div v-if="socket.errorCode" class="socket-error" :title="socket.errorMessage">
        <strong>{{ socket.errorCode }}</strong>
        <span>{{ errorText }}</span>
      </div>
    </van-cell-group>

    <van-collapse v-model="expandedHeaders" :border="false" class="header-collapse">
      <van-collapse-item name="requestHeader" :title="$t('proxy.socket.requestHeaders')"
        :value="String(requestHeaders.length)">
        <div class="header-list">
          <div v-for="(item, idx) in requestHeaders" :key="`req-${item.key}-${idx}`" class="header-row">
            <span class="header-key">{{ item.key }}</span>
            <span class="header-value">{{ item.value }}</span>
          </div>
          <div v-if="requestHeaders.length === 0" class="header-empty">-</div>
        </div>
      </van-collapse-item>
      <van-collapse-item name="responseHeader" :title="$t('proxy.socket.responseHeaders')"
        :value="String(responseHeaders.length)">
        <div class="header-list">
          <div v-for="(item, idx) in responseHeaders" :key="`resp-${item.key}-${idx}`" class="header-row">
            <span class="header-key">{{ item.key }}</span>
            <span class="header-value">{{ item.value }}</span>
          </div>
          <div v-if="responseHeaders.length === 0" class="header-empty">-</div>
        </div>
      </van-collapse-item>
    </van-collapse>

    <div class="socket-messages">
      <div class="msg-toolbar">
        <div class="msg-filter">
          <van-button v-for="item in directionOptions" :key="item.value" size="mini" class="filter-btn"
            :type="direction === item.value ? 'primary' : 'default'"
            :plain="direction !== item.value" @click="direction = item.value">
            {{ item.label }}
          </van-button>
        </div>
        <div class="msg-filter">
          <van-button v-for="item in categoryOptions" :key="item.value" size="mini" class="filter-btn"
            :type="category === item.value ? 'primary' : 'default'"
            :plain="category !== item.value" @click="category = item.value">
            {{ item.label }}
          </van-button>
        </div>
        <van-switch v-model="follow" size="16px" class="follow-switch" />
        <span class="follow-label" @click="follow = !follow">{{ $t('proxy.socket.follow') }}</span>
        <van-button v-if="!follow" size="mini" plain type="primary" @click="scrollToLatest">
          {{ $t('proxy.socket.backToLatest') }}
        </van-button>
        <span class="msg-count">{{ filteredFrames.length }} / {{ frames.length }}</span>
      </div>
      <van-field v-model="keyword" clearable :placeholder="$t('proxy.socket.searchPlaceholder')"
        left-icon="search" class="msg-search" />

      <OverlayScrollbarsComponent ref="listRef" class="msg-list" :options="scrollOptions" defer>
        <div v-for="frame in filteredFrames" :key="frame.seq" class="msg-row"
          :class="{ 'is-selected': frame.seq === selectedSeq, 'is-c2s': frame.dir === 'c2s' }"
          @click="selectedSeq = frame.seq">
          <span class="msg-time">{{ frame.at }}ms</span>
          <span class="msg-dir" :class="frame.dir">{{ frame.dir === 'c2s' ? '↑' : '↓' }}</span>
          <span class="msg-opcode" :class="frameCategory(frame.opcode)">{{ frame.opcode }}</span>
          <span class="msg-size">{{ formatBytes(frame.size) }}</span>
          <span class="msg-preview" :title="framePreview(frame)">{{ framePreview(frame) }}</span>
          <van-tag v-if="frame.truncated" plain type="warning" class="msg-tag">
            {{ $t('proxy.socket.truncated') }}
          </van-tag>
        </div>
        <div v-if="frames.length === 0" class="msg-empty">{{ $t('proxy.socket.noFrames') }}</div>
        <div v-else-if="filteredFrames.length === 0" class="msg-empty">{{ $t('proxy.socket.noMatch') }}</div>
      </OverlayScrollbarsComponent>

      <div class="msg-detail">
        <div class="msg-detail-head">
          <span class="msg-detail-title">{{ $t('proxy.socket.messageDetail') }}</span>
          <template v-if="selectedFrame != null">
            <span class="msg-detail-meta">
              #{{ selectedFrame.seq }} · {{ selectedFrame.dir === 'c2s' ? '↑' : '↓' }} ·
              {{ selectedFrame.opcode }} · {{ formatBytes(selectedFrame.size) }} · {{ selectedFrame.at }}ms
            </span>
            <van-button size="mini" plain type="primary" @click="copyText(frameText)">
              {{ $t('proxy.socket.copy') }}
            </van-button>
          </template>
        </div>
        <div v-if="selectedFrame == null" class="msg-detail-empty">{{ $t('proxy.socket.selectFrame') }}</div>
        <vue-ace-editor v-else :fold="false" :fill="true" :data="frameText" searchable />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ProxyMock } from '@shared'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { showToast } from 'vant'
import type { PropType } from 'vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { scrollOptions } from '../../common/scroll'
import VueAceEditor from '../components/VueAceEditor.vue'
import {
  formatBytes, formatDuration, frameCategory, frameContent, framePreview,
} from './socket.helper'

const props = defineProps({
  record: { type: Object as PropType<ProxyMock.SocketRecord> },
})

const { t, te } = useI18n()

type Direction = 'all' | 'c2s' | 's2c'
type Category = 'all' | 'text' | 'binary' | 'control'

const direction = ref<Direction>('all')
const category = ref<Category>('all')
const keyword = ref('')
const follow = ref(true)
const selectedSeq = ref<number>(null)
const expandedHeaders = ref<string[]>([])
const listRef = ref<any>()
const now = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval>
let viewportEl: HTMLElement

const socket = computed(() => props.record as ProxyMock.SocketRecord)
const frames = computed(() => socket.value?.frames ?? [])
const isLive = computed(() => socket.value != null && socket.value.wsPhase !== 'close')

const directionOptions = computed<Array<{ value: Direction, label: string }>>(() => [
  { value: 'all', label: t('proxy.socket.all') },
  { value: 'c2s', label: t('proxy.socket.up') },
  { value: 's2c', label: t('proxy.socket.down') },
])

const categoryOptions = computed<Array<{ value: Category, label: string }>>(() => [
  { value: 'all', label: t('proxy.socket.all') },
  { value: 'text', label: t('proxy.socket.text') },
  { value: 'binary', label: t('proxy.socket.binary') },
  { value: 'control', label: t('proxy.socket.control') },
])

const filteredFrames = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return frames.value.filter(frame => {
    if (direction.value !== 'all' && frame.dir !== direction.value) return false
    if (category.value !== 'all' && frameCategory(frame.opcode) !== category.value) return false
    if (text !== '' && !String(frame.data ?? '').toLowerCase().includes(text)) return false
    return true
  })
})

const selectedFrame = computed(() =>
  selectedSeq.value == null ? null : frames.value.find(it => it.seq === selectedSeq.value) ?? null)

const frameText = computed(() => {
  const frame = selectedFrame.value
  if (frame == null) return ''
  const content = frameContent(frame)
  return frame.truncated
    ? `${content}\n\n${t('proxy.socket.truncatedNote', { size: formatBytes(frame.size) })}`
    : content
})

const durationText = computed(() => {
  const record = socket.value
  if (record == null) return '-'
  if (record.wsPhase === 'close') return formatDuration(record.time ?? 0)
  return formatDuration(Math.max(0, now.value - (record.timestamp ?? now.value)))
})

const statusText = computed(() => {
  const record = socket.value
  if (record == null) return ''
  if (record.wsPhase !== 'close') return t('proxy.socket.connected')
  if (record.errorCode) return `${t('proxy.socket.failed')} ${record.statusCode}`
  return t('proxy.socket.closed')
})

const statusTagType = computed(() => {
  const record = socket.value
  if (record?.wsPhase !== 'close') return 'success'
  if (record.errorCode) return 'danger'
  return record.closeCode === 1000 || record.closeCode === 1001 ? 'success' : 'warning'
})

const closeByText = computed(() => {
  const by = socket.value?.closeBy
  return by == null ? '-' : t(`proxy.socket.closeBy.${by}`)
})

const errorText = computed(() => {
  const record = socket.value
  if (record?.errorCode == null) return ''
  const key = `proxy.socket.errors.${record.errorCode}`
  return te(key) ? t(key) : (record.errorMessage ?? record.errorCode)
})

interface HeaderEntry {
  key: string
  value: string
}

function toKeyValueEntries(source: Record<string, any> | null | undefined): HeaderEntry[] {
  if (source == null) return []
  return Object.keys(source).map(key => {
    const value = source[key]
    const text = Array.isArray(value) ? value.map(it => String(it ?? '')).join('\n')
      : typeof value === 'object' && value != null ? JSON.stringify(value) : String(value ?? '')
    return { key, value: text }
  })
}

const requestHeaders = computed(() => toKeyValueEntries(socket.value?.requestHeaders))
const responseHeaders = computed(() => toKeyValueEntries(socket.value?.responseHeaders))

function bindViewport() {
  viewportEl = listRef.value?.$el?.querySelector('.os-viewport') ?? null
  viewportEl?.addEventListener('scroll', onScroll, { passive: true })
}

function onScroll() {
  if (viewportEl == null) return
  follow.value = viewportEl.scrollHeight - viewportEl.scrollTop - viewportEl.clientHeight < 24
}

function scrollToLatest() {
  void nextTick(() => {
    const viewport = viewportEl ?? listRef.value?.$el?.querySelector('.os-viewport')
    if (viewport == null) return
    viewport.scrollTop = viewport.scrollHeight
    follow.value = true
  })
}

async function copyText(text: string) {
  try {
    if (window.mainApi) await window.mainApi.writeClipboard(text)
    else await navigator.clipboard.writeText(text)
    showToast(t('proxy.socket.copied'))
  } catch (err) {
    showToast(t('common.copyFailed'))
  }
}

watch(() => props.record?.id, () => {
  selectedSeq.value = null
  follow.value = true
  void nextTick(scrollToLatest)
})

watch(() => filteredFrames.value.length, () => {
  if (follow.value) scrollToLatest()
})

watch(follow, (value) => {
  if (value) scrollToLatest()
})

onMounted(() => {
  tickTimer = setInterval(() => { now.value = Date.now() }, 1000)
  tickTimer.unref?.()
  void nextTick(() => {
    bindViewport()
    scrollToLatest()
  })
})

onUnmounted(() => {
  clearInterval(tickTimer)
  viewportEl?.removeEventListener('scroll', onScroll)
})
</script>

<style scoped>
.socket-detail {
  padding-bottom: 5px;
}

.socket-summary {
  margin-top: 5px;
}

.socket-url {
  font-size: var(--van-font-size-md);
  font-weight: 500;
  word-break: break-all;
  user-select: text;
}

.socket-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px 12px;
  padding: 8px 16px 10px;
}

.socket-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: var(--van-font-size-sm);
}

.socket-stat.is-wide {
  grid-column: span 3;
}

.stat-label {
  flex: none;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-xs);
}

.stat-value {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--van-text-color);
}

.stat-value.is-warn {
  color: var(--van-warning-color);
}

.stat-value.is-danger {
  color: var(--van-danger-color);
}

.socket-error {
  display: flex;
  gap: 8px;
  margin: 0 16px 10px;
  padding: 6px 10px;
  border-radius: var(--van-radius-md);
  background: rgba(238, 10, 36, 0.08);
  color: var(--van-danger-color);
  font-size: var(--van-font-size-sm);
  word-break: break-all;
}

.header-collapse {
  margin: var(--van-padding-md) var(--van-padding-md) 0;
  overflow: hidden;
  border-radius: var(--van-radius-lg);
  background: var(--van-cell-group-background);
}

.header-list {
  display: grid;
  grid-template-columns: fit-content(40%) minmax(0, 1fr);
  column-gap: 16px;
  row-gap: 6px;
  padding: 5px 15px;
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

.header-empty {
  grid-column: span 2;
  color: var(--van-text-color-3);
}

.socket-messages {
  display: flex;
  flex-direction: column;
  margin: var(--van-padding-md) var(--van-padding-md) 0;
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-lg);
  background: var(--van-cell-group-background);
  overflow: hidden;
}

.msg-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px 0;
}

.msg-filter {
  display: flex;
  gap: 4px;
}

.filter-btn {
  min-width: 42px;
  padding: 0 8px;
}

.follow-switch {
  margin-left: auto;
}

.follow-label {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-xs);
  cursor: pointer;
  user-select: none;
}

.msg-count {
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-xs);
  font-variant-numeric: tabular-nums;
}

.msg-search {
  margin-top: 6px;
  padding: 2px 12px;
  font-size: var(--van-font-size-sm);
}

.msg-list {
  height: clamp(220px, 38vh, 460px);
  border-top: 1px solid var(--van-border-color);
  border-bottom: 1px solid var(--van-border-color);
  background: var(--van-background);
}

.msg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 10px;
  border-left: 2px solid transparent;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: var(--van-font-size-xs);
  color: var(--van-text-color-2);
  cursor: pointer;
  user-select: none;
}

.msg-row:hover {
  background: var(--van-gray-1);
}

.msg-row.is-selected {
  background: var(--van-primary-color);
  color: #fff;
}

.msg-row.is-selected .msg-preview,
.msg-row.is-selected .msg-time,
.msg-row.is-selected .msg-size {
  color: rgba(255, 255, 255, 0.86);
}

.msg-row.is-c2s {
  border-left-color: var(--van-warning-color);
}

.msg-row:not(.is-c2s) {
  border-left-color: var(--van-primary-color);
}

.msg-time {
  flex: none;
  width: 64px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.msg-dir {
  flex: none;
  width: 14px;
  text-align: center;
  font-weight: 700;
}

.msg-dir.c2s {
  color: var(--van-warning-color);
}

.msg-dir.s2c {
  color: var(--van-primary-color);
}

.msg-row.is-selected .msg-dir {
  color: #fff;
}

.msg-opcode {
  flex: none;
  width: 46px;
}

.msg-opcode.text {
  color: var(--van-success-color);
}

.msg-opcode.binary {
  color: #8e44ad;
}

.msg-opcode.control {
  color: var(--van-text-color-3);
}

.msg-row.is-selected .msg-opcode {
  color: #fff;
}

.msg-size {
  flex: none;
  width: 64px;
  color: var(--van-text-color-3);
  font-variant-numeric: tabular-nums;
}

.msg-preview {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--van-text-color);
}

.msg-tag {
  flex: none;
}

.msg-empty {
  padding: 24px 12px;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
  text-align: center;
}

.msg-detail {
  display: flex;
  flex-direction: column;
  height: 240px;
}

.msg-detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
}

.msg-detail-title {
  flex: none;
  font-size: var(--van-font-size-sm);
  font-weight: 500;
}

.msg-detail-meta {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--van-text-color-3);
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: var(--van-font-size-xs);
}

.msg-detail-empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

.msg-detail :deep(.ace-editor-wrapper) {
  flex: 1 1 auto;
  min-height: 0;
}

@media (max-width: 1100px) {
  .socket-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .socket-stat.is-wide {
    grid-column: span 2;
  }
}
</style>