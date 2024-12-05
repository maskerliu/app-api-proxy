import { defineStore } from 'pinia'
import { showNotify } from 'vant'
import { LocalServerConfig, ProxyMock, updateBaseDomain, updateClientUID } from '../../common'
import { generateUid, PushClient } from '../common'

export { ProxyRecordStore } from './ProxyRecords'

let pushClient: PushClient = null

export const CommonStore = defineStore('Common', {
  state: () => {
    return {
      uid: '',
      showQrCode: false,
      showMockRuleMgr: false,
      showSettings: false,
      registerUrl: '',
      serverConfig: {} as LocalServerConfig
    }
  },
  actions: {
    updateShowQrCode(show: boolean) {
      this.showQrCode = show
    },
    async init(config?: LocalServerConfig) {
      pushClient = new PushClient()

      if (config) {
        updateBaseDomain(`${config.protocol}://${config.ip}:${config.port}`)
      } else {
        if (__DEV__ || !__IS_WEB__) {
          updateBaseDomain(SERVER_BASE_URL)
        }
      }

      try {
        this.serverConfig = await ProxyMock.getServerConfig()
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
      this.uid = window.localStorage.getItem('uid')
      if (this.uid == null) {
        this.uid = generateUid()
        window.localStorage.setItem('uid', this.uid)
      }

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