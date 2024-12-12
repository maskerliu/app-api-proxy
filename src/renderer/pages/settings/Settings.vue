<template>
  <van-form class="settings" label-align="right" colon>
    <sys-info />

    <van-cell-group inset title=" ">
      <van-field center :label="$t('settings.sys.theme')" label-width="5rem" :readonly="true">
        <template #left-icon>
          <van-icon class="iconfont icon-theme"></van-icon>
        </template>
        <template #right-icon>
          <van-radio-group v-model="wrapTheme" direction="horizontal" style="height: 26px;" @change="onThemeChanged">
            <!-- <van-radio name="sys">
              <van-icon class="iconfont icon-theme-sys theme-icon"
                :style="{ color: wrapTheme == 'sys' ? '#3498db' : 'gray' }" />
            </van-radio> -->
            <van-radio name="light">
              <van-icon class="iconfont icon-theme-light theme-icon"
                :style="{ color: wrapTheme == 'light' ? '#3498db' : 'gray' }" />
            </van-radio>
            <van-radio name="dark">
              <van-icon class="iconfont icon-theme-dark theme-icon"
                :style="{ color: wrapTheme == 'dark' ? '#3498db' : 'gray' }" />
            </van-radio>
          </van-radio-group>
        </template>
      </van-field>
      <van-field center input-align="right" :label="$t('settings.sys.version')" label-width="5rem" :readonly="true">
        <template #left-icon>
          <van-icon class="iconfont icon-info"></van-icon>
        </template>
        <template #input>
          <div style="height: 33px;display: flex; align-items: center; justify-content: center;" @click="versionCheck">
            <span>{{ version }}</span>
          </div>

        </template>
        <template #right-icon>
          <van-loading v-if="versionChecking" />
          <van-button v-if="hasNewVersion" type="warning" plain size="small" @click="downloadNewVersion">
            <van-icon class="iconfont icon-version-update"></van-icon>
          </van-button>
        </template>
      </van-field>
    </van-cell-group>

    <local-resource-mgr />
    <client-mgr style="margin-bottom: 20px;" />

    <van-popup round v-model:show="showDownload" :closeable="false" :close-on-click-overlay="false" teleport="#app">
      <div style="width: 450px; margin: 15px; height: 200px;">
        <div style="width: 100%; height: 155px; overflow-y: auto;">
          在QQ，轻松社交
          - [聊天消息]随时随地好友和群消息；
          - [语音通话]、[视频聊天]和亲友自在畅聊；
          - [文件传输]手机电脑多端互传，轻松便捷。
          <br>
          在QQ，轻松生活
          - [空间动态]快速获知好友动态，随时分享生活；
          - [移动支付]话费充值、转账收款、网购一应俱全；
          - [关怀模式]大字体、大图标，操作更简单，长辈使用更方便。
          <br>
          在QQ，轻松娱乐
          - [游戏中心]体验热门手游乐趣，还有更多大神攻略分享；
          - [个性装扮]各种主题、名片、彩铃、气泡、挂件自由选。
          <br>
          QQ9将功能赋能，打造轻松欢乐的社交、娱乐与生活体验。
        </div>
        <van-progress :percentage="downloadProgress" stroke-width="8" class="download-progress" />
      </div>
    </van-popup>
  </van-form>
</template>

<script lang="ts" setup>
import { ConfigProviderTheme } from 'vant'
import { inject, onMounted, ref, Ref, watch } from 'vue'
import ClientMgr from './ClientMgr.vue'
import LocalResourceMgr from './LocalResourceMgr.vue'
import SysInfo from './SysInfo.vue'

const version = ref<string>('1.0.1')
const versionChecking = ref<boolean>(false)
const hasNewVersion = ref<boolean>(false)
const showDownload = ref<boolean>(false)
const downloadProgress = ref<number>(0)

const wrapTheme = ref<ConfigProviderTheme>('light')
const theme = inject<Ref<ConfigProviderTheme>>('theme')

onMounted(() => {
  if (!__IS_WEB__) {
    window.electronAPI.onDownloadUpdate((...args: any) => {
      downloadProgress.value = args[0].progress.toFixed(1)
    })
  }

  wrapTheme.value = theme.value
})

watch(downloadProgress, () => {
  if (downloadProgress.value == 100) {
    showDownload.value = false
    hasNewVersion.value = false
  }
})

function onThemeChanged() {
  window.localStorage.setItem('theme', wrapTheme.value)
  theme.value = wrapTheme.value

  if (!__IS_WEB__) {
    window.electronAPI.setAppTheme(theme.value)
  }
}

function versionCheck() {
  versionChecking.value = true
  hasNewVersion.value = false

  setTimeout(() => {
    versionChecking.value = false
    hasNewVersion.value = true
  }, 1200)
}

function downloadNewVersion() {
  showDownload.value = true
  downloadProgress.value = 0
  window.electronAPI.downloadUpdate()
}

</script>
<style scoped>
.settings {
  width: 80vw;
  min-width: 375px;
  height: 100%;
  padding-top: 12px;
  overflow-y: auto;
  background-color: var(--van-gray-1);
}

.theme-icon {
  font-size: 1.6rem;
}

.download-progress {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 15px;
}
</style>