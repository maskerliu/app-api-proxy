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
      <van-row align="center" class="socket-stats">
        <van-tag :type="status.tagType">{{ status.text }}</van-tag>
        <van-row v-for="stat in stats" :key="stat.key" align="center" :wrap="false" class="socket-stat"
          :title="stat.title">
          <span v-if="stat.label" class="stat-label">{{ stat.label }}</span>
          <span v-for="(value, idx) in stat.values" :key="idx" class="stat-value" :class="value.cls" :title="value.title">
            <template v-if="value.icon"><i class="iconfont dir-icon" :class="value.icon"></i> {{ value.text }}</template>
            <template v-else>{{ value.text }}</template>
          </span>
        </van-row>
      </van-row>
      <van-row v-if="socket.errorCode" :wrap="false" class="socket-error" :title="socket.errorMessage">
        <strong>{{ socket.errorCode }}</strong>
        <span>{{ errorText }}</span>
      </van-row>
    </van-cell-group>

    <van-collapse v-model="expandedHeaders" :border="false" class="header-collapse">
      <van-collapse-item v-for="group in headerGroups" :key="group.name" :name="group.name" :title="group.title"
        :value="String(group.items.length)">
        <div class="header-list">
          <div v-for="(item, idx) in group.items" :key="`${group.name}-${item.key}-${idx}`" class="header-row">
            <span class="header-key" :title="item.key"><bdi>{{ item.key }}</bdi></span>
            <span class="header-value">{{ item.value }}</span>
          </div>
          <div v-if="group.items.length === 0" class="header-empty">-</div>
        </div>
      </van-collapse-item>
    </van-collapse>

    <div class="socket-messages">
      <van-row align="center" :wrap="false" class="msg-toolbar">
        <van-radio-group v-model="direction" direction="horizontal" class="filter-btn-group">
          <van-radio v-for="item in directionOptions" :key="item.value" :name="item.value">{{ item.label }}</van-radio>
        </van-radio-group>
        <mini-select class="category-select" :model-value="category" :options="categoryOptions" font-size="sm"
          @update:model-value="onCategoryChange" />
        <van-switch v-model="follow" size="16px" class="follow-switch" />
        <span class="follow-label" @click="follow = !follow">{{ $t('proxy.socket.follow') }}</span>
        <span class="msg-count">{{ filteredFrames.length }} / {{ frames.length }}</span>
      </van-row>
      <van-search v-model="keyword" clearable :placeholder="$t('proxy.socket.searchPlaceholder')" class="msg-search" />

      <van-row :wrap="false" class="msg-body">
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
          <div v-if="filteredFrames.length === 0" class="msg-empty">
            {{ $t(frames.length === 0 ? 'proxy.socket.noFrames' : 'proxy.socket.noMatch') }}
          </div>
        </div>

        <div class="msg-detail">
          <van-row align="center" :wrap="false" class="msg-detail-head">
            <span class="msg-detail-title">{{ $t('proxy.socket.messageDetail') }}</span>
            <template v-if="selectedFrame != null">
              <van-row align="center" :wrap="false" class="msg-detail-meta">
                <span class="meta-item">#{{ selectedFrame.seq }}</span>
                <span class="meta-item"><i class="iconfont dir-icon" :class="dirIcon(selectedFrame.dir)"></i></span>
                <span class="meta-item">{{ selectedFrame.opcode }}</span>
                <span class="meta-item">{{ formatBytes(selectedFrame.size) }}</span>
                <span class="meta-item" :title="`${selectedFrame.at} ms`">{{
                  formatFrameOffset(selectedFrame.at) }}</span>
              </van-row>
              <van-button size="mini" plain type="primary" @click="copyText(frameText)">
                {{ $t('proxy.socket.copy') }}
              </van-button>
            </template>
          </van-row>
          <van-row v-if="selectedFrame == null" align="center" justify="center" class="msg-detail-empty">
            {{ $t('proxy.socket.selectFrame') }}
          </van-row>
          <vue-ace-editor v-else :fold="false" :data="frameText" searchable />
        </div>
      </van-row>
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
import MiniSelect from '../components/MiniSelect.vue'
import VueAceEditor from '../components/VueAceEditor.vue'
import { dirIcon, frameCategory, frameContent, framePreview, socketStatsOf, socketStatusOf } from './socket.helper'
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
const status = computed(() => socketStatusOf(socket.value, t))
const requestHeaders = computed(() => toKeyValueEntries(socket.value?.requestHeaders))
const responseHeaders = computed(() => toKeyValueEntries(socket.value?.responseHeaders))
const headerGroups = computed(() => [
  { name: 'requestHeader', title: t('proxy.socket.requestHeaders'), items: requestHeaders.value },
  { name: 'responseHeader', title: t('proxy.socket.responseHeaders'), items: responseHeaders.value },
])

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

function onCategoryChange(value: string) {
  category.value = value as Category
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

const stats = computed(() => socketStatsOf(socket.value, {
  t,
  duration: durationText.value,
  frameTotal: frames.value.length,
}))

const errorText = computed(() => {
  const record = socket.value
  if (record?.errorCode == null) return ''
  const key = `proxy.socket.errors.${record.errorCode}`
  return te(key) ? t(key) : (record.errorMessage ?? record.errorCode)
})

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
  /* van-row 自带 flex + wrap：指标合并在一条信息带内，宽度不足才换行，避免详情区被统计块挤高 */
  gap: 4px 14px;
  padding: var(--sp-lg) var(--sp-3xl) var(--sp-xl);
}

.socket-stat {
  gap: var(--sp-md);
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
  gap: var(--sp-lg);
  margin: 0 var(--sp-3xl) var(--sp-xl);
  padding: var(--sp-md) var(--sp-xl);
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
  /* radio 自身高度写死 20px，这里按字号兜底，保证整行高度跟随全局字号缩放 */
  min-height: calc(var(--van-font-size-md) * 1.9);
  gap: var(--sp-md);
  padding: var(--sp-lg) var(--sp-xl) 0;
}

.filter-btn-group {
  /* van-radio-group direction="horizontal" 自带 display:flex，这里只覆盖它默认可换行的行为 */
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
  padding: 0 var(--sp-lg);
  white-space: nowrap;
}

/* 类别筛选换成 MiniSelect：条高按工具栏同一基准（md*1.9）压平，不让下拉把整行顶高；
   四个选项收进弹层后，窄窗口下方向组与跟随开关之间不再被裁 */
.category-select {
  flex: none;
  --mini-select-bar-height: calc(var(--van-font-size-md) * 1.9);
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
  margin: var(--sp-md) 0;
  padding: var(--sp-xs) var(--sp-2xl);
  font-size: var(--van-font-size-sm);

  --van-cell-vertical-padding: 0;
}

.msg-body {
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
  gap: var(--sp-md);
  height: calc(var(--van-font-size-sm) * 2.2);
  padding: 0 var(--sp-lg);
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
  gap: var(--sp-lg);
  padding: var(--sp-md) var(--sp-xl);
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
  margin: 0 var(--card-gutter);
}

.msg-detail-empty {
  flex: 1 1 auto;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

.msg-detail :deep(.ace-editor-wrapper) {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}
</style>