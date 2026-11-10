import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { registerHooks } from 'node:module'
import { after, describe, it } from 'node:test'
import { WebSocket } from 'ws'
import { ProxyMock } from '@shared/proxy.models'
import { startLabServer } from '../../tools/ws-lab/server.mjs'

// 服务模块会经 MainConst 引用 electron，单测环境用最小 app 替身
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>process.env.TMPDIR||"/tmp"}',
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { SocketProxyService } = await import('@main/service/socket-proxy.service')

const UID = 'ws-it'
const pushed: ProxyMock.SocketRecord[] = []
// UID 无对应 viewer 时的兜底广播，与 PushService.broadcastProxyMessage 同名同参
const broadcasted: ProxyMock.SocketRecord[] = []
const diagnostics = {
  requests: [] as any[],
  errors: [] as any[],
  recordRequest(entry: any) { this.requests.push(entry) },
  recordError(entry: any) { this.errors.push(entry) },
}
const pushService = {
  hasClient: (uid: string) => uid === UID,
  sendProxyMessage: (_uid: string, record: ProxyMock.SocketRecord) => { pushed.push(record) },
  broadcastProxyMessage: (record: ProxyMock.SocketRecord) => { broadcasted.push(record) },
}
const proxyService = {
  getProxyConfig: (_uid: string) => ({ status: false, delay: 0, dataServer: '' }),
}

const lab = startLabServer({ port: 0, host: '127.0.0.1', silent: true })
const labAddress = await lab.listen()
const labPort = labAddress.port

const service = new SocketProxyService()
;(service as any).pushService = pushService
;(service as any).proxyService = proxyService
;(service as any).diagnosticService = diagnostics

const proxyServer = http.createServer((_req, res) => {
  res.writeHead(404)
  res.end()
})
service.bindServer(proxyServer)
await new Promise<void>(resolve => proxyServer.listen(0, '127.0.0.1', () => resolve()))
const proxyPort = (proxyServer.address() as AddressInfo).port

const clients: WebSocket[] = []

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(predicate: () => boolean, message: string, timeout = 3000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (predicate()) return
    await delay(20)
  }
  assert.fail(message)
}

function proxyQuery(extra: string, host: string = `127.0.0.1:${labPort}`): string {
  return `__mock_host=${encodeURIComponent(host)}&__mock_uid=${UID}&${extra}`
}

interface Inbox {
  items: any[]
  next(predicate?: (msg: any) => boolean, timeout?: number): Promise<any>
}

interface OpenClient {
  ws: WebSocket
  inbox: Inbox
}

// 从建连开始缓存消息：欢迎帧可能与 open 在同一轮事件里到达
function createInbox(ws: WebSocket): Inbox {
  const items: any[] = []
  const waiters: { predicate: (msg: any) => boolean, resolve: (msg: any) => void, timer: any }[] = []

  ws.on('message', (data: any, isBinary: boolean) => {
    let item: any
    if (isBinary) {
      item = { binary: Buffer.from(data) }
    } else {
      try {
        item = JSON.parse(data.toString())
      } catch (err) {
        item = { raw: data.toString() }
      }
    }
    const index = waiters.findIndex(it => it.predicate(item))
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1)
      clearTimeout(waiter.timer)
      waiter.resolve(item)
      return
    }
    items.push(item)
  })

  return {
    items,
    next(predicate = () => true, timeout = 3000) {
      const index = items.findIndex(predicate)
      if (index >= 0) return Promise.resolve(items.splice(index, 1)[0])
      return new Promise((resolve, reject) => {
        const waiter: any = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            const i = waiters.indexOf(waiter)
            if (i >= 0) waiters.splice(i, 1)
            reject(new Error('timeout waiting for message'))
          }, timeout),
        }
        waiters.push(waiter)
      })
    },
  }
}

function openProxy(query: string, options: { protocols?: string[] } = {}): Promise<OpenClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/_proxy/ws?${query}`, options.protocols)
    clients.push(ws)
    const inbox = createInbox(ws)
    ws.once('open', () => resolve({ ws, inbox }))
    ws.once('error', reject)
  })
}

function handshakeFailure(query: string): Promise<{ status?: number, code?: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/_proxy/ws?${query}`)
    clients.push(ws)
    ws.once('unexpected-response', (_req, res) => {
      const code = res.headers['x-mock-ws-error']
      res.resume()
      resolve({ status: res.statusCode, code: typeof code === 'string' ? code : undefined })
    })
    ws.once('error', reject)
  })
}

after(async () => {
  for (const ws of clients) {
    try {
      ws.terminate()
    } catch (err) {
      // ignore
    }
  }
  service.closeAll()
  await new Promise<void>(resolve => proxyServer.close(() => resolve()))
  await lab.close()
})

