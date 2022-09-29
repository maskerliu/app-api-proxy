import { mapActions } from 'pinia';
import { defineComponent, PropType } from 'vue';

import BizMain from '../renderer/pages/BizMain.vue';
import { useCommonStore } from '../renderer/store';

const App = defineComponent({
  components: {
    [BizMain.name]: BizMain,
  },
  props: {
    success: { type: String },
    callback: {
      type: Function as PropType<() => void>
    }
  },
  data() {
    return {
      canRender: false as boolean,
    }
  },
  computed: {

  },

  created() {
    this.canRender = true
    this.init()
  },
  methods: {
    ...mapActions(useCommonStore, ['init'])
  }
});

export default App;