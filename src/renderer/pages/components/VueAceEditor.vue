<template>
  <div ref="aceEditor" style="width: 100%; height: 100vh;"></div>
</template>
<script lang="ts" setup>
import ace, { Ace } from "ace-builds"
import 'ace-builds/src-min-noconflict/ext-language_tools'
import 'ace-builds/src-noconflict/mode-javascript'
import 'ace-builds/src-noconflict/mode-json'
import 'ace-builds/src-noconflict/mode-text'
import 'ace-builds/src-noconflict/theme-tomorrow'
import { nextTick, onMounted, ref, watch } from 'vue'

ace.config.setModuleUrl('ace/mode/javascript', require('file-loader?esModule=false!ace-builds/src-noconflict/mode-javascript.js'))
ace.config.setModuleUrl('ace/mode/text', require('file-loader?esModule=false!ace-builds/src-noconflict/mode-text.js'))
ace.config.setModuleUrl('ace/mode/json', require('file-loader?esModule=false!ace-builds/src-noconflict/mode-json.js'))
ace.config.setModuleUrl('ace/theme/tomorrow', require('file-loader?esModule=false!ace-builds/src-noconflict/theme-tomorrow.js'))
ace.config.setModuleUrl('ace/ext/language_tools', require('file-loader?esModule=false!ace-builds/src-noconflict/ext-language_tools.js'))


interface VueAceEditorProps {
  theme: string
  lang: string
  options: Partial<Ace.EditorOptions>
  fold: boolean
  data: string,
  readOnly: boolean
}

const props = withDefaults(defineProps<Partial<VueAceEditorProps>>(), {
  theme: 'tomorrow',
  lang: 'json',
  fold: true,
  readOnly: true
})

const aceEditor = ref<HTMLElement>()

const emit = defineEmits<{
  change: [data: string],
  update: [data: string]
}>()

let _editor: Ace.Editor = null
let _defOpts: Partial<Ace.EditorOptions> = {
  fontSize: 12,
  maxLines: 20,
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

onMounted(() => {
  _defOpts.readOnly = props.readOnly ? props.readOnly : false
  _defOpts.theme = props.theme ? `ace/theme/${props.theme}` : _defOpts.theme
  _editor = ace.edit(aceEditor.value, Object.assign(_defOpts, props.options))

  _editor.session.setOptions({
    mode: `ace/mode/${props.lang}`,
    tabSize: _defOpts.tabSize,
    foldStyle: _defOpts.foldStyle,
    useWrapMode: true,
  })

  // _editor.session.setTabSize(2)
  // _editor.session.setMode(`ace/mode/${props.lang}`)
  // _editor.session.setFoldStyle('markbegin')
  // _editor.session.setUseWrapMode(true)
  if (props.fold) _editor.session.foldAll()

  _editor.insert(props.data)

  _editor.resize()
  // mirror local editor with global editor
  // _editor.on('change', () => {
  //   emit('change:data', _editor.getValue())
  // })
})

watch(() => props.data, () => {
  if (props.data != _editor.getValue()) {
    _editor.setValue(props.data, 2)
    _editor.resize()
    nextTick(() => _editor.navigateFileEnd())
  }
})

watch(() => props.lang, () => {
  _editor.setOption('mode', `ace/mode/${props.lang}`)
})

</script>
<style scoped>
@import "~ace-builds/css/ace.css";

.ace_fold-widget {
  box-sizing: border-box;
  margin: 0 -12px 0 1px;
  display: none;
  width: 11px;
  vertical-align: top;
  background-repeat: no-repeat;
  background-position: center;
  border-radius: 3px;
  border: 1px solid #e11c1cf5 !important;
  ;
  cursor: pointer;
}

.ace_fold-widget.ace_closed {}
</style>