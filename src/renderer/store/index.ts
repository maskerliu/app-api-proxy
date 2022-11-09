

import { defineStore } from 'pinia'
import { updateBaseDomain, updateClientUID } from '../../common/base.api'
import { LocalServerConfig } from '../../common/base.models'
import { IOT } from '../../common/iot.models'
import { getServerConfig } from '../../common/proxy.api'
import { ProxyMock } from '../../common/proxy.models'
import { generateUid } from '../common'
import MsgClient from '../common/MsgClient'
import PahoMsgClient from '../common/PahoMsgClient'
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
        msgClient = new PahoMsgClient(this.serverConfig.mqttBroker)
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
      let deviceId = 'lynx-iot-nodered-00003'
      let monitorSnap: IOT.MonitorSnap = {
        temperature: Number.parseFloat((Math.random() * 60).toFixed(2)),
        humidity: Number.parseFloat(Math.random().toFixed(2)),
        speed: Number.parseInt((Math.random() * 5000).toFixed(1)),
        voltage: Number.parseInt((Math.random() * 220).toFixed(0)),
        electric: Number.parseFloat((Math.random() * 5).toFixed(1)),
        pressure: Number.parseFloat((Math.random() * 10).toFixed(1)),
        timestamp: new Date().getTime()
      }

      let msg: IOT.IOTMsg = {
        from: deviceId,
        type: IOT.MsgType.DATA,
        data: monitorSnap
      }
      msgClient.sendMsg(deviceId, msg)
    },
    updateServerConfig(config?: LocalServerConfig) {
      let uid = generateUid()
      this.serverConfig = config ? config : this.serverConfig
      updateClientUID(uid)

      updateBaseDomain(`${PROTOCOL}://${this.serverConfig.ip}:${this.serverConfig.port}`)
      this.registerUrl = `${PROTOCOL}://${this.serverConfig.ip}:${this.serverConfig.port}/appmock/register?uid=${uid}`
      pushClient.start(`${PROTOCOL}://${this.serverConfig.ip}:${this.serverConfig.port}`, uid)
    },
    updateClientInfos(clientInfos: Array<ProxyMock.ClientInfo>) {
      this.clientInfos = [...clientInfos]
    },
    rebootDevice(deviceId: string) {
      msgClient.sendMsg(deviceId, {
        from: 'my/test/electron',
        type: IOT.MsgType.REBOOT
      })
    },
    deviceTmpSubscribe(deviceId: string) {
      msgClient.subscribe(deviceId)
      msgClient.sendMsg(deviceId, {
        from: 'my/test/electron',
        type: IOT.MsgType.TMP_SUBSCRIBED
      })
    },
    deviceTmpUnsubscribe(deviceId: string) {
      msgClient.unsubscribe(deviceId)
      msgClient.sendMsg(deviceId, {
        from: 'my/test/electron',
        type: IOT.MsgType.TMP_UNSUBSCRIBED
      })
    }
  }
})