<template>
  <OverlayScrollbarsComponent class="settings" :options="scrollOptions" defer>
    <van-form label-align="right" colon>
      <sys-info />
      <van-cell-group inset :title="$t('settings.help.title')">
        <van-cell :title="$t('settings.help.onboarding')" is-link @click="open('/onboarding')">
          <template #icon>
            <i class="iconfont icon-help cell-icon" />
          </template>
        </van-cell>
        <van-cell :title="$t('settings.help.diagnostic')" is-link @click="open('/diagnostic')">
          <template #icon>
            <i class="iconfont icon-diagnostic cell-icon" />
          </template>
        </van-cell>
      </van-cell-group>
      <version-theme />
      <local-resource-mgr />
      <client-mgr />
    </van-form>
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
/* 与 VersionTheme 字段图标保持相同左偏移与图标/文字间距 */
.cell-icon {
  margin-left: 15px;
  margin-right: var(--van-padding-base);
  align-self: center;
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