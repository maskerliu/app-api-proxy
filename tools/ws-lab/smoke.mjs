#!/usr/bin/env node
// ws-lab 冒烟测试：不需要 AppApiProxy，直接验证 lab 的服务端契约。
import assert from 'node:assert/strict'
import process from 'node:process'
import { WebSocket } from 'ws'
import { startLabServer } from './server.mjs'

const DELAY = ms => new Promise(resolve => setTimeout(resolve, ms))
const lab = startLabServer({ port: 0, host: '127.0.0.1', silent: true })
const address = await lab.listen()
const port = address.port
const base = `http://127.0.0.1:${port}`
const opened = []
const passed = []

function ok(name) {
  passed.push(name)
  console.log(`  ok  ${name}`)
}

async function api(path, body) {
  const options = body === undefined
    ? undefined
    : {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  const res = await fetch(`${base}${path}`, options)
  const data = await res.json().catch(() => null)
  assert.equal(res.ok, true, `HTTP ${res.status} ${path}: ${JSON.stringify(data)}`)
  return data
}

function createInbox(ws) {
  const items = []
  const waiters = []

  const deliver = item => {
    for (let i = 0; i < waiters.length; i++) {
      const waiter = waiters[i]
      if (waiter.predicate(item)) {
        waiters.splice(i, 1)
        clearTimeout(waiter.timer)
        waiter.resolve(item)
        return
      }
    }
    items.push(item)
  }

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      deliver({ binary: Buffer.from(data) })
      return
    }
    const text = data.toString()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      parsed = { raw: text }
    }
    deliver(parsed)
  })

  return {
    items,
    next(predicate = () => true, timeout = 2000) {
      const index = items.findIndex(predicate)
      if (index >= 0) return Promise.resolve(items.splice(index, 1)[0])
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null }
        waiter.timer = setTimeout(() => {
          const i = waiters.indexOf(waiter)
          if (i >= 0) waiters.splice(i, 1)
          reject(new Error('timeout waiting for expected message'))
        }, timeout)
        waiters.push(waiter)
      })
    },
    clear() {
      items.length = 0
    },
  }
}

function openClient(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    const inbox = createInbox(ws)
    ws.once('open', () => {
      const client = { ws, inbox }
      opened.push(client)
      resolve(client)
    })
    ws.once('error', reject)
  })
}

let a = null
let b = null
let c = null

try {
  const health = await api('/api/health')
  assert.equal(health.ok, true)
  ok('GET /api/health')

  const indexHtml = await (await fetch(`${base}/`)).text()
  assert.match(indexHtml, /连接配置/)
  assert.match(indexHtml, /client\.js/)
  const adminHtml = await (await fetch(`${base}/admin`)).text()
  assert.match(adminHtml, /推送控制/)
  assert.match(adminHtml, /admin\.js/)
  ok('static client/admin pages')

  await assert.rejects(openClient('/nope'), /404/)
  ok('unknown upgrade path returns 404')

  a = await openClient('/ws?name=smoke-a')
  b = await openClient('/ws?name=smoke-b')
  const welcomeA = await a.inbox.next(m => m.kind === 'welcome')
  assert.equal(welcomeA.name, 'smoke-a')
  assert.equal(welcomeA.path, '/ws')
  assert.equal(welcomeA.query.name, 'smoke-a')
  const welcomeB = await b.inbox.next(m => m.kind === 'welcome')
  assert.equal(welcomeB.name, 'smoke-b')
  ok('welcome envelope with upstream-visible path/query')

  const clients = await api('/api/clients')
  assert.equal(clients.length, 2)
  const clientA = clients.find(it => it.name === 'smoke-a')
  const clientB = clients.find(it => it.name === 'smoke-b')
  assert.ok(clientA != null && clientB != null)
  assert.equal(clientA.readyState, WebSocket.OPEN)
  ok('GET /api/clients')

  a.inbox.clear()
  a.ws.send('hello')
  const echo = await a.inbox.next(m => m.kind === 'echo')
  assert.equal(echo.payload, 'hello')
  ok('text echo')

  a.inbox.clear()
  a.ws.send(Buffer.from([1, 2, 3, 250]))
  const echoBinary = await a.inbox.next(m => m.binary != null)
  assert.deepEqual([...echoBinary.binary], [1, 2, 3, 250])
  ok('binary echo')

  a.inbox.clear()
  b.inbox.clear()
  const pushAll = await api('/api/push', { target: 'all', type: 'text', data: 'tick' })
  assert.equal(pushAll.sent, 2)
  assert.equal((await a.inbox.next(m => m.kind === 'push')).payload, 'tick')
  assert.equal((await b.inbox.next(m => m.kind === 'push')).payload, 'tick')
  ok('push text to all clients')

  a.inbox.clear()
  b.inbox.clear()
  const pushOne = await api('/api/push', { target: clientA.id, type: 'text', data: 'only-a' })
  assert.equal(pushOne.sent, 1)
  assert.equal((await a.inbox.next(m => m.kind === 'push')).payload, 'only-a')
  await DELAY(250)
  assert.equal(b.inbox.items.filter(m => m.kind === 'push').length, 0)
  ok('push text to a single client')

  a.inbox.clear()
  const binPayload = Buffer.from('hello-bin')
  await api('/api/push', { target: 'all', type: 'binary', data: binPayload.toString('base64') })
  const pushedBinary = await a.inbox.next(m => m.binary != null)
  assert.equal(pushedBinary.binary.toString(), 'hello-bin')
  ok('push binary payload')

  c = await openClient('/ws?name=smoke-no-echo&echo=0')
  await c.inbox.next(m => m.kind === 'welcome')
  c.inbox.clear()
  c.ws.send('no echo please')
  await DELAY(250)
  assert.equal(c.inbox.items.length, 0)
  ok('echo=0 disables echo')

  const closed = new Promise(resolve => {
    b.ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
  })
  const closeRes = await api('/api/close', { target: clientB.id, code: 4001, reason: 'smoke bye' })
  assert.equal(closeRes.closed, 1)
  const closeEvent = await closed
  assert.equal(closeEvent.code, 4001)
  assert.equal(closeEvent.reason, 'smoke bye')
  await DELAY(100)
  assert.equal((await api('/api/clients')).length, 2)
  ok('close with code/reason propagates')

  const logs = await api('/api/logs?limit=200')
  assert.ok(logs.some(it => it.message.includes('client connected')))
  assert.ok(logs.some(it => it.level === 'recv'))
  ok('GET /api/logs records connection and receive events')

  console.log(`\nPASS ${passed.length} checks`)
} catch (err) {
  console.error('\nFAIL', err)
  process.exitCode = 1
} finally {
  for (const client of opened) {
    try {
      client.ws.terminate()
    } catch (err) {
      // 忽略
    }
  }
  await lab.close()
}