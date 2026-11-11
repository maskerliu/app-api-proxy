<template>
  <div class="record-snap" :class="{ 'is-selected': recordStore.curRecordId == source.id }"
    @click="recordStore.curRecordId = source.id">
    <div class="snap-timeline">
      <div class="snap-timeline-dot"
        :style="{ borderColor: source.timelineColor, backgroundColor: recordStore.curRecordId == source.id ? 'var(--van-text-color)' : 'transparent' }">
      </div>
    </div>
    <div class="snap-content">
      <div class="snap-url-row">
        <div class="snap-url" :title="source.url">{{ source.url }}</div>
        <div class="snap-arrow">
          <van-loading size="18" color="var(--van-primary-color)" v-if="showLoading" />
          <van-icon v-else name="arrow" size="18" color="var(--van-text-color-3)" />
        </div>
      </div>
      <div class="snap-meta-row">
        <template v-if="isSocket">
          <van-tag :type="socketTagType">[WS] {{ socketStatusText }}</van-tag>
          <span class="snap-io">↑{{ formatBytes(socket.bytesSent) }} ↓{{ formatBytes(socket.bytesReceived) }}</span>
          <span class="snap-time">{{ socketDuration }}</span>
          <van-tag v-if="socket.subprotocol" plain type="primary">{{ socket.subprotocol }}</van-tag>
          <span v-if="socket.closeReason" class="snap-reason" :title="socket.closeReason">
            {{ socket.closeReason }}
          </span>
          <span v-if="(socket.droppedFrames ?? 0) > 0" class="snap-dropped">
            {{ $t('proxy.socket.dropped', { count: socket.droppedFrames }) }}
          </span>
          <span v-if="socket.errorCode" class="snap-error" :title="socketErrorTitle">{{ socket.errorCode }}</span>
        </template>
        <template v-else-if="isStat">
          <template v-for="(item, idx) in ((source as ProxyMock.ProxyStatRecord).statistics?.bps?.slice(0, 2) ?? [])"
            :key="idx">
            <span class="stat-pid">{{ item.pageId }}</span>
            <strong class="stat-type">[{{ item.event_id == 2001 ? "PV" : "事件" }}]</strong>
            <span class="stat-eid" v-if="item.event_id != 2001">{{ item.elementId == "" ? item.arg1 : item.elementId
            }}</span>
          </template>
        </template>
        <template v-else>
          <van-tag :type="source.method == 'POST' ? 'success' : 'warning'" class="method-tag">
            {{ source.method?.charAt(0) ?? '?' }}
          </van-tag>
          <van-tag plain :type="source.statusCode === 200 ? 'success' : 'danger'">
            {{ source.statusCode }}
          </van-tag>
          <van-tag v-if="source.responseData != null" plain
            :type="parseInt(source.responseData.code) === 2000 ? 'success' : 'warning'">
            {{ source.responseData.code }}
          </van-tag>
          <van-tag v-if="source.type == 5020" type="primary">打点</van-tag>
          <van-tag v-if="missBadge" plain type="default">{{ missBadge }}%</van-tag>
          <van-icon v-if="source.isMock" class="iconfont icon-shuiguan mock-icon" />
          <span class="snap-timecost" :class="{ 'is-slow': (source.time ?? 0) > 500 }">
            {{ source.time != null ? source.time : '-----' }}ms
          </span>
        </template>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ProxyMock } from '@shared'
import type { PropType } from 'vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ProxyRecordStore } from '../../store'
import { formatBytes, formatElapsed } from '../../common/format'

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

const isStat = computed(() => props.source.type == ProxyMock.ProxyType.STATISTICS)
const isSocket = computed(() => props.source.type == ProxyMock.ProxyType.SOCKET)
const socket = computed(() => props.source as ProxyMock.SocketRecord)
const showLoading = computed(() => isSocket.value
  ? socket.value.wsPhase === 'open'
  : props.source.type != ProxyMock.ProxyType.REQUEST_END && props.source.type != ProxyMock.ProxyType.STATISTICS)

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
  return formatElapsed(record.time ?? 0)
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
.record-snap {
  display: flex;
  align-items: flex-start;
  padding: var(--app-sp-xl) 0;
  cursor: pointer;
  border-bottom: 1px solid var(--van-border-color);
  transition: background-color 0.2s;
}

.record-snap:hover {
  background-color: var(--van-hover-color);
}

.record-snap.is-selected {
  background-color: var(--van-active-color);
}

.snap-timeline {
  position: relative;
  width: 20px;
  height: 100%;
  flex-shrink: 0;
}

.snap-timeline::before {
  content: '';
  position: absolute;
  left: 9px;
  top: 0;
  bottom: 0;
  width: 2px;
  border-left: 2px dashed var(--van-gray-6);
}

.snap-timeline-dot {
  position: absolute;
  left: 5px;
  top: 12px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--van-primary-color);
  background-color: transparent;
  z-index: 1;
}

.snap-content {
  flex: 1;
  min-width: 0;
  margin-left: var(--app-sp-xl);
}

.snap-url-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--app-sp-lg);
  margin-bottom: var(--app-sp-md);
}

.snap-url {
  flex: 1;
  min-width: 0;
  font-size: var(--van-font-size-md);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: ltr;
  text-align: left;
}

.snap-arrow {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.snap-meta-row {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: var(--app-sp-md);
  font-size: var(--van-font-size-xs);
  color: var(--van-text-color-3);
  overflow: hidden;
}

.snap-meta-row>* {
  flex-shrink: 0;
}

.snap-io {
  font-variant-numeric: tabular-nums;
  color: var(--van-text-color-2);
}

.snap-time {
  font-variant-numeric: tabular-nums;
}

.snap-timecost {
  font-variant-numeric: tabular-nums;
  color: var(--van-success-color);
}

.snap-timecost.is-slow {
  color: var(--van-danger-color);
}

.snap-reason {
  max-width: 120px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.snap-dropped {
  color: var(--van-warning-color);
}

.snap-error {
  color: var(--van-danger-color);
  font-weight: 500;
}

.method-tag {
  font-weight: 700;
  font-size: var(--app-method-square-font);
  min-width: var(--app-method-square);
  height: var(--app-method-square);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
}

.mock-icon {
  font-size: 14px;
  color: var(--van-warning-color);
  font-weight: bold;
}

.stat-pid {
  color: var(--van-primary-color);
}

.stat-type {
  color: var(--van-danger-color);
  margin: 0 var(--app-sp-xs);
}

.stat-eid {
  color: var(--van-warning-color);
}
</style>
