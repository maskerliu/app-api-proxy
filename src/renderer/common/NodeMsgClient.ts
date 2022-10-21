import { connect, IClientOptions, MqttClient } from 'mqtt'
import { Notify } from 'vant'


export default class NodeMsgClient {

  client: MqttClient
  options: IClientOptions = {
    host: '228aeef000db461798db0bc8c9c11a8b.s2.eu.hivemq.cloud',
    port: 8883,
    protocol: 'mqtts',
    username: 'lynx-iot',
    password: '12345678'
  }

  constructor() {
    this.client = connect(this.options)

    // set callback handlers
    this.client.on('connect', () => {
      this.client.subscribe('my/test/android')
    })

    this.client.on('error', (error) => { console.log(error) })

    this.client.on('message', (topic, message) => {
      Notify({ message: message.toString(), duration: 800 })
    })
  }

  public sendMsg(message: string) {
    this.client.publish('my/test/electron', message)
    // let message = new Paho.Message('Hello')
    // message.destinationName = 'my/test/electron'
    // this.client.send(message)
  }

  subscribe() {
    this.client.subscribe('my/test/android')
  }

}