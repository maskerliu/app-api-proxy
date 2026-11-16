<template>
  <van-cell-group class="debug-panel" label-align="right" colon>
    <van-cell-group inset :title="$t('debug.common.title')">
      <van-cell :title="$t('debug.common.devTools')" clickable @click="openDevTools"></van-cell>
    </van-cell-group>

    <van-cell-group inset title="Event Source">
      <van-cell title="stream" :label="sseDetail">
        <template #value>
          <van-tag :type="sseTagType">{{ sseStatus }}</van-tag>
        </template>
      </van-cell>

      <van-cell center title="demo push" :label="sseReply">
        <template #right-icon>
          <div class="sse-actions">
            <van-button size="mini" plain type="primary" :disabled="!sseConnected" @click="runSse(ssePush)">
              direct
            </van-button>
            <van-button size="mini" plain type="primary" :disabled="!sseConnected"
              @click="runSse(sseBroadcast)">broadcast</van-button>
          </div>
        </template>
      </van-cell>

      <van-cell title="last event" :value="sseEventHead">
        <template #label>
          <div class="sse-payload">{{ sseData }}</div>
        </template>
      </van-cell>
    </van-cell-group>

    <van-cell-group inset title="HLS">
      <van-field center placeholder="HLS URL" label-width="3.7em" v-model="streamUrl">
        <template #left-icon>
          <div style="display: flex; justify-content: center;">
            <van-icon class="iconfont icon-link" style="color: var(--van-gray-8)" />
            <div style="position: absolute; bottom: -5px; left: 0; font-size: var(--van-font-size-xs); color: var(--van-danger-color);">{{ bandwidth }}kbps
            </div>
          </div>
        </template>
        <template #button>
          <van-button class="btn-icon-only" size="small" type="primary" icon="play" @click="onHlsClick" :loading="playerLoading">
            <template #icon>
              <van-icon class="iconfont" :class="playerStatus ? 'icon-player-pause' : 'icon-player-play'"
                style="color: var(--van-gray-8)" />
            </template>
          </van-button>
        </template>
      </van-field>
      <video ref="hlsPlayer" width="100%" height="100px" controls></video>
    </van-cell-group>
  </van-cell-group>
</template>

<script lang="ts" setup>
import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source'
import Hls from 'hls.js'
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { baseDomain, sseBroadcast, ssePush } from '@shared'
import { API_URL } from '@shared/api.const'
import { MOCK_UID_HEADER } from '@shared/http-header'
import { CommonStore } from '../../store'

const commonStore = CommonStore()
const sseData = ref<string>('')
const sseStatus = ref<string>('idle')
const sseReply = ref<string>('')
const sseEvents = ref<number>(0)
const sseOpens = ref<number>(0)
const sseEventId = ref<string>('')
const sseEventName = ref<string>('')
const sseConnected = computed(() => sseStatus.value === 'connected')
const sseDetail = computed(() => `uid ${commonStore.uid || '-'} · events ${sseEvents.value} · conns ${sseOpens.value}`)
const sseEventHead = computed(() => sseEventName.value
  ? `${sseEventId.value ? `#${sseEventId.value} ` : ''}${sseEventName.value}`
  : '')
const sseTagType = computed<'default' | 'primary' | 'success' | 'warning' | 'danger'>(() => {
  switch (sseStatus.value) {
    case 'connected': return 'success'
    case 'connecting':
    case 'reconnecting': return 'warning'
    case 'error': return 'danger'
    default: return 'default'
  }
})
const playerStatus = ref<boolean>(false)
const playerLoading = ref<boolean>(false)
const streamUrl = ref<string>('https://iovliveplay.radio.cn/fm/1600000001173.m3u8')
const bandwidth = ref<string>('0')

const hlsPlayer = useTemplateRef<HTMLMediaElement>('hlsPlayer')

let hls: Hls
let timer: any
let sseAbort: AbortController | null = null

onMounted(async () => {
  if (!commonStore.showDebugPanel) return
  initHls()
  await registerSSE()
})

onBeforeUnmount(() => {
  stopSSE()
  stopHls()
})

watch(() => commonStore.showDebugPanel, (val) => {
  if (!val) {
    stopHls()
    stopSSE()
  } else {
    initHls()
    registerSSE()
  }
})

// 推送连接重连后服务端会分配新 uid，SSE 需要跟着重新订阅
watch(() => commonStore.uid, (uid) => {
  if (commonStore.showDebugPanel && uid) registerSSE()
})

