<template>
  <div ref="aceEditor"></div>
</template>
<script lang="ts" setup>
import ace from 'brace';
import { nextTick, onMounted, ref, watch } from 'vue';


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
  codeContent: String,
  editor: Object
})
const aceEditor = ref()
const emit = defineEmits(['update:editor', 'update:codeContent', 'change'])

let _editor = null

onMounted(() => {
  /**
    * this._editor -> local editor for this component
    * this.editor -> for allow parrent component can use editor. Example: use this.editor.setFontSize(40) in parent component to set font size for code editor
    */
  _editor = ace.edit(aceEditor.value)
  _editor.$blockScrolling = Infinity
  _editor.setTheme(`ace/theme/${props.theme}`)
  _editor.session.setMode(`ace/mode/${props.lang}`)
  _editor.setOptions(props.options)
  _editor.setFontSize(13)
  _editor.getSession().setTabSize(2)
  _editor.insert(props.codeContent)

  // mirror local editor with global editor
  emit("update:editor", _editor)

  _editor.on('change', () => {
    const content = _editor.getValue()
    emit('update:codeContent', content)
  })
})

watch(() => props.codeContent, () => {
  if (props.codeContent != _editor.getValue()) {
    _editor.setValue(props.codeContent)
    nextTick(() => _editor.navigateFileEnd())
  }

})

</script>
<style scoped>

</style>