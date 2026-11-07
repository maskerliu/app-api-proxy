#!/usr/bin/env node
// 模拟 OkHttp/App 这类可以自定义握手请求头的客户端，用于验证经 AppApiProxy 的 WS 代理链路。
import process from 'node:process'
import readline from 'node:readline'
import { WebSocket } from 'ws'

const HELP = `ws-lab node client

用法:
  node tools/ws-lab/node-client.mjs [options]

选项:
  --target <host|origin>   上游目标，如 127.0.0.1:8890 或 wss://api.example.com
  --proxy <host|origin>    代理地址，填写后走 AppApiProxy；https 代理写 wss://127.0.0.1:8884
  --uid <uid>              代理模式下的 x-mock-uid
  --insecure               跳过 TLS 证书校验（https 代理使用自签名证书时）
  --path <path>            WS 路径，默认 /ws
  --name <name>            客户端名称
  --no-echo                告知 ws-lab 不回显
  --no-reconnect           断线不自动重连
  --heartbeat <ms>         每 N 毫秒发送应用层心跳，0 表示关闭
  --help                   显示帮助

stdin:
  普通行按文本发送；"/bin <base64>" 发送二进制；"/quit" 退出。
`

function parseArgs(argv) {
  const args = {
    target: '127.0.0.1:8890',
    proxy: '',
    uid: 'ws-lab',
    path: '/ws',
    name: 'node-client',
    echo: true,
    reconnect: true,
    heartbeat: 0,
    insecure: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next == null) {
        console.error(`缺少参数值: ${key}`)
        process.exit(1)
      }
      return next
    }

    switch (key) {
      case '--target': args.target = value(); break
      case '--proxy': args.proxy = value(); break
      case '--uid': args.uid = value(); break
      case '--path': args.path = value(); break
      case '--name': args.name = value(); break
      case '--insecure': args.insecure = true; break
      case '--no-echo': args.echo = false; break
      case '--no-reconnect': args.reconnect = false; break
      case '--heartbeat': args.heartbeat = Number(value()) || 0; break
      case '--help':
      case '-h':
        console.log(HELP)
        process.exit(0)
        break
      default:
        console.error(`未知参数: ${key}\n`)
        console.log(HELP)
        process.exit(1)
    }
  }
  return args
}

function cleanHost(value) {
  return String(value ?? '')
    .trim()
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
}

function normalizePath(value) {
  const raw = String(value ?? '').trim() || '/ws'
  return raw.startsWith('/') ? raw : `/${raw}`
}

// 地址里写了 wss:// 或 https:// 就用 wss，否则默认 ws
function resolveScheme(value, fallback = 'ws') {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw.startsWith('wss://') || raw.startsWith('https://')) return 'wss'
  if (raw.startsWith('ws://') || raw.startsWith('http://')) return 'ws'
  return fallback
}

function buildEndpoint(args) {
  const path = normalizePath(args.path)
  const query = new URLSearchParams()
  query.set('name', args.name)
  query.set('echo', args.echo ? '1' : '0')

  if (String(args.proxy).trim() !== '') {
    const proxyHost = cleanHost(args.proxy)
    if (proxyHost === '') throw new Error('代理地址为空')
    const url = new URL(`${resolveScheme(args.proxy)}://${proxyHost}/_proxy${path}`)
    query.forEach((v, k) => url.searchParams.set(k, v))
    url.searchParams.set('__mock_host', args.target)
    url.searchParams.set('__mock_uid', args.uid)
    return {
      url: url.toString(),
      headers: {
        'x-mock-host': args.target,
        'x-mock-uid': args.uid,
      },
    }
  }

  const targetHost = cleanHost(args.target)
  if (targetHost === '') throw new Error('目标地址为空')
  const url = new URL(`${resolveScheme(args.target)}://${targetHost}${path}`)
  query.forEach((v, k) => url.searchParams.set(k, v))
  return { url: url.toString(), headers: {} }
}

