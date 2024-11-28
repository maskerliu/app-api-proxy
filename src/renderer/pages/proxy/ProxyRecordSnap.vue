<template>
  <van-cell center @click="recordStore.curRecordId = source.id" :is-link="true" style="padding: 10px 0;" :title-style="{
    margin: '0 15px 0 20px', maxWidth: 'calc(100% - 1px)', direction: 'rtl',
    unicodeBidi: 'embed'
  }" title-class="request-snap-url">
    <template #icon>
      <div class="item-timeline">
        <div class="item-selected" v-if="recordStore.curRecordId == source.id"></div>
        <div class="item-timeline-dot" v-bind:style="{ borderColor: source.timelineColor }"></div>
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
      <span v-else class="van-ellipsis">
        {{ source.url }}
      </span>
    </template>
    <template #label>
      <div justify="start" style="direction: rtl; unicode-bidi: embed; width: 100%;">
        <span class="request-snap-timecost" v-bind:style="{ color: source.time > 500 ? '#e74c3c' : '#2ecc71' }">
          耗时: {{ source.time ? `${source.time}`.padStart(5, '&nbsp;') : "-----" }} ms
        </span>
        <van-tag plain mark :type="parseInt(source.responseData.code) === 8000 ? 'success' : 'warning'"
          style="margin-left: 5px; font-size: 0.5rem;" v-if="source.responseData != null">
          {{ source.responseData.code }}<b>[BIZ]</b>
        </van-tag>

        <van-tag plain mark :type="source.statusCode === 200 ? 'success' : 'danger'"
          style="margin-left: 5px; font-size: 0.5rem;">
          {{ source.statusCode }} <b>[HTTP]</b>
        </van-tag>

        <van-tag v-if="source.type == 5020" type="primary">[打点]</van-tag>
        <van-tag v-else :type="source.method == 'POST' ? 'success' : 'warning'">{{ source.method }}</van-tag>
        <van-icon v-if="source.isMock" class="iconfont icon-shuiguan"
          style="font-size: 1.1rem; color: brown; font-weight: bold; top: 3px; margin-right: 8px;" />

      </div>
    </template>
    <template #right-icon>
      <van-loading size="20" color="#8e44ad" style="margin-right: 5px;"
        v-if="source.type != 5012 && source.type != 5020" />
      <van-icon v-else name="arrow" size="20" color="grey" style="margin-right: 5px;" />
    </template>
  </van-cell>
</template>

<script lang="ts" setup>
import type { PropType } from 'vue'
import { ProxyMock } from '../../../common'
import { ProxyRecordStore } from '../../store'

defineProps({
  source: {
    type: Object as PropType<ProxyMock.ProxyRequestRecord>,
    required: true,
  },
})

const recordStore = ProxyRecordStore()

</script>

<style scoped>
.item-selected {
  position: absolute;
  width: 11px;
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
  border: 2px solid;
  border-color: #2980b9;
  width: 10px;
  height: 10px;
  margin-top: 15px;
  margin-left: -8px;
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
  font-size: 0.7rem;
  font-weight: bold;
  color: #2980b9;
  top: 10px;
  margin: 0 5px;
}

.request-snap-timecost {
  margin-left: 5px;
  font-size: 0.7rem;
}

.request-snap-url {
  direction: rtl;
  unicode-bidi: embed;
  /* max-width: calc(100% - 60px);
  width: calc(100% - 60px); */
  font-size: 0.8rem;
  font-weight: bold;
  color: #34495e;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
}
</style>
