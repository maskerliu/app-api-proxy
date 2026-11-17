<template>
  <!-- 跳过 Vant touch 模拟：合成 touch 事件会被 Ace 的移动端处理器当成触摸，
       长按选词、拖动变滚动，导致鼠标拖选失效 -->
  <div data-no-touch-simulate class="ace-editor-wrapper" :class="maxLines || fill ? null : 'ace-editor'">
    <van-icon v-if="searchable && !searchVisible" name="search" class="ace-search-toggle" v-tip="$t('common.searchTip')"
      @click="openSearch" />
    <!-- ace.edit 会清空容器子节点，悬浮控件必须放在编辑器容器外层 -->
    <div ref="aceEditor" class="ace-editor-inner"></div>
    <van-popup v-model:show="showPreview" class="preview-container" closeable round teleport="#app" @close="preClose">
      <van-loading v-show="previewType == 4" type="spinner" size="24" />

      <audio v-show="previewType == 0" controls preload="metadata" :src="audioSrc" @error="onPreviewError"
        @loadedmetadata="onMediaMetadata" @durationchange="onMediaMetadata"></audio>

      <van-image v-show="previewType == 1" :src="imgSrc" fit="contain" show-loading @load="onImageLoad">
        <template v-slot:loading>
          <van-loading type="spinner" size="20" />
        </template>
      </van-image>

      <video ref="videoEl" v-show="previewType == 2" controls preload="metadata" :src="videoSrc"
        @error="onPreviewError" @loadedmetadata="onMediaMetadata" @durationchange="onMediaMetadata"></video>

      <!-- 元信息悬浮在弹层顶部：格式 / 尺寸 / 采样率 / 声道 / 码率 / 时长 / 大小，取到什么显什么 -->
      <div v-if="previewInfo != ''" class="preview-meta mono truncate" v-tip="previewInfo">{{ previewInfo }}</div>
    </van-popup>
  </div>
</template>
<script lang="ts" setup>
import { baseDomain } from '@shared'
import { API_URL } from '@shared/api.const'
import ace, { Ace, Range } from 'ace-builds'
import 'ace-builds/src-min-noconflict/ext-language_tools'
// 静态引入搜索扩展：core 的 find 命令默认按 basePath 动态加载，打包环境下会 404
import 'ace-builds/src-min-noconflict/ext-searchbox'
import 'ace-builds/src-min-noconflict/mode-json'
import 'ace-builds/src-min-noconflict/mode-text'
import 'ace-builds/src-min-noconflict/mode-xml'
import 'ace-builds/src-min-noconflict/theme-cloud_editor'
import 'ace-builds/src-min-noconflict/theme-cloud_editor_dark'
import axios from 'axios'
import Hls from 'hls.js'
import { showToast } from 'vant'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatBitrate, formatBytes, formatDuration, formatSampleRate } from '../../common/format'
import { mediaKindByUrl, resolveMediaKind, sniffMediaFormat } from '../../common/mediaFormat'
import { CommonStore, FONT_SIZE_MD_OFFSET } from '../../store'

const { t } = useI18n()
const commonStore = CommonStore()

interface VueAceEditorProps {
  lang: string
  options: Partial<Ace.EditorOptions>
  fold: boolean
  readOnly: boolean
  maxLines: number
  fill: boolean
  fillMaxInset: number
  gutter: boolean
  searchable: boolean
}

interface MatchToken { row: number, start: number, value: string }

const data = defineModel<string>('data')
let x = 0, y = 0, row = 0, col = 0, marker = 0
let pressX = 0, pressY = 0
let link: string = null
let settingFromModel = false

