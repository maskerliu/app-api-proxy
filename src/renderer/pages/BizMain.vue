<template>
  <van-row class="full-row">
    <router-view class="biz-content" v-slot="{ Component, route }">
      <transition name="fade">
        <component :is="Component" :key="route.path" />
      </transition>
    </router-view>

    <van-floating-bubble v-if="enableDebug" :offset="{ x: 10, y: 500 }" axis="xy" :gap="10" magnetic="x" icon="fire-o"
      @click="onOpenDebugPanel" />

    <van-popup v-model:show="showDebugPanel" position="left" closeable close-icon="close">
      <debug-panel />
    </van-popup>

  </van-row>
</template>

<script lang="ts" setup>
import { onMounted, provide, ref } from 'vue'
import { useRouter } from 'vue-router'
import DebugPanel from './components/DebugPanel.vue'

const active = ref<number>(0)
const enableDebug = true// !__IS_WEB__
const showDebugPanel = ref<boolean>(false)

provide('showDebugPanel', showDebugPanel)

onMounted(async () => {
  useRouter().beforeEach((to: any, from: any) => {
    return true
  })

  useRouter().replace("/proxy")
  active.value = 1

  // await fetchEventSource(`${baseDomain()}/appmock/sse`, {
  //   onmessage(ev) {
  //     console.log('incoming', ev.data)
  //   },
  //   onclose() {
  //     console.log('closed')
  //   },
  //   onerror(err) {
  //     console.log(err)
  //   },
  // })
})

function onOpenDebugPanel() {
  showDebugPanel.value = true
}

</script>

<style scoped>
.biz-content {
  width: 100%;
  min-width: 375px;
  height: 100vh;
  background: var(--van-gray-1);
  overflow: hidden auto;
}
</style>
