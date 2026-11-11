<template>
  <van-cell-group class="debug-panel" label-align="right" colon>
    <van-cell-group inset :title="$t('debug.common.title')">
      <van-cell :title="$t('debug.common.versionCheck')" clickable @click="toNew"></van-cell>
      <van-cell :title="$t('debug.common.devTools')" clickable @click="openDevTools"></van-cell>
    </van-cell-group>

    <van-cell-group inset title="Event Source">
      <van-cell title="trigger server notification" :label="sseLabel" is-link @click="onSSE"></van-cell>
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

    <van-cell-group inset title="Camera" style="text-align: center;">
      <van-cell title="OpenCV">
        <template #right-icon>
          <van-button class="btn-icon-only" plain size="small" type="primary" @click="openCamera">
            <template #icon>
              <van-icon class="iconfont icon-camera" style="color: var(--van-gray-8)" />
            </template>
          </van-button>
        </template>
      </van-cell>
      <canvas ref="preview"></canvas>
      <canvas ref="offscreen" style="display: none;"></canvas>
      <video ref="preVideo" autoplay style="display: none;"></video>
    </van-cell-group>
  </van-cell-group>
</template>

<script lang="ts" setup>
import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source'
import Hls from 'hls.js'
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { baseDomain, broadcast } from '@shared'
import { API_URL } from '@shared/api.const'
import { MOCK_UID_HEADER } from '@shared/http-header'
import { CommonStore } from '../../store'

const commonStore = CommonStore()
const sseData = ref<string>('')
const sseStatus = ref<string>('idle')
const sseLabel = computed(() => sseData.value ? `${sseStatus.value} | ${sseData.value}` : sseStatus.value)
const playerStatus = ref<boolean>(false)
const playerLoading = ref<boolean>(false)
const streamUrl = ref<string>('https://iovliveplay.radio.cn/fm/1600000001173.m3u8')
const bandwidth = ref<string>('0')

const hlsPlayer = useTemplateRef<HTMLMediaElement>('hlsPlayer')
const preVideo = useTemplateRef<HTMLVideoElement>('preVideo')
const preview = useTemplateRef<HTMLCanvasElement>('preview')
const offscreen = useTemplateRef<HTMLCanvasElement>('offscreen')

let hls: Hls
let timer: any
let animationId: number
let sseAbort: AbortController | null = null
let previewCtx: CanvasRenderingContext2D
let offscreenCtx: CanvasRenderingContext2D
let frames = 0

onMounted(async () => {

  window.addEventListener('beforeunload', closeCamera)

  previewCtx = preview.value.getContext('2d', { willReadFrequently: true })
  offscreenCtx = offscreen.value.getContext('2d', { willReadFrequently: true })

  previewCtx.imageSmoothingEnabled = true
  previewCtx.imageSmoothingQuality = 'high'

  if (!commonStore.showDebugPanel) return
  initHls()
  await registerSSE()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', closeCamera)
  stopSSE()
  stopHls()
  closeCamera()
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
        sseData.value = ev.event && ev.event !== 'message' ? `[${ev.event}] ${ev.data}` : ev.data
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

function toNew() {
  alert('去新版')
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


function processFrame() {
  if (preVideo.value == null) return
  if (preVideo.value.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) return

  offscreen.value.width = preview.value.width = preVideo.value.videoWidth * 0.5
  offscreen.value.height = preview.value.height = preVideo.value.videoHeight * 0.5

  offscreenCtx.drawImage(preVideo.value, 0, 0, offscreen.value.width, offscreen.value.height)

  const imageData = offscreenCtx.getImageData(0, 0, offscreen.value.width, offscreen.value.height)

  if (frames < 3) frames++
  else {
    frames = 0

  }
  offscreenCtx.putImageData(imageData, 0, 0)
  previewCtx.drawImage(offscreen.value, 0, 0, imageData.width, imageData.height, 0, 0, imageData.width, imageData.height)

  previewCtx.scale(-1, 1)
}

async function openCamera() {
  if (window.isWeb) return

  if (preVideo.value.srcObject) {
    previewCtx.clearRect(0, 0, preview.value.width, preview.value.height)
    offscreenCtx.clearRect(0, 0, offscreen.value.width, offscreen.value.height)
    closeCamera()
    preVideo.value.srcObject = null
    return
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true })
    preVideo.value.srcObject = stream

    animationId = requestAnimationFrame(function loop() {
      processFrame()
      animationId = requestAnimationFrame(loop)
    })
  } catch (e) {
    console.error(e)
  }
}

async function closeCamera() {
  if (animationId) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
  if (preVideo.value?.srcObject) {
    (preVideo.value.srcObject as MediaStream).getTracks().forEach(track => track.stop())
    preVideo.value.srcObject = null
  }
}

function openDevTools() {
  window.mainApi?.openDevTools()
  commonStore.showDebugPanel = false
}

async function onSSE() {
  if (!commonStore.uid) return
  window.mainApi?.sendServerEvent()
  try {
    await broadcast(commonStore.uid)
  } catch (err) {
    console.warn('broadcast failed:', err)
  }
}

</script>

<style scoped>
.debug-panel {
  width: 100%;
  min-width: min(375px, 100vw);
  height: 100%;
  padding: var(--app-sp-xl) 0;
  background-color: var(--van-gray-1);
}

.debug-panel canvas {
  max-width: 100%;
  height: auto;
}
</style>
