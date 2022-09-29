import { Request, Response } from "express"
import { Server } from "http"
import { Connection, createServer, Server as SockServer } from "sockjs"
import { BizCode, BizResponse, BizType, ClientInfo, CMDType, MsgPushClient, ProxyRequestRecord, ProxyStatRecord, PushMsg, PushMsgType } from "../common/models/DataModels"

type PushClient = { conn: Connection, uid: String, username: String, connId: string }

class PushService {
  public pushClients: Map<String, PushClient> = new Map() // key: uid
  private sockjsServer: SockServer

  constructor() {
    this.sockjsServer = createServer({ prefix: '/echo', transports: 'websocket' })
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

  public sendMessage(clientUid: String, data: PushMsg<any>) {
    if (this.pushClients.has(clientUid)) {
      this.pushClients.get(clientUid).conn.write(JSON.stringify(data))
    }
  }

  public sendProxyMessage(clientUid: String, data: ProxyRequestRecord | ProxyStatRecord) {

    let pushMsg: PushMsg<ProxyRequestRecord | ProxyStatRecord> = {
      type: PushMsgType.TXT,
      payload: {
        type: BizType.Proxy,
        content: data
      }
    }
    if (this.pushClients.has(clientUid)) {
      this.pushClients.get(clientUid).conn.write(JSON.stringify(pushMsg))
    }
  }

  public getAllPushClients(req: Request, resp: Response) {
    let bizResp: BizResponse<Array<MsgPushClient>> = new BizResponse<Array<MsgPushClient>>()
    bizResp.code = BizCode.SUCCESS
    bizResp.data = []

    this.pushClients.forEach(it => {
      bizResp.data.push({
        key: it.conn.id,
        uid: it.uid,
        username: it.username,
        ip: it.conn.remoteAddress,
        port: it.conn.remotePort
      })
    })

    resp.json(bizResp)
    resp.end()
  }

  private handleMsg(conn: Connection, data: any) {
    let msg: PushMsg<any> = JSON.parse(data)
    switch (msg.type) {
      case PushMsgType.CMD: {
        this.handleCMD(conn, msg)
        break
      }
      case PushMsgType.TXT: {
        this.handleTXT(conn, msg)
        break
      }
    }
  }

  private handleClose(conn: Connection) {

    Object.keys(this.pushClients).forEach(key => {
      if (this.pushClients.get(key).connId == conn.id) { this.pushClients.delete(key) }
    })

    this.boardcastClientInfos()
  }

  private handleError(conn: Connection) {
    Object.keys(this.pushClients).forEach(key => {
      if (this.pushClients.get(key).conn.id == conn.id) this.pushClients.delete(key)
    })

    this.boardcastClientInfos()
  }

  private handleCMD(conn: Connection, msg: PushMsg<any>) {
    switch (msg.payload.type) {
      case CMDType.REGISTER:
        let client: PushClient = {
          conn: conn,
          uid: msg.payload.content.uid,
          username: msg.payload.content.username,
          connId: conn.id
        }
        this.pushClients.set(client.uid, client)
        this.boardcastClientInfos()
        break
      case CMDType.RECONNECT:
        break
      case CMDType.KICKDOWN:
        if (this.pushClients.has(msg.to))
          this.pushClients.get(msg.to).conn.write(JSON.stringify(msg))
        break
    }
  }

  private handleTXT(conn: any, msg: PushMsg<any>) {
    switch (msg.payload.type) {
      case BizType.IM: {
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
    let data: Array<ClientInfo> = []

    this.pushClients.forEach(it => {
      data.push({
        key: it.conn.id,
        uid: it.uid,
        username: it.username,
        ip: it.conn.remoteAddress,
        port: it.conn.remotePort
      })
    })

    let msg: PushMsg<Array<ClientInfo>> = {
      type: PushMsgType.TXT,
    }

    msg.payload = {
      type: BizType.ClientInfos,
      content: data
    }

    this.pushClients.forEach(it => {
      it.conn.write(JSON.stringify(msg))
    })
  }

}

export default new PushService()