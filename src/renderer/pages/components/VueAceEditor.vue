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
  width?: string
  height?: string
  theme?: string
  lang?: string
  options?: Partial<Ace.EditorOptions>
  data: string,
  readOnly?: boolean
}

const props = withDefaults(defineProps<VueAceEditorProps>(), {
  width: '100%',
  theme: 'tomorrow',
  lang: 'json',
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
  maxLines: 25,
  mode: '',
  displayIndentGuides: true,
  cursorStyle: 'smooth',
  useWorker: false,
  wrap: 'free',
  showFoldWidgets: true,
  showLineNumbers: true,
  showGutter: true,
  highlightActiveLine: true,
  highlightSelectedWord: false, // 高亮选中文本
  enableLiveAutocompletion: true, // 启用实时自动完成
  wrapBehavioursEnabled: true,
  enableBasicAutocompletion: true,
  enableSnippets: true,
  tabSize: 2,
  showPrintMargin: true,
  useSvgGutterIcons: true,
  enableMobileMenu: false,
  readOnly: false,
  foldStyle: 'manual'
}

onMounted(() => {
  _defOpts.readOnly = props.readOnly ? props.readOnly : false
  _editor = ace.edit(aceEditor.value, Object.assign(_defOpts, props.options))
  _editor.session.setMode(`ace/mode/${props.lang}`)
  _editor.setTheme(`ace/theme/${props.theme}`)
  _editor.insert(props.data)
  _editor.getSession().setTabSize(2)
  _editor.session.setMode(`ace/mode/${props.lang}`)
  _editor.session.setFoldStyle('markbegin')
  _editor.getSession().setUseWrapMode(true)
  _editor.getSession().foldAll()
  _editor.setReadOnly(props.readOnly)
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
@import "~ace-builds/css/ace.css"
</style>