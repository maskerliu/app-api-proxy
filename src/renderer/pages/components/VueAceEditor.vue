<template>
  <div ref="previewContainer" style="position: relative;">
    <div ref="aceEditor" :class="maxLines ? null : 'ace-editor'"></div>
    <van-popup v-model:show="showPreview" class="preview-container" closeable round teleport="#app" @close="preClose">
      <audio v-show="previewType == 0" controls preload="auto" style="width: 100%; height: 120px;"
        :src="audioSrc"></audio>
      <van-image v-show="previewType == 1" :src="imgSrc" width="100%" height="100%" fit="contain" show-loading>
        <template v-slot:loading>
          <van-loading type="spinner" size="20" />
        </template>
      </van-image>
      <video v-show="previewType == 2" controls width="100%" :src="videoSrc"></video>

      <div v-show="previewType == 3" style="width: 30rem; height: 120px;">
        <van-icon :name="playStatus ? 'pause-circle-o' : 'play-circle-o'" size="36"
          style="margin-left: 50px; color: var(--van-gray-8);"
          @click="playStatus ? tcplayer.pause() : tcplayer.play()" />
      </div>
    </van-popup>
  </div>
</template>
<script lang="ts" setup>
import ace, { Ace, Range } from 'ace-builds'
import 'ace-builds/src-min-noconflict/ext-language_tools'
import 'ace-builds/src-min-noconflict/mode-json'
import 'ace-builds/src-min-noconflict/theme-cloud_editor'
import 'ace-builds/src-min-noconflict/theme-cloud_editor_dark'
import axios from 'axios'
import TCPlayer from 'tcplayer.js'
import 'tcplayer.js/dist/tcplayer.min.css'
import { ConfigProviderTheme } from 'vant'
import { inject, nextTick, onMounted, Ref, ref, useTemplateRef, watch } from 'vue'
import { baseDomain } from '../../../common'

const licenseUrl = 'https://license.vod2.myqcloud.com/license/v2/1340452115_1/v_cube.license'

const theme = inject<Ref<ConfigProviderTheme>>('theme')

interface VueAceEditorProps {
  lang: string
  options: Partial<Ace.EditorOptions>
  fold: boolean
  readOnly: boolean
  maxLines: number
}

interface MatchToken { row: number, start: number, value: string }

const data = defineModel<string>('data')
let x = 0, y = 0, row = 0, col = 0, marker = 0, curRow = 0, curCol = 0
let link: string = null

let _editor: Ace.Editor = null
let _defOpts: Partial<Ace.EditorOptions> = {
  // fontSize: 11,
  // maxLines: 22,
  // minLines: 1,
  theme: 'ace/theme/cloud_editor_dark',
  displayIndentGuides: true,
  cursorStyle: 'wide',
  useWorker: false,
  wrap: 'free',
  showFoldWidgets: true,
  showLineNumbers: true,
  showGutter: true,
  showPrintMargin: false,
  autoScrollEditorIntoView: true,
  highlightActiveLine: true,
  highlightSelectedWord: false, // 高亮选中文本
  enableLiveAutocompletion: true, // 启用实时自动完成
  wrapBehavioursEnabled: true,
  enableBasicAutocompletion: true,
  enableSnippets: true,
  tabSize: 2,
  useSvgGutterIcons: true,
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
})

const aceEditor = ref<HTMLElement>()
const showPreview = ref<boolean>(false)
const previewType = ref<number>(0)

const previewContainer = useTemplateRef<HTMLElement>('previewContainer')
const imgSrc = ref<string>()
const audioSrc = ref<string>()
const videoSrc = ref<string>()
const playStatus = ref<boolean>(false)
const loadStatus = ref<boolean>(false)
let tcplayer: any

onMounted(() => {
  _defOpts.readOnly = props.readOnly ? props.readOnly : false
  _defOpts.theme = `ace/theme/cloud_editor${theme.value == 'light' ? '' : '_' + theme.value}`
  if (props.maxLines) {
    _defOpts.maxLines = props.maxLines
  }
  _editor = ace.edit(aceEditor.value, Object.assign(_defOpts, props.options))
  _editor.session.setOptions({
    mode: `ace/mode/${props.lang}`,
    tabSize: _defOpts.tabSize,
    foldStyle: _defOpts.foldStyle
  })

  if (props.fold) _editor.session.foldAll()

  if (data.value) {
    _editor.session.setValue(data.value)
  }

  _editor.renderer.scroller.addEventListener('mousemove', onMouseMove)
  _editor.renderer.content.addEventListener('mouseout', onMouseOut)
  _editor.renderer.content.addEventListener('click', onClick)
})

