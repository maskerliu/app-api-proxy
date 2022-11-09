<template>
  <div class="record-snap-item" v-bind:style="{ background: source.isMock ? '#ffeaa755' : 'white' }"
    @click="recordStore.curRecordId = source.id">
    <span class="item-selected" v-if="recordStore.curRecordId == source.id"></span>
    <div class="item-timeline">
      <div class="item-timeline-dot" v-bind:style="{ background: source.timelineColor }"></div>
    </div>
    <div v-if="source.type == 5020">
      <strong class="request-snap-method">[打点]</strong>
      <div class="request-snap-url"
        v-for="(item, idx) in (source as ProxyMock.ProxyStatRecord).statistics.bps.slice(0, 2)" :key="idx">
        <span class="stat-snap-pid"> {{ item.pageId }} </span>
        <strong class="stat-snap-type">[{{ item.event_id == 2001 ? "PV" : "事件" }}]</strong>
        <span class="stat-snap-eid" v-if="item.event_id != 2001"><br />
          {{ item.elementId == "" ? item.arg1 : item.elementId }}
        </span>
      </div>
    </div>
    <div v-else>
      <div style="display: block">
        <strong class="request-snap-method">[{{ source.method }}]</strong>
        <span class="request-snap-url">{{ source.url }}</span>
      </div>

      <div class="request-snap-status" style="width: 100%; margin-top: 10px">
        <van-tag plain :type="source.statusCode === 200 ? 'success' : 'danger'">
          <b>[HTTP]</b>
          {{ source.statusCode }}
        </van-tag>
        <van-tag plain :type="
          parseInt(source.responseData.code) === 8000 ? 'success' : 'warning'
        " style="margin-left: 5px" v-if="source.responseData != null">
          <b>[BIZ]</b>
          {{ source.responseData.code }}
        </van-tag>
        <span style="margin-left: 5px" v-bind:style="{ color: source.time > 500 ? '#e74c3c' : '#2ecc71' }">耗时: {{
        source.time ? source.time : "--"
        }} ms</span>
      </div>
      <van-icon name="arrow" style="
          position: absolute;
          top: 30px;
          right: 10px;
          font-size: 1.2rem;
          color: grey;
        " />

      <div v-if="source.type != 5012 && source.type != 5020" class="request-snap-loading" center>
        <van-loading size="20" type="spinner" style="position: absolute; margin-top: 25px; right: 40px" />
      </div>
    </div>
    <i class="divider"></i>
  </div>
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
.record-snap-item {
  position: relative;
  height: 50px;
  padding: 10px 15px;
}

.item-selected {
  position: absolute;
  width: calc(100%);
  height: calc(100% - 1px);
  background: #9191a148;
  left: 10;
  top: -1px;
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
  width: 14px;
  height: 14px;
  margin-top: 2px;
  margin-left: -8px;
}

.divider {
  position: absolute;
  bottom: 1px;
  width: 100%;
  height: 1px;
  background: #cccccc;
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
  position: absolute;
  top: 10px;
  right: 35px;
}

.request-snap-url {
  width: calc(100% - 70px);
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

.request-snap-status {
  width: 100%;
  margin-top: 10px;
  font-size: 0.6rem;
  font-weight: bold;
}

.request-snap-loading {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background-color: #dfdfdf88;
  top: 0;
}

</style>
