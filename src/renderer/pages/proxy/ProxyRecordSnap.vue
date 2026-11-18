<template>
  <div class="list-row record-snap" :class="[{ 'is-selected': isCurrent, 'is-socket': isSocket }, `is-lv-${markLevel}`]"
    @click="recordStore.curRecordId = source.id">
    <!-- 长连接不是请求突发，时间线整列不画；缩进保留，URL 才和下面的 HTTP 行对在同一列 -->
    <div class="snap-timeline" v-if="!isSocket" v-tip="densityTip">
      <div class="snap-line snap-line-top" :class="{ 'is-solid': density?.joinTop }"></div>
      <div class="snap-timeline-dot"></div>
      <div class="snap-line snap-line-bottom" :class="{ 'is-solid': density?.joinBottom }"></div>
    </div>
    <!-- 段两端的时间戳浮在行自己的上留白带里：不占列宽，URL 不必为它让位；两枚都标在自己圆点的上方，
         相邻两段也不会把「起」「止」挤进同一条缝 -->
    <div v-if="segmentEdge" class="snap-seg-time num" v-tip="segmentEdge.tip">
      {{ segmentEdge.label }} {{ segmentEdge.time }}
    </div>
    <div class="snap-content">
      <div class="snap-url-row">
        <div class="snap-url truncate" v-tip="source.url">{{ source.url }}</div>
        <div class="snap-arrow">
          <van-loading size="18" color="var(--van-primary-color)" v-if="showLoading" />
          <van-icon v-else name="arrow" size="18" color="var(--van-text-color-3)" />
        </div>
      </div>
      <div class="snap-meta-row">
        <template v-if="isSocket">
          <van-tag :type="socketTagType">[WS] {{ socketStatusText }}</van-tag>
          <span class="snap-io num">
            <span><i class="iconfont dir-icon" :class="dirIcon('c2s')"></i> {{ formatBytes(socket.bytesSent) }}</span>
            <span><i class="iconfont dir-icon" :class="dirIcon('s2c')"></i> {{ formatBytes(socket.bytesReceived) }}</span>
          </span>
          <span class="snap-time num">{{ socketDuration }}</span>
          <van-tag v-if="socket.subprotocol" plain type="primary">{{ socket.subprotocol }}</van-tag>
          <span v-if="socket.closeReason" class="snap-reason truncate" v-tip="socket.closeReason">
            {{ socket.closeReason }}
          </span>
          <span v-if="(socket.droppedFrames ?? 0) > 0" class="snap-dropped">
            {{ $t('proxy.socket.dropped', { count: socket.droppedFrames }) }}
          </span>
          <span v-if="socket.errorCode" class="snap-error" v-tip="socketErrorTitle">{{ socket.errorCode }}</span>
        </template>
        <template v-else-if="isStat">
          <template v-for="(item, idx) in ((source as ProxyMock.ProxyStatRecord).statistics?.bps?.slice(0, 2) ?? [])"
            :key="idx">
            <span class="stat-pid">{{ item.pageId }}</span>
            <strong class="stat-type">[{{ item.event_id == 2001 ? "PV" : $t('proxy.statEvent') }}]</strong>
            <span class="stat-eid" v-if="item.event_id != 2001">{{ item.elementId == "" ? item.arg1 : item.elementId
            }}</span>
          </template>
        </template>
        <template v-else>
          <van-tag :type="methodTagType(source.method)" class="method-square">
            {{ source.method?.charAt(0) ?? '?' }}
          </van-tag>
          <van-tag plain :type="source.statusCode === 200 ? 'success' : 'danger'">
            {{ source.statusCode }}
          </van-tag>
          <van-tag v-if="source.responseData != null" plain
            :type="parseInt(source.responseData.code) === 2000 ? 'success' : 'warning'">
            {{ source.responseData.code }}
          </van-tag>
          <van-tag v-if="source.type == 5020" type="primary">{{ $t('proxy.statTag') }}</van-tag>
          <van-tag v-if="missBadge" plain type="default">{{ missBadge }}%</van-tag>
          <van-icon v-if="source.isMock" class="iconfont icon-shuiguan mock-icon" />
          <span class="snap-timecost num" :class="{ 'is-slow': (source.time ?? 0) > 500 }">
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
import { formatBytes, formatClock, formatElapsed } from '../../common/format'
import { methodTagType } from '../../common/tag'
import { dirIcon } from './socket'
import { DENSITY_GAP_MS, spanText, type DensityRow } from './density'

