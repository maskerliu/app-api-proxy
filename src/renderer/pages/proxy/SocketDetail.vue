<template>
  <div v-if="socket != null" class="socket-detail">
    <van-cell-group inset class="socket-summary">
      <van-cell center>
        <template #title>
          <div class="socket-url" v-tip="socket.url">{{ socket.url }}</div>
        </template>
        <template #right-icon>
          <van-button class="btn-icon-only" plain size="small" type="primary" @click="copyText(socket.url)">
            <template #icon>
              <van-icon class="iconfont icon-copy" />
            </template>
          </van-button>
        </template>
      </van-cell>
      <van-row align="center" class="socket-stats">
        <van-tag :type="status.tagType">{{ status.text }}</van-tag>
        <van-row v-for="stat in stats" :key="stat.key" align="center" :wrap="false" class="socket-stat"
          v-tip="stat.title">
          <span v-if="stat.label" class="stat-label">{{ stat.label }}</span>
          <span v-for="(value, idx) in stat.values" :key="idx" class="stat-value truncate" :class="value.cls"
            v-tip="value.title">
            <template v-if="value.icon"><i class="iconfont dir-icon" :class="value.icon"></i> {{ value.text
            }}</template>
            <template v-else>{{ value.text }}</template>
          </span>
        </van-row>
      </van-row>
      <van-row v-if="socket.errorCode" :wrap="false" class="socket-error" v-tip="socket.errorMessage">
        <strong>{{ socket.errorCode }}</strong>
        <span>{{ errorText }}</span>
      </van-row>
    </van-cell-group>

    <van-collapse v-model="expandedHeaders" :border="false" class="header-collapse">
      <van-collapse-item v-for="group in headerGroups" :key="group.name" :name="group.name" :title="group.title"
        :value="String(group.items.length)">
        <div class="header-list">
          <div v-for="(item, idx) in group.items" :key="`${group.name}-${item.key}-${idx}`" class="header-row">
            <span class="header-key" v-tip="item.key"><bdi>{{ item.key }}</bdi></span>
            <span class="header-value">{{ item.value }}</span>
          </div>
          <div v-if="group.items.length === 0" class="header-empty">-</div>
        </div>
      </van-collapse-item>
    </van-collapse>

    <div class="socket-messages">
      <van-row align="center" class="msg-toolbar">
        <van-radio-group v-model="direction" direction="horizontal" class="filter-btn-group">
          <van-radio v-for="item in directionOptions" :key="item.value" :name="item.value">{{ item.label }}</van-radio>
        </van-radio-group>
        <mini-select class="category-select" :model-value="category" :options="categoryOptions" font-size="sm"
          @update:model-value="onCategoryChange" />
        <van-field v-model="keyword" class="control-field msg-search" clearable
          :placeholder="$t('proxy.socket.searchPlaceholder')" />
        <span class="msg-count num">{{ filteredFrames.length }} / {{ frames.length }}</span>
      </van-row>

      <van-row :wrap="false" class="msg-body">
        <OverlayScrollbarsComponent class="msg-list" :options="scrollOptions" :events="msgListEvents" defer>
          <div v-for="frame in filteredFrames" :key="frame.seq" class="list-row msg-row mono"
            :class="{ 'is-selected': frame.seq === selectedSeq }" @click="selectedSeq = frame.seq">
            <span class="msg-time num" v-tip="`${frame.at} ms`">{{ formatFrameOffset(frame.at) }}</span>
            <span class="msg-dir"><i class="iconfont dir-icon" :class="dirIcon(frame.dir)"></i></span>
            <span class="msg-opcode num">{{ frame.opcode }}</span>
            <span class="msg-preview truncate" v-tip="framePreview(frame)">{{ framePreview(frame) }}</span>
            <van-tag v-if="frame.truncated" plain type="warning" class="msg-tag">
              {{ $t('proxy.socket.truncated') }}
            </van-tag>
            <span class="msg-size num">{{ formatBytes(frame.size) }}</span>
          </div>
          <div v-if="filteredFrames.length === 0" class="msg-empty hint">
            {{ $t(frames.length === 0 ? 'proxy.socket.noFrames' : 'proxy.socket.noMatch') }}
          </div>
        </OverlayScrollbarsComponent>

        <div class="msg-detail">
          <van-row align="center" :wrap="false" class="msg-detail-head">
            <span class="msg-detail-title">{{ $t('proxy.socket.messageDetail') }}</span>
            <template v-if="selectedFrame != null">
              <van-row align="center" :wrap="false" class="msg-detail-meta mono">
                <span class="meta-item">#{{ selectedFrame.seq }}</span>
                <span class="meta-item"><i class="iconfont dir-icon" :class="dirIcon(selectedFrame.dir)"></i></span>
                <span class="meta-item">{{ selectedFrame.opcode }}</span>
                <span class="meta-item">{{ formatBytes(selectedFrame.size) }}</span>
                <span class="meta-item" v-tip="`${selectedFrame.at} ms`">{{
                  formatFrameOffset(selectedFrame.at) }}</span>
              </van-row>
              <van-button size="mini" plain type="primary" @click="copyText(frameText)">
                {{ $t('proxy.socket.copy') }}
              </van-button>
            </template>
          </van-row>
          <van-row v-if="selectedFrame == null" align="center" justify="center" class="msg-detail-empty hint">
            {{ $t('proxy.socket.selectFrame') }}
          </van-row>
          <!-- autoScrollEditorIntoView 关掉：Ace 在光标移动（切帧时的 navigateFileEnd、Ctrl+F 命中）后
               会把一枚隐形锚点 scrollIntoView，连带外层面板/页面一起滚，用来露出光标却把卡片底边推出视野；
               编辑器自己有滚动条，正文不该驱动祖先滚动 -->
          <vue-ace-editor v-else :fold="false" :gutter="false" :data="frameText" searchable
            :options="{ autoScrollEditorIntoView: false }" />
        </div>
      </van-row>

      <van-button v-if="missed > 0" size="mini" plain type="primary" class="msg-new-frames" @click="scrollToBottom">
        <template #icon>
          <van-icon name="arrow-down" />
        </template>
        {{ $t('proxy.socket.newFrames', { count: missed }) }}
      </van-button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ProxyMock } from '@shared'
