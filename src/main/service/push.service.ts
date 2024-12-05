import { Server } from 'http'
import { injectable } from 'inversify'
import "reflect-metadata"
import { Connection, createServer, Server as SockServer } from 'sockjs'
import { ProxyMock } from '../../common'

type PushClient = { conn: Connection, uid: string, username: string, connId: string }

export interface IPushService {
  bindServer(httpServer: Server): void
  closeWebSocketServer(callback: any): void
  sendMessage(clientUid: String, data: ProxyMock.PushMsg<any>): void
  sendProxyMessage(clientUid: String, data: ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord): void
  hasProxy(uid: string): boolean
  getAllPushClients(): ProxyMock.MsgPushClient[]
}

@injectable()
export class PushService implements IPushService {
  pushClients: Map<String, PushClient>
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

  public closeWebSocketServer(callback: any) {
    this.pushClients.forEach(it => {
      it.conn.close()
      it.conn.destroy()
    })
    this.pushClients.clear()
    this.sockjsServer
  }

  public sendMessage(clientUid: String, data: ProxyMock.PushMsg<any>) {
    if (this.pushClients.has(clientUid)) {
      this.pushClients.get(clientUid).conn.write(JSON.stringify(data))
    }
  }

  public sendProxyMessage(clientUid: String, data: ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord) {

    let pushMsg: ProxyMock.PushMsg<ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord> = {
      type: ProxyMock.PushMsgType.TXT,
      payload: {
        type: ProxyMock.BizType.Proxy,
        content: data
      }
    }
    if (this.pushClients.has(clientUid)) {
      this.pushClients.get(clientUid).conn.write(JSON.stringify(pushMsg))
    }
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
    let msg: ProxyMock.PushMsg<any> = JSON.parse(data)
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
    let keys = [...this.pushClients.keys()]
    keys.forEach(key => {
      if (this.pushClients.get(key).connId == conn.id) { this.pushClients.delete(key) }
    })

    this.boardcastClientInfos()
  }

  private handleError(conn: Connection) {
    let keys = [...this.pushClients.keys()]
    keys.forEach(key => {
      if (this.pushClients.get(key).connId == conn.id) this.pushClients.delete(key)
    })

    this.boardcastClientInfos()
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
        if (this.pushClients.has(msg.to))
          this.pushClients.get(msg.to).conn.write(JSON.stringify(msg))
        break
    }
  }

  private handleTXT(conn: any, msg: ProxyMock.PushMsg<any>) {
    switch (msg.payload.type) {
      case ProxyMock.BizType.IM: {
        if (msg.to == null) { // boardcast to everyone
          this.pushClients.forEach(it => {
            if (it.uid != msg.from) it.conn.write(JSON.stringify(msg))
          })
        } else {
          this.pushClients.get(msg.to).conn.write(JSON.stringify(msg))
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

    this.pushClients.forEach(it => {
      it.conn.write(JSON.stringify(msg))
    })
  }
}