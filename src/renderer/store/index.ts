

import { defineStore } from 'pinia'
import { updateBaseDomain, updateClientUID } from '../../common/base.api'
import { LocalServerConfig } from '../../common/base.models'
import { getServerConfig } from '../../common/proxy.api'
import { ProxyMock } from '../../common/proxy.models'
import { generateUid } from '../common'
import MsgClient from '../common/MsgClient'
import PushClient from '../common/PushClient'

let pushClient: PushClient = null
let msgClient: MsgClient = null

export const useCommonStore = defineStore('Common', {
  state: () => {
    return {
      showQrCode: false,
      registerUrl: '',
      serverConfig: {} as LocalServerConfig,
      clientInfos: [] as Array<ProxyMock.ClientInfo>
    }
  },
  actions: {
    updateShowQrCode(show: boolean) {
      this.showQrCode = show
    },
    async init() {
      pushClient = new PushClient()
      if (__DEV__ || !__IS_WEB__) { // dev mode 
        updateBaseDomain(SERVER_BASE_URL)
      }

      try {
        this.serverConfig = await getServerConfig()
        this.updateServerConfig()
        // msgClient = new PahoMsgClient(this.serverConfig.mqttBroker)
      } catch (err) {
        console.error(err)
      }
    },
    async saveLocalServerConfig(config: LocalServerConfig) {
      let newConfig: LocalServerConfig = Object.assign(this.serverConfig, config)
      delete newConfig.ip
      delete newConfig.port
      delete newConfig.ips
    },
    sendMessage(params: ProxyMock.PushMsg<any>) {
      pushClient.send(params)
    },
    publishMessage(message: string) {
      // here just mock a device to send a fake monitor data for test
     
    },
    updateServerConfig(config?: LocalServerConfig) {
      let uid = generateUid()
      this.serverConfig = config ? config : this.serverConfig
      updateClientUID(uid)

      if (!__IS_WEB__) {
        updateBaseDomain(`${PROTOCOL}://${this.serverConfig.ip}:${this.serverConfig.port}`)
        this.registerUrl = `${PROTOCOL}://${this.serverConfig.ip}:${this.serverConfig.port}/appmock/register?uid=${uid}`
        pushClient.start(`${PROTOCOL}://${this.serverConfig.ip}:${this.serverConfig.port}`, uid)
      } else {
        this.registerUrl = `${SERVER_BASE_URL}/appmock/register?uid=${uid}`
        pushClient.start(SERVER_BASE_URL, uid)
      }
    },
    updateClientInfos(clientInfos: Array<ProxyMock.ClientInfo>) {
      this.clientInfos = [...clientInfos]
    },
  }
})