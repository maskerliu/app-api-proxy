<template>
  <div style="width: 375px; height: 100vh; overflow: hidden auto;">
    <van-form class="full-row" style="width: 100%; min-width: 375px; padding: 15px 0; " label-align="right" colon>
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
    </van-form>
  </div>
</template>

<script lang="ts" setup>
import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source'
import Hls from 'hls.js'
import { inject, onMounted, Ref, ref, useTemplateRef, watch } from 'vue'
import { baseDomain, ProxyMock } from '../../../common'
import { CommonStore } from '../../store'

const commonStore = CommonStore()
const showDebugPanel = inject<Ref<boolean>>('showDebugPanel')
const sseData = ref<string>('hello world')
const playerStatus = ref<boolean>(false)
const playerLoading = ref<boolean>(false)
const streamUrl = ref<string>('https://iovliveplay.radio.cn/fm/1600000001173.m3u8')

const bandwidth = ref<string>('0')
const hlsPlayer = useTemplateRef<HTMLMediaElement>('hlsPlayer')
let hls: Hls
let timer: any

onMounted(async () => {
  await registerSSE()

  if (hls == null) hls = new Hls()

  console.log('init hls')
})

watch(showDebugPanel, (val, old) => {
  if (!val) {
    hlsPlayer.value.pause()
    hls?.stopLoad()
    hls?.destroy()
  } else {
    initHls()
  }
})

function initHls() {
  if (hls != null) return

  hls = new Hls({ maxBufferLength: 30 })

  timer = setInterval(() => {
    bandwidth.value = (hls?.bandwidthEstimate % 1000 || 0).toFixed(2)
  }, 1000)

  hls.on(Hls.Events.MANIFEST_PARSED, function () {
    hlsPlayer.value.play()
  })

  hls.on(Hls.Events.ERROR, function (event, data) {
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        console.log('network error', event)
        hls.startLoad()
        break
      case Hls.ErrorTypes.MEDIA_ERROR:
        console.log('media error', event)
        hls.recoverMediaError()
        break
      default:
        hls.destroy()
        console.log('other error', event)
        break
    }
  })

  hls.on(Hls.Events.BUFFER_EOS, function (event, data) {
    console.log('buffer eos', event)
    hls.startLoad()
  })

  // hls.on(Hls.Events.BUFFER_APPENDED, function (event, data) {
  //   console.log('buffer appended', event, data)
  // })

  hls.on(Hls.Events.BUFFER_FLUSHED, function (event, data) {
    console.log('buffer flushed', event)
  })
}

async function registerSSE() {
  await fetchEventSource(`${baseDomain()}/appmock/sse/${commonStore.uid}`, {
    headers: {
      'x-mock-uid': commonStore.uid
    },
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
}

function toNew() {
  alert('去新版')
}


function onHlsClick() {

  if (playerStatus.value) {
    playerStatus.value = false
    hlsPlayer.value.pause()
    hls?.stopLoad()
    clearTimeout(timer)
  } else {
    timer = setInterval(() => {
      bandwidth.value = (hls?.bandwidthEstimate % 1000 || 0).toFixed(2)
    }, 1000)
    playerStatus.value = true
    if (Hls.isSupported()) {
      hls?.loadSource(streamUrl.value)
      hls?.attachMedia(hlsPlayer.value)
      // hls.on(Hls.Events.MANIFEST_PARSED, function () {
      //   hlsPlayer.value.play()
      // })


      // hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function (event, data) {
      //   console.log('lists has been updated', event, data)
      // })

      // hls.on(Hls.Events.AUDIO_TRACK_LOADING, function (event, data) {
      //   console.log('audio track  loading starts', event, data)
      // })

      // hls.on(Hls.Events.AUDIO_TRACK_LOADED, function (event, data) {
      //   console.log('audio track  loading completed', event, data)
      // })


      // hls.on(Hls.Events.FRAG_LOADING, function (event, data) {
      //   console.log('frag loading starts', event, data)
      // })

      // hls.on(Hls.Events.FRAG_LOADED, function (event, data) {
      //   console.log('frag loading completed', event, data)
      // })

      // hls.on(Hls.Events.FRAG_PARSED, function (event, data) {
      //   console.log('frag parsed', event, data)
      // })

      // hls.on(Hls.Events.FRAG_BUFFERED, function (event, data) {
      //   console.log('frag buffered', event, data)
      // })

      // hls.on(Hls.Events.FRAG_CHANGED, function (event, data) {
      //   console.log('frag changed', event, data)
      // })


    } else if (hlsPlayer.value.canPlayType('application/vnd.apple.mpegurl')) {
      hlsPlayer.value.src = streamUrl.value
    }
  }
}

function openDevTools() {
  if (!__IS_WEB__) {
    window.electronAPI.openDevTools()
    showDebugPanel.value = false
  }
}

async function onSSE() {
  if (!__IS_WEB__) {
    window.electronAPI.sendServerEvent()
  }

  await ProxyMock.broadcast(commonStore.uid)
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
</style>
