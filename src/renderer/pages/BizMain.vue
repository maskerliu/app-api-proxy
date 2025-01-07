<template>
  <van-row class="full-row">
    <router-view class="biz-content" v-slot="{ Component, route }">
      <transition name="fade">
        <component :is="Component" :key="route.path" />
      </transition>
    </router-view>
    <!-- <van-tabbar route v-model="active">
      <van-tabbar-item replace to="/proxy">
        <template #icon>
          <van-icon class="iconfont icon-mock" size="22" />
        </template>
</van-tabbar-item>
<van-tabbar-item replace to="/lab" dot>
  <template #icon>
          <van-icon class="iconfont icon-lab" size="22" />
        </template>
</van-tabbar-item>
<van-tabbar-item replace to="/message" badge="5">
  <template #icon>
          <van-icon class="iconfont icon-msg-read" size="22" />
        </template>
</van-tabbar-item>
<van-tabbar-item replace to="/settings">
  <template #icon>
          <van-icon class="iconfont icon-setting" size="22" />
        </template>
</van-tabbar-item>
</van-tabbar> -->


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
const enableDebug = !__IS_WEB__
const showDebugPanel = ref<boolean>(false)

provide('showDebugPanel', showDebugPanel)

onMounted(() => {
  useRouter().beforeEach((to: any, from: any) => {
    return true
  })

  useRouter().replace("/proxy")
  active.value = 1
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
