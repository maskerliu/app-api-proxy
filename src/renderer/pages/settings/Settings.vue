<template>
  <van-form class="settings" label-align="right" colon>
    <sys-info />
    <version-theme />
    <local-resource-mgr />
    <client-mgr />
  </van-form>
</template>

<script lang="ts" setup>
import { onMounted } from 'vue'
import ClientMgr from './ClientMgr.vue'
import LocalResourceMgr from './LocalResourceMgr.vue'
import SysInfo from './SysInfo.vue'
import VersionTheme from './VersionTheme.vue'


onMounted(() => {

})

</script>
<style scoped>
.settings {
  width: 80vw;
  min-width: 375px;
  height: 100%;
  padding-top: 12px 0 20px 0;
  overflow-y: auto;
  background-color: var(--van-gray-1);
}
</style>