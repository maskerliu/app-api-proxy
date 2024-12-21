<template>
  <van-cell-group inset title=" ">
    <van-field center :label="$t('settings.sys.theme')" label-width="5rem" :readonly="true">
      <template #left-icon>
        <van-icon class="iconfont icon-theme"></van-icon>
      </template>
      <template #right-icon>
        <van-radio-group v-model="theme" direction="horizontal" style="height: 26px;" @change="onThemeChanged">
          <van-radio name="light">
            <van-icon class="iconfont icon-theme-light theme-icon"
              :style="{ color: theme == 'light' ? '#3498db' : 'gray' }" />
          </van-radio>
          <van-radio name="dark">
            <van-icon class="iconfont icon-theme-dark theme-icon"
              :style="{ color: theme == 'dark' ? '#3498db' : 'gray' }" />
          </van-radio>
        </van-radio-group>
      </template>
    </van-field>

    <van-field center input-align="right" :label="$t('settings.sys.version')" label-width="5rem" :readonly="true">
      <template #left-icon>
        <van-icon class="iconfont icon-info"></van-icon>
      </template>
      <template #input>
        <div style="height: 33px;display: flex; align-items: center; justify-content: center;" @click="onVersionCheck">
          <span>{{ commonStore.serverConfig.appVersion }}</span>
        </div>

      </template>
      <template #right-icon>
        <van-loading v-if="versionChecking" />
        <van-button v-if="hasNewVersion" type="warning" plain size="small" @click="downloadNewVersion">
          <van-icon class="iconfont icon-version-update"></van-icon>
        </van-button>
      </template>
    </van-field>

    <van-field center input-align="right" :label="$t('settings.sys.lang')" label-width="5rem" :readonly="true">
      <template #left-icon>
        <van-icon class="iconfont icon-lang" />
      </template>
      <template #input>
        <van-popover v-model:show="showLangs" placement="bottom-end" style="min-width: 140px">
          <van-cell v-for="item in langs" :title="item" clickable is-link @click="onSelectLang(item)">
          </van-cell>
          <template #reference>
            <div style="min-width: 120px; height: 1rem; padding: 2px; margin-top: -5px;">
              {{ lang }}
            </div>
          </template>
        </van-popover>
      </template>
      <template #right-icon>
        <van-loading v-if="versionChecking" />
        <van-button v-if="hasNewVersion" type="warning" plain size="small" @click="downloadNewVersion">
          <van-icon class="iconfont icon-version-update" />
        </van-button>
      </template>
    </van-field>

    <van-popup round v-model:show="showDownload" :closeable="popupCloseable" :close-on-click-overlay="false"
      teleport="#app">
      <van-row style="width: 450px; margin: 15px; height: 300px;" justify="center">
        <van-icon class="iconfont icon-version-update" style="color: green; font-size: 2rem;" />
        <pre class="update-message">{{ newVersion.message }} </pre>
        <div style="width: 100%;">
          <van-progress :percentage="downloadProgress" stroke-width="4" class="download-progress" />
        </div>
        <van-button v-if="showRestart" plain block type="success" size="small" @click="restart">
          {{ $t('settings.sys.restart') }}
        </van-button>
      </van-row>
    </van-popup>
  </van-cell-group>
</template>
<script lang="ts" setup>

import { ConfigProviderTheme, showNotify } from 'vant'
import { inject, onMounted, ref, Ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Version, versionCheck } from '../../../common'
import { CommonStore } from '../../store'

const commonStore = CommonStore()
const i18n = useI18n()
const versionChecking = ref<boolean>(false)
const hasNewVersion = ref<boolean>(false)
const showLangs = ref<boolean>(false)
const showDownload = ref<boolean>(false)
const showRestart = ref<boolean>(false)
const downloadProgress = ref<number>(0)

const lang = inject<Ref<string>>('lang')
const theme = inject<Ref<ConfigProviderTheme>>('theme')

const popupCloseable = __IS_WEB__
let newVersion: Version = null

const value1 = ref(0)
const langs = ['en', 'zh-CN']

onMounted(() => {
  if (!__IS_WEB__) {
    window.electronAPI.onDownloadUpdate((...args: any) => {
      downloadProgress.value = args[0].progress.toFixed(1)
    })
  }
})

watch(downloadProgress, () => {
  if (downloadProgress.value == 100) {
    showRestart.value = !newVersion.fullUpdate
    hasNewVersion.value = false
  }
})

function onSelectLang(_lang: string) {
  lang.value = _lang
  showLangs.value = false
  i18n.locale.value = lang.value
  window.localStorage.setItem('lang', _lang)
}

function onThemeChanged() {
  window.localStorage.setItem('theme', theme.value)
  if (!__IS_WEB__) window.electronAPI.setAppTheme(theme.value)
}

async function onVersionCheck() {
  versionChecking.value = true
  hasNewVersion.value = false
  try {
    newVersion = await versionCheck(commonStore.serverConfig.platform, commonStore.serverConfig.arch, commonStore.serverConfig.updateServer)
    newVersion.message = "在QQ，轻松社交" +
      "\n- [聊天消息]随时随地好友和群消息；" +
      "\n- [语音通话]、[视频聊天]和亲友自在畅聊；" +
      "\n- [文件传输]手机电脑多端互传，轻松便捷。" +
      "\n" +
      "\n在QQ，轻松生活" +
      "\n- [空间动态]快速获知好友动态，随时分享生活；" +
      "\n- [移动支付]话费充值、转账收款、网购一应俱全；" +
      "\n- [关怀模式]大字体、大图标，操作更简单，长辈使用更方便。" +
      "\n" +
      "\n在QQ，轻松娱乐" +
      "\n- [游戏中心]体验热门手游乐趣，还有更多大神攻略分享；" +
      "\n- [个性装扮]各种主题、名片、彩铃、气泡、挂件自由选。" +
      "\n" +
      "\nQQ9将功能赋能，打造轻松欢乐的社交、娱乐与生活体验。"
    hasNewVersion.value = newVersion.version != commonStore.serverConfig.appVersion
  } catch (err) {
    showNotify(err)
    hasNewVersion.value = false
  } finally {
    versionChecking.value = false
  }
}

function downloadNewVersion() {
  showDownload.value = true
  downloadProgress.value = 0
  if (newVersion.fullUpdate) showRestart.value = false
  if (!__IS_WEB__) window.electronAPI.downloadUpdate(newVersion)
}

function restart() {
  showDownload.value = false
  if (!__IS_WEB__) window.electronAPI.relaunch()
}

</script>
<style lang="css" scoped>
.theme-icon {
  font-size: 1.6rem;
}

.update-message {
  width: calc(100% - 0px);
  height: 190px;
  overflow: hidden auto;
  margin: 0 15px;
  color: var(--van-text-color);
}

.download-progress {
  margin: 10px 0;
}
</style>