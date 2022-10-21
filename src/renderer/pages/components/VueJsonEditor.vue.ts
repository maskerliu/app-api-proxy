
import JsonEditor from "jsoneditor"
import "jsoneditor/dist/jsoneditor.min.css"
import { defineComponent } from "vue"

const VueJsonEditor = defineComponent({
  editor: null,
  name: "json-editor-vue",
  props: {
    modelValue: Object,
    // https://github.com/josdejong/jsoneditor/blob/master/docs/api.md#configuration-options
    options: Object,
    currentMode: {
      type: String,
      default: "code",
    },
    modeList: {
      type: Array,
      default: ["tree", "code", "form", "text", "view"],
    },
    // en, es zh-CN, pt-BR, tr, ja, fr-FR, de, ru, ko
    language: {
      type: String,
      default: "en",
    },
  },
  data() {
    return {
      json: this.modelValue,
      expandedModes: ["tree", "view", "form"],
      inChange: false,
      // 全屏处理
      isFullScreen: false,
      hasLogo: true,
      showFullScreen: false,
      internalChange: false,
      editor: null
    }
  },
  watch: {
    modelValue: {
      immediate: true,
      deep: true,
      handler(val) {
        if (!this.internalChange) {
          this.setEditorContent(val)
          this.$nextTick(() => {
            this.expandAll()
          })
        }
      },
    },
  },
  mounted() {
    this.init()
    const logo = document.querySelector(
      ".jsoneditor-menu .jsoneditor-poweredBy"
    )
    this.hasLogo = logo && window.getComputedStyle(logo).display !== "none"
    this.showFullScreen = true
  },
  unmounted() {
    this.editor?.destroy()
    this.editor = null
  },
  methods: {
    toggleFullScreen() {
      this.isFullScreen = !this.isFullScreen
    },
    init() {
      const { currentMode, modeList, options } = this
      const onChange = () => {
        try {
          const json = this.editor.get()
          this.json = json
          this.$emit("update:modelValue", json)
          this.$emit("change", json)
          this.internalChange = true
          this.$nextTick(() => {
            this.internalChange = false
          })
        } catch (error) { }
      }
      const onModeChange = () => {
        this.expandAll()
      }
      const onTextSelectionChange = (start, end, text) => {
        this.$emit("textSelectionChange", this.editor, start, end, text)
      }
      const onSelectionChange = (start, end) => {
        this.$emit("selectionChange", this.editor, start, end)
      }
      const onColorPicker = (parent, color, onChange) => {
        this.$emit("colorPicker", this.editor, parent, color, onChange)
      }
      const onFocus = ({ target }) => {
        this.$emit("focus", this.editor, target)
      }
      const onBlur = async ({ target }) => {
        this.$emit("blur", this.editor, target)
      }
      const finalOptions = {
        ...options,
        indentation: 2,
        language: this.language,
        mode: currentMode,
        modes: modeList,
        onChange,
        onModeChange,
        onTextSelectionChange,
        onSelectionChange,
        onColorPicker,
        onFocus,
        onBlur,
      }
      this.editor = new JsonEditor(
        this.$refs.jsonEditorVue,
        finalOptions,
        this.json
      )
    },
    expandAll() {
      if (this.expandedModes.includes(this.editor?.getMode())) {
        this.editor?.expandAll()
      }
    },
    setEditorContent(value) {
      this.editor?.set(value)
    },
  },
})

export default VueJsonEditor