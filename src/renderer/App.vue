<template>
  <biz-main v-if="canRender" />
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';

import BizMain from './pages/BizMain.vue';
import { useCommonStore } from './store';

const canRender = ref(true)

onMounted(() => {
  canRender.value = true
  useCommonStore().init()
})
</script>

<style>
#app {
  font-family: "Microsoft YaHei", 微软雅黑, "MicrosoftJhengHei", 华文细黑,
    STHeiti, MingLiu, monospace;
  background: transparent;
  letter-spacing: 1px;
  -moz-user-select: none;
  -webkit-user-select: none;
  -ms-user-select: none;
  user-select: none;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  filter: invert(0.0);
}

.bg-border {
  margin: 5px;
  padding: 0;
  border-radius: 5px;
  box-shadow: 0px 5px 5px -5px #000;
}

.biz-content {
  width: 100%;
  min-width: 375px;
  height: calc(100% - 76px);
  margin: 0px 0 50px 0;
  background: #f1f2f6;
  overflow-y: hidden;
}

.drag-bar {
  width: 100%;
  height: 26px;
  -webkit-app-region: drag;
  background: transparent;
}
</style>
