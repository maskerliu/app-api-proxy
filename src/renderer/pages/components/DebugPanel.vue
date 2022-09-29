<template>
  <div
    class="drag-ball"
    ref="dragBall"
    @touchstart.stop.prevent="touchstart"
    @touchmove.stop.prevent="touchmove"
    @touchend.stop.prevent="touchend"
  >
    <van-popover v-model:show="showPopover" theme="dark" placement="left">
      <template #reference>
        <van-button plain hairline round>
          <van-icon
            class="iconfont"
            class-prefix="icon"
            name="bug"
            size="25"
            color="red"
          />
        </van-button>
      </template>
      <div style="width: 500px; height: 300px"></div>
    </van-popover>
  </div>
</template>

<script lang="ts" src="./DebugPanel.vue.ts"></script>

<style scoped>
.drag-ball {
  position: absolute;
  z-index: 10003;
  right: 0;
  top: 70%;
  width: 2em;
  height: 2em;
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
