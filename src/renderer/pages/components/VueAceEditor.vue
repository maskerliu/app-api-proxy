<template>
  <div ref="aceEditor"></div>
</template>
<script lang="ts" setup>
import ace, { Ace } from 'ace-builds'
import 'ace-builds/src-min-noconflict/ext-language_tools'
import 'ace-builds/src-min-noconflict/ext-linking.js'
import 'ace-builds/src-min-noconflict/mode-json'
import 'ace-builds/src-min-noconflict/theme-chrome'
import { nextTick, onMounted, ref, watch } from 'vue'

ace.require('ace-builds/src-min-noconflict/ext-linking.js')

// ace.config.setModuleUrl('ace/mode/javascript', require('file-loader?esModule=false!ace-builds/src-noconflict/mode-javascript.js'))
// ace.config.setModuleUrl('ace/mode/text', require('file-loader?esModule=false!ace-builds/src-noconflict/mode-text.js'))
// ace.config.setModuleUrl('ace/mode/json', require('file-loader?esModule=false!ace-builds/src-noconflict/mode-json.js'))
// ace.config.setModuleUrl('ace/theme/chrome', require('file-loader?esModule=false!ace-builds/src-noconflict/theme-chrome.js'))
// ace.config.setModuleUrl('ace/ext/language_tools', require('file-loader?esModule=false!ace-builds/src-noconflict/ext-language_tools.js'))

interface VueAceEditorProps {
  theme: string
  lang: string
  options: Partial<Ace.EditorOptions>
  fold: boolean
  readOnly: boolean
  maxLines: number
}

const data = defineModel<string>('data')

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

onMounted(() => {
  _defOpts.readOnly = props.readOnly ? props.readOnly : false
  _defOpts.theme = props.theme ? `ace/theme/${props.theme}` : _defOpts.theme
  _defOpts.maxLines = props.maxLines
  _editor = ace.edit(aceEditor.value, Object.assign(_defOpts, props.options))
  _editor.setOptions({ enableLinking: true })

  _editor.session.setOptions({
    mode: `ace/mode/${props.lang}`,
    tabSize: _defOpts.tabSize,
    foldStyle: _defOpts.foldStyle,
    useWrapMode: true,
  })

  _editor.on("linkClick", (e: any) => {
    console.log(e.token.value)
  })

  if (props.fold) _editor.session.foldAll()

  if (data.value) {
    _editor.setValue(data.value, 1)
    _editor.resize()
  }
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

function findLink(row: number, column: number) {
  var editor = this.editor
  var session = editor.session
  var line = session.getLine(row)

  var match = this.getMatchAround(/https?:\/\/[^\s"']+/g, line, column)
  if (!match)
    return

  match.row = row
  return match
}

</script>
<style scoped>
/* @import "~ace-builds/css/ace.css"; */
.ace_link_marker {
  position: absolute;
  border-bottom: 1px solid blue;
}
</style>