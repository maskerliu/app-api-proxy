<template>
  <biz-main v-if="canRender" />
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';

import BizMain from '../renderer/pages/BizMain.vue';
import { useCommonStore } from '../renderer/store';

const canRender = ref(true)

onMounted(() => {
  canRender.value = true
  useCommonStore().init()
})
</script>

<style>
::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}

::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.1);
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}

#app {
  font-family: "Consolas,Monaco,Menlo,Bitstream Vera Sans Mono,monospace";
  background: transparent;
  letter-spacing: 1px;
  /* -moz-user-select: none;
  -webkit-user-select: none; */
  /* -ms-user-select: none; */
  /* user-select: none; */
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.bg-border {
  margin: 5px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid #e1e1e1;
  box-shadow: 0px 12px 8px -12px #000;
}

.biz-content {
  width: 100%;
  min-width: 375px;
  height: calc(100% - 0px);
  margin: 0px 0 50px 0;
  background: #f1f2f6;
  overflow-y: hidden;
}
</style>