let _editor: Ace.Editor = null
// 默认选项模板：只读，挂载时按实例复制一份再覆盖，避免跨实例串味
const _defOpts: Partial<Ace.EditorOptions> = {
  theme: 'ace/theme/cloud_editor_dark',
  displayIndentGuides: true,
  cursorStyle: 'wide',
  useWorker: false,
  wrap: 'free',
  showFoldWidgets: true,
  fadeFoldWidgets: true,
  showLineNumbers: true,
  showGutter: true,
  showPrintMargin: false,
  autoScrollEditorIntoView: true,
  highlightActiveLine: true,
  highlightSelectedWord: false, // 高亮选中文本
  enableLiveAutocompletion: false, // 启用实时自动完成
  wrapBehavioursEnabled: true,
  enableBasicAutocompletion: true,
  enableSnippets: true,
  useSoftTabs: true,
  tabSize: 2,
  useSvgGutterIcons: false,
  enableMobileMenu: false,
  readOnly: false,
  foldStyle: 'markbeginend',
}

const props = withDefaults(defineProps<Partial<VueAceEditorProps>>(), {
  theme: 'cloud_editor',
  lang: 'json',
  fold: true,
  readOnly: true,
  data: '{}',
  fill: false,
  fillMaxInset: 0,
  gutter: true,
  searchable: false,
})

const aceEditor = ref<HTMLElement>()
const showPreview = ref<boolean>(false)
const previewType = ref<number>(0)
const searchVisible = ref<boolean>(false)
let searchObserver: MutationObserver

const videoEl = ref<HTMLVideoElement>()
const imgSrc = ref<string>()
const audioSrc = ref<string>()
const videoSrc = ref<string>()
let hls: Hls
// 每次预览递增，用于丢弃上一个预览仍在进行的异步结果
let previewSeq = 0

interface PreviewMeta {
  dims?: string
  duration?: number
  sampleRate?: number
  channels?: number
  size?: number
}

// 采样率与声道数只能解码拿到，超过这个体积就退回流式播放、只报时长
const AUDIO_DECODE_MAX_BYTES = 20 * 1024 * 1024

const previewFormat = ref<string>('')
const previewMeta = ref<PreviewMeta>({})

function channelText(channels: number) {
  if (channels == 1) return t('common.previewMono')
  if (channels == 2) return t('common.previewStereo')
  return t('common.previewChannels', { count: channels })
}

// 悬浮在弹层顶部的元信息一行，字段按可得情况拼，缺的不占位
const previewInfo = computed(() => {
  const meta = previewMeta.value
  const items: string[] = []
  if (previewFormat.value != '') items.push(previewFormat.value)
  if (meta.dims) items.push(meta.dims)
  if (meta.sampleRate) items.push(formatSampleRate(meta.sampleRate))
  if (meta.channels) items.push(channelText(meta.channels))
  // 码率按体积除时长估，容器头的误差在展示精度内可忽略
  if (meta.size && meta.duration) items.push(formatBitrate(meta.size * 8 / meta.duration))
  const duration = formatDuration(meta.duration)
  if (duration != '') items.push(duration)
  if (meta.size) items.push(formatBytes(meta.size, 2))
  return items.join('  ·  ')
})

// setValue 会重置折叠状态，折叠必须在赋值之后执行
function applyFold() {
  if (props.fold) _editor.session.foldAll()
}

const FILL_MIN_LINES = 3
const FILL_BOTTOM_GAP = 5

let fillObserver: ResizeObserver
let boxObserver: ResizeObserver
let fillLines = 0

function scrollParentOf(el: HTMLElement): HTMLElement {
  let node = el.parentElement
  while (node != null && node !== document.body) {
    // OverlayScrollbars 内容未溢出时 viewport 是 overflow: hidden，只能靠属性识别，
    // 否则会越过面板找到外层滚动容器，贴合高度按错误的高度计算
    if (node.hasAttribute('data-overlayscrollbars-viewport')) return node
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node
    node = node.parentElement
  }
  return null
}