const { t, te } = useI18n()

const props = defineProps({
  source: {
    type: Object as PropType<ProxyMock.ProxyRequestRecord>,
    required: true,
  },
  // 波次密度与同组连线；长连接不计密，Proxy.vue 不给这一行传值
  density: {
    type: Object as PropType<DensityRow<ProxyMock.ProxyRequestRecord> | null>,
    default: null,
  },
  // 列表里上一行是不是长连接：段首的时间戳落在本行上留白，挨着 WS 行就会被读成 WS 的时间戳
  aboveSocket: {
    type: Boolean,
    default: false,
  },
})

const isCurrent = computed(() => recordStore.curRecordId == props.source.id)
const markLevel = computed(() => props.density?.mark.level ?? 0)

// 提示挂在整条时间线列上（比 10px 的圆点好命中）；长连接没有这一列，也就没有提示
const densityTip = computed(() => {
  const mark = props.density?.mark
  if (mark == null) return ''
  const main = mark.count > 1
    ? t('proxy.densityBucket', { count: mark.count, span: spanText(mark.span) })
    : t('proxy.densityLonely', { gap: spanText(DENSITY_GAP_MS) })
  return mark.dense ? `${main}\n${t('proxy.densityWarning')}` : main
})

// 一段只在链头（这一段最新的一条）和链尾（最早的一条）各报一次时间，中间行不重复
const segmentEdge = computed(() => {
  const row = props.density
  if (row == null) return null
  const latest = row.joinBottom && !row.joinTop && !props.aboveSocket
  const earliest = row.joinTop && !row.joinBottom
  if (!latest && !earliest) return null
  const time = formatClock(props.source.timestamp)
  if (time === '') return null
  return latest
    ? { head: true, label: t('proxy.densityTo'), time, tip: t('proxy.densityToTip', { time }) }
    : { head: false, label: t('proxy.densityFrom'), time, tip: t('proxy.densityFromTip', { time }) }
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
  /* 段端时间戳是绝对定位浮层，锚点必须是行自己 */
  position: relative;
  display: flex;
  align-items: flex-start;
  border-bottom: 1px solid var(--van-border-color);
  transition: background-color 0.2s;

  /* 桶密度档位色单源：圆点与组内连线都读这一个变量，取值由行根节点的 is-lv-N 决定；
     根上这条本身就是 1 档（低频）的 default 灰，所以下面只覆盖 2、3 档 */
  --snap-mark-color: var(--van-gray-5);
  /* 圆点对准 URL 那一行：URL 行的行盒由 .snap-arrow 的定高方格撑出来（比文字本身高），
     所以取「内容上内边距 + 方格的一半」再减去圆点半径，字号缩放时两边一起走。 */
  --snap-arrow-box: 22px;
  --snap-timeline-width: 20px;
  /* 行的上下留白单源：`.snap-content` 的内边距、圆点定位、段端时间戳那条带子都读它，
     改这一个数就整体收紧，不会把圆点和时间戳留在旧留白上 */
  --snap-pad-y: var(--app-sp-lg);
  --snap-mark-size: calc(var(--van-font-size-md) * 0.8);
  --snap-mark-top: calc(var(--snap-pad-y) + var(--snap-arrow-box) / 2 - var(--snap-mark-size) / 2);
}

/* Vant 语义三档：低频 = default 灰（就是根上那条，不另写一档），正常 = success，密集 = warning。
   0 档（缺时间戳）落在同一枚灰上；长连接整列不画，用不到这些。 */
.record-snap.is-lv-2 {
  --snap-mark-color: var(--van-success-color);
}

.record-snap.is-lv-3 {
  --snap-mark-color: var(--van-warning-color);
}

/* 选中态与 hover 都读 global.css 的 .list-row（只剩淡主色底，左缘色条 2026-11-18 已删）。 */

/* 纵向留白从行上挪到内容列：时间线列要撑满整行，连线才能在行间不断开 */
.snap-timeline {
  position: relative;
  width: var(--snap-timeline-width);
  align-self: stretch;
  flex-shrink: 0;
}

/* 连线分上下两段，各自止于圆点边缘：圆点是 alpha 填充，线从它底下穿过会透出 2px 灰痕 */
.snap-line {
  position: absolute;
  left: calc(50% - 1px);
  width: 2px;
  background-image: repeating-linear-gradient(to bottom, var(--van-gray-6) 0 4px, transparent 4px 8px);
}

.snap-line-top {
  top: 0;
  height: var(--snap-mark-top);
}

.snap-line-bottom {
  top: calc(var(--snap-mark-top) + var(--snap-mark-size));
  bottom: 0;
}

/* 同波且相邻：虚线换成这一组的色阶，串成一条实线 */
.snap-line.is-solid {
  background-image: none;
  background-color: var(--snap-mark-color);
}

.snap-timeline-dot {
  position: absolute;
  left: calc(50% - var(--snap-mark-size) / 2);
  top: var(--snap-mark-top);
  width: var(--snap-mark-size);
  height: var(--snap-mark-size);
  border-radius: 50%;
  background-color: var(--snap-mark-color);
  z-index: 1;
}

/* 时间戳浮在层上：落在行自己的上留白带里（`.snap-content` 的 `--snap-pad-y` 内边距），
   带子里没有文字，所以既不占列宽也不用底色去遮谁。
   「止」（段的上端）和「起」（段的下端）都用 top，各标在自己圆点上方——放段尾下留白时，
   相邻两段的起/止会叠进同一条缝，读起来像同一时刻的两个标签。
   line-height:1 是为了把文字塞进那条带子（带子高 = --snap-pad-y，md14 时 8.4px，比 xs 字还矮一点，
   溢出的两三像素吃的是 URL 行方格与文字之间的空档）；等宽数字避免时刻抖动。
   类名要和长连接时长那枚 `.snap-time` 分开，否则绝对定位会把 WS 的时长从 meta 行里抽走。 */
.snap-seg-time {
  position: absolute;
  z-index: 2;
  top: 1px;
  left: var(--snap-timeline-width);
  font-size: var(--van-font-size-xs);
  line-height: 1;
  white-space: nowrap;
  color: var(--van-text-color-2);
}

.snap-content {
  flex: 1;
  min-width: 0;
  margin-left: var(--app-sp-xl);
  padding: var(--snap-pad-y) 0;
}

/* 长连接那一行没有时间线列，缩进要自己补回 20px，否则 URL 比 HTTP 行靠左一整列 */
.record-snap.is-socket .snap-content {
  margin-left: calc(var(--snap-timeline-width) + var(--app-sp-xl));
}

.snap-url-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--app-sp-lg);
  margin-bottom: var(--app-sp-sm);
}

.snap-url {
  flex: 1;
  min-width: 0;
  font-size: var(--van-font-size-md);
  font-weight: 500;
  color: var(--van-text-color);
  direction: ltr;
  text-align: left;
}

.snap-arrow {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--snap-arrow-box);
  height: var(--snap-arrow-box);
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

/* 收发字节：图标与数值成一组，两组之间留一档沟道——换成图标后文字间不再有 ↑↓ 那点自带空隙 */
.snap-io {
  display: inline-flex;
  align-items: center;
  gap: var(--app-sp-sm);
  color: var(--van-text-color-2);
}

.snap-timecost {
  color: var(--van-success-color);
}

.snap-timecost.is-slow {
  color: var(--van-danger-color);
}

.snap-reason {
  max-width: 120px;
}

.snap-dropped {
  color: var(--van-warning-color);
}

.snap-error {
  color: var(--van-danger-color);
  font-weight: 500;
}

.mock-icon {
  /* 写死 14px；1.1 档在默认字号下 14.3px，随行内其余信息一起缩放 */
  font-size: calc(var(--van-font-size-md) * 1.1);
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
