<template>
  <van-row class="full-row">
    <!-- <div class="drag-bar"></div> -->
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
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import DebugPanel from './components/DebugPanel.vue'

const active = ref<number>(0)
const enableDebug = !__IS_WEB__
const showDebugPanel = ref<boolean>(false)

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

// import { getCurrentInstance } from "vue"
// const appContext = getCurrentInstance()
// console.log(appContext)
</script>

<style>
:root {
  --van-dialog-border-radius: 4px;
  --van-tag-font-size: 0.6rem;
  --van-tag-padding: 2px 5px;
  --van-tag-border-radius: 5px;
  --van-cell-horizontal-padding: 10px;
  --van-popup-round-radius: 8px;
  --van-popup-close-icon-margin: 22px;
  --van-border-width: 1.4px;
  --van-radius-md: 8px;
  --van-dialog-radius: 2px;
  --van-floating-bubble-background: #f04b1e;
}

.full-row {
  width: 100%;
  height: 100%;
  background: #eee;
  overflow: hidden;
}

::-webkit-scrollbar {
  width: 4px;
  height: 4px;
  scrollbar-arrow-color: red;
}

::-webkit-scrollbar-thumb {
  border-radius: 5px;
  box-shadow: inset 0 0 5px rgba(125, 125, 125, 0.1);
  -webkit-box-shadow: inset 0 0 5px rgba(125, 125, 125, 0.1);
  background: rgba(0, 0, 0, 0.2);
  scrollbar-arrow-color: red;
}

::-webkit-scrollbar-track {
  box-shadow: inset 0 0 5px rgba(125, 125, 125, 0.2);
  -webkit-box-shadow: inset 0 0 5px rgba(125, 125, 125, 0.2);
  border-radius: 0;
  background: rgba(0, 0, 0, 0.1);
}

.fade-enter-active {
  animation: bounce-in 0.5s ease-in;
}

.fade-leave-active {
  animation: bounce-out 0.5s ease-out;
}

@keyframes bounce-in {
  0% {
    opacity: 0.0;
  }

  100% {
    opacity: 1.;
  }
}

@keyframes bounce-out {
  0% {
    opacity: 1.0;
  }

  100% {
    opacity: 0.0;
  }
}
</style>
