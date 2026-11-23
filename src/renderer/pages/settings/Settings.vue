<template>
  <OverlayScrollbarsComponent class="settings" :options="scrollOptions" defer>
    <!-- 整页首组上方让开 App.vue 那条 absolute 的 32px .drag-bar，取值与 MockRuleMgr 顶栏同源。 -->
    <div label-align="right" colon :style="{ paddingTop: isWeb ? '0' : 'calc(10px + var(--app-sp-md))' }">
      <sys-info />
      <van-cell-group inset :title="$t('settings.help.title')">
        <van-field :label="$t('settings.help.onboarding')" is-link readonly @click="open('/onboarding')">
          <template #left-icon>
            <van-icon class="iconfont icon-help setting-cell-icon" />
          </template>
        </van-field>
        <van-field :label="$t('settings.help.diagnostic')" is-link readonly @click="open('/diagnostic')">
          <template #left-icon>
            <van-icon class="iconfont icon-diagnostic setting-cell-icon" />
          </template>
        </van-field>
      </van-cell-group>
      <data-backup />
      <mock-cloud-share v-if="!isWeb" />
      <version-theme />
      <client-mgr />
    </div>
  </OverlayScrollbarsComponent>
</template>

<script lang="ts" setup>
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { useRouter } from 'vue-router'
import { scrollOptions } from '../../common/scroll'
import ClientMgr from './ClientMgr.vue'
import DataBackup from './DataBackup.vue'
import MockCloudShare from './MockCloudShare.vue'
import SysInfo from './SysInfo.vue'
import VersionTheme from './VersionTheme.vue'

const router = useRouter()
const isWeb = window.isWeb

function open(path: string) {
  router.push(path)
}
</script>

<style scoped>
.settings {
  width: var(--app-popup-w-md);
  min-width: min(375px, 100vw);
  max-width: 100vw;
  height: 100vh;
  height: 100dvh;
  background-color: var(--van-gray-1);
}
</style>