import { Server } from 'http'
import { injectable } from 'inversify'
import { Connection, createServer, Server as SockServer } from 'sockjs'
import { ProxyMock } from '@shared/proxy.models'

type PushClient = { conn: Connection, uid: string, username: string, connId: string }

@injectable()
export class PushService {
  pushClients: Map<string, PushClient>
  private sockjsServer: SockServer

  constructor() {
    this.pushClients = new Map()
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
    callback?.()
  }

  public sendMessage(clientUid: string, data: ProxyMock.PushMsg<any>) {
    this.safeWrite(clientUid, data)
  }

  public sendProxyMessage(clientUid: string, data: ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord) {

    let pushMsg: ProxyMock.PushMsg<ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord> = {
      type: ProxyMock.PushMsgType.TXT,
      payload: {
        type: ProxyMock.BizType.Proxy,
        content: data
      }
    }
    this.safeWrite(clientUid, pushMsg)
  }

  public hasProxy(uid: string): boolean {
    return this.pushClients.has(uid)
  }

  public getAllPushClients() {
    let result: ProxyMock.MsgPushClient[] = []
    this.pushClients.forEach(it => {
      result.push({
        connId: it.conn.id,
        uid: it.uid,
        username: it.username,
        ip: it.conn.remoteAddress,
        port: it.conn.remotePort
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
    const keys = [...this.pushClients.keys()]
    keys.forEach(key => {
      if (this.pushClients.get(key)?.connId == conn.id) this.pushClients.delete(key)
    })

    this.boardcastClientInfos()
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
        let client: PushClient = {
          conn: conn,
          uid: msg.payload.content.uid,
          username: msg.payload.content.username,
          connId: conn.id
        }
        this.pushClients.set(client.uid, client)
        this.boardcastClientInfos()
        break
      case ProxyMock.CMDType.RECONNECT:
        break
      case ProxyMock.CMDType.KICKDOWN:
        this.safeWrite(msg.to, msg)
        break
    }
  }

  private handleTXT(conn: any, msg: ProxyMock.PushMsg<any>) {
    switch (msg.payload.type) {
      case ProxyMock.BizType.IM: {
        if (msg.to == null) { // boardcast to everyone
          this.pushClients.forEach((it, uid) => {
            if (it.uid != msg.from) this.safeWrite(uid, msg)
          })
        } else {
          this.safeWrite(msg.to, msg)
        }
        break
      }
    }
  }

  private boardcastClientInfos() {
    let data: Array<ProxyMock.ClientInfo> = []

    this.pushClients.forEach(it => {
      data.push({
        connId: it.conn.id,
        uid: it.uid,
        username: it.username,
        ip: it.conn.remoteAddress,
        port: it.conn.remotePort
      })
    })

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