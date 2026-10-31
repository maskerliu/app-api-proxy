<template>
  <van-form class="settings" label-align="right" colon>
    <sys-info />
    <version-theme />
    <local-resource-mgr />
    <client-mgr />
  </van-form>
</template>

<script lang="ts" setup>
import ClientMgr from './ClientMgr.vue'
import LocalResourceMgr from './LocalResourceMgr.vue'
import SysInfo from './SysInfo.vue'
import VersionTheme from './VersionTheme.vue'

</script>
<style scoped>
.settings {
  width: min(80vw, 860px);
  min-width: min(375px, 100vw);
  max-width: 100vw;
  height: 100vh;
  height: 100dvh;
  /* padding-top: 12px 0 20px 0; */
  overflow-y: auto;
  background-color: var(--van-gray-1);
}
</style>