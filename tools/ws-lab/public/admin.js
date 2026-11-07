const POLL_MS = 2000

const els = {
  autoRefresh: document.getElementById('autoRefresh'),
  refreshBtn: document.getElementById('refreshBtn'),
  clientRows: document.getElementById('clientRows'),
  statClients: document.getElementById('statClients'),
  statReceived: document.getElementById('statReceived'),
  statSent: document.getElementById('statSent'),
  statUptime: document.getElementById('statUptime'),
  targetBadge: document.getElementById('targetBadge'),
  typeSeg: document.getElementById('typeSeg'),
  pushData: document.getElementById('pushData'),
  intervalMs: document.getElementById('intervalMs'),
  intervalMeta: document.getElementById('intervalMeta'),
  pushBtn: document.getElementById('pushBtn'),
  intervalBtn: document.getElementById('intervalBtn'),
  closeCode: document.getElementById('closeCode'),
  closeReason: document.getElementById('closeReason'),
  closeBtn: document.getElementById('closeBtn'),
  logs: document.getElementById('logs'),
  logMeta: document.getElementById('logMeta'),
  toast: document.getElementById('toast'),
}

const state = {
  selected: '',
  clients: [],
  type: 'text',
  polling: null,
  pushTimer: null,
  pushBusy: false,
  pushCount: 0,
  lastLogKey: '',
  offline: false,
  toastTimer: null,
}

/* ---------- helpers ---------- */

async function request(path, options) {
  const res = await fetch(path, options)
  let data = null
  try {
    data = await res.json()
  } catch (err) {
    data = null
  }
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
  return data
}

function toast(message, kind = '') {
  els.toast.textContent = message
  els.toast.className = `toast show ${kind}`
  clearTimeout(state.toastTimer)
  state.toastTimer = setTimeout(() => {
    els.toast.className = 'toast'
  }, 2200)
}

function pad(n, size = 2) {
  return String(n).padStart(size, '0')
}

function formatClock(ts) {
  const date = new Date(ts)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatDuration(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function shortId(id) {
  return String(id ?? '').slice(0, 8)
}

function selectedClient() {
  return state.clients.find(it => it.id === state.selected) ?? null
}

/* ---------- clients ---------- */

async function loadClients() {
  try {
    const [clients, health] = await Promise.all([
      request('/api/clients'),
      request('/api/health'),
    ])
    state.clients = Array.isArray(clients) ? clients : []
    if (state.selected !== '' && !state.clients.some(it => it.id === state.selected)) {
      state.selected = ''
    }
    renderClients()
    renderStats(health)
    if (state.offline) {
      state.offline = false
      toast('服务已恢复', 'success')
    }
  } catch (err) {
    if (!state.offline) {
      state.offline = true
      toast(`服务不可用：${err.message}`, 'error')
    }
  }
}

function renderClients() {
  els.clientRows.replaceChildren()

  if (state.clients.length === 0) {
    const row = document.createElement('tr')
    const cell = document.createElement('td')
    cell.colSpan = 6
    cell.className = 'empty'
    cell.textContent = '暂无连接，打开客户端页发起连接'
    row.append(cell)
    els.clientRows.append(row)
    renderTarget()
    return
  }

  for (const client of state.clients) {
    const row = document.createElement('tr')
    row.dataset.id = client.id
    if (client.id === state.selected) row.classList.add('selected')
    row.title = client.id

    const nameCell = document.createElement('td')
    const name = document.createElement('strong')
    name.textContent = client.name
    nameCell.append(name)
    if (client.protocol !== '') {
      const proto = document.createElement('div')
      proto.className = 'muted'
      proto.textContent = `协议 ${client.protocol}`
      nameCell.append(proto)
    }

    const idCell = document.createElement('td')
    const idCode = document.createElement('code')
    idCode.textContent = shortId(client.id)
    idCell.append(idCode)

    const ipCell = document.createElement('td')
    ipCell.textContent = client.ip

    const stateCell = document.createElement('td')
    const badge = document.createElement('span')
    const open = client.readyState === 1
    badge.className = `badge ${open ? 'ok' : 'warn'}`
    badge.textContent = open ? 'OPEN' : `STATE ${client.readyState}`
    stateCell.append(badge)

    const countCell = document.createElement('td')
    countCell.textContent = `${client.received} / ${client.sent}`

    const timeCell = document.createElement('td')
    timeCell.textContent = formatClock(client.connectedAt)
    timeCell.title = new Date(client.connectedAt).toLocaleString('zh-CN')

    row.append(nameCell, idCell, ipCell, stateCell, countCell, timeCell)
    els.clientRows.append(row)
  }

  renderTarget()
}

function renderStats(health) {
  const received = state.clients.reduce((sum, it) => sum + (Number(it.received) || 0), 0)
  const sent = state.clients.reduce((sum, it) => sum + (Number(it.sent) || 0), 0)
  els.statClients.textContent = String(state.clients.length)
  els.statReceived.textContent = String(received)
  els.statSent.textContent = String(sent)
  els.statUptime.textContent = health == null ? '-' : formatDuration(health.uptime)
}

function renderTarget() {
  const client = selectedClient()
  if (client == null) {
    els.targetBadge.textContent = '全部在线连接'
    els.targetBadge.title = ''
    return
  }
  els.targetBadge.textContent = client.name
  els.targetBadge.title = `${client.name} · ${client.id}`
}

/* ---------- push ---------- */

async function pushOnce(manual) {
  if (state.pushBusy) return
  const data = els.pushData.value
  if (state.type === 'binary' && data.replace(/\s+/g, '') !== '' && !/^[A-Za-z0-9+/=]+$/.test(data.replace(/\s+/g, ''))) {
    toast('Base64 格式不正确', 'error')
    return
  }

  const target = state.selected === '' ? 'all' : state.selected
  state.pushBusy = true
  els.pushBtn.disabled = true
  try {
    const res = await request('/api/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, type: state.type, data }),
    })
    state.pushCount += 1
    const targetLabel = state.selected === '' ? '全部连接' : selectedClient()?.name ?? shortId(state.selected)
    els.intervalMeta.textContent = `已推送 ${state.pushCount} 次 · ${formatClock(Date.now())}`
    if (manual) {
      if (res.sent === 0) toast(`没有可用的连接（目标：${targetLabel}）`, 'error')
      else toast(`已推送 ${res.type === 'binary' ? '二进制' : '文本'}给 ${res.sent} 个连接`, 'success')
    }
    loadLogs()
  } catch (err) {
    if (manual) toast(`推送失败：${err.message}`, 'error')
  } finally {
    state.pushBusy = false
    els.pushBtn.disabled = false
  }
}

function toggleInterval() {
  if (state.pushTimer != null) {
    clearInterval(state.pushTimer)
    state.pushTimer = null
    els.intervalBtn.textContent = '开始定时推送'
    els.intervalBtn.classList.remove('primary')
    els.intervalMs.disabled = false
    els.intervalMeta.textContent = `已停止 · 累计 ${state.pushCount} 次`
    return
  }

  const ms = Math.max(100, Number(els.intervalMs.value) || 1000)
  els.intervalMs.value = String(ms)
  els.intervalMs.disabled = true
  state.pushTimer = setInterval(() => pushOnce(false), ms)
  els.intervalBtn.textContent = '停止定时推送'
  els.intervalBtn.classList.add('primary')
  els.intervalMeta.textContent = `每 ${ms} ms 推送一次`
  pushOnce(false)
}

async function closeConnections() {
  const target = state.selected === '' ? 'all' : state.selected
  const code = Number(els.closeCode.value) || 1000
  const reason = els.closeReason.value
  try {
    const res = await request('/api/close', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, code, reason }),
    })
    toast(`已关闭 ${res.closed} 个连接（code=${res.code}）`, res.closed > 0 ? 'success' : 'error')
    setTimeout(loadClients, 300)
  } catch (err) {
    toast(`关闭失败：${err.message}`, 'error')
  }
}

