<template>
  <van-list style="padding: 5px;">
    <van-cell v-for="(item, idx) in (record as ProxyMock.ProxyStatRecord).statistics.bps" :key="idx"
      :title="item.pageId" :label="item.elementId" :value="item.args" />
  </van-list>
</template>

<script lang="ts" setup>
import type { PropType } from 'vue'
import { ProxyMock } from '@shared'

defineProps({
  record: { type: Object as PropType<ProxyMock.ProxyStatRecord>, required: true },
})
</script>
