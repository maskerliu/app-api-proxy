import { mapActions, mapState } from 'pinia'
import { defineComponent } from 'vue'
import { BizType, ClientInfo, IP, MsgPushClient, PushMsg, PushMsgType } from '../../../common/models/DataModels'
import { useCommonStore } from '../../store'

type SettingPreference = { key: string, tooltip: string, hasStatus?: boolean, statusKey?: string }

const Settings = defineComponent({
  name: "Settings",
  data() {
    return {
      dialogVisible: false,
      selectClient: null as MsgPushClient,
      broadcastMsg: null as string,
      imMsg: null as string,
      perferences: [
        { tooltip: "代理Http服务端口", key: "port", },
        { tooltip: "代理长连服务端口", key: "proxySocketPort", },
        { tooltip: "API定义服务地址", key: "apiDefineServer", },
        { tooltip: "埋点规则服务地址", key: "statRuleServer", },
        { tooltip: "代理数据服务地址", key: "dataProxyServer", hasStatus: true, statusKey: "dataProxyStatus" },
      ] as Array<SettingPreference>,
      curServerIp: null as IP,
      showPopover: false
    }
  },
  computed: {
    ...mapState(useCommonStore, ['serverConfig', 'clientInfos'])
  },
  mounted() {
    console.log(this.serverConfig.ips)
    this.curServerIp = this.serverConfig.ips
  },
  methods: {
    ...mapActions(useCommonStore, ['sendMessage']),
    onSelectIP(ip: IP) {
      this.curServerIp = ip
      this.showPopover = false
    },
    sendBroadcastMsg(): void {
      let msg: PushMsg<any> = {
        type: PushMsgType.TXT,
        payload: {
          type: BizType.IM,
          content: this.broadcastMsg
        }
      }
      this.sendMessage(msg)
      this.broadcastMsg = ""
    },
    sendMsg(): void {
      let msg: PushMsg<any> = {
        to: this.selectClient.uid,
        type: PushMsgType.TXT,
        payload: {
          type: BizType.IM,
          content: this.imMsg
        }
      }
      this.sendMessage(msg)
      this.imMsg = ""
    },
    showOpMenu(client: ClientInfo): void {
      this.dialogVisible = true
      this.selectClient = client
    }
  }
})

export default Settings