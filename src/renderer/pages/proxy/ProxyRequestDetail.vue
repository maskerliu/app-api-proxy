<template>
  <van-form ref="container" label-align="right" colon>
    <van-sticky :offset-top="5" :container="container">
      <van-cell-group inset title="" class="content" style="margin-top: 5px;">
        <van-cell center>
          <template #title>
            <span class="van-ellipsis">{{ record.url }}</span>
          </template>
          <template #right-icon>
            <van-button style="margin: 0 10px;" plain size="small" type="success" icon="description"
              @click="copyLink" />
            <van-button plain size="small" type="primary" icon="bookmark-o" @click="addToMockRule" />
          </template>
        </van-cell>
      </van-cell-group>
    </van-sticky>

    <van-cell-group inset :title="$t('proxy.requestHeader')" class="content">
      <van-cell>
        <template #value>
          <vue-ace-editor :fold="false"
            :data="record.headers == null ? '{}' : JSON.stringify(record.headers, null, '\t')" />
        </template>
      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.requestParams')" class="content">
      <van-cell>
        <vue-ace-editor :data="record.requestData == null ? '{}' : JSON.stringify(record.requestData, null, '\t')" />
      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.responseHeader')" class="content">
      <van-cell>
        <vue-ace-editor :fold="false"
          :data="record.responseHeaders == null ? '{}' : JSON.stringify(record.responseHeaders, null, '\t')" />
      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.responseBody')" style="margin-bottom: 5px;" class="content">
      <van-cell>
        <template #value>
          <vue-ace-editor
            :data="record.responseData == null ? '{}' : JSON.stringify(record.responseData, null, '\t')" />
        </template>
      </van-cell>
    </van-cell-group>
  </van-form>
</template>

<script lang="ts" setup>
import { showToast } from 'vant'
import { PropType, ref, watch } from 'vue'
import { ProxyMock } from '../../../common'
import { CommonStore } from '../../store'
import VueAceEditor from '../components/VueAceEditor.vue'

const AUDIO_RGX = new RegExp('(.mp3|.ogg|.wav|.m4a|.aac)$')
const VIDEO_RGX = new RegExp('(.mp4)$')
const IMG_RGX = new RegExp('(.jpg|.jpeg|.png|.JPG|.gif|.GIF|.webp)$')

const props = defineProps({
  record: { type: Object as PropType<ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord> },
})

const commonStore = CommonStore()
const container = ref(null)
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
  // var input = document.createElement('input')
  // input.value = props.record.url
  // document.body.appendChild(input)
  // input.select()
  // document.execCommand("copy")
  showToast(`[ ${props.record.url} ] has copyed!`)
  // clipboard.writeText(this.record.url)
}

function addToMockRule() {
  commonStore.showMockRuleMgr = true
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
  padding: 0;
}
</style>
