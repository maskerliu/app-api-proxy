<template>
  <div class="drag-ball" ref="dragBall" @touchstart.stop.prevent="touchStart" @touchmove.stop.prevent="touchMove"
    @touchend.stop.prevent="touchEnd">
    <van-popover v-model:show="showPopover" theme="dark" placement="left">
      <template #reference>
        <van-button plain hairline round>
          <van-icon class="iconfont icon-debug" name="bug" size="22" color="red" />
        </van-button>
      </template>
      <div style="width: 500px; height: 300px"></div>
    </van-popover>
  </div>
</template>

<script lang="ts" setup>
import { defineComponent, ref } from 'vue'

const dragBall = ref()
const showPopover = ref(false)
const canDrag = ref(false)

let inset = { left: 0, top: 0, }
let move = { x: 0, y: 0 } // 移动
let position = { left: 0, top: 0, } // 位置
let positionOld = { left: 0, top: 0 } // 初始位置 
let startTime = 0
let endTime = 0

function toNew() {
  alert('去新版')
}

function touchStart(e: any) {
  if (!canDrag.value) {
    startTime = e.timeStamp
    console.log(dragBall.value)
    positionOld = getPosition(dragBall.value)
    position = { ...positionOld }
    inset = {
      left: e.targetTouches[0].clientX - positionOld.left,
      top: e.targetTouches[0].clientY - positionOld.top,
    }
    canDrag.value = true
  }
}

function touchMove(e: any) {
  if (canDrag.value) {
    let left = e.targetTouches[0].clientX - inset.left
    let top = e.targetTouches[0].clientY - inset.top
    if (left < 0) {
      left = 0
    } else if (left > window.innerWidth - dragBall.value.offsetWidth) {
      left = window.innerWidth - dragBall.value.offsetWidth
    }
    if (top < 0) {
      top = 0
    } else if (top > window.innerHeight - dragBall.value.offsetHeight) {
      top = window.innerHeight - dragBall.value.offsetHeight
    }
    dragBall.value.style.left = left + 'px'
    dragBall.value.style.top = top + 'px'
    move = {
      x: left - positionOld.left,
      y: top - positionOld.top,
    }
    position = { left, top }
  }
}
function touchEnd(e: TouchEvent) {
  if (canDrag.value) {
    endTime = e.timeStamp
    if (
      endTime - startTime > 400 ||
      Math.abs(move.x) > 2 ||
      Math.abs(move.y) > 2
    ) {
      // 非单击事件
      if (position.left + dragBall.value.offsetWidth / 2 > window.innerWidth / 2) {
        dragBall.value.style.left =
          window.innerWidth - dragBall.value.offsetWidth + 'px'
      } else {
        dragBall.value.style.left = 0 + 'px'
      }
    } else {
      this.$emit('click')
    }

    inset = { left: 0, top: 0 }
    move = { x: 0, y: 0 }
    position = { left: 0, top: 0 }
    canDrag.value = false
  }
}

function getPosition(source: any) {
  let left = source.offsetLeft //获取元素相对于其父元素的left值var left
  let top = source.offsetTop
  let current = source.offsetParent // 取得元素的offsetParent // 一直循环直到根元素
  while (current != null) {
    left += current.offsetLeft
    top += current.offsetTop
    current = current.offsetParent
  }
  return { left: left, top: top }
}

</script>

<style scoped>
.drag-ball {
  position: absolute;
  z-index: 10003;
  right: 0;
  top: 70%;
  width: 2.5em;
  height: 2.5em;
  background: #e1e1e1aa;
  border-radius: 50%;
  overflow: hidden;
  box-shadow: 0px 0px 10px 2px skyblue;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}
</style>
