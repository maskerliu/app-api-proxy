<template>
  <div v-if="socket != null" class="socket-detail">
    <van-cell-group inset class="socket-summary">
      <van-cell center>
        <template #title>
          <div class="socket-url" :title="socket.url">{{ socket.url }}</div>
        </template>
        <template #right-icon>
          <van-button class="btn-icon-only" plain size="small" type="primary" icon="description"
            @click="copyText(socket.url)" />
        </template>
      </van-cell>
      <div class="socket-stats">
        <van-tag :type="statusTagType">{{ statusText }}</van-tag>
        <div class="socket-stat">
          <span class="stat-label">{{ $t('proxy.socket.duration') }}</span>
          <span class="stat-value">{{ durationText }}</span>
        </div>
        <div class="socket-stat" :title="$t('proxy.socket.bytesTitle')">
          <span class="stat-value"><i class="iconfont dir-icon icon-upstream"></i> {{
            formatBytes(socket.bytesSent) }}</span>
          <span class="stat-value"><i class="iconfont dir-icon icon-downlink"></i> {{
            formatBytes(socket.bytesReceived) }}</span>
        </div>
        <div class="socket-stat">
          <span class="stat-label">{{ $t('proxy.socket.frameCount') }}</span>
          <span class="stat-value">{{ socket.frameCount ?? frames.length }}</span>
          <span v-if="(socket.droppedFrames ?? 0) > 0" class="stat-value is-warn">{{
            $t('proxy.socket.dropped', { count: socket.droppedFrames }) }}</span>
        </div>
        <div v-if="socket.subprotocol" class="socket-stat">
          <span class="stat-label">{{ $t('proxy.socket.subprotocol') }}</span>
          <span class="stat-value">{{ socket.subprotocol }}</span>
        </div>
        <div v-if="socket.wsPhase === 'close'" class="socket-stat">
          <span class="stat-label">{{ $t('proxy.socket.closeCode') }}</span>
          <span class="stat-value" :class="{ 'is-danger': socket.closeCode !== 1000 && socket.closeCode !== 1001 }">{{
            socket.closeCode ?? '-' }}</span>
          <span v-if="socket.closeBy" class="stat-value">{{ closeByText }}</span>
          <span v-if="socket.closeReason" class="stat-value" :title="socket.closeReason">{{
            socket.closeReason }}</span>
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
          <van-radio-group v-model="direction" direction="horizontal" class="filter-btn-group">
            <van-radio v-for="item in directionOptions" :key="item.value" :name="item.value">{{
              item.label }}</van-radio>
          </van-radio-group>
        </div>
        <div class="msg-filter">
          <van-radio-group v-model="category" direction="horizontal" class="filter-btn-group">
            <van-radio v-for="item in categoryOptions" :key="item.value" :name="item.value">{{ item.label }}</van-radio>
          </van-radio-group>
        </div>
        <van-switch v-model="follow" size="16px" class="follow-switch" />
        <span class="follow-label" @click="follow = !follow">{{ $t('proxy.socket.follow') }}</span>
        <span class="msg-count">{{ filteredFrames.length }} / {{ frames.length }}</span>
      </div>
      <van-search v-model="keyword" clearable :placeholder="$t('proxy.socket.searchPlaceholder')" class="msg-search" />

      <div class="msg-body">
        <div ref="listRef" class="msg-list">
          <div v-for="frame in filteredFrames" :key="frame.seq" class="msg-row"
            :class="{ 'is-selected': frame.seq === selectedSeq }" @click="selectedSeq = frame.seq">
            <span class="msg-time" :title="`${frame.at} ms`">{{ formatFrameOffset(frame.at) }}</span>
            <span class="msg-dir"><i class="iconfont dir-icon" :class="dirIcon(frame.dir)"></i></span>
            <span class="msg-opcode">{{ frame.opcode }}</span>
            <span class="msg-preview" :title="framePreview(frame)">{{ framePreview(frame) }}</span>
            <van-tag v-if="frame.truncated" plain type="warning" class="msg-tag">
              {{ $t('proxy.socket.truncated') }}
            </van-tag>
            <span class="msg-size">{{ formatBytes(frame.size) }}</span>
          </div>
          <div v-if="frames.length === 0" class="msg-empty">{{ $t('proxy.socket.noFrames') }}</div>
          <div v-else-if="filteredFrames.length === 0" class="msg-empty">{{ $t('proxy.socket.noMatch') }}</div>
        </div>

        <div class="msg-detail">
          <div class="msg-detail-head">
            <span class="msg-detail-title">{{ $t('proxy.socket.messageDetail') }}</span>
            <template v-if="selectedFrame != null">
              <span class="msg-detail-meta">
                <span class="meta-item">#{{ selectedFrame.seq }}</span>
                <span class="meta-item"><i class="iconfont dir-icon" :class="dirIcon(selectedFrame.dir)"></i></span>
                <span class="meta-item">{{ selectedFrame.opcode }}</span>
                <span class="meta-item">{{ formatBytes(selectedFrame.size) }}</span>
                <span class="meta-item" :title="`${selectedFrame.at} ms`">{{
                  formatFrameOffset(selectedFrame.at) }}</span>
              </span>
              <van-button size="mini" plain type="primary" @click="copyText(frameText)">
                {{ $t('proxy.socket.copy') }}
              </van-button>
            </template>
          </div>
          <div v-if="selectedFrame == null" class="msg-detail-empty">{{ $t('proxy.socket.selectFrame') }}</div>
          <vue-ace-editor v-else :fold="false" :data="frameText" searchable />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ProxyMock } from '@shared'
