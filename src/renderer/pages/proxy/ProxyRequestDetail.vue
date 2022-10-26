<template>
  <div class="inspector-panel bg-border" ref="inspectorPanel">
    <div class="request-path">
      <span class="request-url">
        <b>[Path] </b> {{ record.url }}<br />
        <span style="font-size: 0.7rem; font-weight: normal">
          {{ apiDesc }}
        </span>
      </span>
      <van-button
        style="margin: 0 5px"
        plain
        size="small"
        type="success"
        icon="description"
        @click="copyLink"
      />
      <van-button
        style="margin: 0 5px"
        plain
        size="small"
        type="primary"
        icon="bookmark-o"
        @click="addToMockRule"
      />
    </div>
    <div class="inspector-row" style="margin-top: 70px; padding-bottom: 15px">
      <h3>&emsp;&emsp;请求头</h3>
      <json-viewer
        style="margin-top: 40px"
        :closed="true"
        :data="record.headers == null ? {} : record.headers"
      ></json-viewer>
    </div>
    <div class="inspector-row" style="padding-bottom: 15px">
      <h3>&emsp;&emsp;请求参数</h3>
      <json-viewer
        style="margin-top: 40px"
        :data="record.requestData == null ? {} : record.requestData"
      ></json-viewer>
    </div>
    <div class="inspector-row" style="padding-bottom: 15px">
      <h3>&emsp;&emsp;响应头</h3>
      <json-viewer
        style="margin-top: 40px"
        :closed="true"
        :data="record.responseHeaders == null ? {} : record.responseHeaders"
      ></json-viewer>
    </div>
    <div
      class="inspector-row"
      style="height: calc(100vh - 65px)"
      ref="respDataDiv"
    >
      <h3>&emsp;&emsp;响应数据</h3>
      <json-viewer
        style="margin-top: 50px; height: calc(100vh - 105px)"
        :data="record.responseData"
        :deep="5"
      ></json-viewer>
    </div>

    <van-popup
      v-model:show="showAddMockRule"
      :style="{ width: '90%', padding: '10px' }"
    >
      <mock-rule-mgr
        style="width: 100%; height: calc(100vh - 120px); display: flex"
        :record="record"
      />
    </van-popup>

    <van-dialog title="预览" :show="showPreview" top="100px" align="center">
      <img
        style="max-width: 100%; max-height: 60vh; border-radius: 8px"
        :src="curImgSrc"
        v-show="!!curImgSrc"
      />
      <audio
        id="audioPlayer"
        style="width: 100%; max-width: 100%; max-height: 60vh"
        :src="curAudioSrc"
        controls="true"
        v-show="!!curAudioSrc"
      />
      <video
        style="max-width: 100%; max-height: 60vh; object-fit: contain"
        :src="curVideoSrc"
        v-show="!!curVideoSrc"
        controls="true"
      />
    </van-dialog>
  </div>
</template>

<script lang="ts" >
import type { PropType } from "vue";
import { defineComponent } from "vue";
import { ProxyRequestRecord } from "../../../common/models";
import JsonViewer from "../components/JsonViewer.vue";
import MockRuleMgr from "../mock/MockRuleMgr.vue";


const AUDIO_RGX = new RegExp("(.mp3|.ogg|.wav|.m4a|.aac)$");
const VIDEO_RGX = new RegExp("(.mp4)$");
const IMG_RGX = new RegExp("(.jpg|.jpeg|.png|.JPG|.gif|.GIF|.webp)$");

const ProxyRequestDetail = defineComponent({
  components: {
    JsonViewer,
    MockRuleMgr,
  },
  props: {
    record: { type: Object as PropType<ProxyRequestRecord> },
  },
  computed: {},
  data() {
    return {
      // $refs!: {
      //   inspectorPanel: any,
      //   respDataDiv: any
      // },
      apiDesc: null as string,
      curImgSrc: null as string,
      curAudioSrc: null as string,
      audioPlayer: null as any,
      curVideoSrc: null as string,
      showPreview: false,
      showAddMockRule: false,
    };
  },
  mounted() {
    this.audioPlayer = document.getElementById("audioPlayer");
  },
  methods: {
    onItemClick(item: string) {
      let canShow = false;
      if (!!AUDIO_RGX.test(item)) {
        this.curAudioSrc = item;
        this.curImgSrc = null;
        canShow = true;
      } else if (!!IMG_RGX.test(item)) {
        this.curAudioSrc = null;
        this.curImgSrc = item;
        canShow = true;
      } else if (!!VIDEO_RGX.test(item)) {
        this.curVideoSrc = item;
        canShow = true;
      }
      this.showPreview = canShow;
    },
    closeImgPreview() {
      this.showPreview = false;
      this.curImgSrc = null;
      this.curAudioSrc = null;
      if (this.audioPlayer != null) {
        this.audioPlayer.pause();
      }
    },
    copyLink() {
      // clipboard.writeText(this.record.url)
    },
    addToMockRule() {
      this.showAddMockRule = true;
    },
    updated() {
      this.$refs.inspectorPanel.scrollTop = 0;
      this.$nextTick(() => {
        this.$refs.inspectorPanel.scrollTop =
          this.$refs.respDataDiv.getBoundingClientRect().top;
      });
    },
  },

  watch: {
    showPreview() {
      if (!this.showPreview) {
        if (this.audioPlayer != null) {
          this.audioPlayer.pause();
        }
        this.curImgSrc = null;
        this.curAudioSrc = null;
        this.curVideoSrc = null;
      }
    },
  },
});

export default ProxyRequestDetail;
</script>

<style>
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
  padding: 14px 0px;
  z-index: 99;
  margin: 0 0 0 -5px;
  width: 100%;
  background: #f1f1f180;
  color: grey;
}

.request-path {
  display: flex;
  background: #f1f1f180;
  position: fixed;
  z-index: 100;
  height: 50px;
  width: calc(100vw - 340px);
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
