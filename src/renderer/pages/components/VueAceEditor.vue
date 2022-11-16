<template>
  <div ref="aceEditor"></div>
</template>
<script lang="ts" setup>
import ace from 'brace'
import 'brace/mode/javascript'
import 'brace/mode/json'
import 'brace/theme/monokai'
import { nextTick, onMounted, ref, watch } from 'vue'


const props = defineProps({
  width: {
    type: String,
    default: '100%'
  },
  height: {
    type: String,
    default: '300px'
  },
  theme: {
    type: String,
    default: 'monokai'
  },
  lang: {
    type: String,
    default: 'javascript'
  },
  options: Object,
  content: String,
  editor: Object
})
const aceEditor = ref()
const emit = defineEmits(['update:editor', 'update:content', 'change'])

let _editor: ace.Editor = null

onMounted(() => {
  /**
    * this._editor -> local editor for this component
    * this.editor -> for allow parrent component can use editor. Example: use this.editor.setFontSize(40) in parent component to set font size for code editor
    */
  _editor = ace.edit(aceEditor.value)
  _editor.$blockScrolling = Infinity
  // _editor.setTheme(`ace/theme/${props.theme}`)
  _editor.session.setMode(`ace/mode/${props.lang}`)
  _editor.setOptions(props.options)
  _editor.setFontSize('12px')
  _editor.getSession().setTabSize(2)
  _editor.insert(props.content)

  // mirror local editor with global editor
  emit("update:editor", _editor)

  _editor.on('change', () => {
    const content = _editor.getValue()
    emit('update:content', content)
  })
})

watch(() => props.content, () => {
  if (props.content != _editor.getValue()) {
    _editor.setValue(props.content)
    nextTick(() => _editor.navigateFileEnd())
  }

})

</script>
<style scoped>

</style>