describe('SocketProxyService 经 /_proxy 端到端', () => {
  it('查询参数接入：欢迎帧、命令头被剥离、快照可见', async () => {
    const { ws, inbox } = await openProxy(proxyQuery('name=it-a&echo=1'))
    const welcome = await inbox.next(msg => msg.kind === 'welcome')

    assert.equal(welcome.path, '/ws')
    assert.equal(welcome.query.name, 'it-a')
    assert.equal(welcome.query.echo, '1')
    assert.equal(welcome.query.__mock_host, undefined)
    assert.equal(welcome.query.__mock_uid, undefined)
    assert.equal(ws.extensions, '')

    await waitFor(() => service.getActiveConnections().length === 1, 'open connection not exposed')
    const openRecord = pushed.find(it => it.wsPhase === 'open')
    assert.ok(openRecord != null)
    assert.equal(openRecord.url, `ws://127.0.0.1:${labPort}/ws?name=it-a&echo=1`)
    assert.equal(openRecord.type, ProxyMock.PorxyType.SOCKET)
    assert.equal(openRecord.wsId, openRecord.id)

    assert.ok(diagnostics.requests.some(it => it.method === 'WS' && it.uid === UID && it.uidKnown === true))
    ws.close(1000, 'done')
  })

  it('文本与二进制双向转发并批量推送帧', async () => {
    const { ws, inbox } = await openProxy(proxyQuery('name=it-b&echo=1'))
    await inbox.next(msg => msg.kind === 'welcome')

    ws.send('hello')
    const echo = await inbox.next(msg => msg.kind === 'echo')
    assert.equal(echo.payload, 'hello')

    const binary = Buffer.from([1, 2, 3, 250])
    ws.send(binary)
    await waitFor(() => pushed.some(it => it.wsPhase === 'frames'
      && (it.frames ?? []).some(f => f.opcode === 'binary' && f.data === binary.toString('base64'))),
    'binary frame not pushed')

    const allFrames = pushed.filter(it => it.wsPhase === 'frames').flatMap(it => it.frames ?? [])
    const textUp = allFrames.find(f => f.dir === 'c2s' && f.opcode === 'text' && f.data === 'hello')
    const echoFrame = allFrames.find(f => f.dir === 's2c' && f.opcode === 'text'
      && f.data.includes('"kind":"echo"') && f.data.includes('"payload":"hello"'))
    assert.ok(textUp != null, 'c2s text frame missing')
    assert.ok(echoFrame != null, 's2c echo frame missing')

    ws.close(1000, 'done')
    await waitFor(() => service.getActiveConnections().length === 0, 'connection not released')
  })

  it('客户端关闭时记录关闭码、原因与关闭方', async () => {
    const before = pushed.length
    const { ws, inbox } = await openProxy(proxyQuery('name=it-c&echo=0'))
    await inbox.next(msg => msg.kind === 'welcome')

    ws.close(4001, 'client bye')
    await waitFor(() => pushed.slice(before).some(it => it.wsPhase === 'close'), 'close record not pushed')

    const close = pushed.slice(before).find(it => it.wsPhase === 'close')
    assert.equal(close.closeCode, 4001)
    assert.equal(close.closeReason, 'client bye')
    assert.equal(close.closeBy, 'client')
    assert.equal(service.getActiveConnections().length, 0)
  })

  it('缺少目标地址返回 400 + WS-E01', async () => {
    const failure = await handshakeFailure('name=it-d')
    assert.equal(failure.status, 400)
    assert.equal(failure.code, ProxyMock.SocketErrorCode.MISSING_TARGET)
    assert.ok(diagnostics.errors.some(it => it.error.includes(ProxyMock.SocketErrorCode.MISSING_TARGET)))
  })

  it('上游不可达返回 502 + WS-E04', async () => {
    const closed = http.createServer()
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', () => resolve()))
    const closedPort = (closed.address() as AddressInfo).port
    await new Promise<void>(resolve => closed.close(() => resolve()))

    const failure = await handshakeFailure(proxyQuery('name=it-e', `127.0.0.1:${closedPort}`))
    assert.equal(failure.status, 502)
    assert.equal(failure.code, ProxyMock.SocketErrorCode.CONNECT_FAILED)

    await waitFor(() => pushed.some(it => it.wsPhase === 'close'
      && it.errorCode === ProxyMock.SocketErrorCode.CONNECT_FAILED), 'failed connection not pushed')
  })

  it('未注册 uid 走兜底广播，代理链路仍完成', async () => {
    const sentBefore = pushed.length
    const broadcastBefore = broadcasted.length
    const query = `__mock_host=${encodeURIComponent(`127.0.0.1:${labPort}`)}&__mock_uid=offline-uid&name=it-f&echo=1`
    const { ws, inbox } = await openProxy(query)
    const welcome = await inbox.next(msg => msg.kind === 'welcome')
    assert.equal(welcome.query.name, 'it-f')

    ws.close(1000, 'done')
    await waitFor(() => broadcasted.slice(broadcastBefore).some(it => it.wsPhase === 'close'),
      'offline uid not broadcast')
    // 未注册的 uid 不该再走定向推送，否则会写进别人会话的缓冲区
    assert.equal(pushed.length, sentBefore)
  })
})