import { defineStore } from 'pinia'
import { updateBaseDomain, updateClientUID } from '../../common/base.api'
import { LocalServerConfig } from '../../common/base.models'
import { getServerConfig } from '../../common/proxy.api'
import { ProxyMock } from '../../common/proxy.models'
import { generateUid } from '../common'
import PushClient from '../common/PushClient'
import { showNotify } from 'vant'

let pushClient: PushClient = null

export const useCommonStore = defineStore('Common', {
  state: () => {
    return {
      uid: '',
      showQrCode: false,
      registerUrl: '',
      serverConfig: {} as LocalServerConfig
    }
  },
  actions: {
    updateShowQrCode(show: boolean) {
      this.showQrCode = show
    },
    async init() {
      pushClient = new PushClient()

      if (__DEV__ || !__IS_WEB__) {
        updateBaseDomain(SERVER_BASE_URL)
      }

      try {
        this.serverConfig = await getServerConfig()
        this.updateServerConfig()
      } catch (err) {
        showNotify(err)
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
      this.uid = generateUid()
      this.serverConfig = config ? config : this.serverConfig
      updateClientUID(this.uid)

      this.registerUrl = `${this.serverConfig.protocol}://${this.serverConfig.ip}:${this.serverConfig.port}/appmock/register?uid=${this.uid}`
      if (__IS_WEB__) {
        pushClient.start(`${this.serverConfig.protocol}://${this.serverConfig.ip}:${this.serverConfig.port}`, this.uid)
      } else {
        pushClient.start(`${this.serverConfig.protocol}://localhost:${this.serverConfig.port}`, this.uid)
      }
    },
    updateClientInfos(clientInfos: Array<ProxyMock.ClientInfo>) {
      this.clientInfos = [...clientInfos]
    },
  }
})