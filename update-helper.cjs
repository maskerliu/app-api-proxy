'use strict'

// 重启后替换 app.asar 的辅助进程：由主进程以 ELECTRON_RUN_AS_NODE 方式启动，
// 属于 GUI 子系统进程，不会弹出控制台窗口；安装目录不可写时通过 elevate.exe 提权。
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

function parseArgs(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    result[key.slice(2)] = argv[++i]
  }
  return result
}

const opts = parseArgs(process.argv.slice(2))
const RESOURCES = opts.resources
const EXE = opts.exe
const LOG = opts.log
const APP_PID = Number(opts.pid) || 0
const STAGED = opts.staged

function log(message) {
  try {
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    // 日志失败不影响更新
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function isAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function waitForExit(pid, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    sleep(200)
  }
  return false
}

function replaceAsar(source) {
  const target = path.join(RESOURCES, 'update.asar')
  const appAsar = path.join(RESOURCES, 'app.asar')
  const bakAsar = path.join(RESOURCES, 'app-bak.asar')

  if (source && path.resolve(source) != path.resolve(target)) fs.copyFileSync(source, target)

  for (let i = 0; i < 30; i++) {
    try {
      fs.rmSync(bakAsar, { force: true })
    } catch {}
    try {
      fs.renameSync(appAsar, bakAsar)
    } catch {
      if (i == 29) {
        log('app.asar 一直被占用，放弃本次替换')
        return false
      }
      sleep(1000)
      continue
    }
    try {
      fs.renameSync(target, appAsar)
      return true
    } catch (err) {
      log(`替换 app.asar 失败: ${err && err.message}`)
      try {
        fs.renameSync(bakAsar, appAsar)
      } catch {}
      return false
    }
  }
  return false
}

function applyElevated(source) {
  const elevate = path.join(RESOURCES, 'elevate.exe')
  const script = path.join(RESOURCES, 'update.ps1')
  if (!fs.existsSync(elevate) || !fs.existsSync(script)) {
    log('缺少 elevate.exe 或 update.ps1，无法提权应用更新')
    return false
  }

  const marker = path.join(path.dirname(source), '.apply-result')
  const startedMarker = path.join(path.dirname(source), '.apply-started')
  fs.rmSync(marker, { force: true })
  fs.rmSync(startedMarker, { force: true })
  spawn(elevate, [
    'powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', script, RESOURCES, source, marker, startedMarker
  ], { stdio: 'ignore', windowsHide: true })
  log('已申请提权，等待 UAC 确认')

  // 用户取消 UAC 时脚本不会启动，尽快恢复应用；已开始执行则多给一些时间
  let started = false
  let deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (fs.existsSync(marker)) {
      const result = fs.readFileSync(marker, 'utf8').trim()
      log(`提权更新结果: ${result}`)
      return result == 'ok'
    }
    if (!started && fs.existsSync(startedMarker)) {
      started = true
      deadline = Date.now() + 120000
      log('提权脚本已启动，继续等待替换完成')
    }
    sleep(300)
  }
  log('等待提权更新超时（可能取消了 UAC）')
  return false
}

function startApp() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(EXE, [], { detached: true, stdio: 'ignore', cwd: path.dirname(EXE), env })
  child.unref()
}

function main() {
  const stagedExists = STAGED != null && fs.existsSync(STAGED)
  log(`helper 启动 pid=${process.pid} staged=${stagedExists}`)

  if (!waitForExit(APP_PID, 30000)) log('原进程在 30 秒内未退出，继续尝试替换')

  let ok = false
  if (stagedExists) {
    try {
      ok = replaceAsar(STAGED)
    } catch (err) {
      if (err && (err.code == 'EACCES' || err.code == 'EPERM')) {
        log('安装目录无写入权限，改用提权更新')
        ok = applyElevated(STAGED)
      } else {
        log(`更新失败: ${err && err.message}`)
      }
    }
  } else {
    ok = replaceAsar(null)
  }

  if (ok && stagedExists) {
    try {
      fs.rmSync(STAGED, { force: true })
    } catch {}
  }
  log(ok ? '更新完成，正在重启应用' : '更新未完成，仍启动应用')
  startApp()
}

main()
