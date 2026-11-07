import { execFileSync } from 'child_process'
import cors from 'cors'
import express from 'express'
import fs from 'fs'
import minimist from 'minimist'
import path from 'path'
import tcpPortUsed from 'tcp-port-used'
import { fileURLToPath } from 'url'
import { getLocalIPs } from './misc'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MARKER = 'AppApiProxy update server'
const VIRTUAL_IFACE = /vethernet|hyper-v|vmware|virtualbox|wsl|docker|tailscale|zerotier|virtual/i

const argv = minimist(process.argv.slice(2), {
  string: ['port', 'dir'],
  boolean: ['help'],
  default: { port: 4000, dir: 'build' }
})

function printUsage() {
  console.log(`
用法: yarn updateServer [--port=4000] [--dir=build]

将构建产物以静态文件方式提供，供应用检查/下载更新。

  --port  监听端口，默认 4000
  --dir   要提供的目录，默认 build
  --help  显示本帮助

端口被上次的更新服务占用时会自动结束旧实例；被其他程序占用时直接报错，可改用 --port。
`)
}

function fail(message: string): never {
  console.error(`\n[错误] ${message}\n`)
  process.exit(1)
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return { ok: res.ok, status: res.status, text: await res.text() }
  } catch {
    return null
  }
}

// 通过响应特征确认端口上是本项目的更新服务（version.json 结构或根路径标识）
async function isUpdateServer(port: number): Promise<boolean> {
  const base = `http://127.0.0.1:${port}`
  const version = await fetchText(`${base}/version.json`)
  if (version?.ok) {
    try {
      const payload = JSON.parse(version.text)
      if (typeof payload?.data?.version === 'string') return true
    } catch {
      // 继续用根路径标识判断
    }
  }
  const root = await fetchText(`${base}/`)
  return root?.ok === true && root.text.includes(MARKER)
}

function findListenerPid(port: number): number | null {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true })
      const suffix = new RegExp(`:${port}$`)
      for (const line of output.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue
        const cols = line.trim().split(/\s+/)
        if (cols.length < 5 || !suffix.test(cols[1])) continue
        const pid = Number(cols[4])
        return Number.isInteger(pid) && pid > 0 ? pid : null
      }
      return null
    }
    const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
    const pid = Number(output.trim().split(/\s+/)[0])
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function killTree(pid: number) {
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  process.kill(pid, 'SIGTERM')
}

async function releasePort(port: number) {
  const pid = findListenerPid(port)
  if (pid == null) fail(`端口 ${port} 已被占用，但无法定位占用进程，请手动结束后重试，或用 --port 指定其他端口`)

  console.warn(`端口 ${port} 被上次的更新服务占用（PID ${pid}），正在结束旧实例...`)
  try {
    killTree(pid)
  } catch (err: any) {
    fail(`结束旧实例失败（PID ${pid}）：${err?.message ?? err}，请手动结束后重试，或用 --port 指定其他端口`)
  }
  try {
    await tcpPortUsed.waitUntilFree(port, 200, 5000)
  } catch {
    fail(`端口 ${port} 仍未释放，请检查 PID ${pid} 是否已退出，或用 --port 指定其他端口`)
  }
}

function lanUrls(port: number): string[] {
  const candidates = getLocalIPs().filter(it => !it.internal)
  const preferred = candidates.filter(it => !VIRTUAL_IFACE.test(it.name))
  return (preferred.length > 0 ? preferred : candidates).map(it => `http://${it.address}:${port}`)
}

function startServer(port: number, dir: string) {
  const app = express()
  app.disable('x-powered-by')
  app.use(cors())

  app.use((req, res, next) => {
    const startedAt = Date.now()
    res.on('finish', () => {
      const time = new Date().toTimeString().slice(0, 8)
      console.log(`[${time}] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`)
    })
    next()
  })

  app.get('/', (_req, res) => {
    const files = fs.readdirSync(dir).filter(it => /\.(json|gz|exe|zip|appimage|yml)$/i.test(it)).sort()
    res.type('text/plain').send(`${MARKER}\n\n${files.map(it => `- /${it}`).join('\n')}\n`)
  })

  app.use(express.static(dir, {
    etag: false,
    lastModified: false,
    cacheControl: false,
    setHeaders: res => res.setHeader('Cache-Control', 'no-cache')
  }))

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`\n更新服务已启动，PID ${process.pid}，目录 ${path.relative(ROOT, dir) || '.'}`)
    console.log(`  本机: http://127.0.0.1:${port}`)
    for (const url of lanUrls(port)) console.log(`  局域网: ${url}`)
    if (!fs.existsSync(path.join(dir, 'version.json'))) {
      console.warn('\n[提示] 未找到 version.json，应用检查更新会失败；请先执行 yarn pub 生成更新文件。')
    }
    console.log('\n按 Ctrl+C 停止服务\n')
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') fail(`端口 ${port} 已被占用（可能刚被其他程序抢占），请改用 --port 指定其他端口`)
    fail(`更新服务启动失败：${err.message}`)
  })

  const shutdown = (signal: string) => {
    console.log(`\n收到 ${signal}，正在停止更新服务...`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

async function main() {
  if (argv.help) {
    printUsage()
    return
  }

  const port = Number(argv.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`端口不合法：${argv.port}`)
  }

  const dir = path.resolve(ROOT, String(argv.dir))
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    fail(`目录不存在：${dir}\n请先执行 yarn pkg 或 yarn pub 生成构建产物`)
  }

  if (await tcpPortUsed.check(port, '127.0.0.1')) {
    if (!(await isUpdateServer(port))) {
      const pid = findListenerPid(port)
      fail(`端口 ${port} 被其他程序占用${pid == null ? '' : `（PID ${pid}）`}，已保持原状；请关闭该程序或用 --port 指定其他端口`)
    }
    await releasePort(port)
  }

  startServer(port, dir)
}

main().catch(err => fail(err instanceof Error ? err.message : String(err)))
