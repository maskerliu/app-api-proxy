<template>
  <van-cell center is-link style="padding: 10px 0;" :title-style="{ margin: '0 10px 0 15px' }"
    @click="recordStore.curRecordId = source.id">
    <template #icon>
      <div class="item-timeline">
        <div class="item-timeline-dot"
          :style="{ borderColor: source.timelineColor, backgroundColor: recordStore.curRecordId == source.id ? 'var(--van-text-color)' : 'transparent' }">
        </div>
      </div>
    </template>
    <template #title>
      <template v-if="isStat">
        <div v-for="(item, idx) in ((source as ProxyMock.ProxyStatRecord).statistics?.bps?.slice(0, 2) ?? [])"
          :key="idx">
          <span class="stat-snap-pid"> {{ item.pageId }} </span>
          <strong class="stat-snap-type">[{{ item.event_id == 2001 ? "PV" : "事件" }}]</strong>
          <span class="stat-snap-eid" v-if="item.event_id != 2001"><br />
            {{ item.elementId == "" ? item.arg1 : item.elementId }}
          </span>
        </div>
      </template>
      <template v-else-if="isSocket">
        <div class="request-snap-url socket-snap-url" :title="source.url">{{ source.url }}</div>
      </template>
      <van-row v-else justify="end">
        <div class="request-snap-url">
          {{ source.url }}
        </div>
      </van-row>
    </template>
    <template #label>
      <div v-if="isSocket" class="socket-snap-meta">
        <van-tag :type="socketTagType" style="font-size: var(--van-font-size-xs);">
          [WS] {{ socketStatusText }}
        </van-tag>
        <span class="socket-snap-io" :title="$t('proxy.socket.bytesTitle')">
          ↑{{ formatBytes(socket.bytesSent) }} ↓{{ formatBytes(socket.bytesReceived) }}
        </span>
        <span class="socket-snap-time">{{ socketDuration }}</span>
        <van-tag v-if="socket.subprotocol" plain type="primary"
          style="font-size: var(--van-font-size-xs);">{{ socket.subprotocol }}</van-tag>
        <span v-if="socket.closeReason" class="socket-snap-reason" :title="socket.closeReason">
          {{ socket.closeReason }}
        </span>
        <span v-if="(socket.droppedFrames ?? 0) > 0" class="socket-snap-dropped">
          {{ $t('proxy.socket.dropped', { count: socket.droppedFrames }) }}
        </span>
        <span v-if="socket.errorCode" class="socket-snap-error" :title="socketErrorTitle">
          {{ socket.errorCode }}
        </span>
      </div>
      <div v-else style="display: flex; align-items: center; direction: rtl; width: 100%; margin-top: 25px;">
        <span class="request-snap-timecost" v-bind:style="{ color: (source.time ?? 0) > 500 ? '#e74c3c' : '#2ecc71' }">
          耗时: <span class="timecost-value">{{ source.time != null ? source.time : "-----" }}</span> ms
        </span>
        <van-tag plain :type="parseInt(source.responseData.code) === 2000 ? 'success' : 'warning'"
          style="margin-left: 5px; font-size: var(--van-font-size-xs);" v-if="source.responseData != null">
          {{ source.responseData.code }}<b>[BIZ]</b>
        </van-tag>

        <van-tag plain :type="source.statusCode === 200 ? 'success' : 'danger'"
          style="margin-left: 5px; font-size: var(--van-font-size-xs);">
          {{ source.statusCode }} <b>[HTTP]</b>
        </van-tag>

        <van-tag v-if="source.type == 5020" type="primary" style="margin-left: 5px;">[打点]</van-tag>
        <van-tag v-else :type="source.method == 'POST' ? 'success' : 'warning'"
          style="margin-left: 5px; font-size: var(--van-font-size-xs);">
          {{ source.method }}
        </van-tag>
        <van-tag v-if="missBadge" plain type="default"
          style="margin-left: 5px; font-size: var(--van-font-size-xs); color: var(--van-text-color-3);">
          {{ $t('mock.miss.badge', { score: missBadge }) }}
        </van-tag>
        <van-icon v-if="source.isMock" class="iconfont icon-shuiguan"
          style="font-size: 1.1rem; color: brown; font-weight: bold;" />

      </div>
    </template>
    <template #right-icon>
      <van-loading size="20" color="#8e44ad" style="margin-right: 5px;" v-if="showLoading" />
      <van-icon v-else name="arrow" size="20" color="grey" style="margin-right: 5px;" />
    </template>
  </van-cell>
