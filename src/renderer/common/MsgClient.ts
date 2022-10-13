import { connect, IClientOptions, MqttClient } from 'mqtt'
import { Notify } from 'vant'


export default class MsgClient {

  client: MqttClient
  option: IClientOptions = {
    host: 'c4d01539c3e54ac7bf8a61fae09ff0ec.s2.eu.hivemq.cloud',
    port: 8883,
    protocol: 'mqtts',
    username: 'lynxchina',
    password: '16227105'
  }

  constructor() {
    this.init()
  }

  private init() {
    this.client = connect(this.option)

    this.client.on('connect', () => { console.log('Connected') })
    this.client.on('error', (error) => { console.log(error) })
    this.client.on('message', (topic, message) => {
      // called each time a message is received
      // console.log('Received message:', topic, message.toString())
      Notify({message: message.toString(), type: 'success', duration: 800})
    })

    this.client.subscribe('my/test/android')
  }

  public sendMsg(message: string) {
    this.client.publish('my/test/electron', message)
  }

}