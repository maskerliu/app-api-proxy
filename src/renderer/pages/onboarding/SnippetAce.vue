<template>
  <div ref="aceEl" class="snippet-ace"></div>
</template>
<script lang="ts" setup>
import ace, { Ace } from 'ace-builds'
import 'ace-builds/src-min-noconflict/mode-javascript'
import 'ace-builds/src-min-noconflict/mode-kotlin'
import 'ace-builds/src-min-noconflict/mode-python'
import 'ace-builds/src-min-noconflict/mode-sh'
import 'ace-builds/src-min-noconflict/theme-cloud_editor'
import 'ace-builds/src-min-noconflict/theme-cloud_editor_dark'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { CommonStore, FONT_SIZE_MD_OFFSET } from '../../store'

const props = defineProps<{
  mode: string
  code: string
}>()

const commonStore = CommonStore()
const aceEl = ref<HTMLElement>()

let editor: Ace.Editor = null
let observer: ResizeObserver = null

function themeName(): string {
  return `ace/theme/cloud_editor${commonStore.theme == 'light' ? '' : '_' + commonStore.theme}`
}

function fontSize(): number {
  return commonStore.fontSize + FONT_SIZE_MD_OFFSET
}

// 隐藏/被遮挡的窗口里 Ace 的重绘会被节流，DOM 可能停留在旧内容，切换片段后主动整屏刷新
function applyCode(code: string) {
  if (editor == null) return
  editor.session.setValue(code)
  editor.clearSelection()
  editor.session.setScrollTop(0)
  editor.renderer.updateFull(true)
  editor.resize(true)
}

onMounted(() => {
  editor = ace.edit(aceEl.value, {
    theme: themeName(),
    mode: `ace/mode/${props.mode}`,
    readOnly: true,
    showGutter: false,
    showFoldWidgets: false,
    showPrintMargin: false,
    showLineNumbers: false,
    highlightActiveLine: false,
    highlightSelectedWord: false,
    displayIndentGuides: false,
    wrap: true,
    useWorker: false,
    fontSize: fontSize(),
    tabSize: 2,
  })
  applyCode(props.code)
  // 折叠面板/窗口变化时容器高度会变，Ace 需要主动重算尺寸
  observer = new ResizeObserver(() => editor?.resize(true))
  observer.observe(aceEl.value)
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
  editor?.destroy()
  editor = null
})

watch(() => props.code, code => {
  if (editor == null || code === editor.getValue()) return
  applyCode(code)
})

watch(() => props.mode, mode => {
  if (editor == null) return
  editor.session.setMode(`ace/mode/${mode}`)
  editor.renderer.updateFull(true)
})

watch(() => commonStore.theme, () => {
  editor?.setOption('theme', themeName())
})

watch(() => commonStore.fontSize, () => {
  editor?.setOption('fontSize', fontSize())
  editor?.resize(true)
})
</script>
<style scoped>
.snippet-ace {
  width: 100%;
  height: 100%;
  /* 底色统一由外层容器提供，避免 Ace 主题自带的背景色与容器不一致 */
  background-color: transparent;
}
</style>
