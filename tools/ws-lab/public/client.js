const MAX_MESSAGES = 500
const RECONNECT_BASE = 1000
const RECONNECT_MAX = 10000

const els = {
  state: document.getElementById('state'),
  stateText: document.getElementById('stateText'),
  configFields: document.getElementById('configFields'),
  targetHost: document.getElementById('targetHost'),
  targetHint: document.getElementById('targetHint'),
  path: document.getElementById('path'),
  name: document.getElementById('name'),
  proxyHost: document.getElementById('proxyHost'),
  proxyHint: document.getElementById('proxyHint'),
  uid: document.getElementById('uid'),
  subprotocol: document.getElementById('subprotocol'),
  echo: document.getElementById('echo'),
  autoReconnect: document.getElementById('autoReconnect'),
  urlPreview: document.getElementById('urlPreview'),
  connectBtn: document.getElementById('connectBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  messages: document.getElementById('messages'),
  msgCount: document.getElementById('msgCount'),
  clearBtn: document.getElementById('clearBtn'),
  filterSeg: document.getElementById('filterSeg'),
  search: document.getElementById('search'),
  statIn: document.getElementById('statIn'),
  statOut: document.getElementById('statOut'),
  statBytes: document.getElementById('statBytes'),
  statUptime: document.getElementById('statUptime'),
  sendText: document.getElementById('sendText'),
  sendTextBtn: document.getElementById('sendTextBtn'),
  sendBinary: document.getElementById('sendBinary'),
  sendBinaryBtn: document.getElementById('sendBinaryBtn'),
  toast: document.getElementById('toast'),
}

let ws = null
let manualClose = false
let reconnectTimer = null
let reconnectDelay = RECONNECT_BASE
let openedAt = null
let currentFilter = 'all'
let stats = { inCount: 0, outCount: 0, bytes: 0 }
let toastTimer = null

/* ---------- helpers ---------- */

function cleanHost(value) {
  return String(value ?? '')
    .trim()
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
}

// 地址里写了 wss:// 或 https:// 就用 wss，否则默认 ws
function resolveScheme(value, fallback = 'ws') {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw.startsWith('wss://') || raw.startsWith('https://')) return 'wss'
  if (raw.startsWith('ws://') || raw.startsWith('http://')) return 'ws'
  return fallback
}

function hasScheme(value) {
  return /^(wss?|https?):\/\//i.test(String(value ?? '').trim())
}

// 没有显式写协议时，首次失败后自动用另一套协议重试，覆盖 http/https 两种代理配置
function alternateUrlFor(input, url) {
  if (hasScheme(input)) return null
  const next = new URL(url)
  next.protocol = next.protocol === 'wss:' ? 'ws:' : 'wss:'
  return next.toString()
}

function normalizePath(value) {
  const raw = String(value ?? '').trim() || '/ws'
  return raw.startsWith('/') ? raw : `/${raw}`
}

function isProxyMode() {
  return document.body.classList.contains('mode-proxy')
}

function formatTime(ts) {
  const date = new Date(ts)
  const pad = (n, size = 2) => String(n).padStart(size, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = n => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function toast(message, kind = '') {
  els.toast.textContent = message
  els.toast.className = `toast show ${kind}`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    els.toast.className = 'toast'
  }, 2200)
}

function buildUrl() {
  const path = normalizePath(els.path.value)
  const protocols = els.subprotocol.value.trim()
  const query = new URLSearchParams()
  const name = els.name.value.trim()
  if (name !== '') query.set('name', name)
  query.set('echo', els.echo.checked ? '1' : '0')

  if (!isProxyMode()) {
    const host = cleanHost(els.targetHost.value)
    if (host === '') return { error: '请填写目标地址' }
    const scheme = resolveScheme(els.targetHost.value)
    const url = new URL(`${scheme}://${host}${path}`)
    query.forEach((value, key) => url.searchParams.set(key, value))
    const finalUrl = url.toString()
    return {
      url: finalUrl,
      protocols,
      scheme,
      alternateUrl: alternateUrlFor(els.targetHost.value, finalUrl),
    }
  }

  const proxy = cleanHost(els.proxyHost.value)
  const target = els.targetHost.value.trim()
  if (proxy === '') return { error: '请填写代理地址' }
  if (target === '') return { error: '请填写上游目标地址' }

  const scheme = resolveScheme(els.proxyHost.value)
  const url = new URL(`${scheme}://${proxy}/_proxy${path}`)
  query.forEach((value, key) => url.searchParams.set(key, value))
  url.searchParams.set('__mock_host', target)
  url.searchParams.set('__mock_uid', els.uid.value.trim() || 'ws-lab')
  const finalUrl = url.toString()
  return {
    url: finalUrl,
    protocols,
    scheme,
    alternateUrl: alternateUrlFor(els.proxyHost.value, finalUrl),
  }
}

