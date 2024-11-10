<template>
  <van-cell center @click="recordStore.curRecordId = source.id" :is-link="true" style="padding: 10px 0;">
    <template #icon>
      <div class="item-timeline">
        <div class="item-selected" v-if="recordStore.curRecordId == source.id"></div>
        <div class="item-timeline-dot" v-bind:style="{ background: source.timelineColor }"></div>
      </div>
    </template>
    <template #title>
      <div v-if="source.type == 5020" class="request-snap-url"
        v-for="(item, idx) in (source as ProxyMock.ProxyStatRecord).statistics.bps.slice(0, 2)">
        <span class="stat-snap-pid"> {{ item.pageId }} </span>
        <strong class="stat-snap-type">[{{ item.event_id == 2001 ? "PV" : "事件" }}]</strong>
        <span class="stat-snap-eid" v-if="item.event_id != 2001"><br />
          {{ item.elementId == "" ? item.arg1 : item.elementId }}
        </span>
      </div>
      <span v-else class="request-snap-url">
        {{ source.url }}
      </span>
      <van-loading size="20" type="spinner" style="width: 28px; margin-top: -28px; "
        v-if="source.type != 5012 && source.type != 5020" />
    </template>
    <template #label>
      <van-icon v-if="source.isMock" class="iconfont icon-api"
          style="font-size: 0.7rem; color: brown; font-weight: bold; margin-right: 5px;" />
        <strong v-if="source.type == 5020" class="request-snap-method">[打点]</strong>
        <strong v-else class="request-snap-method">[{{ source.method }}]</strong>
        <van-tag plain mark :type="source.statusCode === 200 ? 'success' : 'danger'" style="margin-left: 5px">
          <b>[HTTP]</b>
          {{ source.statusCode }}
        </van-tag>
        <van-tag plain mark :type="parseInt(source.responseData.code) === 8000 ? 'success' : 'warning'"
          style="margin-left: 5px" v-if="source.responseData != null">
          <b>[BIZ]</b>
          {{ source.responseData.code }}
        </van-tag>
        <span style="margin-left: 5px; font-size: 0.6rem;"
          v-bind:style="{ color: source.time > 500 ? '#e74c3c' : '#2ecc71' }">
          耗时: {{ source.time ? source.time : "--" }} ms
        </span>
    </template>

  </van-cell>
</template>

<script lang="ts" setup>
import type { PropType } from 'vue';
import { ProxyMock } from '../../../common/proxy.models';
import { useProxyRecordStore } from '../../store/ProxyRecords';

defineProps({
  source: {
    type: Object as PropType<ProxyMock.ProxyRequestRecord>,
    required: true,
  },
})

const recordStore = useProxyRecordStore()

</script>

<style scoped>
.item-selected {
  position: absolute;
  width: 10px;
  height: 100%;
  background: #9191a148;
  left: -6px;
  z-index: 99;
}

.item-timeline {
  position: absolute;
  width: 8px;
  height: 100%;
  left: 6px;
  top: 0;
  font-size: 0.5rem;
  font-weight: bold;
  border-left: 2px dashed #d6d6d6;
  color: white;
}

.item-timeline-dot {
  border-radius: 7px;
  background-color: aquamarine;
  width: 10px;
  height: 10px;
  margin-top: 20px;
  margin-left: -6px;
}

.record-snap-item:hover {
  background: #ececec;
  cursor: pointer;
}

.stat-snap-pid {
  max-width: 100px;
  font-size: 0.6rem;
  color: #8c7ae6;
}

.stat-snap-eid {
  max-width: 100px;
  font-size: 0.6rem;
  color: #e1b12c;
  margin-top: 5px;
}

.stat-snap-type {
  font-size: 0.6rem;
  color: #d35400;
}

.request-snap-method {
  font-size: 0.6rem;
  font-weight: bold;
  color: #2980b9;
  top: 10px;
  right: 35px;
}

.request-snap-url {
  max-width: 260px;
  font-size: 0.7rem;
  font-weight: bold;
  color: #34495e;
  padding: 0 0 5px 5px;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
}
</style>
