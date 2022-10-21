// import { connect, IClientOptions, MqttClient } from 'mqtt'
import { Notify } from 'vant'

// import * from 'paho-mqtt'
const Paho = require('paho-mqtt')

export default class PahoMsgClient {

  client: any
  option = {
    host: '228aeef000db461798db0bc8c9c11a8b.s2.eu.hivemq.cloud',
    port: 8884,
    protocol: 'mqtts',
    username: 'lynx-iot',
    password: '12345678',
    ssl: true,
    keepAlive: 0,
    timeout: 5000,
  }

  constructor() {
    this.client = new Paho.Client(this.option.host, this.option.port, 'clientId')

    // set callback handlers
    this.client.onConnectionLost = this.onConnectionLost
    this.client.onMessageArrived = this.onMessageArrived

    // connect the client
    this.client.connect({
      useSSL: this.option.ssl,
      userName: this.option.username,
      password: this.option.password,
      onSuccess: this.subscribe
    })
  }

  public sendMsg(message: string) {
    this.client.publish('my/test/web', message)
    // let message = new Paho.Message('Hello')
    // message.destinationName = 'my/test/electron'
    // this.client.send(message)
  }

  subscribe() {
    this.client.subscribe('my/test/android')
  }

  onConnectionLost(response) {
    if (response.errorCode !== 0) {
      console.log(`[onConnectionLost]: ${response.errorMessage}`)
    }
  }

  onMessageArrived(message) {
    console.log('onMessageArrived:' + message.payloadString)
  }

}