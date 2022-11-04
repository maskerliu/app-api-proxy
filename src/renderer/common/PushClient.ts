import SockJS from 'sockjs-client'
import { Notify } from 'vant'
import { getAllPushClients } from '../../common/proxy.api'
import { ProxyMock } from '../../common/proxy.models'
import { useCommonStore } from '../store'
import { useProxyRecordStore } from '../store/ProxyRecords'

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

  public send(data: ProxyMock.PushMsg<any>): void {
    data.from = this.uid
    this.sockjs.send(JSON.stringify(data))
  }

  private register(uid: string): void {
    let msg: ProxyMock.PushMsg<any> = {
      type: ProxyMock.PushMsgType.CMD,
      payload: {
        type: ProxyMock.CMDType.REGISTER,
        content: { uid: uid, username: localStorage.username }
      }
    }
    this.send(msg)

    getAllPushClients().then(result => {
      this.commonStore.updateClientInfos(result)
    }).catch(err => { })
  }

  private handleMsg(data: any): void {
    let msg: ProxyMock.PushMsg<any> = JSON.parse(data)
    switch (msg.type) {
      case ProxyMock.PushMsgType.CMD: {
        this.handleCMD(msg.payload)
        break
      }
      case ProxyMock.PushMsgType.TXT: {
        this.handlePayload(msg.payload)
        break
      }
      default:
        Notify({ message: 'unhandled code:' + msg.type, type: 'warning' })
    }
  }

  private handleCMD(msg: ProxyMock.PushMsgPayload<any>) {
    switch (msg.type) {
      case ProxyMock.CMDType.REGISTER:
        this.commonStore.updateShowQrCode(false)
        Notify({ message: '设备[' + msg.content + ']注册成功', type: 'success' })
        break
      case ProxyMock.CMDType.KICKDOWN:
        Notify({ message: '被踢下线', type: 'danger' })
        window.close()
        break
    }
  }

  private handlePayload(msg: ProxyMock.PushMsgPayload<any>) {
    switch (msg.type) {
      case ProxyMock.BizType.Proxy: {
        this.proxyRecordStore.updateRecord(msg.content)
        break
      }
      case ProxyMock.BizType.IM: {
        Notify({ message: msg.content, type: 'success' })
        break
      }
      case ProxyMock.BizType.ClientInfos: {
        this.commonStore.updateClientInfos(msg.content)
        break
      }
    }
  }
}
