import Paho from 'paho-mqtt'
import { IOT } from '../../common/iot.models'
import { useIOTDeviceStore } from '../store/IOTDevices'
import MsgClient from './MsgClient'

export default class PahoMsgClient extends MsgClient {

  private option = {
    port: 8884,
    protocol: 'mqtts',
    username: 'lynx-iot',
    password: '12345678',
    ssl: true,
    keepAlive: 0,
    timeout: 5000,
  }

  constructor(host: string) {
    super()

    this.client = new Paho.Client(host, this.option.port, 'lynx-iot-nodered-00003')

    // set callback handlers
    this.client.onConnectionLost = this.onConnectionLost
    this.client.onMessageArrived = (msg: any) => { this.handleMsg(msg.topic, msg.payloadString) }

    // connect the client
    this.client.connect({
      useSSL: this.option.ssl,
      userName: this.option.username,
      password: this.option.password
    })
  }

  protected isConnected(): boolean {
    return this.client.isConnected()
  }

  onConnectionLost(response: any) {
    if (response.errorCode !== 0) {
      console.log('[onConnectionLost]:', response)
      console.log(response.errorMessage)
    }
  }

}