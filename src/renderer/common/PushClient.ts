import SockJS from 'sockjs-client'
import { showNotify } from 'vant'
import { ProxyMock } from '@shared/proxy.models'
import { CommonStore, ProxyRecordStore } from '../store'

export class PushClient {
  // 由服务端在注册成功后分配，每次注册都会变化
  private uid: string
  private host: string
  private sockjs: WebSocket

  private commonStore: any
  private proxyRecordStore: any

  constructor() {
    this.commonStore = CommonStore()
    this.proxyRecordStore = ProxyRecordStore()
  }

  public start(host: string): void {
    // 地址没变时复用现有连接，避免保存配置时无谓地重新注册换 uid
    if (this.sockjs != null && this.host === host) return
    this.host = host
    try {
      this.sockjs?.close()
    } catch (err) { }
    this.sockjs = new SockJS(`${host}/echo`, { transports: 'websocket' })
    this.sockjs.onopen = () => { this.register() }
    this.sockjs.onmessage = (e: any) => { this.handleMsg(e.data) }
  }

  public send(data: ProxyMock.PushMsg<any>): void {
    data.from = this.uid
    this.sockjs.send(JSON.stringify(data))
  }

  private register(): void {
    let msg: ProxyMock.PushMsg<any> = {
      type: ProxyMock.PushMsgType.CMD,
      payload: {
        type: ProxyMock.CMDType.REGISTER,
        content: { username: localStorage.username }
      }
    }
    this.send(msg)
  }

  private handleMsg(data: any): void {
    let msg: ProxyMock.PushMsg<any>
    try {
      msg = JSON.parse(data)
    } catch (err) {
      console.warn('push message parse failed:', err)
      return
    }
    if (msg?.payload == null) return

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
        showNotify({ message: 'unhandled code:' + msg.type, type: 'warning' })
    }
  }

  private handleCMD(msg: ProxyMock.PushMsgPayload<any>) {
    switch (msg.type) {
      case ProxyMock.CMDType.REGISTERED: {
        const uid: string = typeof msg.content === 'string' ? msg.content : msg.content?.uid
        if (uid == null) break
        this.uid = uid
        this.commonStore.applyUid(uid)
        this.commonStore.updateShowQrCode(false)
        showNotify({ message: '注册成功', type: 'success', duration: 500 })
        break
      }
      case ProxyMock.CMDType.DEVICE_REGISTERED: {
        const uid: string = typeof msg.content === 'string' ? msg.content : msg.content?.uid
        this.commonStore.updateShowQrCode(false)
        showNotify({ message: '设备[' + uid + ']注册成功', type: 'success', duration: 800 })
        break
      }
      case ProxyMock.CMDType.KICKDOWN:
        showNotify({ message: '被踢下线', type: 'danger', duration: 1200 })
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
        showNotify({ message: msg.content, type: 'success', duration: 500 })
        break
      }
      case ProxyMock.BizType.ClientInfos: {
        this.commonStore.updateClientInfos(msg.content)
        break
      }
    }
  }
}
