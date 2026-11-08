<template>
  <OverlayScrollbarsComponent class="settings" :options="scrollOptions" defer>
    <div label-align="right" colon>
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
      <version-theme />
      <local-resource-mgr />
      <client-mgr />
    </div>
  </OverlayScrollbarsComponent>
</template>

<script lang="ts" setup>
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { useRouter } from 'vue-router'
import { scrollOptions } from '../../common/scroll'
import ClientMgr from './ClientMgr.vue'
import LocalResourceMgr from './LocalResourceMgr.vue'
import SysInfo from './SysInfo.vue'
import VersionTheme from './VersionTheme.vue'

const router = useRouter()

function open(path: string) {
  router.push(path)
}
</script>

<style scoped>
.setting-cell-icon {
  margin-left: 15px;
}
</style>
<style scoped>
.settings {
  width: min(60vw, 860px);
  min-width: min(375px, 100vw);
  max-width: 100vw;
  height: 100vh;
  height: 100dvh;
  /* padding-top: 12px 0 20px 0; */
  background-color: var(--van-gray-1);
}
</style>