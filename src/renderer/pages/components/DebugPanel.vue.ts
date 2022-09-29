import { defineComponent, ref } from "vue";

const DebugPanel = defineComponent({
  name: "DebugPanel",
  setup() {
    const showPopover = ref(false);
    return { showPopover };
  },
  props: {
    value: {
      type: String,
      default: 'debug'
    }
  },
  data() {
    return {
      canDrag: false,
      // 偏移
      inset: {
        left: 0,
        top: 0
      },
      // 移动
      move: {},
      // 位置
      position: {
        left: 0,
        top: 0
      },
      // 初始位置
      positionOld: {},
      startTime: null,
      endTime: null
    };
  },

  mounted() {
    // this.env = this.envs[this.appInfo.env];
  },
  computed: {
    dragBall() {
      return this.$refs.dragBall;
    }
  },
  methods: {
    toNew() {
      alert('去新版');
    },
    touchstart(e) {
      if (!this.canDrag) {
        this.startTime = e.timeStamp;
        this.positionOld = this.getPosition(this.dragBall);
        this.position = { ...this.positionOld };
        this.inset = {
          left: e.targetTouches[0].clientX - this.positionOld.left,
          top: e.targetTouches[0].clientY - this.positionOld.top
        };
        this.canDrag = true;
      }
    },
    touchmove(e) {
      if (this.canDrag) {
        let left = e.targetTouches[0].clientX - this.inset.left;
        let top = e.targetTouches[0].clientY - this.inset.top;
        if (left < 0) {
          left = 0;
        } else if (left > (window.innerWidth - this.dragBall.offsetWidth)) {
          left = window.innerWidth - this.dragBall.offsetWidth;
        }
        if (top < 0) {
          top = 0;
        } else if (top > (window.innerHeight - this.dragBall.offsetHeight)) {
          top = window.innerHeight - this.dragBall.offsetHeight;
        }
        this.dragBall.style.left = left + 'px';
        this.dragBall.style.top = top + 'px';
        this.move = {
          x: left - this.positionOld.left,
          y: top - this.positionOld.top
        };
        this.position = { left, top };
      }
    },
    touchend(e) {
      if (this.canDrag) {
        this.endTime = e.timeStamp;
        if (this.endTime - this.startTime > 400 || Math.abs(this.move.x) > 2 || Math.abs(this.move.y) > 2) {
          // 非单击事件
          if ((this.position.left + this.dragBall.offsetWidth / 2) > window.innerWidth / 2) {
            this.dragBall.style.left = window.innerWidth - this.dragBall.offsetWidth + 'px';
          } else {
            this.dragBall.style.left = 0 + 'px';
          }
        } else {
          this.$emit('click');
        }
        this.inset = {};
        this.move = {};
        this.position = {};
        this.canDrag = false;
      }
    },
    getPosition(source: any) {
      let left = source.offsetLeft; //获取元素相对于其父元素的left值var left
      let top = source.offsetTop;
      let current = source.offsetParent; // 取得元素的offsetParent // 一直循环直到根元素
      while (current != null) {
        left += current.offsetLeft;
        top += current.offsetTop;
        current = current.offsetParent;
      }
      return {
        left: left,
        top: top
      };
    }
  }
});

export default DebugPanel;