// 按滚动容器的剩余高度换算行数，用内容坐标计算，滚动时结果保持不变。
// allowShrink=false 用于折叠面板展开：保留当前高度让内容撑开页面，而不是压缩响应体
// 最小行数贴合父容器底部；最大行数扣除 fillMaxInset（吸顶区块高度），内容超出后编辑器内部滚动
function syncFillHeight(allowShrink = true) {
  if (!props.fill || _editor == null || aceEditor.value == null) return

  const el = aceEditor.value
  const parent = scrollParentOf(el)
  const parentRect = parent?.getBoundingClientRect()
  const viewportTop = parentRect?.top ?? 0
  const viewportHeight = parent?.clientHeight ?? window.innerHeight
  const offsetTop = el.getBoundingClientRect().top - viewportTop + (parent?.scrollTop ?? window.scrollY)
  const lineHeight = _editor.renderer.lineHeight || 16
  const needed = Math.max(FILL_MIN_LINES, Math.floor((viewportHeight - offsetTop - FILL_BOTTOM_GAP) / lineHeight))
  const lines = allowShrink ? needed : Math.max(needed, fillLines)
  const maxInset = Math.max(0, props.fillMaxInset ?? 0)
  const maxLines = Math.max(lines, Math.floor((viewportHeight - maxInset - FILL_BOTTOM_GAP) / lineHeight))

  fillLines = lines
  _editor.setOption('minLines', lines)
  _editor.setOption('maxLines', maxLines)
}

function onWindowResize() {
  syncFillHeight()
}

// 盒子被布局改变（窗口缩放、折叠区展开、切换记录）后 Ace 不会自己重测：它只在构造和显式
// resize() 时读一次容器尺寸，layerConfig 停在旧高度就只画得下几行，剩下的空白看起来像显示不全。
// fill 实例已有 fillObserver 按滚动容器算行数，这里只管靠 CSS 填充与 maxLines 定高的实例。
function observeEditorBox() {
  if (props.fill) return
  const box = aceEditor.value?.parentElement
  if (box == null) return
  let lastSize = `${box.clientWidth}x${box.clientHeight}`
  boxObserver = new ResizeObserver(() => {
    const size = `${box.clientWidth}x${box.clientHeight}`
    if (size === lastSize) return
    lastSize = size
    _editor?.resize()
  })
  boxObserver.observe(box)
}

function syncSearchVisible() {
  const box = _editor.renderer.scroller.querySelector('.ace_search') as HTMLElement
  searchVisible.value = box != null && box.style.display != 'none'
}

// 展开时复用已有输入内容并重新高亮，首次点击才创建搜索框
function openSearch() {
  const searchBox = (_editor as any).searchBox
  if (searchBox != null) searchBox.show()
  else (ace as any).require('ace/ext/searchbox').Search(_editor)
}

// Ace 主题名由全局主题推导：light 走 cloud_editor，其余走 cloud_editor_<theme>
function aceTheme(): string {
  return `ace/theme/cloud_editor${commonStore.theme == 'light' ? '' : '_' + commonStore.theme}`
}

onMounted(() => {
  // 每个实例一份选项：_defOpts 是模块级对象，原先直接改写它并交给 ace.edit，
  // 于是带 maxLines 的编辑器（HTTP 请求体 22 / Mock 响应体 16）之后挂起来的编辑器也继承 maxLines，
  // Ace 改按内容算高并给容器写死 inline height，靠 CSS 填充的详情区因此只画得下一半
  const opts: Partial<Ace.EditorOptions> = Object.assign({}, _defOpts, {
    readOnly: props.readOnly ? props.readOnly : false,
    fontSize: commonStore.fontSize + FONT_SIZE_MD_OFFSET,
    theme: aceTheme(),
    showGutter: props.gutter,
  }, props.options)
  if (props.maxLines) {
    opts.maxLines = props.maxLines
  }
  _editor = ace.edit(aceEditor.value, opts)
  _editor.session.setOptions({
    mode: `ace/mode/${props.lang}`,
    tabSize: opts.tabSize,
    foldStyle: opts.foldStyle
  })

  if (data.value) {
    _editor.session.setValue(data.value)
  }
  applyFold()

  // 可编辑时把编辑内容回写给 v-model，供父组件读取
  _editor.session.on('change', () => {
    if (settingFromModel) return
    data.value = _editor.getValue()
  })

  _editor.renderer.scroller.addEventListener('mousedown', onMouseDown)
  _editor.renderer.scroller.addEventListener('mousemove', onMouseMove)
  _editor.renderer.content.addEventListener('mouseout', onMouseOut)
  // 按下/抬起时文本层可能重建，click 的 target 会变成 scroller，挂在 content 上会漏事件
  _editor.renderer.scroller.addEventListener('click', onClick)

  if (props.fill) {
    nextTick(() => syncFillHeight())
    fillObserver = new ResizeObserver(() => syncFillHeight())
    fillObserver.observe(scrollParentOf(aceEditor.value) ?? document.body)
    window.addEventListener('resize', onWindowResize)
  } else {
    observeEditorBox()
  }

  if (props.searchable) {
    // 搜索框由 Ace 按需创建在 scroller 内，通过观察显示状态同步悬浮图标
    searchObserver = new MutationObserver(syncSearchVisible)
    searchObserver.observe(_editor.renderer.scroller, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style'],
    })
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize)
  fillObserver?.disconnect()
  fillObserver = null
  boxObserver?.disconnect()
  boxObserver = null
  searchObserver?.disconnect()
  searchObserver = null
})