import type { EventListeners } from 'overlayscrollbars'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { showToast } from 'vant'
import type { PropType } from 'vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { copyToClipboard } from '../../common/clipboard'
import { formatBytes, formatElapsed, formatFrameOffset } from '../../common/format'
import { toKeyValueEntries } from '../../common/headerUtil'
import { scrollOptions } from '../../common/scroll'
import MiniSelect from '../components/MiniSelect.vue'
import VueAceEditor from '../components/VueAceEditor.vue'
import { dirIcon, frameCategory, frameContent, framePreview, socketStatsOf, socketStatusOf } from './socket'

const props = defineProps({
  record: { type: Object as PropType<ProxyMock.SocketRecord> },
})

const { t, te } = useI18n()

type Direction = 'all' | 'c2s' | 's2c'
type Category = 'all' | 'text' | 'binary' | 'control'

const direction = ref<Direction>('all')
const category = ref<Category>('all')
const keyword = ref('')
const atBottom = ref(true)
const seenSeq = ref(0)
const selectedSeq = ref<number>(null)
const expandedHeaders = ref<string[]>([])
const now = ref(Date.now())
// 真正滚得动的是 OverlayScrollbars 自己的 viewport 节点，且 defer 初始化之前不存在，
// 只能从实例事件里取；组件重建时 destroyed/initialized 会成对走一遍，不会留下过期节点
let listViewport: HTMLElement | null = null
let tickTimer: ReturnType<typeof setInterval>

const socket = computed(() => props.record as ProxyMock.SocketRecord)
const frames = computed(() => socket.value?.frames ?? [])
// 新帧到达的信号只看尾帧 seq：帧数封顶 SOCKET_MAX_FRAMES(1000) 之后 frames.length 就不动了，seq 仍一直涨
const lastSeq = computed(() => frames.value[frames.value.length - 1]?.seq ?? 0)
// 贴底时不落未读数：seenSeq 只在离开底部的那一刻冻结，于是浮标计的正是「上滚之后新到的帧数」，回到列表底部即清零
const missed = computed(() => atBottom.value ? 0 : Math.max(0, lastSeq.value - seenSeq.value))
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

// 贴底判定按「离底不到一行」：行高取首行实测值。原先写死 24px，而消息行高是 sm*2.2——
// 字号 7 时 24 恰好一整行（往上滚一行仍算贴底，会被拉回去），字号 10 时连半行都不到，同一套代码随字号漂移。
// 行高按 .msg-row 取而不是 firstElementChild：空态提示也在同一个容器里，无匹配帧时量到的是它的内边距。
function isAtBottom(el: HTMLElement) {
  const rowHeight = el.querySelector('.msg-row')?.getBoundingClientRect().height ?? 0
  return el.scrollHeight - el.scrollTop - el.clientHeight < rowHeight
}

