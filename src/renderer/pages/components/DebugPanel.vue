<template>
  <div style="width: 375px; height: 100vh; overflow: hidden;">
    <van-form class="full-row" style="width: 100%; min-width: 375px; padding-top: 12px; " label-align="right" colon>
      <van-cell-group inset :title="$t('debug.common.title')">
        <van-cell :title="$t('debug.common.versionCheck')" clickable @click="toNew"></van-cell>
        <van-cell :title="$t('debug.common.devTools')" clickable @click="openDevTools"></van-cell>
      </van-cell-group>

      <van-cell-group inset :title="$t('debug.virtualClient.title')">
        <van-cell :title="'Virtual Client'" clickable @click="virtualClient"></van-cell>
      </van-cell-group>

      <lab />
    </van-form>
  </div>
</template>

<script lang="ts" setup>
import { inject, Ref } from 'vue'
import Lab from '../lab/Lab.vue'

const showDebugPanel = inject<Ref<boolean>>('showDebugPanel')

function toNew() {
  alert('去新版')
}

function virtualClient() {

}

function openDevTools() {
  if (!__IS_WEB__) {
    window.electronAPI.openDevTools()
    showDebugPanel.value = false
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