watch(() => commonStore.theme, () => {
  _editor.setOption('theme', aceTheme())
})

watch(() => commonStore.fontSize, () => {
  _editor.setOption('fontSize', commonStore.fontSize + FONT_SIZE_MD_OFFSET)
  _editor.resize()
  if (props.fill) nextTick(syncFillHeight)
})

watch(() => props.maxLines, () => {
  // _editor.setOption('maxLines', props.maxLines)
  _editor.resize()
})

watch(() => props.fillMaxInset, () => {
  if (props.fill) nextTick(syncFillHeight)
})

watch(data, () => {
  if (_editor == null || data.value === _editor.getValue()) return
  settingFromModel = true
  _editor.session.setValue(data.value ?? '')
  settingFromModel = false
  applyFold()
  if (!props.fold) nextTick(() => _editor.navigateFileEnd())
  if (props.fill) nextTick(syncFillHeight)
})

watch(() => props.lang, () => {
  _editor.setOption('mode', `ace/mode/${props.lang}`)
})

watch(showPreview, (visible) => {
  if (!visible) releasePreviewUrls()
})

function releasePreviewUrls() {
  [audioSrc.value, imgSrc.value, videoSrc.value].forEach(src => {
    if (src?.startsWith('blob:')) URL.revokeObjectURL(src)
  })
  audioSrc.value = null
  imgSrc.value = null
  videoSrc.value = null
}

function resetPreviewMeta() {
  previewFormat.value = ''
  previewMeta.value = {}
}

// 上一个预览的异步结果可能晚于新预览到达，回填前先确认还是同一次
function isCurrentPreview(seq: number) {
  return seq == previewSeq && showPreview.value
}

async function probeMedia(url: string): Promise<{ size?: number, contentType?: string }> {
  try {
    let resp = await axios.head(proxyMediaUrl(url), { withCredentials: false, timeout: 10000 })
    return {
      size: Number(resp.headers['content-length']) || undefined,
      contentType: resp.headers['content-type'] as string,
    }
  } catch (err) {
    // 源站不认 HEAD 时只是少了体积与格式，播放不受影响
    return {}
  }
}

async function decodeAudioMeta(data: ArrayBuffer, seq: number) {
  // 用完即关：一个 AudioContext 就占一路音频线程，预览次数多了会到浏览器的上限
  let ctx = new AudioContext()
  try {
    // decodeAudioData 会占用传入的 buffer，给它的是一份副本
    let buffer = await ctx.decodeAudioData(data.slice(0))
    if (!isCurrentPreview(seq)) return
    previewMeta.value.duration = buffer.duration
    previewMeta.value.sampleRate = buffer.sampleRate
    previewMeta.value.channels = buffer.numberOfChannels
  } catch (err) {
    // 解码器不认（如 opus/alaw）只是少了采样率与声道，播放与其余元信息不受影响
    console.log(err)
  } finally {
    ctx.close().catch(() => { })
  }
}

