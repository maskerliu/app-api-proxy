<template>
  <van-cell-group inset title=" ">
    <van-field center :label="$t('settings.sys.theme')" label-width="4rem" :readonly="true">
      <template #left-icon>
        <van-icon class="iconfont icon-theme" style="margin-left: 15px;" />
      </template>
      <template #right-icon>
        <van-radio-group v-model="commonStore.theme" direction="horizontal" style="height: 26px;"
          @change="commonStore.updateTheme">
          <van-radio name="light">
            <van-icon class="iconfont icon-theme-light theme-icon"
              :style="{ color: commonStore.theme == 'light' ? '#3498db' : 'gray' }" />
          </van-radio>
          <van-radio name="dark">
            <van-icon class="iconfont icon-theme-dark theme-icon"
              :style="{ color: commonStore.theme == 'dark' ? '#3498db' : 'gray' }" />
          </van-radio>
        </van-radio-group>
      </template>
    </van-field>

    <van-field center input-align="right" :label="$t('settings.sys.fontsize')" label-width="4rem" :readonly="true">
      <template #left-icon>
        <van-icon class="iconfont icon-font-size" style="margin-left: 15px;" />
      </template>
      <template #input>
        <van-popover v-model:show="showFontSizes" placement="bottom-end" style="min-width: 140px">
          <van-cell v-for="size in fontSizes" :title="`${size}`" clickable is-link @click="onSelectFontSize(size)">
          </van-cell>
          <template #reference>
            <div style="min-width: 120px; height: 1rem; padding: 2px; margin-top: -5px;">
              {{ commonStore.fontSize }}
            </div>
          </template>
        </van-popover>
      </template>
    </van-field>

    <van-field center input-align="right" :label="$t('settings.sys.version')" label-width="4rem" :readonly="true">
      <template #left-icon>
        <van-icon class="iconfont icon-info" style="margin-left: 15px;" />
      </template>
      <template #input>
        <div style="height: 33px;display: flex; align-items: center; justify-content: center;" @click="onVersionCheck">
          <span>{{ commonStore.serverConfig.appVersion }}</span>
        </div>

      </template>
      <template #right-icon>
        <van-loading v-if="versionChecking" />
        <van-button v-if="hasNewVersion" type="warning" plain size="small" @click="downloadNewVersion">
          <van-icon class="iconfont icon-version-update" />
        </van-button>
      </template>
    </van-field>

    <van-field center input-align="right" :label="$t('settings.sys.lang')" label-width="4rem" :readonly="true">
      <template #left-icon>
        <van-icon class="iconfont icon-lang" style="margin-left: 15px;" />
      </template>
      <template #input>
        <van-popover v-model:show="showLangs" placement="bottom-end" style="min-width: 140px">
          <van-cell v-for="item in langs" :title="item" clickable is-link @click="onSelectLang(item)">
          </van-cell>
          <template #reference>
            <div style="min-width: 120px; height: 1rem; padding: 2px; margin-top: -5px;">
              {{ commonStore.lang }}
            </div>
          </template>
        </van-popover>
      </template>
    </van-field>

    <van-popup round v-model:show="showDownload" :closeable="!showRestart" :close-on-click-overlay="false"
      teleport="#app" @close="onPopupClose">
      <van-row class="version-popup" justify="center">
        <van-icon class="iconfont icon-version-update" style="color: green; font-size: 2rem;" />
        <pre class="update-message">{{ newVersion.message }} </pre>
        <div style="width: 100%;">
          <van-progress :percentage="downloadProgress" stroke-width="4" class="download-progress" />
        </div>
        <van-button v-if="downloading" plain block type="default" size="small" @click="cancelDownload">
          {{ $t('settings.sys.cancelUpdate') }}
        </van-button>
        <van-button v-if="showRestart" plain block type="success" size="small" @click="restart">
          {{ $t('settings.sys.restart') }}
        </van-button>
      </van-row>
    </van-popup>
  </van-cell-group>
</template>
<script lang="ts" setup>
import { Version, versionCheck } from '@shared'
import { showNotify, showToast } from 'vant'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CommonStore, FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../store'

const commonStore = CommonStore()
const i18n = useI18n()
const versionChecking = ref<boolean>(false)
const hasNewVersion = ref<boolean>(false)
const showLangs = ref<boolean>(false)
const showFontSizes = ref<boolean>(false)
const showDownload = ref<boolean>(false)
const showRestart = ref<boolean>(false)
const downloading = ref<boolean>(false)
const downloadProgress = ref<number>(0)

let newVersion: Version = null

const value1 = ref(0)
const langs = ['en', 'zh-CN']
const fontSizes = Array.from({ length: FONT_SIZE_MAX - FONT_SIZE_MIN + 1 }, (_v, i) => FONT_SIZE_MIN + i)

onMounted(() => {
  window.mainApi?.onDownloadUpdate((...args: any) => {
    const event = args[0] ?? {}
    if (event.error) {
      showNotify(String(event.error))
      downloadProgress.value = 0
      downloading.value = false
      showDownload.value = false
      return
    }
    const progress = Number(event.progress)
    if (Number.isFinite(progress)) downloadProgress.value = progress
  })
})

onBeforeUnmount(() => {
  window.mainApi?.offDownloadUpdate()
})

watch(downloadProgress, () => {
  if (downloadProgress.value == 100) {
    downloading.value = false
    showRestart.value = !newVersion.fullUpdate
    hasNewVersion.value = false
  }
})

function onSelectLang(_lang: string) {
  commonStore.updateLang(_lang)
  showLangs.value = false
  i18n.locale.value = _lang
}

function onSelectFontSize(size: number) {
  commonStore.fontSize = size
  commonStore.updateFontSize()
  showFontSizes.value = false
}

async function onVersionCheck() {
  versionChecking.value = true
  hasNewVersion.value = false
  try {
    newVersion = await versionCheck(commonStore.serverConfig.platform, commonStore.serverConfig.arch, commonStore.serverConfig.updateServer)
    hasNewVersion.value = newVersion.version != commonStore.serverConfig.appVersion

    if (!hasNewVersion.value) {
      showToast(i18n.t('settings.sys.noNewVersion'))
    }
  } catch (err) {
    showNotify(err)
    hasNewVersion.value = false
  } finally {
    versionChecking.value = false
  }
}

function downloadNewVersion() {
  if (downloading.value) return
  showDownload.value = true
  downloadProgress.value = 0
  showRestart.value = false
  downloading.value = true
  window.mainApi?.downloadUpdate(newVersion)
}

function cancelDownload() {
  window.mainApi?.cancelUpdate()
}

function onPopupClose() {
  if (downloading.value) window.mainApi?.cancelUpdate()
}

function restart() {
  showDownload.value = false
  window.mainApi?.relaunch()
}

</script>
<style lang="css" scoped>
.theme-icon {
  font-size: 1.6rem;
}

.version-popup {
  width: min(450px, calc(100vw - 60px));
  min-height: 300px;
  margin: 15px;
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