watch(theme, () => {
  let newTheme = `ace/theme/cloud_editor${theme.value == 'light' ? '' : '_' + theme.value}`
  _editor.setOption('theme', newTheme)
})

watch(() => props.maxLines, () => {
  _editor.setOption('maxLines', props.maxLines)
  _editor.resize()
})

watch(data, () => {
  _editor.session.setValue(data.value)
  nextTick(() => _editor.navigateFileEnd())
})

watch(() => props.lang, () => {
  _editor.setOption('mode', `ace/mode/${props.lang}`)
})

watch(showPreview, (_, _old) => {

  if (!_) {
    URL.revokeObjectURL(audioSrc.value)
    URL.revokeObjectURL(imgSrc.value)
    URL.revokeObjectURL(videoSrc.value)

    audioSrc.value = null
    imgSrc.value = null
    videoSrc.value = null
  }
})

function onMouseMove(e: MouseEvent) {
  if ((_editor as any).$mouseHandler.isMousePressed) {
    if (_editor.selection.isEmpty()) clearMarker()
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
  previewType.value = -1

  if (tcplayer) {
    tcplayer.unload()
    playStatus.value = false
    loadStatus.value = false
  }

  videoSrc.value = null
  audioSrc.value = null
  imgSrc.value = null

}

async function onClick() {
  if (!link) return

  showPreview.value = true
  if (/^https?:\/\/.*\.m3u8/.test(link)) {
    previewType.value = 3
    let video: HTMLVideoElement
    if (previewContainer.value.getElementsByTagName('video').length == 0) {
      video = document.createElement<'video'>('video')
      video.setAttribute("id", 'player-container-id')
      video.setAttribute('width', '100%')
      video.setAttribute('height', '0')
      video.style.display = 'none'
      video.style.visibility = 'hidden'

      previewContainer.value.appendChild(video)
    } else {
      video = previewContainer.value.getElementsByTagName('video')[0]
      video.setAttribute("id", 'player-container-id')
      console.log(video)
    }

    if (tcplayer == null) {
      tcplayer = TCPlayer('player-container-id', { autoplay: true, licenseUrl })
    }

    tcplayer.src(link)

    tcplayer.on('error', function (e) {
      console.log(e)
    })

    tcplayer.on('play', function () {
      playStatus.value = true
    })

    tcplayer.on('pause', function () {
      playStatus.value = false
    })

    tcplayer.on('loadstart', function () {
      loadStatus.value = true
    })

    tcplayer.on('loadeddata', function () {
      loadStatus.value = false
    })

    return
  }

  try {
    let resp = await axios.get(`${baseDomain()}/mediaproxy?target=${link}`,
      { withCredentials: false, responseType: 'arraybuffer' })
    let contentType = resp.headers['content-type'] as string
    if (/image.*/.test(contentType)) {
      previewType.value = 1
      imgSrc.value = URL.createObjectURL(new Blob([resp.data], { type: contentType }))
    } else if (/audio.*/.test(contentType)) {
      previewType.value = 0
      audioSrc.value = URL.createObjectURL(new Blob([resp.data], { type: contentType }))
    } else if (/video.*/.test(contentType)) {
      previewType.value = 2
      videoSrc.value = URL.createObjectURL(new Blob([resp.data], { type: contentType }))

    }
  } catch (err) {
    console.log(err)
  }
  showPreview.value = true
}

function update() {
  var canvasPos = _editor.renderer.scroller.getBoundingClientRect()
  var offset = (x + _editor.renderer.scrollLeft - canvasPos.left - (_editor.renderer as any).$padding) / _editor.renderer.characterWidth
  row = Math.floor((y + _editor.renderer.scrollTop - canvasPos.top) / _editor.renderer.lineHeight)
  col = Math.round(offset)
  var screenPos = { row: row, column: col, side: offset - col > 0 ? 1 : -1 }
  var docPos = _editor.session.screenToDocumentPosition(screenPos.row, screenPos.column)

  var selectionRange = _editor.selection.getRange()
  if (!selectionRange.isEmpty()) {
    if (selectionRange.start.row <= row && selectionRange.end.row >= row)
      return clearMarker()
  }

  var line = _editor.session.getLine(docPos.row)
  if (docPos.column == line.length) {
    var clippedPos = _editor.session.documentToScreenPosition(docPos.row, docPos.column)
    if (clippedPos.column != screenPos.column) {
      return clearMarker()
    }
  }

  let token = findLink(docPos.row, docPos.column)
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
  var match = getMatchAround(/https?:\/\/[^\s"']+/g, line, column)
  if (!match)
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

</script>
<style>
.preview-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 70%;
  overflow: hidden;
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
</style>