function onMediaMetadata(e: Event) {
  const el = e.target as HTMLMediaElement
  if (Number.isFinite(el.duration) && el.duration > 0) previewMeta.value.duration = el.duration
  const video = el as HTMLVideoElement
  if (video.videoWidth > 0) previewMeta.value.dims = `${video.videoWidth} × ${video.videoHeight}`
}

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  if (img?.naturalWidth > 0) previewMeta.value.dims = `${img.naturalWidth} × ${img.naturalHeight}`
}

function proxyMediaUrl(url: string) {
  return `${baseDomain()}${API_URL.CorsMediaProxy}?target=${encodeURIComponent(url)}`
}

function isHlsUrl(url: string) {
  return /\.m3u8([?#]|$)/i.test(url)
}

function destroyHls() {
  if (hls == null) return
  hls.destroy()
  hls = null
  videoEl.value?.pause()
  videoEl.value?.removeAttribute('src')
}

function previewHls(url: string) {
  releasePreviewUrls()
  destroyHls()
  resetPreviewMeta()
  previewFormat.value = 'HLS'
  previewType.value = 2
  showPreview.value = true

  nextTick(() => {
    const video = videoEl.value
    if (video == null) return

    if (Hls.isSupported()) {
      const instance = new Hls({ maxBufferLength: 30 })
      hls = instance

      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hls !== instance) return
        video.play().catch(() => { })
      })

      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (hls !== instance) return
        // 直播流网络抖动、解码异常先尝试恢复，恢复不了再提示失败
        if (data.type == Hls.ErrorTypes.NETWORK_ERROR) return instance.startLoad()
        if (data.type == Hls.ErrorTypes.MEDIA_ERROR) return instance.recoverMediaError()
        if (!data.fatal) return

        destroyHls()
        if (!showPreview.value) return
        previewType.value = -1
        showPreview.value = false
        showToast(t('common.previewFailed'))
      })

      instance.loadSource(url)
      instance.attachMedia(video)
      return
    }

    // macOS 的 Chromium 不支持原生 HLS，这里只是兜底
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url
      video.play().catch(() => { })
      return
    }

    previewType.value = -1
    showPreview.value = false
    showToast(t('common.previewUnsupported'))
  })
}

function onPreviewError(e: Event) {
  const el = e.target as HTMLMediaElement
  // HLS 的错误交给 hls.js 处理，直接清 src 会破坏 MediaSource
  if (hls != null && el == videoEl.value) return

  const failedSrc = el.getAttribute('src')
  // 立即停止出错的加载，否则弹层关闭后残留的媒体元素还会异步报错
  el.removeAttribute('src')
  el.load()

  if (!showPreview.value) return
  // 只处理当前这次预览的失败，忽略上一次预览残留元素报出的错误
  const expected = previewType.value == 0 ? audioSrc.value
    : previewType.value == 2 ? videoSrc.value : null
  if (expected == null || failedSrc != expected) return

  releasePreviewUrls()
  showPreview.value = false
  showToast(t('common.previewFailed'))
}

function onMouseDown(e: MouseEvent) {
  pressX = e.clientX
  pressY = e.clientY
}

function onMouseMove(e: MouseEvent) {
  // 只在实际拖选时清标记；按下时轻微抖动就清空会导致点击链接失效
  if ((_editor as any).$mouseHandler.isMousePressed) {
    if (!_editor.selection.isEmpty()) clearMarker()
    return
  }
  x = e.clientX
  y = e.clientY
  update()
}

function onMouseOut() {
  clearMarker()
}

async function preClose() {
  previewSeq++
  previewType.value = -1

  destroyHls()

  releasePreviewUrls()
}