function updatePreview() {
  const built = buildUrl()
  els.urlPreview.textContent = built.error ? `无法生成：${built.error}` : built.url
  els.targetHint.textContent = isProxyMode()
    ? '上游 WS 地址：host:port、ws:// 或 wss://；目标自带的 path 会作为前缀'
    : 'ws-lab 服务地址（host:port，或 wss://）'
  els.proxyHint.textContent = resolveScheme(els.proxyHost.value) === 'wss'
    ? 'https 代理：需先在浏览器打开代理地址并信任自签名证书'
    : 'http 代理；AppApiProxy 为 https 时改填 wss:// 地址'
  els.urlPreview.title = els.urlPreview.textContent
}

function setState(next) {
  els.state.className = `state ${next}`
  els.stateText.textContent = next === 'open' ? '已连接' : next === 'connecting' ? '连接中…' : '未连接'
  const busy = next === 'open' || next === 'connecting'
  els.configFields.disabled = busy
  els.connectBtn.disabled = busy
  els.disconnectBtn.disabled = !busy
  els.connectBtn.textContent = next === 'connecting' ? '连接中…' : '连接'
  els.sendTextBtn.disabled = next !== 'open'
  els.sendBinaryBtn.disabled = next !== 'open'
}

/* ---------- messages ---------- */

function prettyText(raw) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch (err) {
    return raw
  }
}

function messageLabel(dir, parsed) {
  if (dir !== 'in') return dir === 'out' ? 'send' : 'system'
  if (parsed == null) return 'recv'
  if (typeof parsed === 'object') {
    if (parsed.kind === 'welcome') return 'welcome'
    if (parsed.kind === 'push') return 'push'
    if (parsed.kind === 'echo') return 'echo'
  }
  return 'recv'
}

function appendMessage(dir, label, text, meta) {
  const item = document.createElement('div')
  item.className = `msg ${dir}`
  item.dataset.dir = dir
  item.dataset.text = String(text ?? '').toLowerCase()

  const head = document.createElement('div')
  head.className = 'msg-head'
  const badge = document.createElement('span')
  badge.className = `badge ${dir}`
  badge.textContent = label
  const time = document.createElement('span')
  time.textContent = formatTime(Date.now())
  head.append(badge, time)
  if (meta) {
    const extra = document.createElement('span')
    extra.className = 'muted'
    extra.textContent = meta
    head.append(extra)
  }

  const pre = document.createElement('pre')
  pre.textContent = text
  item.append(head, pre)

  els.messages.append(item)
  while (els.messages.children.length > MAX_MESSAGES) {
    els.messages.firstElementChild.remove()
  }
  els.msgCount.textContent = `${els.messages.children.length} 条`
  applyFilter()
  if (currentFilter === 'all' || currentFilter === dir) {
    els.messages.scrollTop = els.messages.scrollHeight
  }
}

function applyFilter() {
  const term = els.search.value.trim().toLowerCase()
  for (const item of els.messages.children) {
    const dirOk = currentFilter === 'all' || item.dataset.dir === currentFilter
    const termOk = term === '' || item.dataset.text.includes(term)
    item.hidden = !(dirOk && termOk)
  }
}

function appendSystem(label, text) {
  appendMessage('system', label, text)
}

/* ---------- stats ---------- */

function renderStats() {
  els.statIn.textContent = String(stats.inCount)
  els.statOut.textContent = String(stats.outCount)
  els.statBytes.textContent = humanBytes(stats.bytes)
  els.statUptime.textContent = openedAt == null ? '-' : formatDuration(Date.now() - openedAt)
}

setInterval(renderStats, 1000)

/* ---------- connection ---------- */

function detachSocket() {
  const socket = ws
  ws = null
  if (socket == null) return
  socket.onopen = null
  socket.onmessage = null
  socket.onerror = null
  socket.onclose = null
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    try {
      socket.close(1000, 'reconnect')
    } catch (err) {
      // 忽略关闭异常
    }
  }
}

function scheduleReconnect() {
  if (manualClose || !els.autoReconnect.checked) return
  clearTimeout(reconnectTimer)
  const delay = reconnectDelay
  appendSystem('reconnect', `${delay} ms 后自动重连`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX)
    connect()
  }, delay)
}