import { showToast } from 'vant'
import type { PropType } from 'vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { copyToClipboard } from '../../common/clipboard'
import { toKeyValueEntries } from '../../common/headerUtil'
import VueAceEditor from '../components/VueAceEditor.vue'
import { frameCategory, frameContent, framePreview } from './socket.helper'
import { formatBytes, formatElapsed, formatFrameOffset } from '../../common/format'

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

function dirIcon(dir: ProxyMock.SocketDirection) {
  return dir === 'c2s' ? 'icon-upstream' : 'icon-downlink'
}

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
  if (record.wsPhase === 'close') return formatElapsed(record.time ?? 0)
  return formatElapsed(Math.max(0, now.value - (record.timestamp ?? now.value)))
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

const requestHeaders = computed(() => toKeyValueEntries(socket.value?.requestHeaders))
const responseHeaders = computed(() => toKeyValueEntries(socket.value?.responseHeaders))

function bindViewport() {
  viewportEl = listRef.value
  viewportEl?.addEventListener('scroll', onScroll, { passive: true })
}

function onScroll() {
  if (viewportEl == null) return
  follow.value = viewportEl.scrollHeight - viewportEl.scrollTop - viewportEl.clientHeight < 24
}

function scrollToLatest() {
  void nextTick(() => {
    const viewport = viewportEl ?? listRef.value
    if (viewport == null) return
    viewport.scrollTop = viewport.scrollHeight
    follow.value = true
  })
}

async function copyText(text: string) {
  try {
    await copyToClipboard(text)
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
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
}

.socket-summary {
  /* 与 HTTP 详情页 stickyTop (25px)、统计详情页顶部间距保持同一视觉线；引用统一 Token */
  margin: var(--detail-top-gap) var(--van-padding-md) 0;
}

.socket-url {
  font-size: var(--van-font-size-md);
  font-weight: 500;
  word-break: break-all;
  user-select: text;
}

.socket-stats {
  display: flex;
  align-items: center;
  /* 指标合并在一条信息带内，宽度不足才换行，避免详情区被统计块挤高 */
  flex-wrap: wrap;
  gap: 4px 14px;
  padding: 8px 16px 10px;
}

.socket-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: var(--van-font-size-sm);
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
  background: color-mix(in srgb, var(--van-danger-color) 8%, transparent);
  color: var(--van-danger-color);
  font-size: var(--van-font-size-sm);
  word-break: break-all;
}

.header-empty {
  grid-column: span 2;
  color: var(--van-text-color-3);
}

