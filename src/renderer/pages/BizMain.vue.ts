import { mapState } from 'pinia'
import { defineComponent } from "vue"
import { useCommonStore } from "../store"

import DebugPanel from './components/DebugPanel.vue'

const BizMain = defineComponent({
  name: "BizMain",
  components: {
    DebugPanel
  },
  setup() {

  },
  data() {
    return {
      active: 0,
      navTitle: "",
    }
  },
  created() {
    this.$router.beforeEach((to: any, from: any) => {
      this.navTitle = to.name
      return true
    })
  },
  mounted() {
    this.$router.replace("/proxy")
    this.active = 1
  },
})

export default BizMain