function syncBottom(el: HTMLElement | null) {
  if (el == null) return
  atBottom.value = isAtBottom(el)
  if (atBottom.value) seenSeq.value = lastSeq.value
}

function scrollToBottom() {
  void nextTick(() => {
    if (listViewport == null) return
    listViewport.scrollTop = listViewport.scrollHeight
    atBottom.value = true
    seenSeq.value = lastSeq.value
  })
}

// 滚动事件由实例回调接管：defer 下 viewport 是异步出现的，自己 addEventListener 要么挂早了
// 挂到 root 上（不滚动的节点），要么赶上组件重建后失效——表现成「无论滚到哪里都被拉回底部」
const msgListEvents: EventListeners = {
  initialized: (instance) => {
    listViewport = instance.elements().viewport
    // 挂载时那次 scrollToBottom 面对的是尚未初始化的列表，这里补一次才贴得住
    if (atBottom.value) void scrollToBottom()
  },
  scroll: (instance) => syncBottom(instance.elements().viewport),
  destroyed: () => { listViewport = null },
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
  // 换连接先把已读指针对齐到新尾帧，否则拿上一条的 seq 差会闪一下浮标
  seenSeq.value = lastSeq.value
  void scrollToBottom()
})

// 新帧与筛选结果都重新贴尾：前者是新数据到了，后者是「匹配到的最新一条」换了
watch([lastSeq, () => filteredFrames.value.length], () => {
  if (atBottom.value) scrollToBottom()
})

onMounted(() => {
  tickTimer = setInterval(() => { now.value = Date.now() }, 1000)
  tickTimer.unref?.()
  seenSeq.value = lastSeq.value
  void nextTick(scrollToBottom)
})

onUnmounted(() => {
  clearInterval(tickTimer)
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
  margin: var(--app-detail-top-gap) var(--van-padding-md) 0;
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
  padding: var(--app-sp-lg) var(--app-sp-3xl) var(--app-sp-xl);
}

.socket-stat {
  gap: var(--app-sp-md);
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
  color: var(--van-text-color);
}

.stat-value.is-warn {
  color: var(--van-warning-color);
}

.stat-value.is-danger {
  color: var(--van-danger-color);
}

.socket-error {
  gap: var(--app-sp-lg);
  margin: 0 var(--app-sp-3xl) var(--app-sp-xl);
  padding: var(--app-sp-md) var(--app-sp-xl);
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
  position: relative;
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
  /* 不再单独兜底行高：radio 写死的 20px 原先低于压平的控件档，现在同排的下拉与搜索框
     都读全站 --app-control-height（md*2.2，字号 7 时 24.2px），已经把它顶过去了。
     上下各留一档 sp-lg：合行后工具栏自己就是列表上沿，不再有单独搜索条垫底 */
  gap: var(--app-sp-md);
  padding: var(--app-sp-lg) var(--app-sp-xl);
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
  padding: 0 var(--app-sp-lg);
  white-space: nowrap;
}

/* 类别筛选换成 MiniSelect：条高不再单独压平，与搜索框同读全站控件基准 --app-control-height，
   一行里两个带边框的控件底边才对得上 */
.category-select {
  flex: none;
}

.msg-count {
  flex: none;
  white-space: nowrap;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-xs);
}

/* 搜索框并进工具栏同一行：吃掉「类别」与计数之间剩下的宽度（右栏 715px、字号 9 实测 382px）。
   基准宽 14 档 = 182px 是换行扳机：容器窄到放不下时整条掉到第二行并占满那一行，
   实测字号 9 从 515px 起单行、514px 变两行（字号 7 分界 454、字号 10 分界 546）；跟随开关还在时是 604/533/640。
   外观走 global.css 的 .control-field，与 MockMatchTab「忽略参数」那枚输入框同一控件：
   高度 = --app-control-height（md*2.2）、左右内边距 = --app-sp-lg、下边一条 1px 实线；
   原先 van-search 的整条灰底与那组 --van-search-* 压平变量一并下线，宽度基准没动，所以换行分界照旧。 */
.msg-search {
  flex: 1 1 calc(var(--van-font-size-md) * 14);
  min-width: calc(var(--van-font-size-md) * 8);
  font-size: var(--van-font-size-sm);
}

.msg-body {
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--van-border-color);
}

