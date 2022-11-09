import { connect, IClientOptions } from 'mqtt'

import MsgClient from './MsgClient'


export default class NodeMsgClient extends MsgClient {

  private options: IClientOptions = {
    port: 8883,
    protocol: 'mqtts',
    username: 'lynx-iot',
    password: '12345678',
    clientId: 'lynx-iot-electron'
  }

  constructor(host: string) {
    super()

    this.options.host = host
    this.client = connect(this.options)
    this.client.on('error', (error) => { console.log(error) })
    this.client.on('message', (topic, message) => { this.handleMsg(topic, message.toString()) })
  }

  protected isConnected(): boolean {
    return this.client.connected
  }
}