/* ---------- logs ---------- */

async function loadLogs() {
  try {
    const logs = await request('/api/logs?limit=120')
    const newest = logs[logs.length - 1]
    const key = newest == null ? '' : `${newest.at}-${logs.length}`
    if (key === state.lastLogKey) return
    state.lastLogKey = key
    renderLogs(logs)
  } catch (err) {
    // 日志拉取失败不打断主流程，等待下一轮轮询
  }
}

function renderLogs(logs) {
  els.logs.replaceChildren()
  if (logs.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'logs-empty'
    empty.textContent = '暂无日志'
    els.logs.append(empty)
    els.logMeta.textContent = '-'
    return
  }

  const newest = logs[logs.length - 1]
  els.logMeta.textContent = `共 ${logs.length} 条 · 最新 ${formatClock(newest.at)}`

  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i]
    const line = document.createElement('div')
    line.className = 'log-line'

    const time = document.createElement('span')
    time.className = 'log-time'
    time.textContent = formatClock(entry.at)

    const level = document.createElement('span')
    level.className = `log-level ${entry.level}`
    level.textContent = String(entry.level ?? 'info').toUpperCase()

    line.append(time, level)

    if (entry.clientId != null) {
      const client = document.createElement('span')
      client.className = 'log-client'
      client.textContent = shortId(entry.clientId)
      line.append(client)
    }

    const message = document.createElement('span')
    message.className = 'log-msg'
    message.textContent = entry.message
    line.append(message)

    els.logs.append(line)
  }
}

/* ---------- polling ---------- */

function startPolling() {
  stopPolling()
  if (els.autoRefresh.checked) {
    state.polling = setInterval(() => {
      loadClients()
      loadLogs()
    }, POLL_MS)
  }
}

function stopPolling() {
  if (state.polling != null) {
    clearInterval(state.polling)
    state.polling = null
  }
}

/* ---------- events ---------- */

els.clientRows.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-id]')
  if (row == null) return
  state.selected = state.selected === row.dataset.id ? '' : row.dataset.id
  renderClients()
})

els.typeSeg.addEventListener('click', (event) => {
  const button = event.target.closest('.seg-btn')
  if (button == null) return
  els.typeSeg.querySelectorAll('.seg-btn').forEach(it => it.classList.remove('active'))
  button.classList.add('active')
  state.type = button.dataset.type
  const binary = state.type === 'binary'
  els.pushData.placeholder = binary ? 'AQIDBA==' : '{"event":"tick","ts":1700000000000}'
})

els.autoRefresh.addEventListener('change', startPolling)
els.refreshBtn.addEventListener('click', () => {
  loadClients()
  loadLogs()
})
els.pushBtn.addEventListener('click', () => pushOnce(true))
els.intervalBtn.addEventListener('click', toggleInterval)
els.intervalMs.addEventListener('change', () => {
  els.intervalMs.value = String(Math.max(100, Number(els.intervalMs.value) || 1000))
})
els.closeBtn.addEventListener('click', closeConnections)

window.addEventListener('beforeunload', () => {
  stopPolling()
  if (state.pushTimer != null) clearInterval(state.pushTimer)
})

loadClients()
loadLogs()
startPolling()