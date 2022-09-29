import { mapActions, mapState, mapWritableState } from 'pinia'
import QrcodeVue from 'qrcode.vue'
import { Notify } from 'vant'
import { defineComponent } from 'vue'
import { ProxyRequestRecord, ProxyStatRecord } from '../../../common/models/DataModels'
import { mockRegister, setProxyDelay } from '../../../common/models/LocalAPIs'
import { useCommonStore } from '../../store'
import { useProxyRecordStore } from '../../store/ProxyRecords'
import ProxyRecordSnap from './ProxyRecordSnap.vue'
import ProxyRequestDetail from './ProxyRequestDetail.vue'
import ProxyStatDetail from './ProxyStatDetail.vue'

const Proxy = defineComponent({
  name: 'BizMain',
  components: {
    QrcodeVue,
    ProxyRecordSnap,
    ProxyRequestDetail,
    ProxyStatDetail,
  },
  data() {
    return {
      active: 0 as number,
      navTitle: '' as string,
      proxyDelay: '0' as string,
      filterInput: null as string,
      activeTab: '0' as string,
      throttleRecords: null as Array<ProxyRequestRecord | ProxyStatRecord>,
      scroll: null as any,
      clientStartX: 0,
    }
  },
  created() {
    this.$router.beforeEach((to: any, from: any) => {
      this.navTitle = to.name
      return true
    })
  },
  mounted() {
    this.active = 1
    this.$refs.resizeBar.$el.onmousedown = (e: MouseEvent) => {
      this.clientStartX = e.clientX
      document.onmousemove = (e) => {
        this.moveHandle(e.clientX)
        return false
      }

      document.onmouseup = function () {
        document.onmousemove = null
        document.onmouseup = null
      }
      return false
    }
  },
  computed: {
    ...mapState(useCommonStore, ['registerUrl']),
    ...mapWritableState(useCommonStore, ['showQrCode']),
    ...mapState(useProxyRecordStore, ['records']),
    ...mapWritableState(useProxyRecordStore, ['proxyTypes', 'filterKeyword', 'curRecordId'])

  },
  methods: {
    ...mapActions(useProxyRecordStore, ['updateFilter', 'clearRecords', 'mockRecord']),
    onLeftNavBtnClicked() {
      if (this.navBar.leftAction != null) {
        this.navBar.leftAction()
      } else {
        this.$router.go(-1)
      }
    },
    moveHandle(nowClient: any) {
      let changeWidth = nowClient - 85
      if (changeWidth < 300) {
        changeWidth = 300
        nowClient = 330
      }
      let remainWidth = this.$refs.container.$el.clientWidth - changeWidth - 20
      this.$refs.leftDom.$el.style.width = changeWidth + 'px'
      this.$refs.rightDom.$el.style.width = remainWidth + 'px'
    },
    onRightNavBtnClicked() {
      this.navBar.rightAction()
    },
    click2Reg() {
      mockRegister().then(resp => { this.showQrCode = (resp == null) })
    },
  },
  watch: {
    filterKeyword() {
      this.updateFilter()
    },
    proxyTypes() {
      this.updateFilter()
    },
    async proxyDelay() {
      try {
        await setProxyDelay(Number(this.proxyDelay))
        Notify({ message: '成功设置延迟', type: 'success' })
      } catch (err) {
        Notify({ message: '设置延迟失败', type: 'danger' })
      }
    }
  }
})

export default Proxy