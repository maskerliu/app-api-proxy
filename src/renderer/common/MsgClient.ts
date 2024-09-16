import { IOT } from '../../common/iot.models'

export default abstract class MsgClient {

  // protected deviceStore: any
  protected client: any
  protected curTopic: string
  protected curSubDevice: string


  constructor() {
    
  }

  // abstract subscribe(deviceId: string): void
  // abstract unsubscribe(deviceId: string): void
  // abstract sendMsg(deviceId: string, message: IOT.IOTMsg): void

  public subscribe(deviceId: string) {

    if (!this.isConnected()) { return }

    if (this.curTopic && this.curSubDevice !== deviceId) {
      this.sendMsg(this.curSubDevice, {
        from: this.client.clientId,
        type: IOT.MsgType.TMP_UNSUBSCRIBED,
      })
      this.client.unsubscribe(this.curTopic)
    }

    this.curSubDevice = deviceId
    this.curTopic = `tmp/${deviceId}`
    this.client.subscribe(this.curTopic)

    this.sendMsg(deviceId, {
      from: this.client.clientId,
      type: IOT.MsgType.TMP_SUBSCRIBED,
    })
  }

  protected abstract isConnected(): boolean

  public unsubscribe(deviceId: string): void {
    if (!this.isConnected()) { return }
    this.client.unsubscribe(this.curTopic)
    this.client.unsubscribe(`tmp/${deviceId}`)
  }

  public sendMsg(deviceId: string, message: IOT.IOTMsg) {
    this.client.publish(deviceId, JSON.stringify(message))
    this.client.publish(`tmp/${deviceId}`, JSON.stringify(message))
  }

  protected handleMsg(topic: string, message: string) {
    try {
      let msg = JSON.parse(message) as IOT.IOTMsg
      switch (msg.type) {
        case IOT.MsgType.DATA:
          // this.deviceStore.updateDeviceData(msg.from, msg.data)
          break
        case IOT.MsgType.REGISTER:

          break
      }
    } catch (err) {
      console.log(err)
    }
  }
}