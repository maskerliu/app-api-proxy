

import { defineStore } from 'pinia'
import { Notify } from 'vant'
import { ClientInfo, LocalServerConfig, PushMsg } from '../../common/models/DataModels'
import { updateBaseDomain, updateClientUID, getServerConfig } from '../../common/models/LocalAPIs'
import { generateUid } from '../common'
import PushClient from '../common/PushClient'

let db: PouchDB.Database = null
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

      // let appDir = await ipcRenderer.invoke("getAppDir")
      // db = new PouchDB(path.join(appDir, 'SharePerferences'), { adapter: 'leveldb' })
      this.updateServerConfig()
      try {
        this.serverConfig = await getServerConfig()
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

      try {
        let doc = await db.get('localServerConfig')
        await db.put({
          _id: 'localServerConfig',
          _rev: doc._rev,
          config: newConfig,
        })
        this.serverConfig = newConfig
        Notify({ message: "应用配置更新成功", type: "success", duration: 500 })
      } catch (err) {

      }
    },
    sendMessage(params: PushMsg<any>) {
      pushClient.send(params)
    },
    updateServerConfig(config?: LocalServerConfig) {
      let uid = generateUid()
      this.serverConfig = config ? config : this.serverConfig
      updateClientUID(uid)

      if (process.env.SERVER_BASE_URL) {
        updateBaseDomain(process.env.SERVER_BASE_URL);
        this.registerUrl = `${process.env.SERVER_BASE_URL}/appmock/register?uid=${uid}`;
        pushClient.start(process.env.SERVER_BASE_URL, uid);
      } else {
        updateBaseDomain(`http://${this.serverConfig.ip}:${this.serverConfig.port}`);
        this.registerUrl = `http://${this.serverConfig.ip}:${this.serverConfig.port}/appmock/register?uid=${uid}`;
        pushClient.start(`http://${this.serverConfig.ip}:${this.serverConfig.port}`, uid);
      }
    },
    updateClientInfos(clientInfos: Array<ClientInfo>) {
      this.clientInfos = [...clientInfos]
    }
  }
})