import { defineComponent } from 'vue'

const JsonViewer = defineComponent({
  props: {
    fontSize: { type: Number, require: false, default: 12 },
    lineHeight: { type: Number, require: false, default: 24 },
    deep: { type: Number, require: false, default: 3 },
    currentDeep: { type: Number, require: false, default: 1 },
    theme: { type: String, require: false, default: '' },
    hasSiblings: { type: Boolean, requir: false, defalut: true },
    data: { type: Object, require: true, default: {} },
    jsonKey: { type: String, require: false, default: '' },
    closed: { type: Boolean, required: false, default: false },
    isLast: { type: Boolean, required: false, default: true },
  },
  computed: {
    isArray(): boolean {
      return this.getDataType(this.data) === "array"
    },
    length(): number {
      if (this.data == null) {
        return 0
      } else {
        return this.isArray ? this.data.length : Object.keys(this.data).length
      }
    },
    subfix():string {
      const data = this.data
      if (this.isEmptyArrayOrObject(data)) {
        return ""
      } else {
        return (this.isArray ? "]" : "}") + (this.isLast ? "" : ",")
      }
    },
    prefix():string {
      return this.isArray ? "[" : "{"
    },
    items() {
      const json = this.data
      if (this.isArray) {
        return json.map((item) => {
          const isJSON = this.isObjectOrArray(item)
          return { value: item, isJSON, key: "" }
        })
      }

      return Object.keys(json).map((key) => {
        const item = json[key]
        const isJSON = this.isObjectOrArray(item)
        return { value: item, isJSON, key }
      })
    },
    iconColors() {
      return ["#747983", "#747983"]
    },
  },
  data() {
    return {
      innerclosed: true as boolean,
      templateDeep: 1 as number,
      visible: false as boolean,
    }
  },
  mounted() {
    this.innerclosed = this.closed
    this.templateDeep = this.currentDeep
    setTimeout(() => {
      this.visible = true
    }, 0)
  },
  methods: {


    getDataType(data: any) {
      return Object.prototype.toString
        .call(data)
        .slice(8, -1)
        .toLowerCase()
    },

    isObjectOrArray(source: any) {
      return ["array", "object"].includes(this.getDataType(source))
    },

    toggleClose() {
      if (this.length === 0) {
        return
      }
      if (this.innerclosed) {
        this.innerclosed = false
      } else {
        this.innerclosed = true
      }
    },
    isClose(curDeep: number) {
      return curDeep > this.deep
    },

    isEmptyArrayOrObject(data: any) {
      // 空数组或者空对象
      return [{}, []]
        .map((item) => JSON.stringify(item))
        .includes(JSON.stringify(data))
    },
  },
  watch: {
    closed() {
      this.innerclosed = this.closed
    }
  }
})

export default JsonViewer