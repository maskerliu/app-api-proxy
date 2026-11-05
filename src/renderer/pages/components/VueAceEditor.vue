<template>
  <!-- 跳过 Vant touch 模拟：合成 touch 事件会被 Ace 的移动端处理器当成触摸，
       长按选词、拖动变滚动，导致鼠标拖选失效 -->
  <div data-no-touch-simulate class="ace-editor-wrapper" :class="maxLines || fill ? null : 'ace-editor'">
    <van-icon v-if="searchable && !searchVisible" name="search" class="ace-search-toggle" title="搜索 (Ctrl+F)"
      @click="openSearch" />
    <!-- ace.edit 会清空容器子节点，悬浮控件必须放在编辑器容器外层 -->
    <div ref="aceEditor" class="ace-editor-inner"></div>
    <van-popup v-model:show="showPreview" class="preview-container" closeable round teleport="#app" @close="preClose">
      <van-loading v-show="previewType == 4" type="spinner" size="24" />

      <audio v-show="previewType == 0" controls preload="metadata" :src="audioSrc" @error="onPreviewError"></audio>

      <van-image v-show="previewType == 1" :src="imgSrc" fit="contain" show-loading>
        <template v-slot:loading>
          <van-loading type="spinner" size="20" />
        </template>
      </van-image>

      <video ref="videoEl" v-show="previewType == 2" controls preload="metadata" :src="videoSrc"
        @error="onPreviewError"></video>
    </van-popup>
  </div>
</template>
<script lang="ts" setup>
import { baseDomain } from '@shared'
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
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { CommonStore, FONT_SIZE_MD_OFFSET } from '../../store'

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
let x = 0, y = 0, row = 0, col = 0, marker = 0, curRow = 0, curCol = 0
let pressX = 0, pressY = 0
let link: string = null
let settingFromModel = false

let _editor: Ace.Editor = null
let _defOpts: Partial<Ace.EditorOptions> = {
  // maxLines: 22,
  // minLines: 1,
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

// setValue 会重置折叠状态，折叠必须在赋值之后执行
function applyFold() {
  if (props.fold) _editor.session.foldAll()
}

const FILL_MIN_LINES = 3
const FILL_BOTTOM_GAP = 5

let fillObserver: ResizeObserver
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

onMounted(() => {
  _defOpts.readOnly = props.readOnly ? props.readOnly : false
  _defOpts.fontSize = commonStore.fontSize + FONT_SIZE_MD_OFFSET
  _defOpts.theme = `ace/theme/cloud_editor${commonStore.theme == 'light' ? '' : '_' + commonStore.theme}`
  _defOpts.showGutter = props.gutter
  if (props.maxLines) {
    _defOpts.maxLines = props.maxLines
  }
  _editor = ace.edit(aceEditor.value, Object.assign(_defOpts, props.options))
  _editor.session.setOptions({
    mode: `ace/mode/${props.lang}`,
    tabSize: _defOpts.tabSize,
    foldStyle: _defOpts.foldStyle
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
  searchObserver?.disconnect()
  searchObserver = null
})

watch(() => commonStore.theme, () => {
  let newTheme = `ace/theme/cloud_editor${commonStore.theme == 'light' ? '' : '_' + commonStore.theme}`
  _editor.setOption('theme', newTheme)
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

function proxyMediaUrl(url: string) {
  return `${baseDomain()}/corsMediaProxy?target=${encodeURIComponent(url)}`
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
        showToast('资源预览失败')
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
    showToast('不支持的预览类型')
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
  showToast('资源预览失败')
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

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|m4b|aac|flac|opus)$/i
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|flv)$/i

function mediaKindByUrl(url: string): string {
  let path = url.split(/[?#]/)[0]
  if (IMAGE_EXT.test(path)) return 'image'
  if (AUDIO_EXT.test(path)) return 'audio'
  if (VIDEO_EXT.test(path)) return 'video'
  return ''
}

// 部分 CDN/对象存储会把媒体文件的 content-type 返回成 application/octet-stream，
// 此时按文件头、再按 URL 后缀兜底判断
function resolveMediaKind(contentType: string, data: ArrayBuffer, url: string): string {
  let type = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'

  let head = new Uint8Array(data.slice(0, 12))
  if (head.length >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF) return 'image' // jpeg
  if (head.length >= 8 && head[0] == 0x89 && head[1] == 0x50 && head[2] == 0x4E && head[3] == 0x47) return 'image' // png
  if (head.length >= 3 && head[0] == 0x47 && head[1] == 0x49 && head[2] == 0x46) return 'image' // gif
  if (head.length >= 12 && head[8] == 0x57 && head[9] == 0x45 && head[10] == 0x42 && head[11] == 0x50) return 'image' // webp
  if (head.length >= 2 && head[0] == 0x42 && head[1] == 0x4D) return 'image' // bmp
  if (head.length >= 8 && head[4] == 0x66 && head[5] == 0x74 && head[6] == 0x79 && head[7] == 0x70) return 'video' // mp4/mov(ftyp)

  let path = url.split(/[?#]/)[0]
  if (IMAGE_EXT.test(path)) return 'image'
  if (AUDIO_EXT.test(path)) return 'audio'
  if (VIDEO_EXT.test(path)) return 'video'
  return ''
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

  // 音视频交给播放器流式加载（代理已支持 Range），避免整文件读入内存
  let kind = mediaKindByUrl(link)
  if (kind == 'audio' || kind == 'video') {
    releasePreviewUrls()
    if (kind == 'audio') audioSrc.value = proxyMediaUrl(link)
    else videoSrc.value = proxyMediaUrl(link)
    previewType.value = kind == 'audio' ? 0 : 2
    showPreview.value = true
    return
  }

  previewType.value = 4
  showPreview.value = true

  try {
    // target 必须编码，否则签名 URL 中的 & + # 会破坏查询串
    let resp = await axios.get(proxyMediaUrl(link), {
      withCredentials: false,
      responseType: 'arraybuffer',
      timeout: 30000
    })
    if (seq != previewSeq || !showPreview.value) return

    let contentType = resp.headers['content-type'] as string
    // 没有 .m3u8 后缀但 content-type 是 HLS 播放列表
    if (/mpegurl/i.test(contentType ?? '')) {
      previewHls(link)
      return
    }

    let mediaKind = resolveMediaKind(contentType, resp.data, link)
    let toBlobUrl = () => URL.createObjectURL(new Blob([resp.data], { type: contentType }))

    releasePreviewUrls()
    switch (mediaKind) {
      case 'image':
        previewType.value = 1
        imgSrc.value = toBlobUrl()
        break
      case 'audio':
        previewType.value = 0
        audioSrc.value = toBlobUrl()
        break
      case 'video':
        previewType.value = 2
        videoSrc.value = toBlobUrl()
        break
      default:
        previewType.value = -1
        showPreview.value = false
        showToast('不支持的预览类型')
    }
  } catch (err) {
    console.log(err)
    // 超时/失败时可能已经切到别的预览，不能再关闭当前弹层
    if (seq != previewSeq || !showPreview.value) return
    previewType.value = -1
    showPreview.value = false
    showToast('资源预览失败')
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

/* 搜索收起后的悬浮入口，不占据正文空间 */
.ace-search-toggle {
  position: absolute;
  top: 6px;
  right: 10px;
  z-index: 5;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  padding: 4px;
  border: 1px solid var(--van-border-color);
  border-radius: 4px;
  background: var(--van-background-2);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  color: var(--van-text-color-2);
  font-size: 14px;
  cursor: pointer;
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