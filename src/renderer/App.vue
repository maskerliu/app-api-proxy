<template>
  <van-config-provider :theme="commonStore.theme" :theme-vars="commonStore.themeVars" theme-vars-scope="global"
    class="full-row">
    <div class="drag-bar" v-if="!isWeb"></div>

    <router-view class="biz-content" v-slot="{ Component, route }">
      <transition name="fade" mode="out-in" v-if="canRender">
        <component :is="Component" :key="route.path" />
      </transition>
    </router-view>

    <van-floating-bubble v-if="enableDebug" :offset="offset" axis="xy" :gap="10" magnetic="x" icon="fire-o"
      @click="onOpenDebugPanel" />

    <van-popup v-model:show="commonStore.showDebugPanel" position="left" closeable close-icon="close">
      <debug-panel />
    </van-popup>
  </van-config-provider>
</template>

<script lang="ts" setup>
import { LocalServerConfig } from '@shared'
import { showLoadingToast, type ToastWrapperInstance } from 'vant'
import { defineAsyncComponent, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { CommonStore } from './store'

const DebugPanel = defineAsyncComponent(() => import('./pages/components/DebugPanel.vue'))

const isWeb = window.isWeb
const commonStore = CommonStore()
const i18n = useI18n()
const router = useRouter()
const canRender = ref(false)
const enableDebug = __DEV__
// 启动 200ms 内未完成配置则弹全局加载 toast；配置就绪后调用 closeLoading 关闭
let closeLoading: ToastWrapperInstance | null = null
const loadingTimer = setTimeout(() => {
  if (!canRender.value) {
    closeLoading = showLoadingToast({ message: i18n.t('common.loading'), forbidClick: true, duration: 0 })
  }
}, 200)
const offset = ref({
  x: window.innerWidth - 42,
  y: window.innerHeight - 150
})

async function onConfigReady(config?: LocalServerConfig) {
  await commonStore.init(config)
  i18n.locale.value = commonStore.lang
  window.mainApi?.setAppTheme(commonStore.theme)
  canRender.value = true
  clearTimeout(loadingTimer)
  closeLoading?.close()
  closeLoading = null
  router.replace(commonStore.onboarded ? '/proxy' : '/onboarding')
}

onMounted(async () => {

  canRender.value = false
  window.isWeb = window.mainApi == null

  window.addEventListener('resize', () => {
    offset.value.x = window.innerWidth - 42
    offset.value.y = window.innerHeight - 150
  })

  window.mainApi?.onOpenOnboarding(() => router.push('/onboarding'))

  if (window.mainApi) {
    window.mainApi.getBizConfig(onConfigReady)
  } else {
    await onConfigReady()
  }
})

function onOpenDebugPanel() {
  commonStore.showDebugPanel = true
}

</script>

<style>
#app {
  /* font-family: "Consolas"; */
  background: var(--van-gray-1);
  font-size: var(--van-font-size-md);
  letter-spacing: 1px;
  /* -moz-user-select: none;
  -webkit-user-select: none;
  -ms-user-select: none;
  user-select: none; */
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  user-select: none;
  scroll-behavior: smooth;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

::-webkit-scrollbar-thumb {
  border-radius: 2px;
  box-shadow: inset 0 0 5px rgba(125, 125, 125, 0.1);
  -webkit-box-shadow: inset 0 0 5px rgba(125, 125, 125, 0.1);
  background: var(--van-gray-8);
}

/* OverlayScrollbars 主题：手柄颜色取自 Vant 灰阶，深色主题下随 gray 变量自动反相 */
.os-theme-van {
  --os-size: 6px;
  --os-padding-perpendicular: 2px;
  --os-padding-axis: 2px;
  --os-track-border-radius: 3px;
  --os-handle-border-radius: 3px;
  --os-handle-interactive-area-offset: 4px;
  --os-handle-bg: color-mix(in srgb, var(--van-gray-8) 45%, transparent);
  --os-handle-bg-hover: color-mix(in srgb, var(--van-gray-8) 65%, transparent);
  --os-handle-bg-active: color-mix(in srgb, var(--van-gray-8) 85%, transparent);
}

.full-row {
  width: 100%;
  height: 100%;
  background: var(--van-background);
  overflow: hidden;
}

.border-bg {
  margin: var(--card-gutter);
  padding: 0;
  box-shadow: 0px 12px 8px -12px #000;
}

.biz-content {
  width: 100%;
  min-width: 0;
  height: 100vh;
  height: 100dvh;
  background: var(--van-gray-1);
  overflow: hidden auto;
}

/* 路由切换淡入淡出；out-in 保证新旧页面不同时占位导致跳动 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.drag-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 32px;
  pointer-events: auto;
  -webkit-app-region: drag;
  z-index: 1;
}

.rule-mgr-cell-value {
  /* 地板 120px 是原先写死的值：字号 9 不变，字号 10 放宽到 md*9.2=128.8，
     不再把 Mock 规则头部的规则名挤成省略号 */
  flex: 0 0 max(120px, calc(var(--van-font-size-md) * 9.2)) !important;
}

</style>