function initHls() {
  if (hls != null) return

  const instance = new Hls({ maxBufferLength: 30 })
  hls = instance

  if (timer == null) {
    timer = setInterval(() => {
      bandwidth.value = ((hls?.bandwidthEstimate ?? 0) % 1000).toFixed(2)
    }, 1000)
  }

  instance.on(Hls.Events.MANIFEST_PARSED, function () {
    if (hls !== instance) return
    hlsPlayer.value?.play()
  })

  instance.on(Hls.Events.ERROR, function (event, data) {
    if (hls !== instance) return
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        console.log('network error', event)
        instance.startLoad()
        break
      case Hls.ErrorTypes.MEDIA_ERROR:
        console.log('media error', event)
        instance.recoverMediaError()
        break
      default:
        console.log('other error', event)
        instance.destroy()
        if (hls === instance) hls = null
        break
    }
  })

  instance.on(Hls.Events.BUFFER_EOS, function (event, data) {
    if (hls !== instance) return
    console.log('buffer eos', event)
    instance.startLoad()
  })

  instance.on(Hls.Events.BUFFER_FLUSHED, function (event, data) {
    console.log('buffer flushed', event)
  })
}

function stopHls() {
  hlsPlayer.value?.pause()
  hls?.stopLoad()
  hls?.destroy()
  hls = null
  if (timer != null) {
    clearInterval(timer)
    timer = null
  }
}

function stopSSE() {
  sseAbort?.abort()
  sseAbort = null
}

async function registerSSE() {
  const uid = commonStore.uid
  if (!uid) {
    sseStatus.value = 'waiting uid'
    return
  }

  stopSSE()
  const controller = new AbortController()
  sseAbort = controller
  sseStatus.value = 'connecting'
  // 计数描述的是本次订阅：重新订阅清零，库内部的自动重连才会累加到 conns
  sseReply.value = ''
  sseEvents.value = 0
  sseOpens.value = 0
  sseEventId.value = ''
  sseEventName.value = ''
  sseData.value = ''

  try {
    await fetchEventSource(`${baseDomain()}${API_URL.Sse}/${uid}`, {
      headers: {
        accept: EventStreamContentType,
        [MOCK_UID_HEADER]: uid
      },
      signal: controller.signal,
      // 调试面板关闭时才需要断开，窗口隐藏/最小化时保持连接
      openWhenHidden: true,
      async onopen(resp) {
        if (controller.signal.aborted) return
        const contentType = resp.headers.get('content-type') ?? ''
        if (resp.ok && contentType.startsWith(EventStreamContentType)) {
          sseStatus.value = 'connected'
          sseOpens.value++
          return
        }
        // 4xx（429 除外）属于客户端错误，重试也不会成功
        if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
          throw new Error(`fatal: ${resp.status}`)
        }
        throw new Error(`retriable: ${resp.status}`)
      },
      onmessage(ev) {
        if (controller.signal.aborted) return
        // 握手帧（只有 retry:）也会走 onmessage，按规范没有 data 就不该计入事件
        if (!ev.data) return
        sseEvents.value++
        sseEventId.value = ev.id
        sseEventName.value = ev.event || 'message'
        sseData.value = ev.data
      },
      onclose() {
        // 服务端主动结束流时按断线处理，交给 onerror 触发重连
        throw new Error('retriable: closed')
      },
      onerror(err) {
        if (controller.signal.aborted) return
        // 不可重试的错误向上抛出，终止本次订阅
        if (err instanceof Error && err.message.startsWith('fatal')) throw err
        sseStatus.value = 'reconnecting'
      }
    })
  } catch (err: any) {
    if (controller.signal.aborted) return
    sseStatus.value = 'error'
    sseData.value = String(err?.message ?? err)
    console.warn('sse closed:', err)
  } finally {
    // 已被更新的订阅替换时不要清理新连接的 controller
    if (sseAbort === controller) sseAbort = null
  }
}

function onHlsClick() {

  if (playerStatus.value) {
    playerStatus.value = false
    hlsPlayer.value?.pause()
    hls?.stopLoad()
    if (timer != null) {
      clearInterval(timer)
      timer = null
    }
  } else {
    initHls()
    if (timer == null) {
      timer = setInterval(() => {
        bandwidth.value = ((hls?.bandwidthEstimate ?? 0) % 1000).toFixed(2)
      }, 1000)
    }
    playerStatus.value = true
    if (Hls.isSupported()) {
      hls.loadSource(streamUrl.value)
      hls.attachMedia(hlsPlayer.value)
    } else if (hlsPlayer.value.canPlayType('application/vnd.apple.mpegurl')) {
      hlsPlayer.value.src = streamUrl.value
    }
  }
}

function openDevTools() {
  window.mainApi?.openDevTools()
  commonStore.showDebugPanel = false
}

// 演示动作只回显服务端的判断，效果本身在流上看得见
async function runSse(action: (uid: string) => Promise<string>) {
  const uid = commonStore.uid
  if (!uid) return
  try {
    sseReply.value = await action(uid)
  } catch (err: any) {
    sseReply.value = String(err?.message ?? err)
  }
}

</script>

<style scoped>
.debug-panel {
  box-sizing: border-box;
  width: 100%;
  min-width: min(375px, 100vw);
  height: 100vh;
  height: 100dvh;
  padding: var(--app-sp-xl) 0;
  background-color: var(--van-gray-1);
}

.sse-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--app-sp-md);
  white-space: nowrap;
}

.sse-payload {
  font-family: var(--app-mono-font);
  word-break: break-all;
}
</style>
