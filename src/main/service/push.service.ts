import { Server } from 'http'
import { injectable } from 'inversify'
import { Connection, createServer, Server as SockServer } from 'sockjs'
import { ProxyMock } from '@shared/proxy.models'
import type { MockStatusBroadcast } from '@shared/mock.models'
import { generateUid } from '@shared/uid'

type PushClient = { conn: Connection, uid: string, username: string, connId: string }
type DeviceClient = { uid: string, ownerUid: string, username: string }

@injectable()
export class PushService {
  pushClients: Map<string, PushClient>
  private devices: Map<string, DeviceClient>
  private sockjsServer: SockServer

  // 连接断开/重新注册时由外部清理该 uid 对应的代理与 Mock 状态
  public onClientClosed?: (uid: string) => void

  constructor() {
    this.pushClients = new Map()
    this.devices = new Map()
    this.sockjsServer = createServer({ prefix: '/echo', websocket: true })
    this.sockjsServer.on('connection', (conn: any) => {
      conn.on('data', (data: any) => { this.handleMsg(conn, data) })
      conn.on('close', () => { this.handleClose(conn) })
      conn.on("error", () => { this.handleError(conn) })
    })
  }

  public bindServer(httpServer: Server) {
    this.sockjsServer.installHandlers(httpServer)
  }

  public closeWebSocketServer(callback?: any) {
    this.pushClients.forEach(it => {
      it.conn.close()
      it.conn.destroy()
    })
    this.pushClients.clear()
    this.devices.clear()
    callback?.()
  }

  public sendMessage(clientUid: string, data: ProxyMock.PushMsg<any>) {
    this.safeWrite(this.resolveOwnerUid(clientUid), data)
  }

  // Mock 开关是多窗口共享状态：任一窗口切换后广播给所有 viewer
  public broadcastMockStatus(status: MockStatusBroadcast) {
    const msg: ProxyMock.PushMsg<MockStatusBroadcast> = {
      type: ProxyMock.PushMsgType.TXT,
      payload: {
        type: ProxyMock.BizType.MockStatus,
        content: status,
      }
    }
    this.pushClients.forEach((_, uid) => this.safeWrite(uid, msg))
  }

  public sendProxyMessage(clientUid: string,
    data: ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord | ProxyMock.SocketRecord) {

    let pushMsg: ProxyMock.PushMsg<ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord | ProxyMock.SocketRecord> = {
      type: ProxyMock.PushMsgType.TXT,
      payload: {
        type: ProxyMock.BizType.Proxy,
        content: data
      }
    }
    this.sendMessage(clientUid, pushMsg)
  }

  // WebSocket 客户端 UID 无对应 viewer 时，广播给所有 viewer
  public broadcastProxyMessage(
    data: ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord | ProxyMock.SocketRecord) {

    const pushMsg: ProxyMock.PushMsg<ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord | ProxyMock.SocketRecord> = {
      type: ProxyMock.PushMsgType.TXT,
      payload: {
        type: ProxyMock.BizType.Proxy,
        content: data
      }
    }
    this.pushClients.forEach((_, uid) => this.safeWrite(uid, pushMsg))
  }

  // 设备 uid 的推送统一交给所属 viewer，保证请求记录展示在扫码的桌面端
  public resolveOwnerUid(uid: string): string {
    return this.devices.get(uid)?.ownerUid ?? uid
  }

  public hasClient(uid: string): boolean {
    return this.pushClients.has(uid) || this.devices.has(uid)
  }

  // viewer 每次注册都由服务端分配新的 uid，避免同一个 uid 被多次注册、串流
  public registerClient(conn: Connection, username?: string): ProxyMock.RegisterResult {
    const uid = this.nextUid()
    // 同一连接重复注册时，把该连接旧 uid 名下的设备迁移到新 uid
    this.detachConnection(conn, uid)
    this.pushClients.set(uid, { conn, uid, username: username ?? '', connId: conn.id })

    const result: ProxyMock.RegisterResult = { uid, message: '注册成功' }
    this.sendMessage(uid, {
      type: ProxyMock.PushMsgType.CMD,
      payload: {
        type: ProxyMock.CMDType.REGISTERED,
        content: result
      }
    })
    this.boardcastClientInfos()
    return result
  }

