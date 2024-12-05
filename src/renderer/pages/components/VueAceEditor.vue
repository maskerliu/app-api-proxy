<template>
  <div>
    <div ref="aceEditor"></div>
    <van-popup v-model:show="showPreview" style="width: 60%; height: 80%; overflow: hidden;">
      <div v-if="previewType == 0" style="width: 100%; height: 50px;">
        <audio controls preload="auto" name="media" crossorigin="anonymous" style="width: 100%;">
          <source :src="previewSrc" type="audio/mpeg">
        </audio>
      </div>
      <van-image v-else-if="previewType == 1" :src="previewSrc" width="100%" height="100%" fit="contain"
        crossorigin="anonymous" />

      <div v-else>

      </div>
    </van-popup>
  </div>
</template>
<script lang="ts" setup>
import ace, { Ace, Range } from 'ace-builds'
import 'ace-builds/src-min-noconflict/ext-language_tools'
import 'ace-builds/src-min-noconflict/mode-json'
import 'ace-builds/src-min-noconflict/theme-chrome'
import { nextTick, onMounted, ref, watch } from 'vue'
import { baseDomain } from '../../../common'

// ace.config.setModuleUrl('ace/mode/javascript', require('file-loader?esModule=false!ace-builds/src-noconflict/mode-javascript.js'))
// ace.config.setModuleUrl('ace/mode/text', require('file-loader?esModule=false!ace-builds/src-noconflict/mode-text.js'))
// ace.config.setModuleUrl('ace/mode/json', require('file-loader?esModule=false!ace-builds/src-noconflict/mode-json.js'))
// ace.config.setModuleUrl('ace/theme/chrome', require('file-loader?esModule=false!ace-builds/src-noconflict/theme-chrome.js'))
// ace.config.setModuleUrl('ace/ext/language_tools', require('file-loader?esModule=false!ace-builds/src-noconflict/ext-language_tools.js'))

const AUDIO_RGX = new RegExp('(.mp3|.ogg|.wav|.m4a|.aac)$')
const VIDEO_RGX = new RegExp('(.mp4)$')
const IMG_RGX = new RegExp('(.jpg|.jpeg|.png|.JPG|.gif|.GIF|.webp)$')


interface VueAceEditorProps {
  theme: string
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
  maxLines: 22,
  minLines: 1,
  theme: 'ace/theme/tomorrow',
  displayIndentGuides: true,
  cursorStyle: 'wide',
  useWorker: false,
  wrap: 'free',
  showFoldWidgets: true,
  showLineNumbers: true,
  showGutter: true,
  showPrintMargin: true,
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
  theme: 'chrome',
  lang: 'json',
  fold: true,
  readOnly: true,
  data: '{}',
})

const aceEditor = ref<HTMLElement>()
const showPreview = ref<boolean>(false)
const previewSrc = ref<string>(null)
const previewType = ref<number>(0)

onMounted(() => {
  _defOpts.readOnly = props.readOnly ? props.readOnly : false
  _defOpts.theme = props.theme ? `ace/theme/${props.theme}` : _defOpts.theme
  _defOpts.maxLines = props.maxLines
  _editor = ace.edit(aceEditor.value, Object.assign(_defOpts, props.options))
  _editor.session.setOptions({
    mode: `ace/mode/${props.lang}`,
    tabSize: _defOpts.tabSize,
    foldStyle: _defOpts.foldStyle,
    useWrapMode: true,
  })

  if (props.fold) _editor.session.foldAll()

  if (data.value) {
    _editor.setValue(data.value, 1)
    _editor.resize()
  }

  _editor.renderer.scroller.addEventListener('mousemove', onMouseMove)
  _editor.renderer.content.addEventListener('mouseout', onMouseOut)
  _editor.renderer.content.addEventListener('click', onClick)
})

watch(() => props.maxLines, () => {
  _editor.setOption('maxLines', props.maxLines)
  _editor.resize()
})

watch(() => data.value, () => {
  _editor.setValue(data.value)
  nextTick(() => _editor.navigateFileEnd())
})

watch(() => props.lang, () => {
  _editor.setOption('mode', `ace/mode/${props.lang}`)
})

function onMouseMove(e: MouseEvent) {
  // if (_editor.$mouseHandler.isMousePressed) {
  //   if (!_editor.selection.isEmpty())
  //     clearMarker()
  //   return
  // }
  x = e.clientX
  y = e.clientY
  update()
}

function onMouseOut() {
  clearMarker()
}

function onClick() {
  if (!link) return
  if (!!AUDIO_RGX.test(link)) {
    previewType.value = 0
    previewSrc.value = `${baseDomain()}/mediaproxy?target=${link}&type=stream`
  } else if (!!IMG_RGX.test(link)) {
    previewType.value = 1
    previewSrc.value = `${baseDomain()}/mediaproxy?target=${link}&type=arraybuffer`
  } else if (!!VIDEO_RGX.test(link)) {
    previewType.value = 2
    previewSrc.value = `${baseDomain()}/mediaproxy?target=${link}&type=stream`
  }
  showPreview.value = true
}

function update() {
  var canvasPos = _editor.renderer.scroller.getBoundingClientRect()
  var offset = (x + _editor.renderer.scrollLeft - canvasPos.left - _editor.renderer.$padding) / _editor.renderer.characterWidth
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
  marker = _editor.session.addMarker(range, "ace_link_marker", "text", true)
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
/* @import "~ace-builds/css/ace.css"; */
.ace_link_marker {
  position: absolute;
  border-bottom: 2px dashed black;
  background: #f9ac2f85;
  opacity: 30%;
}
</style>