</template>

<script lang="ts" setup>
import { ProxyMock } from '@shared'
import type { PropType } from 'vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ProxyRecordStore } from '../../store'
import { formatBytes, formatDuration } from './socket.helper'

const { t, te } = useI18n()

const props = defineProps({
  source: {
    type: Object as PropType<ProxyMock.ProxyRequestRecord>,
    required: true,
  },
})

// 相似度达到阈值才展示灰标，低相似度 miss 只会干扰列表
const missBadge = computed(() => {
  const score = Number(props.source?.mock?.miss?.score)
  return Number.isFinite(score) && score >= 0.6 ? Math.round(score * 100) : 0
})

const isStat = computed(() => props.source.type == ProxyMock.PorxyType.STATISTICS)
const isSocket = computed(() => props.source.type == ProxyMock.PorxyType.SOCKET)
const socket = computed(() => props.source as ProxyMock.SocketRecord)
const showLoading = computed(() => isSocket.value
  ? socket.value.wsPhase !== 'close'
  : props.source.type != ProxyMock.PorxyType.REQUEST_END && props.source.type != ProxyMock.PorxyType.STATISTICS)

const socketStatusText = computed(() => {
  const record = socket.value
  if (record.wsPhase !== 'close') return t('proxy.socket.connected')
  if (record.errorCode) return t('proxy.socket.failed')
  if (record.closeCode == null) return t('proxy.socket.closed')
  return t('proxy.socket.closeCodeShort', { code: record.closeCode })
})

const socketTagType = computed(() => {
  const record = socket.value
  if (record.wsPhase !== 'close') return 'success'
  if (record.errorCode) return 'danger'
  if (record.closeCode == null) return 'default'
  return record.closeCode === 1000 || record.closeCode === 1001 ? 'success' : 'danger'
})

const socketDuration = computed(() => {
  const record = socket.value
  if (record.wsPhase !== 'close') return t('proxy.socket.live')
  return formatDuration(record.time ?? 0)
})

const socketErrorTitle = computed(() => {
  const record = socket.value
  const code = record?.errorCode
  if (code == null) return ''
  const key = `proxy.socket.errors.${code}`
  const text = te(key) ? t(key) : ''
  return text === '' ? record.errorMessage : `${text}\n${record.errorMessage ?? ''}`.trim()
})

const recordStore = ProxyRecordStore()

</script>

<style scoped>
.item-timeline {
  position: absolute;
  width: 8px;
  height: 100%;
  left: 6px;
  top: 0;
  font-size: var(--van-font-size-xs);
  font-weight: bold;
  border-left: 2px dashed var(--van-gray-8);
  /* color: white; */
}

.item-timeline-dot {
  border-radius: 7px;
  border: 2px dashed;
  border-color: #2980b9;
  width: 10px;
  height: 10px;
  margin-top: 15px;
  margin-left: -8px;
}

.stat-snap-pid {
  max-width: 100px;
  font-size: var(--van-font-size-xs);
  color: #8c7ae6;
}

.stat-snap-eid {
  max-width: 100px;
  font-size: var(--van-font-size-xs);
  color: #e1b12c;
  margin-top: 5px;
}

.stat-snap-type {
  font-size: var(--van-font-size-xs);
  color: #d35400;
}

.request-snap-timecost {
  margin-left: 5px;
  font-size: var(--van-font-size-sm);
}

.timecost-value {
  display: inline-block;
  min-width: 3.2em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.request-snap-url {
  position: absolute;
  top: 10px;
  width: calc(100% - 55px);
  font-size: var(--van-font-size-md);
  font-weight: 500;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
}

/* WebSocket 目标按正向展示，域名和路径从左到右可读 */
.socket-snap-url {
  direction: ltr;
  text-align: left;
}

.socket-snap-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  width: 100%;
  margin-top: 25px;
  font-size: var(--van-font-size-xs);
  color: var(--van-text-color-3);
}

.socket-snap-io {
  font-variant-numeric: tabular-nums;
  color: var(--van-text-color-2);
}

.socket-snap-time {
  font-variant-numeric: tabular-nums;
}

.socket-snap-reason {
  max-width: 140px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.socket-snap-dropped {
  color: var(--van-warning-color);
}

.socket-snap-error {
  color: var(--van-danger-color);
  font-weight: 500;
}
</style>