async function onClick(e: MouseEvent) {
  // 拖选文字松手也会触发 click，位移较大时不算点击，避免选完文字弹出预览
  if (Math.abs(e.clientX - pressX) + Math.abs(e.clientY - pressY) > 5) return

  // 直接按点击坐标取链接：拖拽产生的残留选区不应阻止预览
  link = findLinkAt(e.clientX, e.clientY)?.value
  x = e.clientX
  y = e.clientY
  if (!link) return

  // 新预览开始，让上一个预览仍在进行的异步请求结果失效
  const seq = ++previewSeq

  if (isHlsUrl(link)) {
    previewHls(link)
    return
  }

  // 音视频按后缀定类后交给播放器流式加载，图片与后缀不明的资源整包取回
  const kind = mediaKindByUrl(link)
  return kind == 'audio' || kind == 'video' ? previewStreamed(kind, link, seq) : previewDownloaded(link, seq)
}

// 流式这条路不下载正文（代理已支持 Range），元信息靠 HEAD 与播放器报出的 metadata
async function previewStreamed(kind: string, url: string, seq: number) {
  resetPreviewMeta()
  previewFormat.value = sniffMediaFormat(null, null, url)
  previewType.value = 4
  showPreview.value = true

  const probe = await probeMedia(url)
  if (!isCurrentPreview(seq)) return
  previewFormat.value = sniffMediaFormat(null, probe.contentType, url)
  if (probe.size) previewMeta.value.size = probe.size

  // 后缀认得的音频体积都不大，整包取回解码才拿得到采样率与声道；
  // 拿不到体积（源站不认 HEAD）就按流式处理，不盲目下载
  if (kind == 'audio' && probe.size && probe.size <= AUDIO_DECODE_MAX_BYTES) return previewDownloaded(url, seq)

  releasePreviewUrls()
  if (kind == 'audio') audioSrc.value = proxyMediaUrl(url)
  else videoSrc.value = proxyMediaUrl(url)
  previewType.value = kind == 'audio' ? 0 : 2
}

async function previewDownloaded(url: string, seq: number) {
  resetPreviewMeta()
  previewType.value = 4
  showPreview.value = true

  try {
    // target 必须编码，否则签名 URL 中的 & + # 会破坏查询串
    let resp = await axios.get(proxyMediaUrl(url), {
      withCredentials: false,
      responseType: 'arraybuffer',
      timeout: 30000
    })
    if (seq != previewSeq || !showPreview.value) return

    let contentType = resp.headers['content-type'] as string
    // 没有 .m3u8 后缀但 content-type 是 HLS 播放列表
    if (/mpegurl/i.test(contentType ?? '')) {
      previewHls(url)
      return
    }

    let mediaKind = resolveMediaKind(contentType, resp.data, url)
    let size = (resp.data as ArrayBuffer).byteLength
    let toBlobUrl = () => URL.createObjectURL(new Blob([resp.data], { type: contentType }))

    releasePreviewUrls()
    previewFormat.value = sniffMediaFormat(resp.data, contentType, url)
    previewMeta.value.size = size
    switch (mediaKind) {
      case 'image':
        previewType.value = 1
        imgSrc.value = toBlobUrl()
        break
      case 'audio':
        previewType.value = 0
        audioSrc.value = toBlobUrl()
        if (size <= AUDIO_DECODE_MAX_BYTES) void decodeAudioMeta(resp.data, seq)
        break
      case 'video':
        previewType.value = 2
        videoSrc.value = toBlobUrl()
        break
      default:
        previewType.value = -1
        showPreview.value = false
        showToast(t('common.previewUnsupported'))
    }
  } catch (err) {
    console.log(err)
    // 超时/失败时可能已经切到别的预览，不能再关闭当前弹层
    if (seq != previewSeq || !showPreview.value) return
    previewType.value = -1
    showPreview.value = false
    showToast(t('common.previewFailed'))
  }
}

