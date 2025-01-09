<template>
  <van-config-provider :theme="theme">
    <biz-main v-if="canRender" />
  </van-config-provider>
</template>

<script lang="ts" setup>
import { ConfigProviderTheme } from 'vant'
import { onMounted, provide, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BizMain from './pages/BizMain.vue'
import { CommonStore } from './store'

const canRender = ref(true)
const i18n = useI18n()
const theme = ref<ConfigProviderTheme>('light')
const lang = ref<string>('zh-CN')

provide('theme', theme)
provide('lang', lang)

onMounted(async () => {

  window.isWeb = __IS_WEB__

  let wrapTheme = window.localStorage.getItem('theme')
  theme.value = wrapTheme != null ? wrapTheme as ConfigProviderTheme : 'light'

  let wrapLang = window.localStorage.getItem('lang')
  lang.value = wrapLang != null ? wrapLang : 'zh-CN'
  i18n.locale.value = lang.value

  if (!__IS_WEB__) {
    window.electronAPI.getSysSettings(async (result) => {
      await CommonStore().init(result)
    })

    window.electronAPI.setAppTheme(theme.value)
  } else {
    await CommonStore().init()
  }

  canRender.value = true
})

</script>

<style>
.van-theme-light {
  --van-white: white;
  --van-black: #333;
  --van-gray-1: #ecedee;
  --van-gray-8: #69696b;
}

.van-theme-dark {
  --van-white: rgb(24, 23, 23);
  --van-black: #efecec;
  --van-gray-1: #272728;
  --van-gray-8: #ccccce;
}

:root {
  --van-dialog-border-radius: 6px;
  --van-tag-font-size: 0.6rem;
  --van-tag-padding: 2px 5px;
  --van-tag-border-radius: 5px;
  --van-cell-horizontal-padding: 10px;
  --van-popup-round-radius: 8px;
  --van-popup-close-icon-margin: 23px;
  --van-border-width: 1.4px;
  --van-radius-md: 8px;
  --van-dialog-radius: 8px;
  --van-floating-bubble-background: #f04b1e;
}

#app {
  /* font-family: "Consolas"; */
  background: var(--van-gray-1);
  letter-spacing: 1px;
  /* -moz-user-select: none;
  -webkit-user-select: none;
  -ms-user-select: none;
  user-select: none; */
  width: 100vw;
  height: 100vh;
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

::-webkit-scrollbar-track {
  box-shadow: inset 0 0 5px rgba(125, 125, 125, 0.2);
  -webkit-box-shadow: inset 0 0 5px rgba(125, 125, 125, 0.2);
  border-radius: 2px;
  background: var(--van-gray-1);
}

.full-row {
  width: 100%;
  height: 100%;
  background: var(--van-background);
  overflow: hidden;
}

.border-bg {
  margin: 5px;
  padding: 0;
  /* border-radius: 8px; */
  /* border: 1px solid #e1e1e1; */
  box-shadow: 0px 12px 8px -12px #000;
}

.drag-bar {
  width: 100%;
  height: 30px;
  position: absolute;
  background: linear-gradient(to bottom, var(--van-gray-1), transparent);
  -webkit-app-region: drag;
  z-index: 9999;
}

.rule-mgr-cell-value {
  flex: 0 0 120px !important;
}
</style>
