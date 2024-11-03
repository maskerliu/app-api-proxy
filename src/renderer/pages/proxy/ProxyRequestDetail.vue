<template>
  <van-form style="min-width: 420px; height: 100vh; overflow-y: scroll;" label-align="right" colon>
    <van-cell-group inset title="">
      <van-sticky :offset-top="5">
        <van-cell center :title="record.url">
          <template #right-icon>
            <van-button style="margin: 0 10px;" plain size="small" type="success" icon="description"
              @click="copyLink" />
            <van-button plain size="small" type="primary" icon="bookmark-o" @click="addToMockRule" />
          </template>
        </van-cell>
      </van-sticky>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.requestHeader')">
      <van-cell>
        <template #value>
          <vue-json-pretty class="content" :show-icon="true" theme="light" :deep="0" :showDoubleQuotes="false"
            :data="record.headers == null ? {} : record.headers" />
        </template>

      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.requestParams')">
      <van-cell>
        <vue-json-pretty class="content" :show-icon="true" theme="light" :deep="0" :showDoubleQuotes="false"
          :data="record.requestData == null ? {} : record.requestData" />
      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.responseHeader')">
      <van-cell>
        <vue-json-pretty class="content" :show-icon="true" theme="light" :deep="0" :showDoubleQuotes="false"
          :data="record.responseHeaders == null ? {} : record.responseHeaders" />
      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.responseBody')" style="margin-bottom: 5px;">
      <van-cell>
        <template #value>
          <vue-json-pretty class="content" :show-icon="true" theme="light" :showLineNumber="true"
            :showDoubleQuotes="false" style=" max-height: calc(100vh - 125px); overflow-y: auto;"
            :data="record.responseData == null ? {} : record.responseData">
            <template #renderNodeValue="{ node, defaultValue }">
              <template v-if="typeof node.content === 'string' && node.content.startsWith('https://')">
                <a :href="node.content" target="_blank">{{ node.content }}</a>
              </template>
              <template v-else>{{ defaultValue }}</template>
            </template>
          </vue-json-pretty>
        </template>
      </van-cell>

    </van-cell-group>
  </van-form>
</template>

<script lang="ts" setup>
import { PropType, ref, watch } from 'vue'
import VueJsonPretty from 'vue-json-pretty'
import 'vue-json-pretty/lib/styles.css'
import { ProxyMock } from '../../../common/proxy.models'
import { useProxyRecordStore } from '../../store/ProxyRecords'

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

.content {
  font-size: 0.7rem;
  padding: 0 5px;
}
</style>