function connect(attempt = null) {
  const built = attempt ?? buildUrl()
  if (built.error) {
    toast(built.error, 'error')
    return
  }

  manualClose = false
  clearTimeout(reconnectTimer)
  reconnectTimer = null
  detachSocket()
  setState('connecting')
  appendSystem('connect', built.url)

  let opened = false
  let socket
  try {
    socket = built.protocols === '' ? new WebSocket(built.url) : new WebSocket(built.url, built.protocols)
  } catch (err) {
    appendSystem('error', `创建连接失败：${err.message}`)
    setState('closed')
    scheduleReconnect()
    return
  }
  socket.binaryType = 'arraybuffer'
  ws = socket

  socket.onopen = () => {
    if (ws !== socket) return
    opened = true
    openedAt = Date.now()
    reconnectDelay = RECONNECT_BASE
    setState('open')
    const proto = socket.protocol === '' ? '无子协议' : `子协议 ${socket.protocol}`
    appendSystem('open', `连接成功，${proto}`)
    renderStats()
  }

  socket.onmessage = (event) => {
    if (ws !== socket) return
    const isBinary = typeof event.data !== 'string'
    const size = isBinary ? event.data.byteLength : new TextEncoder().encode(event.data).length
    stats.inCount += 1
    stats.bytes += size

    if (isBinary) {
      const base64 = toBase64(event.data)
      appendMessage('in', 'binary', `[${size} bytes]\n${base64}`, `${size} B`)
    } else {
      const pretty = prettyText(event.data)
      let parsed = null
      try {
        parsed = JSON.parse(event.data)
      } catch (err) {
        parsed = null
      }
      appendMessage('in', messageLabel('in', parsed), pretty, `${size} B`)
    }
    renderStats()
  }

  socket.onerror = () => {
    if (ws !== socket) return
    appendSystem('error', '连接出错（浏览器不提供错误详情）')
  }

  socket.onclose = (event) => {
    if (ws !== socket) return
    ws = null
    openedAt = null
    setState('closed')
    const reason = event.reason ? ` reason=${event.reason}` : ''
    appendSystem('close', `已断开 code=${event.code}${reason}${event.wasClean ? '' : '（异常关闭）'}`)
    renderStats()

    // 未显式指定协议时，首次握手失败先自动换 ws/wss 再试一次
    if (!manualClose && !opened && built.alternateUrl != null) {
      const nextScheme = built.scheme === 'wss' ? 'ws' : 'wss'
      appendSystem('fallback', `${built.scheme}:// 握手失败，改用 ${nextScheme}:// 重试：${built.alternateUrl}`)
      connect({ ...built, url: built.alternateUrl, scheme: nextScheme, alternateUrl: null })
      return
    }
    if (!opened && built.scheme === 'wss') {
      const host = new URL(built.url).host
      appendSystem('hint', `wss 握手失败：浏览器不会忽略证书错误。请把 cert/server.crt 装入系统「受信任的根证书」并重启浏览器；或改用 node-client.mjs --insecure，或把 App 设置切到 http（自检地址 https://${host}/_appmock/health）`)
    }
    scheduleReconnect()
  }
}

function disconnect() {
  manualClose = true
  clearTimeout(reconnectTimer)
  reconnectTimer = null
  const socket = ws
  if (socket == null) {
    setState('closed')
    return
  }
  appendSystem('close', '手动断开')
  try {
    socket.close(1000, 'client closed')
  } catch (err) {
    detachSocket()
    setState('closed')
  }
}

/* ---------- binary ---------- */

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fromBase64(text) {
  const raw = atob(String(text ?? '').replace(/\s+/g, ''))
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/* ---------- send ---------- */

function sendText() {
  if (ws == null || ws.readyState !== WebSocket.OPEN) {
    toast('连接未建立', 'error')
    return
  }
  const text = els.sendText.value
  ws.send(text)
  const size = new TextEncoder().encode(text).length
  stats.outCount += 1
  stats.bytes += size
  appendMessage('out', 'text', prettyText(text), `${size} B`)
  renderStats()
}

function sendBinary() {
  if (ws == null || ws.readyState !== WebSocket.OPEN) {
    toast('连接未建立', 'error')
    return
  }
  let bytes
  try {
    bytes = fromBase64(els.sendBinary.value)
  } catch (err) {
    toast('Base64 格式不正确', 'error')
    return
  }
  ws.send(bytes)
  stats.outCount += 1
  stats.bytes += bytes.length
  appendMessage('out', 'binary', `[${bytes.length} bytes]\n${els.sendBinary.value.trim()}`, `${bytes.length} B`)
  renderStats()
}

/* ---------- events ---------- */

document.querySelectorAll('.mode').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.mode').forEach(it => it.classList.remove('active'))
    button.classList.add('active')
    document.body.classList.toggle('mode-proxy', button.dataset.mode === 'proxy')
    document.body.classList.toggle('mode-direct', button.dataset.mode !== 'proxy')
    updatePreview()
  })
})

els.filterSeg.addEventListener('click', (event) => {
  const button = event.target.closest('.seg-btn')
  if (button == null) return
  els.filterSeg.querySelectorAll('.seg-btn').forEach(it => it.classList.remove('active'))
  button.classList.add('active')
  currentFilter = button.dataset.filter
  applyFilter()
})

document.querySelectorAll('#configFields input').forEach(input => {
  input.addEventListener('input', updatePreview)
  input.addEventListener('change', updatePreview)
})

els.search.addEventListener('input', applyFilter)

els.connectBtn.addEventListener('click', connect)
els.disconnectBtn.addEventListener('click', disconnect)
els.sendTextBtn.addEventListener('click', sendText)
els.sendBinaryBtn.addEventListener('click', sendBinary)

els.sendText.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    sendText()
  }
})

els.clearBtn.addEventListener('click', () => {
  els.messages.replaceChildren()
  els.msgCount.textContent = '0 条'
})

window.addEventListener('beforeunload', () => {
  manualClose = true
  if (ws != null) {
    try {
      ws.close(1000, 'page unload')
    } catch (err) {
      // 忽略
    }
  }
})

updatePreview()
setState('closed')
renderStats()