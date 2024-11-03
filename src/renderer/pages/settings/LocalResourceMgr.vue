<template>
  <van-cell-group inset :title="$t('settings.resources.title')">
    <van-field name="uploader" :label="$t('settings.resources.manage')" label-width="10rem">
      <template #input>
        <van-uploader multiple accept="*" />
      </template>
      <template #right-icon>
        <van-button plain size="small">{{ $t('common.upload') }}</van-button>
      </template>
    </van-field>
  </van-cell-group>
</template>
<script lang="ts" setup></script>
<style scoped>

</style>