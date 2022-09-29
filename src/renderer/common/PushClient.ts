import SockJS from "sockjs-client"
import { Notify } from "vant"
import { BizType, CMDType, PushMsg, PushMsgPayload, PushMsgType } from "../../common/models/DataModels"
import { getAllPushClients } from "../../common/models/LocalAPIs"
import { useCommonStore } from '../store'
import { useProxyRecordStore } from "../store/ProxyRecords"

export default class PushClient {
  private uid: string
  private sockjs: WebSocket

  private commonStore: any
  private proxyRecordStore: any

  constructor() {
    this.commonStore = useCommonStore()
    this.proxyRecordStore = useProxyRecordStore()
  }

  public start(host: string, uid: string): void {
    this.uid = uid
    try {
      this.sockjs.close()
    } catch (err) { }
    this.sockjs = new SockJS(`${host}/echo`, { transports: 'websocket' })
    this.sockjs.onopen = () => { this.register(uid) }
    this.sockjs.onmessage = (e: any) => { this.handleMsg(e.data) }
  }

  public close() {
    this.sockjs.close()
  }

  public send(data: PushMsg<any>): void {
    data.from = this.uid
    this.sockjs.send(JSON.stringify(data))
  }

  private register(uid: string): void {
    let msg: PushMsg<any> = {
      type: PushMsgType.CMD,
      payload: {
        type: CMDType.REGISTER,
        content: { uid: uid, username: localStorage.username }
      }
    }
    this.send(msg)

    getAllPushClients().then(result => {
      this.commonStore.updateClientInfos(result)
    }).catch(err => { })
  }

  private handleMsg(data: any): void {
    let msg: PushMsg<any> = JSON.parse(data)
    switch (msg.type) {
      case PushMsgType.CMD: {
        this.handleCMD(msg.payload)
        break
      }
      case PushMsgType.TXT: {
        this.handlePayload(msg.payload)
        break
      }
      default:
        Notify({ message: "unhandled code:" + msg.type, type: "warning" })
    }
  }

  private handleCMD(msg: PushMsgPayload<any>) {
    switch (msg.type) {
      case CMDType.REGISTER:
        this.commonStore.updateShowQrCode(false)
        Notify({ message: "设备[" + msg.content + "]注册成功", type: "success" })
        break
      case CMDType.KICKDOWN:
        Notify({ message: "被踢下线", type: "danger" })
        window.close()
        break
    }
  }

  private handlePayload(msg: PushMsgPayload<any>) {
    switch (msg.type) {
      case BizType.Proxy: {
        this.proxyRecordStore.updateRecord(msg.content)
        break
      }
      case BizType.IM: {
        Notify({ message: msg.content, type: "success" })
        break
      }
      case BizType.ClientInfos: {
        this.commonStore.updateClientInfos(msg.content)
        break
      }
    }
  }
}
