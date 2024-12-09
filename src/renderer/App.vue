<template>
  <biz-main v-if="canRender" />
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue'

import BizMain from './pages/BizMain.vue'
import { CommonStore } from './store'

const canRender = ref(true)

onMounted(() => {
  canRender.value = true
  if (!__IS_WEB__) {
    window.electronAPI.onGetSysSettings((result) => {
      CommonStore().init(result)
    })
  } else {
    CommonStore().init()
  }
})
</script>

<style>
#app {
  font-family: "Consolas,Monaco,Menlo,Bitstream Vera Sans Mono,monospace";
  background: transparent;
  letter-spacing: 1px;
  /* -moz-user-select: none;
  -webkit-user-select: none;
  -ms-user-select: none;
  user-select: none; */
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  filter: invert(0.01);
}

.border-bg {
  margin: 5px;
  padding: 0;
  /* border-radius: 8px; */
  /* border: 1px solid #e1e1e1; */
  box-shadow: 0px 12px 8px -12px #000;
}

.biz-content {
  width: 100%;
  min-width: 375px;
  height: 100%;
  background: #ebecef;
  overflow-y: hidden;
}
</style>
