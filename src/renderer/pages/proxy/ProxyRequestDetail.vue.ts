// import { clipboard } from 'electron'
import { mapWritableState } from 'pinia'
import { defineComponent, PropType } from 'vue'
import { ProxyRequestRecord } from '../../../common/models'
import { useCommonStore } from '../../store'
import JsonViewer from '../components/JsonViewer.vue'
import MockRuleMgr from '../mock/MockRuleMgr.vue'


const AUDIO_RGX = new RegExp('(.mp3|.ogg|.wav|.m4a|.aac)$')
const VIDEO_RGX = new RegExp('(.mp4)$')
const IMG_RGX = new RegExp('(.jpg|.jpeg|.png|.JPG|.gif|.GIF|.webp)$')

const ProxyRequestDetail = defineComponent({
  components: {
    JsonViewer,
    MockRuleMgr,
  },
  props: {
    record: { type: Object as PropType<ProxyRequestRecord>, required: true }
  },
  computed: {
    ...mapWritableState(useCommonStore, ['serverConfig'])
  },
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
    }
  },
  mounted() {
    this.audioPlayer = document.getElementById('audioPlayer')
  },
  methods: {
    onItemClick(item: string) {
      let canShow = false
      if (!!AUDIO_RGX.test(item)) {
        this.curAudioSrc = item
        this.curImgSrc = null
        canShow = true
      } else if (!!IMG_RGX.test(item)) {
        this.curAudioSrc = null
        this.curImgSrc = item
        canShow = true
      } else if (!!VIDEO_RGX.test(item)) {
        this.curVideoSrc = item
        canShow = true
      }
      this.showPreview = canShow
    },
    closeImgPreview() {
      this.showPreview = false
      this.curImgSrc = null
      this.curAudioSrc = null
      if (this.audioPlayer != null) {
        this.audioPlayer.pause()
      }
    },
    copyLink() {
      // clipboard.writeText(this.record.url)
    },
    addToMockRule() {
      this.showAddMockRule = true
    },
    updated() {
      this.$refs.inspectorPanel.scrollTop = 0
      this.$nextTick(() => {
        this.$refs.inspectorPanel.scrollTop = this.$refs.respDataDiv.getBoundingClientRect().top
      })
    },
  },

  watch: {
    showPreview() {
      if (!this.showPreview) {
        if (this.audioPlayer != null) {
          this.audioPlayer.pause()
        }
        this.curImgSrc = null
        this.curAudioSrc = null
        this.curVideoSrc = null
      }
    }
  },
})

export default ProxyRequestDetail
