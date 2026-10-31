<template>
  <van-form class="debug-panel" label-align="right" colon>
    <van-cell-group inset :title="$t('debug.common.title')">
      <van-cell :title="$t('debug.common.versionCheck')" clickable @click="toNew"></van-cell>
      <van-cell :title="$t('debug.common.devTools')" clickable @click="openDevTools"></van-cell>
    </van-cell-group>

    <van-cell-group inset title="Event Source">
      <van-cell title="trigger server notification" :label="sseData" is-link @click="onSSE"></van-cell>
    </van-cell-group>

    <van-cell-group inset title="HLS">
      <van-field center placeholder="HLS URL" label-width="3rem" v-model="streamUrl">
        <template #left-icon>
          <div style="display: flex; justify-content: center;">
            <van-icon class="iconfont icon-link" style="color: var(--van-gray-8)" />
            <div style="position: absolute; bottom: -5px; left: 0; font-size: 10px; color: red;">{{ bandwidth }}kbps
            </div>
          </div>
        </template>
        <template #button>
          <van-button size="small" type="primary" icon="play" @click="onHlsClick" :loading="playerLoading">
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
          <van-button plain size="small" type="primary" @click="openCamera">
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
  </van-form>
</template>

<script lang="ts" setup>
import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source'
import Hls from 'hls.js'
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { baseDomain, ProxyMock, broadcast } from '@shared'
import { CommonStore } from '../../store'

const commonStore = CommonStore()
const sseData = ref<string>('hello world')
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
let sseAbort: AbortController
let previewCtx: CanvasRenderingContext2D
let offscreenCtx: CanvasRenderingContext2D
let frames = 0

onMounted(async () => {

  window.addEventListener('beforeunload', closeCamera)

  previewCtx = preview.value.getContext('2d', { willReadFrequently: true })
  offscreenCtx = offscreen.value.getContext('2d', { willReadFrequently: true })

  previewCtx.imageSmoothingEnabled = true
  previewCtx.imageSmoothingQuality = 'high'

  initHls()
  await registerSSE()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', closeCamera)
  sseAbort?.abort()
  sseAbort = null
  stopHls()
  closeCamera()
})

watch(() => commonStore.showDebugPanel, (val) => {
  if (!val) {
    stopHls()
  } else {
    initHls()
  }
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

async function registerSSE() {
  sseAbort?.abort()
  const controller = new AbortController()
  sseAbort = controller

  try {
    await fetchEventSource(`${baseDomain()}/appmock/sse/${commonStore.uid}`, {
      headers: {
        'x-mock-uid': commonStore.uid
      },
      signal: controller.signal,
      async onopen(resp) {
        if (resp.ok && resp.headers.get('content-type') === EventStreamContentType) {
          return // everything's good
        } else if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
          // client-side errors are usually non-retriable:
          throw new Error('Fatal')
        } else {
          throw new Error('Retriable')
        }
      },
      onmessage(ev) {
        sseData.value = ev.data
      },
      onclose() {
        console.log('closed')
      },
      onerror(err) {
        console.log(err)
      },
    })
  } catch (err) {
    if (!controller.signal.aborted) console.warn('sse closed:', err)
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
  window.mainApi?.sendServerEvent()
  await broadcast(commonStore.uid)
}

</script>

<style scoped>
.drag-ball {
  position: absolute;
  z-index: 10003;
  right: 0;
  top: 70%;
  width: 2.5em;
  height: 2.5em;
  background: #e1e1e1aa;
  border-radius: 50%;
  overflow: hidden;
  box-shadow: 0px 0px 10px 2px skyblue;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}

.debug-panel {
  width: 100%;
  min-width: min(375px, 100vw);
  height: 100%;
  padding: 10px 0;
  background-color: var(--van-gray-1);
}

.debug-panel canvas {
  max-width: 100%;
  height: auto;
}
</style>
