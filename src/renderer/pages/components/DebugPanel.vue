<template>
  <div style="width: 375px; height: 100vh;">
    <van-form class="full-row" style="width: 100%; min-width: 375px; padding-top: 12px; " label-align="right" colon>
      <van-cell-group inset :title="$t('settings.sys.title')">
        <van-cell title="go to new" clickable @click="toNew">

        </van-cell>

        <van-cell title="Developer Tools" clickable @click="openDevTools"></van-cell>
      </van-cell-group>
    </van-form>
  </div>
</template>

<script lang="ts" setup>

function toNew() {
  alert('去新版')
}

function openDevTools() {
  if (!__IS_WEB__) {
    window.electronAPI.openDevTools()
  }
}

</script>

<style scoped>
.drag-ball {
  position: absolute;
  z-index: 10003;
  right: 0;
  top: 70%;
  width: 2.5em;
  height: 2.5em;
  background: #e1e1e1aa;
  border-radius: 50%;
  overflow: hidden;
  box-shadow: 0px 0px 10px 2px skyblue;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}
</style>