function findLinkAt(clientX: number, clientY: number): Partial<MatchToken> {
  var canvasPos = _editor.renderer.scroller.getBoundingClientRect()
  var offset = (clientX + _editor.renderer.scrollLeft - canvasPos.left - (_editor.renderer as any).$padding) / _editor.renderer.characterWidth
  var row = Math.floor((clientY + _editor.renderer.scrollTop - canvasPos.top) / _editor.renderer.lineHeight)
  var col = Math.round(offset)
  var screenPos = { row: row, column: col, side: offset - col > 0 ? 1 : -1 }
  var docPos = _editor.session.screenToDocumentPosition(screenPos.row, screenPos.column)

  var line = _editor.session.getLine(docPos.row)
  if (docPos.column == line.length) {
    var clippedPos = _editor.session.documentToScreenPosition(docPos.row, docPos.column)
    if (clippedPos.column != screenPos.column) return
  }

  return findLink(docPos.row, docPos.column)
}

function update() {
  var canvasPos = _editor.renderer.scroller.getBoundingClientRect()
  var offset = (x + _editor.renderer.scrollLeft - canvasPos.left - (_editor.renderer as any).$padding) / _editor.renderer.characterWidth
  row = Math.floor((y + _editor.renderer.scrollTop - canvasPos.top) / _editor.renderer.lineHeight)
  col = Math.round(offset)

  var selectionRange = _editor.selection.getRange()
  if (!selectionRange.isEmpty()) {
    if (selectionRange.start.row <= row && selectionRange.end.row >= row)
      return clearMarker()
  }

  let token = findLinkAt(x, y)
  // console.log(docPos.row, docPos.column, token)
  link = token?.value
  if (!token) return clearMarker()

  _editor.renderer.setCursorStyle("pointer")
  _editor.session.removeMarker(marker)
  let range = new Range(token.row, token.start, token.row, token.start + token.value.length)
  marker = _editor.session.addMarker(range, "ace-link-marker", "text", true)
}

function clearMarker() {
  _editor.session.removeMarker(marker)
  _editor.renderer.setCursorStyle("")
  link = null
}

function findLink(row: number, column: number): Partial<MatchToken> {
  var line = _editor.session.getLine(row)
  var match = getMatchAround(/https?:\/\/[^\s"'\\]+/g, line, column)
  if (!match)
    return

  // 嵌套 JSON 字符串里链接后紧跟 \" ，标点也可能被误收进链接
  match.value = match.value.replace(/[\\,;.!?)\]}]+$/, '')
  if (!match.value || match.start + match.value.length < column)
    return

  match.row = row
  return match
}

function getMatchAround(regExp: RegExp, string: string, col: number): Partial<MatchToken> {
  let token: Partial<MatchToken>
  regExp.lastIndex = 0
  string.replace(regExp, function (str) {
    let offset = arguments[arguments.length - 2]
    let length = str.length
    if (offset <= col && offset + length >= col)
      token = {
        start: offset,
        value: str
      }

    return str
  })

  return token
}

defineExpose({ syncFillHeight })

</script>
<style>
/* center 弹层宽度是 shrink-to-fit，子元素 width:100% 会形成循环，导致弹层宽度为 0 */
.preview-container {
  display: flex;
  align-items: center;
  justify-content: center;
  /* 元信息悬浮行按弹层宽度铺开，小图不给个下限就只剩省略号了 */
  min-width: 320px;
  max-width: 60%;
  max-height: 70%;
  overflow: hidden;
}

/* 弹层是 shrink-to-fit：百分比宽度会塌成 0，音视频都用固定宽度 */
.preview-container audio {
  width: 480px;
  max-width: 50vw;
  height: 120px;
  flex: none;
}

/* 视频没有固有尺寸，弹层会缩成 300x150，这里给个明确的播放区域 */
.preview-container video {
  width: 60vw;
  max-width: 960px;
  max-height: 70vh;
  flex: none;
}

/* 大图按原比例缩放到限制内，保持完整画面 */
.preview-container .van-image {
  max-width: 60vw;
  max-height: 70vh;
  flex: none;
}

.preview-container .van-image__img {
  width: auto;
  height: auto;
  max-width: 60vw;
  max-height: 70vh;
}