  // 设备通过注册地址接入：分配独立 uid，并归属到扫码的 viewer
  public registerDevice(ownerUid: string, username?: string): ProxyMock.RegisterResult {
    if (ownerUid == null || ownerUid.length === 0) throw new Error('invalid uid')
    const owner = this.pushClients.get(ownerUid)
    if (owner == null) throw new Error(`client [${ownerUid}] is not online`)

    const uid = this.nextUid()
    this.devices.set(uid, { uid, ownerUid, username: username ?? owner.username })

    const result: ProxyMock.RegisterResult = { uid, ownerUid, message: '注册成功' }
    this.sendMessage(ownerUid, {
      type: ProxyMock.PushMsgType.CMD,
      payload: {
        type: ProxyMock.CMDType.DEVICE_REGISTERED,
        content: result
      }
    })
    this.boardcastClientInfos()
    return result
  }

  public getAllPushClients() {
    let result: ProxyMock.MsgPushClient[] = []
    this.pushClients.forEach(it => {
      result.push({
        connId: it.conn.id,
        uid: it.uid,
        username: it.username,
        ip: it.conn.remoteAddress,
        port: it.conn.remotePort,
        kind: 'viewer'
      })
    })
    this.devices.forEach(it => {
      result.push({
        connId: '',
        uid: it.uid,
        username: it.username,
        ip: '-',
        port: 0,
        kind: 'device',
        ownerUid: it.ownerUid
      })
    })

    return result
  }

  private handleMsg(conn: Connection, data: any) {
    let msg: ProxyMock.PushMsg<any>
    try {
      msg = JSON.parse(String(data))
    } catch (err) {
      console.warn('push message parse failed:', err)
      return
    }
    if (msg?.payload == null) return

    switch (msg.type) {
      case ProxyMock.PushMsgType.CMD: {
        this.handleCMD(conn, msg)
        break
      }
      case ProxyMock.PushMsgType.TXT: {
        this.handleTXT(conn, msg)
        break
      }
    }
  }

  private handleClose(conn: Connection) {
    this.removeClient(conn)
  }

  private handleError(conn: Connection) {
    this.removeClient(conn)
  }

  private removeClient(conn: Connection) {
    if (this.detachConnection(conn)) this.boardcastClientInfos()
  }

  // 移除连接持有的 uid（及其名下设备）；remapTo 用于同连接重新注册时迁移设备
  private detachConnection(conn: Connection, remapTo?: string): boolean {
    let changed = false
    const stale = [...this.pushClients.values()].filter(it => it.connId == conn.id)
    for (const client of stale) {
      this.pushClients.delete(client.uid)
      changed = true

      const devices = [...this.devices.values()].filter(it => it.ownerUid == client.uid)
      for (const device of devices) {
        if (remapTo == null) {
          this.dropDevice(device.uid)
        } else {
          device.ownerUid = remapTo
        }
      }
      this.onClientClosed?.(client.uid)
    }
    return changed
  }

  private dropDevice(uid: string) {
    if (!this.devices.delete(uid)) return
    this.onClientClosed?.(uid)
  }

  private nextUid(): string {
    let uid = generateUid()
    while (this.pushClients.has(uid) || this.devices.has(uid)) uid = generateUid()
    return uid
  }

  private safeWrite(uid: string, payload: any) {
    const client = this.pushClients.get(uid)
    if (client == null) return
    try {
      client.conn.write(JSON.stringify(payload))
    } catch (err) {
      console.warn(`push write failed [${uid}]:`, err)
    }
  }

  private handleCMD(conn: Connection, msg: ProxyMock.PushMsg<any>) {
    switch (msg.payload.type) {
      case ProxyMock.CMDType.REGISTER:
        this.registerClient(conn, this.registerUsername(msg.payload.content))
        break
      case ProxyMock.CMDType.RECONNECT:
        break
      case ProxyMock.CMDType.KICKDOWN:
        this.safeWrite(msg.to, msg)
        break
    }
  }

  private registerUsername(content: any): string {
    if (typeof content === 'string') return content
    return content?.username ?? ''
  }

  private handleTXT(conn: any, msg: ProxyMock.PushMsg<any>) {
    switch (msg.payload.type) {
      case ProxyMock.BizType.IM: {
        if (msg.to == null) { // boardcast to everyone
          this.pushClients.forEach((it, uid) => {
            if (it.uid != msg.from) this.safeWrite(uid, msg)
          })
        } else {
          this.safeWrite(this.resolveOwnerUid(msg.to), msg)
        }
        break
      }
    }
  }

  private boardcastClientInfos() {
    const data = this.getAllPushClients()

    let msg: ProxyMock.PushMsg<Array<ProxyMock.ClientInfo>> = {
      type: ProxyMock.PushMsgType.TXT,
    }

    msg.payload = {
      type: ProxyMock.BizType.ClientInfos,
      content: data
    }

    this.pushClients.forEach((_, uid) => {
      this.safeWrite(uid, msg)
    })
  }
}
