import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, 'public')
const DEFAULT_PORT = 8890
const DEFAULT_HOST = '127.0.0.1'
const MAX_BODY = 2 * 1024 * 1024
const MAX_LOGS = 500

const STATIC_ROUTES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/client': 'index.html',
  '/admin': 'admin.html',
  '/admin.html': 'admin.html',
  '/styles.css': 'styles.css',
  '/client.js': 'client.js',
  '/admin.js': 'admin.js',
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...corsHeaders(),
  })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        reject(new Error('invalid json body'))
      }
    })
    req.on('error', reject)
  })
}

function serveStatic(res, fileName) {
  const filePath = path.join(PUBLIC_DIR, fileName)
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { ok: false, error: 'not found' })
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, {
      'content-type': MIME_TYPES[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(data)
  })
}

function publicClient(client) {
  return {
    id: client.id,
    name: client.name,
    ip: client.ip,
    connectedAt: client.connectedAt,
    received: client.received,
    sent: client.sent,
    lastMessageAt: client.lastMessageAt,
    readyState: client.ws.readyState,
    protocol: client.ws.protocol || '',
  }
}

function selectTargets(clients, target) {
  if (target == null || target === '' || target === 'all') return [...clients.values()]
  const client = clients.get(String(target))
  return client == null ? [] : [client]
}

export function startLabServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? DEFAULT_PORT)
  const host = options.host ?? process.env.HOST ?? DEFAULT_HOST
  const silent = options.silent === true
  const clients = new Map()
  const logs = []

  const log = (level, message, clientId) => {
    const entry = { at: Date.now(), level, message, clientId: clientId ?? null }
    logs.push(entry)
    if (logs.length > MAX_LOGS) logs.shift()
    if (silent) return
    const prefix = clientId == null ? '' : `[${String(clientId).slice(0, 8)}] `
    console.log(`${new Date(entry.at).toISOString()} ${level.toUpperCase()} ${prefix}${message}`)
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders())
      res.end()
      return
    }

    let url
    try {
      url = new URL(req.url, `http://${req.headers.host ?? 'lab.local'}`)
    } catch (err) {
      sendJson(res, 400, { ok: false, error: 'invalid url' })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        uptime: Math.floor(process.uptime()),
        clients: clients.size,
        now: Date.now(),
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/clients') {
      sendJson(res, 200, [...clients.values()].map(publicClient))
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/logs') {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50))
      sendJson(res, 200, logs.slice(-limit))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/push') {
      try {
        const body = await readBody(req)
        const targets = selectTargets(clients, body.target)
        const type = body.type === 'binary' ? 'binary' : 'text'
        const raw = String(body.data ?? '')
        const payload = type === 'binary'
          ? Buffer.from(raw.replace(/\s+/g, ''), 'base64')
          : JSON.stringify({ kind: 'push', id: randomUUID(), ts: Date.now(), payload: raw })

        let sent = 0
        for (const client of targets) {
          if (client.ws.readyState !== WebSocket.OPEN) continue
          client.ws.send(payload)
          client.sent += 1
          sent += 1
        }
        log('info', `push ${type} -> ${body.target ?? 'all'} (${sent})`)
        sendJson(res, 200, { ok: true, sent, target: body.target ?? 'all', type })
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message })
      }
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/close') {
      try {
        const body = await readBody(req)
        const targets = selectTargets(clients, body.target)
        const code = Number(body.code) || 1000
        const reason = String(body.reason ?? '')
        for (const client of targets) {
          try {
            client.ws.close(code, reason)
          } catch (err) {
            client.ws.terminate()
          }
        }
        log('info', `close ${body.target ?? 'all'} code=${code} (${targets.length})`)
        sendJson(res, 200, { ok: true, closed: targets.length, code })
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message })
      }
      return
    }

    if (req.method === 'GET' && STATIC_ROUTES[url.pathname] != null) {
      serveStatic(res, STATIC_ROUTES[url.pathname])
      return
    }

    sendJson(res, 404, { ok: false, error: 'not found' })
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 50 * 1024 * 1024 })

  server.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url, `http://${req.headers.host ?? 'lab.local'}`)
    } catch (err) {
      socket.destroy()
      return
    }
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'lab.local'}`)
    const id = randomUUID()
    const name = url.searchParams.get('name') || `client-${id.slice(0, 4)}`
    const echo = url.searchParams.get('echo') !== '0'
    const client = {
      id,
      name,
      ip: req.socket.remoteAddress ?? '',
      connectedAt: Date.now(),
      received: 0,
      sent: 0,
      lastMessageAt: null,
      ws,
    }
    clients.set(id, client)
    ws.isAlive = true

    ws.on('pong', () => { ws.isAlive = true })

    ws.send(JSON.stringify({
      kind: 'welcome',
      clientId: id,
      name,
      ts: Date.now(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      handshake: {
        protocol: ws.protocol || '',
        host: req.headers.host ?? '',
        origin: req.headers.origin ?? '',
        userAgent: req.headers['user-agent'] ?? '',
      },
    }))
    log('info', `client connected: ${name}`, id)

    ws.on('message', (data, isBinary) => {
      client.received += 1
      client.lastMessageAt = Date.now()
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
      const text = isBinary ? buffer.toString('base64') : buffer.toString('utf8')
      log('recv', `${isBinary ? 'binary' : 'text'} ${text.slice(0, 160)}`, id)

      if (!echo || ws.readyState !== WebSocket.OPEN) return
      if (isBinary) {
        ws.send(buffer, { binary: true })
      } else {
        ws.send(JSON.stringify({ kind: 'echo', id: randomUUID(), ts: Date.now(), payload: text }))
      }
    })

    const drop = (reason) => {
      if (!clients.delete(id)) return
      log('info', `client disconnected: ${reason}`, id)
    }
    ws.on('close', (code, reason) => {
      drop(`code=${code} reason=${reason?.toString() ?? ''}`)
    })
    ws.on('error', (err) => {
      log('error', err.message, id)
      drop(`error=${err.message}`)
    })
  })

  const heartbeat = setInterval(() => {
    for (const client of clients.values()) {
      if (client.ws.isAlive === false) {
        client.ws.terminate()
        continue
      }
      client.ws.isAlive = false
      try {
        client.ws.ping()
      } catch (err) {
        client.ws.terminate()
      }
    }
  }, 30000)
  heartbeat.unref()

  const listen = () => new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve(server.address())
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })

  const close = async () => {
    clearInterval(heartbeat)
    for (const client of clients.values()) {
      try {
        client.ws.terminate()
      } catch (err) { }
    }
    clients.clear()
    await new Promise(resolve => wss.close(() => resolve()))
    if (server.listening) {
      await new Promise(resolve => {
        server.close(() => resolve())
        // fetch 的 keep-alive 连接不会自己断开，主动清理避免 close 等待
        server.closeAllConnections?.()
      })
    }
  }

  return { server, wss, clients, logs, listen, close }
}

const isMain = process.argv[1] != null
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMain) {
  const lab = startLabServer()
  const address = await lab.listen()
  const host = typeof address === 'string' ? address : address.address
  const port = typeof address === 'string' ? '' : address.port
  console.log(`ws-lab listening on http://${host}:${port}`)
  console.log(`  client: http://${host}:${port}/`)
  console.log(`  admin : http://${host}:${port}/admin`)
  console.log(`  ws    : ws://${host}:${port}/ws`)
  console.log('  proxy mode expects AppApiProxy running, default ws://127.0.0.1:8884')

  const shutdown = async () => {
    await lab.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}