<template>
  <div class="inspector-panel bg-border" ref="inspectorPanel">
    <div class="inspector-row request-path">
      <span class="request-url">
        <b>[Path] </b> {{ record.url }}<br />
        <span style="font-size: 0.7rem; font-weight: normal">
          {{ apiDesc }}
        </span>
      </span>
      <van-button style="margin: 0 5px" plain size="small" type="success" icon="description" @click="copyLink" />
      <van-button style="margin: 0 5px" plain size="small" type="primary" icon="bookmark-o" @click="addToMockRule" />
    </div>
    <div class="inspector-row" style="margin-top: 70px; padding-bottom: 5px">
      <h3>{{ $t('proxy.requestHeader') }}</h3>
      <!-- <json-viewer style="margin-top: 50px" :closed="true" :data="record.headers == null ? {} : record.headers">
      </json-viewer> -->
      <vue-json-pretty :show-icon="true" theme="light" :deep="0" style="margin-top: 50px; padding: 0 15px;"
        :data="record.requestData == null ? {} : record.requestData" />
    </div>
    <div class="inspector-row" style="padding-bottom: 15x">
      <h3>{{ $t('proxy.requestParams') }}</h3>
      <!-- <json-viewer style="margin-top: 50px" :data="record.requestData == null ? {} : record.requestData"></json-viewer> -->
      <vue-json-pretty :show-icon="true" theme="light" :deep="0" style="margin-top: 50px; padding: 0 15px;"
        :data="record.requestData == null ? {} : record.requestData" />

    </div>
    <div class="inspector-row" style="padding-bottom: 5px">
      <h3>{{ $t('proxy.responseHeader') }}</h3>
      <!-- <json-viewer style="margin-top: 50px" :closed="true"
        :data="record.responseHeaders == null ? {} : record.responseHeaders"></json-viewer> -->
      <vue-json-pretty :show-icon="true" theme="light" :deep="0" style="margin-top: 50px; padding: 0 15px;"
        :data="record.responseHeaders == null ? {} : record.responseHeaders" />
    </div>
    <div class="inspector-row" style="height: calc(100% - 65px)" ref="respDataDiv">
      <h3>{{ $t('proxy.responseBody') }}</h3>
      <!-- <json-viewer style="margin-top: 50px; height: calc(100% - 105px)"
        :data="record.responseData == null ? {} : record.responseData" :deep="5">
      </json-viewer> -->
      <vue-json-pretty :show-icon="true" theme="light" :show-line-number="true"
        style="margin-top: 50px; padding: 0 15px; height: calc(100% - 105px)"
        :data="record.responseData == null ? {} : record.responseData">

        <template #renderNodeValue="{ node, defaultValue }">
          <template v-if="typeof node.content === 'string' && node.content.startsWith('https://')">
            <a :href="node.content" target="_blank">{{ node.content }}</a>
          </template>
          <template v-else>{{ defaultValue }}</template>
        </template>
      </vue-json-pretty>
    </div>

    <van-dialog title="预览" :show="showPreview" top="100px">
      <img style="max-width: 100%; max-height: 60vh; border-radius: 8px" :src="curImgSrc" v-show="!!curImgSrc" />
      <audio id="audioPlayer" style="width: 100%; max-width: 100%; max-height: 60vh" :src="curAudioSrc" controls="true"
        v-show="!!curAudioSrc"></audio>
      <video style="max-width: 100%; max-height: 60vh; object-fit: contain" :src="curVideoSrc" v-show="!!curVideoSrc"
        controls="true"></video>
    </van-dialog>
  </div>
</template>

<script lang="ts" setup>
import { PropType, ref, watch } from 'vue';
import VueJsonPretty from 'vue-json-pretty';
import 'vue-json-pretty/lib/styles.css';
import { ProxyMock } from '../../../common/proxy.models';
import { useProxyRecordStore } from '../../store/ProxyRecords';

const AUDIO_RGX = new RegExp('(.mp3|.ogg|.wav|.m4a|.aac)$')
const VIDEO_RGX = new RegExp('(.mp4)$')
const IMG_RGX = new RegExp('(.jpg|.jpeg|.png|.JPG|.gif|.GIF|.webp)$')

defineProps({
  record: { type: Object as PropType<ProxyMock.ProxyRequestRecord> },
})

const recordStore = useProxyRecordStore()
const apiDesc = ref<string>(null)
const curImgSrc = ref<string>(null)
const curAudioSrc = ref<string>(null)
const audioPlayer = ref(null)
const curVideoSrc = ref<string>(null)
const showPreview = ref(false)

watch(showPreview, () => {
  if (!showPreview.value) {
    if (audioPlayer != null) {
      // audioPlayer.pause()
    }
    curImgSrc.value = null
    curAudioSrc.value = null
    curVideoSrc.value = null
  }
})

function onItemClick(item: string) {
  let canShow = false
  if (!!AUDIO_RGX.test(item)) {
    curAudioSrc.value = item
    curImgSrc.value = null
    canShow = true
  } else if (!!IMG_RGX.test(item)) {
    curAudioSrc.value = null
    curImgSrc.value = item
    canShow = true
  } else if (!!VIDEO_RGX.test(item)) {
    curVideoSrc.value = item
    canShow = true
  }
  showPreview.value = canShow
}

function closeImgPreview() {
  showPreview.value = false
  curImgSrc.value = null
  curAudioSrc.value = null
  if (audioPlayer != null) {
    // audioPlayer.pause()
  }
}

function copyLink() {
  // clipboard.writeText(this.record.url)
}

function addToMockRule() {
  recordStore.showMockRuleMgr = true
}

function updated() {
  this.$refs.inspectorPanel.scrollTop = 0
  this.$nextTick(() => {
    this.$refs.inspectorPanel.scrollTop =
      this.$refs.respDataDiv.getBoundingClientRect().top
  })
}
</script>

<style>
a {
  color: rgb(31, 187, 166);
  text-decoration: underline;
}

.inspector-panel {
  position: relative;
  height: calc(100% - 10px);
  overflow-y: auto;
}

.inspector-panel::-webkit-scrollbar {
  display: none;
}

.inspector-row {
  width: calc(100% -10px);
  background: #ffffff;
  border: 1px solid #efefefef;
  border-radius: 8px;
  margin-top: 10px;
  padding: 0 5px;
  font-size: 0.8rem;
  overflow-x: hidden;
  user-select: text;
}

.inspector-row h3 {
  position: absolute;
  padding: 14px 25px;
  font-weight: 200;
  z-index: 99;
  margin: 0 0 0 -5px;
  width: 100%;
  background: #f1f1f180;
  color: black;
}

.request-path {
  display: flex;
  background: #f1f1f180;
  position: fixed;
  z-index: 100;
  height: 50px;
  width: calc(100% - 360px);
  align-items: center;
  border: 0;
  border-radius: 0px;
  box-shadow: 2px 4px 6px #00000080;
}

.request-url {
  font-size: 0.9rem;
  font-weight: bold;
  color: #2980b9;
  display: inline-block;
  margin-left: 15px;
  word-wrap: break-word;
  white-space: nowrap;
  display: inline;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: text;
  flex: 5;
}
</style>