function stamp() {
  return new Date().toISOString().slice(11, 23)
}

function log(direction, message) {
  console.log(`${stamp()} ${direction} ${message}`)
}

const args = parseArgs(process.argv.slice(2))
let endpoint
try {
  endpoint = buildEndpoint(args)
} catch (err) {
  console.error(`参数错误: ${err.message}`)
  process.exit(1)
}

let socket = null
let manualClose = false
let reconnectTimer = null
let reconnectDelay = 1000
let heartbeatTimer = null

function stopHeartbeat() {
  if (heartbeatTimer != null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function startHeartbeat() {
  stopHeartbeat()
  if (args.heartbeat <= 0) return
  heartbeatTimer = setInterval(() => {
    if (socket == null || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ kind: 'app-ping', ts: Date.now() }))
  }, args.heartbeat)
}

function connect() {
  manualClose = false
  clearTimeout(reconnectTimer)
  reconnectTimer = null
  log('---', `connecting ${endpoint.url}`)
  log('---', `target=${args.target}${args.proxy === '' ? '' : ` via proxy=${args.proxy} uid=${args.uid}`}`)

  const ws = new WebSocket(endpoint.url, {
    headers: endpoint.headers,
    rejectUnauthorized: !args.insecure,
  })
  socket = ws

  ws.on('open', () => {
    if (socket !== ws) return
    reconnectDelay = 1000
    log('<<<', `open protocol=${ws.protocol || '(none)'}`)
    startHeartbeat()
  })

  ws.on('message', (data, isBinary) => {
    if (socket !== ws) return
    if (isBinary) {
      const buffer = Buffer.from(data)
      log('<<<', `binary ${buffer.length}B ${buffer.toString('base64')}`)
      return
    }
    const text = data.toString()
    let pretty = text
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2)
    } catch (err) {
      pretty = text
    }
    log('<<<', pretty)
  })

  ws.on('error', (err) => {
    if (socket !== ws) return
    log('!!!', `error ${err.message}`)
  })

  ws.on('close', (code, reason) => {
    if (socket !== ws) return
    socket = null
    stopHeartbeat()
    log('---', `closed code=${code} reason=${reason?.toString() ?? ''}`)
    if (manualClose || !args.reconnect) {
      process.exit(0)
      return
    }
    const delay = reconnectDelay
    reconnectDelay = Math.min(reconnectDelay * 2, 10000)
    log('---', `reconnect in ${delay}ms`)
    reconnectTimer = setTimeout(connect, delay)
  })
}

function sendText(text) {
  if (socket == null || socket.readyState !== WebSocket.OPEN) {
    log('!!!', '未连接，忽略发送')
    return
  }
  socket.send(text)
  log('>>>', text)
}

function sendBinary(base64) {
  if (socket == null || socket.readyState !== WebSocket.OPEN) {
    log('!!!', '未连接，忽略发送')
    return
  }
  let buffer
  try {
    buffer = Buffer.from(base64.replace(/\s+/g, ''), 'base64')
  } catch (err) {
    log('!!!', `Base64 无效: ${err.message}`)
    return
  }
  socket.send(buffer)
  log('>>>', `binary ${buffer.length}B ${buffer.toString('base64')}`)
}

function shutdown() {
  manualClose = true
  clearTimeout(reconnectTimer)
  reconnectTimer = null
  stopHeartbeat()
  if (socket != null && socket.readyState === WebSocket.OPEN) {
    try {
      socket.close(1000, 'client exit')
    } catch (err) {
      process.exit(0)
    }
    setTimeout(() => process.exit(0), 300)
    return
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  const text = line.trimEnd()
  if (text === '/quit') {
    shutdown()
    return
  }
  if (text.startsWith('/bin ')) {
    sendBinary(text.slice(5))
    return
  }
  sendText(text)
})
rl.on('close', () => {
  // stdin 结束（如管道输入完成）时保持连接，由 Ctrl+C 或对端关闭退出
})

connect()