<template>
  <van-row class="full-row">
    <h3>Record video from webcam and transcode to mp4 (x264) and play!</h3>
    <van-row :gutter="20" class="full-row" style="height: 300px;">
      <van-col span="6">
        <video ref="webcam" width="320" height="240" :srcObject="stream" autoplay></video>
        <van-button id="record" :loading="isLoading" @click="onRecordClicked">{{ isRecording ? 'Stop' : 'Start' }}
        </van-button>
      </van-col>
      <van-col span="6">
        <video ref="outputVideo" width="320" height="240" :src="outputStream" controls></video>
        <van-button @click="transcode1">Start</van-button>

        <van-button @click="test">Test</van-button>
      </van-col>
    </van-row>
    <van-row class="full-row bg-border" style="height: calc(100% - 365px);">
      <p>{{ message }}</p>
    </van-row>
  </van-row>
</template>
<script lang="ts" setup>
import { createFFmpeg, fetchFile, FFmpeg } from '@ffmpeg/ffmpeg';
import { onMounted, ref, watch } from 'vue';
import { useCommonStore } from '../../store';

const commonStore = useCommonStore()
const isRecording = ref(false)
const isLoading = ref(false)
const message = ref<string>(null)

const stream = ref<MediaStream>(null)
const outputStream = ref<string>(null)
let ffmpeg = null as FFmpeg
let recorder = null as MediaRecorder
let chunks = []
let serverUrl = null as string
let video = ref(null)


onMounted(() => {
  initFFmpeg()
})


watch(() => commonStore.serverConfig, () => {
  initFFmpeg()
})

function test() {
  window.electronAPI.openGame({ name: 'liliput', url: 'https://www.electronjs.org/zh/docs/latest/api/ipc-renderer' })
}

async function initFFmpeg() {
  if (!Object.hasOwn(commonStore.serverConfig, 'ip') && !Object.hasOwn(commonStore.serverConfig, 'port')) return
  serverUrl = `${PROTOCOL}://${commonStore.serverConfig.ip}:${commonStore.serverConfig.port}`
  console.log(serverUrl)
  ffmpeg = createFFmpeg({
    log: true,
    corePath: `${serverUrl}/static/ffmpeg-core.js`,
    wasmPath: `${serverUrl}/static/ffmpeg-core.wasm`,
    workerPath: `${serverUrl}/static/ffmpeg-core.worker.js`
  })
  await ffmpeg.load()
}

async function onRecordClicked() {
  if (isRecording.value) {
    recorder.stop()
    isRecording.value = false
    stream.value.getVideoTracks()[0].stop()
    return
  }

  stream.value = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  recorder = new MediaRecorder(stream.value)
  chunks = []
  recorder.ondataavailable = (e: any) => chunks.push(e.data)
  recorder.onstop = async () => {
    let data = await new Blob(chunks).arrayBuffer()
    transcode(new Uint8Array(data))
  }
  recorder.start()
  isRecording.value = true
}

async function transcode(webcamData: any) {
  let name = './record.webm'
  message.value = 'Loading ffmpeg-core.js'
  message.value = 'Start transcoding'
  ffmpeg.FS('writeFile', name, await fetchFile(webcamData))
  await ffmpeg.run('-i', name, 'output.mp4')
  message.value = 'Complete transcoding'
  const data = ffmpeg.FS('readFile', 'output.mp4')
  outputStream.value = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }))
}

async function transcode1() {
  message.value = 'Start transcoding'
  ffmpeg.FS('writeFile', 'test.avi', await fetchFile(`${serverUrl}/static/flame.avi`))
  await ffmpeg.run("-i", "test.avi", "test.mp4")
  message.value = "Complete transcoding"
  const data = ffmpeg.FS("readFile", "test.mp4")
  outputStream.value = URL.createObjectURL(new Blob([data.buffer], { type: "video/mp4" }))
}

</script>
<style scoped>

</style>