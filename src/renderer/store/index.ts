

import { defineStore } from 'pinia'
import { ClientInfo, LocalServerConfig, PushMsg } from '../../common/models/DataModels'
import { getServerConfig, updateBaseDomain, updateClientUID } from '../../common/models/LocalAPIs'
import { generateUid } from '../common'
import PushClient from '../common/PushClient'

let pushClient: PushClient = null

export const useCommonStore = defineStore('Common', {
  state: () => {
    return {
      showQrCode: false,
      registerUrl: '',
      serverConfig: {} as LocalServerConfig,
      clientInfos: [] as Array<ClientInfo>
    }
  },
  actions: {
    updateShowQrCode(show: boolean) {
      this.showQrCode = show
    },
    async init() {

      pushClient = new PushClient()

      if (__DEV__) { // dev mode 
        updateBaseDomain(SERVER_BASE_URL)
      } else {
        if (__IS_WEB__) { // prod web

        } else { // prod renderer
          updateBaseDomain('http://localhost:8885')
        }
      }

      try {
        this.serverConfig = await getServerConfig()
        this.updateServerConfig()
      } catch (err) {
        console.log(err)
      }
    },
    unInit() {

    },
    async saveLocalServerConfig(config: LocalServerConfig) {
      let newConfig: LocalServerConfig = Object.assign(this.serverConfig, config)
      delete newConfig.ip
      delete newConfig.port
      delete newConfig.ips
    },
    sendMessage(params: PushMsg<any>) {
      pushClient.send(params)
    },
    updateServerConfig(config?: LocalServerConfig) {
      let uid = generateUid()
      this.serverConfig = config ? config : this.serverConfig
      updateClientUID(uid)

      updateBaseDomain(`http://${this.serverConfig.ip}:${this.serverConfig.port}`)
      this.registerUrl = `http://${this.serverConfig.ip}:${this.serverConfig.port}/appmock/register?uid=${uid}`
      pushClient.start(`http://${this.serverConfig.ip}:${this.serverConfig.port}`, uid)
    },
    updateClientInfos(clientInfos: Array<ClientInfo>) {
      this.clientInfos = [...clientInfos]
    }
  }
})