/* 元信息压在画面顶部、与右上角关闭按钮同一行：用压暗渐变收尾而不是硬边色块，
   任意底色都读得清；右端留出关闭按钮的位置，截断后靠 v-tip 看全文 */
.preview-container .preview-meta {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  box-sizing: border-box;
  padding: var(--van-popup-close-icon-margin) calc(var(--van-popup-close-icon-margin) * 2 + var(--van-popup-close-icon-size)) 10px var(--van-popup-close-icon-margin);
  color: #fff;
  font-size: var(--van-font-size-sm);
  line-height: var(--van-popup-close-icon-size);
  text-shadow: 0 1px 2px rgb(0 0 0 / 45%);
  background: linear-gradient(to bottom, rgb(0 0 0 / 55%), rgb(0 0 0 / 28%) 55%, rgb(0 0 0 / 0%));
}

/* 悬浮条压暗了顶部，关闭按钮沿用灰色主题变量会糊成一片 */
.preview-container .van-popup__close-icon {
  color: #fff;
}

.ace-editor-wrapper {
  position: relative;
}

.ace-editor .ace-editor-inner {
  height: 100%;
}

.ace-editor {
  position: absolute;
  top: 5px;
  right: 5px;
  bottom: 5px;
  left: 0;
  margin: 0;
}

.ace-link-marker {
  position: absolute;
  border-bottom: 2px dashed var(--van-text-color);
  background: #f9ac2f85;
  opacity: 30%;
}

.ace_editor.ace-cloud_editor_dark .ace-link-marker {
  background: #f9ac2f50;
}

/* 搜索收起后的悬浮入口，不占据正文空间 */
.ace-search-toggle {
  position: absolute;
  top: 6px;
  right: 10px;
  z-index: 5;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  padding: var(--app-sp-sm);
  border: 1px solid var(--van-border-color);
  border-radius: 4px;
  background: var(--van-background-2);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
  cursor: pointer;
}

.ace_editor.ace-cloud_editor_dark .ace-search-toggle {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}

.ace-search-toggle:hover {
  color: var(--van-primary-color);
}

/* 当前行改用高亮底色，去掉主题自带的描边 */
.ace_editor .ace_marker-layer .ace_active-line {
  background-color: rgba(255, 214, 10, 0.22) !important;
  border: none !important;
}

.ace_editor .ace_gutter-active-line {
  background-color: rgba(255, 214, 10, 0.22) !important;
}

.ace_editor.ace-cloud_editor_dark .ace_marker-layer .ace_active-line,
.ace_editor.ace-cloud_editor_dark .ace_gutter-active-line {
  background-color: rgba(255, 214, 10, 0.16) !important;
}

/* 内置搜索框样式固定为浅色，暗色主题下单独覆盖 */
.ace_editor.ace-cloud_editor_dark .ace_search {
  background: var(--van-background-2);
  color: var(--van-text-color);
  border-color: var(--van-border-color);
}

.ace_editor.ace-cloud_editor_dark .ace_search_field {
  background: var(--van-background);
  color: var(--van-text-color);
  border-color: var(--van-border-color);
}

.ace_editor.ace-cloud_editor_dark .ace_searchbtn {
  background: var(--van-background-2);
  color: var(--van-text-color);
  border-color: var(--van-border-color);
}

.ace_editor.ace-cloud_editor_dark .ace_searchbtn:hover {
  background: var(--van-active-color);
}

.ace_editor.ace-cloud_editor_dark .ace_button {
  color: var(--van-text-color);
  border-color: var(--van-border-color);
}

.ace_editor.ace-cloud_editor_dark .ace_button:hover {
  background: var(--van-active-color);
}

.ace_editor.ace-cloud_editor_dark .ace_button:active {
  background: var(--van-border-color);
}

/* 关闭按钮是深色雪碧图，暗色背景上需反色 */
.ace_editor.ace-cloud_editor_dark .ace_searchbtn_close {
  filter: invert(1);
}
</style>