.header-collapse {
  margin: var(--van-padding-md) var(--van-padding-md) 0;
}

.socket-messages {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  margin: var(--van-padding-md) var(--van-padding-md) 0;
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-lg);
  background: var(--van-cell-group-background);
  overflow: hidden;
}

.msg-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  /* radio 自身高度写死 20px，这里按字号兜底，保证整行高度跟随全局字号缩放 */
  min-height: calc(var(--van-font-size-md) * 1.9);
  gap: 6px;
  padding: 8px 10px 0;
}

.msg-filter {
  display: flex;
  flex: none;
  gap: 4px;
}

.filter-btn-group {
  display: flex;
  flex: none;
  flex-wrap: nowrap;
  white-space: nowrap;
  /* Vant 的 label 默认还带 8px 左外边距，与下方 padding 叠加会让图标和文字之间空到 16px */
  --van-radio-label-margin: 0px;
}

.filter-btn-group :deep(.van-radio) {
  flex: none;
  margin: 0;
}

.filter-btn-group :deep(.van-radio__label) {
  padding: 0 8px;
  white-space: nowrap;
}

.follow-switch {
  flex: none;
  margin-left: auto;
}

.follow-label {
  flex: none;
  white-space: nowrap;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-xs);
  cursor: pointer;
  user-select: none;
}

.msg-count {
  flex: none;
  white-space: nowrap;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-xs);
  font-variant-numeric: tabular-nums;
}

.msg-search {
  margin: 6px 0;
  padding: 2px 12px;
  font-size: var(--van-font-size-sm);

  --van-cell-vertical-padding: 0;
}

.msg-body {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--van-border-color);
}

.msg-list {
  flex: 1;
  min-width: 0;
  min-height: 200px;
  overflow-y: auto;
  border-right: 1px solid var(--van-border-color);
  background: var(--van-background);
}

.msg-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: calc(var(--van-font-size-sm) * 2.2);
  padding: 0 8px;
  font-family: var(--mono-font);
  font-size: var(--van-font-size-sm);
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
.msg-row.is-selected .msg-opcode,
.msg-row.is-selected .msg-size {
  color: rgba(255, 255, 255, 0.86);
}

/* 时间/类型/字节三列是次要信息，宽度按字号比例给足等宽字符数，既列对齐又跟随字号缩放 */
.msg-time,
.msg-opcode,
.msg-size {
  flex: none;
  color: var(--van-text-color-3);
  font-variant-numeric: tabular-nums;
}

.msg-time {
  width: calc(var(--van-font-size-sm) * 4.6);
  text-align: right;
}

.msg-opcode {
  width: calc(var(--van-font-size-sm) * 4.2);
}

.msg-size {
  width: calc(var(--van-font-size-sm) * 5);
  text-align: right;
}

.dir-icon {
  /* iconfont 基础样式写死 16px，改为跟随所在行字号，保证全局字号缩放时同步 */
  font-size: inherit;
  /* 行盒按 1em 收拢后以文字中线对齐：默认基线对齐会让箭头整体偏上 */
  line-height: 1;
  vertical-align: middle;
}

/* 方向配色单一来源：上行蓝、下行绿 */
.dir-icon.icon-upstream {
  color: var(--van-primary-color);
}

.dir-icon.icon-downlink {
  color: var(--van-success-color);
}

.msg-dir {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: calc(var(--van-font-size-sm) * 1.4);
}

.msg-row.is-selected .dir-icon {
  color: #fff;
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
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.msg-detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
}

.msg-detail-head .van-button {
  flex: none;
  white-space: nowrap;
}

.msg-detail-title {
  flex: none;
  font-size: var(--van-font-size-sm);
  font-weight: 500;
}

.msg-detail-meta {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--van-text-color-3);
  font-family: var(--mono-font);
  font-size: var(--van-font-size-xs);
}

.meta-item {
  flex: none;
  white-space: nowrap;
}

/* 分隔符交给伪元素，比原先写在文案里的 " · " 少占近一半横向空间 */
.meta-item + .meta-item::before {
  content: '·';
  margin: 0 5px;
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
  position: relative;
}
</style>