/* 浮标靠左：右侧是消息明细编辑器，压在它下角会盖住内容；列表在左半区，落左下角才是要回底的那一侧 */
.msg-new-frames {
  position: absolute;
  left: var(--app-sp-2xl);
  bottom: var(--app-sp-2xl);
  box-shadow: var(--app-shadow-float);
}

.msg-list {
  /* 详情是读报文的地方，列表只做索引，两侧不再等宽：45% / 55%
     （消息行容器 715px、字号 9 实测列表 358→322、详情 357→393；换算到面板要再减约 34px 左右沟道） */
  flex: 9 1 0;
  /* 地板宽 = 一行固定列（时间+方向+类型+字节+截断 tag+沟道+内边距）的实测最小宽，字号 9 时内容正好 231px = sm*21。
     缺这条时行容器窄于约 500px 字节列会被推到列表右缘外（原 50/50 下 445px 裁 12px、字号 10 裁 33px），预览列压到 0 也救不回来；
     代价是行容器比「地板 / 45%」更窄时改由列表让步，此时详情反而窄于 55%（445px、字号 10 实测详情 222→192） */
  min-width: calc(var(--van-font-size-sm) * 21);
  min-height: 200px;
  border-right: 1px solid var(--van-border-color);
  background: var(--van-background);
}

.msg-row {
  display: flex;
  align-items: center;
  gap: var(--app-sp-tight);
  height: calc(var(--van-font-size-sm) * 2.2);
  padding: 0 var(--app-sp-md);
  font-size: var(--van-font-size-sm);
  color: var(--van-text-color-2);
}

/* 选中态与 hover 读 global.css 的 .list-row：原先这里是实心主色 + 整行反白，
   要逐个点子元素的颜色才能压住，方向图标也跟着失色；换成淡底后这些覆盖一条都不需要。 */

/* 时间/类型/字节三列是次要信息，宽度按字号比例给足等宽字符数，既列对齐又跟随字号缩放 */
.msg-time,
.msg-opcode,
.msg-size {
  flex: none;
  color: var(--van-text-color-2);
}

.msg-time {
  width: calc(var(--van-font-size-sm) * 4.6);
  text-align: right;
}

.msg-opcode {
  /* 最长 opcode 是 "binary"（6 字 × 0.55em = 3.3em），3.7em 留到 6.7 字，不让末字压出列宽 */
  width: calc(var(--van-font-size-sm) * 3.7);
}

.msg-size {
  width: calc(var(--van-font-size-sm) * 5);
  text-align: right;
}

.msg-dir {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  /* 图标 1em（.dir-icon 走 font-size:inherit，不再是 iconfont 写死的 16px），1.2em 刚好包住 */
  width: calc(var(--van-font-size-sm) * 1.2);
}

.msg-preview {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--van-text-color);
}

.msg-tag {
  flex: none;
}

.msg-empty {
  padding: 24px 12px;
  text-align: center;
}

.msg-detail {
  display: flex;
  flex-direction: column;
  flex: 11 1 0;
  min-width: 0;
  min-height: 0;
}

.msg-detail-head {
  gap: var(--app-sp-lg);
  padding: var(--app-sp-xs) var(--app-sp-xl);
  border-bottom: 1px solid var(--van-border-color);
  /* 标题行高度固定：未选帧时只有标题，选帧后加 meta + 按钮，高度不能跳 */
  height: 28px;
}

.msg-detail-head .van-button {
  flex: none;
  white-space: nowrap;
}

.msg-detail-title {
  flex: none;
  font-size: var(--van-font-size-sm);
  font-weight: 500;
  color: var(--van-text-color);
}

.msg-detail-meta {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-xs);
}

.meta-item {
  flex: none;
  white-space: nowrap;
}

/* 分隔符交给伪元素，比原先写在文案里的 " · " 少占近一半横向空间 */
.meta-item+.meta-item::before {
  content: '·';
  margin: 0 var(--app-card-gutter);
}

.msg-detail-empty {
  flex: 1 1 auto;
}

.msg-detail :deep(.ace-editor-wrapper) {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  /* 组件自带的 .ace-editor 是绝对定位 + 5px 内缩，这里改回 relative 后那四个偏移量仍然生效：
     top:5px 把编辑器整体下移 5px，而卡片是 overflow:hidden，于是底边连同 Ace 自己的横向滚动条被削掉。
     归零偏移，让填充完全交给 flex。 */
  inset: auto;
}
</style>