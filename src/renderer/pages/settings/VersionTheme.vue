<template>
  <van-cell-group inset title=" ">
    <van-field center :label="$t('settings.sys.theme')" label-width="4.9em" :readonly="true">
      <template #left-icon>
        <van-icon class="iconfont icon-theme setting-cell-icon" />
      </template>
      <template #right-icon>
        <van-radio-group v-model="commonStore.theme" direction="horizontal" style="height: 26px;"
          @change="commonStore.updateTheme">
          <van-radio name="light">
            <van-icon class="iconfont icon-theme-light theme-icon"
              :style="{ color: commonStore.theme == 'light' ? 'var(--van-primary-color)' : 'var(--van-gray-5)' }" />
          </van-radio>
          <van-radio name="dark">
            <van-icon class="iconfont icon-theme-dark theme-icon"
              :style="{ color: commonStore.theme == 'dark' ? 'var(--van-primary-color)' : 'var(--van-gray-5)' }" />
          </van-radio>
        </van-radio-group>
      </template>
    </van-field>

    <van-field center input-align="right" :label="$t('settings.sys.fontsize')" label-width="4.9em" :readonly="true">
      <template #left-icon>
        <van-icon class="iconfont icon-font-size setting-cell-icon" />
      </template>
      <template #input>
        <MiniSelect
          :model-value="String(commonStore.fontSize)"
          :options="fontSizeOptions"
          @change="onSelectFontSizeStr" />
      </template>
    </van-field>

    <van-field center input-align="right" :label="$t('settings.sys.version')" label-width="4.9em" :readonly="true">
      <template #left-icon>
        <van-icon class="iconfont icon-info setting-cell-icon" />
      </template>
      <template #input>
        <van-row class="version-value" align="center" justify="center" :wrap="false" @click="onVersionCheck">
          <span>{{ commonStore.serverConfig.appVersion }}</span>
        </van-row>

      </template>
      <template #right-icon>
        <van-loading v-if="versionChecking" />
        <van-button v-if="hasNewVersion" type="warning" plain size="small" @click="downloadNewVersion">
          <van-icon class="iconfont icon-version-update" />
        </van-button>
      </template>
    </van-field>

    <van-field center input-align="right" :label="$t('settings.sys.lang')" label-width="4.9em" :readonly="true">
      <template #left-icon>
        <van-icon class="iconfont icon-lang setting-cell-icon" />
      </template>
      <template #input>
        <MiniSelect
          :model-value="commonStore.lang"
          :options="langOptions"
          @change="onSelectLang" />
      </template>
    </van-field>

    <van-popup round v-model:show="showDownload" :closeable="!showRestart" :close-on-click-overlay="false"
      teleport="#app" @close="onPopupClose">
      <van-row class="version-popup" justify="center">
        <van-icon class="iconfont icon-version-update" style="color: var(--van-success-color); font-size: 2rem;" />
        <OverlayScrollbarsComponent class="update-message" :options="scrollOptions" defer>
          <pre class="update-message-text">{{ newVersion.message }}</pre>
        </OverlayScrollbarsComponent>
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
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { showNotify, showToast } from 'vant'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MiniSelect from '../components/MiniSelect.vue'
import { scrollOptions } from '../../common/scroll'
import { CommonStore, FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../store'

const commonStore = CommonStore()
const i18n = useI18n()
const versionChecking = ref<boolean>(false)
const hasNewVersion = ref<boolean>(false)
const showDownload = ref<boolean>(false)
const showRestart = ref<boolean>(false)
const downloading = ref<boolean>(false)
const downloadProgress = ref<number>(0)

let newVersion: Version = null

const langs = ['en', 'zh-CN']
const fontSizes = Array.from({ length: FONT_SIZE_MAX - FONT_SIZE_MIN + 1 }, (_v, i) => FONT_SIZE_MIN + i)
const langOptions = computed(() => langs.map(l => ({ label: l, value: l })))
const fontSizeOptions = computed(() => fontSizes.map(n => ({ label: String(n), value: String(n) })))

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
  i18n.locale.value = _lang
}

function onSelectFontSizeStr(size: string) {
  onSelectFontSize(Number(size))
}

function onSelectFontSize(size: number) {
  commonStore.fontSize = size
  commonStore.updateFontSize()
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
.setting-cell-icon {
  margin-left: var(--sp-3xl);
}

/* 版本号：跟随所在 van-field 行高，字号缩放时不再脱节 */
.version-value {
  width: 100%;
  min-height: calc(var(--van-font-size-md) * 2.2);
  cursor: pointer;
}

.theme-icon {
  font-size: 1.2rem;
}

.version-popup {
  width: min(450px, calc(100vw - 60px));
  min-height: 300px;
  margin: var(--sp-3xl);
}

.update-message {
  width: calc(100% - 0px);
  height: 190px;
  margin: 0 var(--sp-3xl);
  color: var(--van-text-color);
}

.update-message-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.download-progress {
  margin: var(--sp-xl) 0;
}
</style>