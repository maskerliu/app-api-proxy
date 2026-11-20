import chalk from 'chalk'
import { deleteSync } from 'del'
import { spawnSync } from 'child_process'
import path from 'path'

// Windows 上刚写完的产物常被索引器/杀软/正在跑的实例短暂占用，句柄一放就能删；
// del 只做一次 fs.rmSync，任何一次撞车都会把整个构建打断，所以这里重试并在仍失败时降级为告警。
const ATTEMPTS = 12
const RETRY_DELAY_MS = 250
const TRANSIENT = /\b(EBUSY|EPERM|ENOTEMPTY|EMFILE|ENFILE)\b/
const PROBE = path.join('tools', 'who-locks.ps1')
const PROBE_TIMEOUT_MS = 20_000

function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function remaining(patterns: string[]): string[] {
  try {
    return deleteSync(patterns, { dryRun: true })
  } catch {
    return []
  }
}

// 只在删除已经失败后执行，正常构建不付这笔开销；探测多个路径逐个查，取前 3 项足够定位
function nameHolders(files: string[]) {
  if (process.platform !== 'win32') return
  const probed = files.slice(0, 3)
  if (probed.length === 0) return
  try {
    const probe = spawnSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PROBE, '-Path', ...probed],
      { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS })
    const out = `${probe.stdout ?? ''}`.trim()
    if (out) console.log(out.split(/\r?\n/).map(line => `         ${line}`).join('\n'))
    else console.log(`         占用已释放，重试 yarn build 即可；探针脚本 ${PROBE} 可随时手工复查`)
  } catch {
    // 诊断失败不该再影响构建
  }
}

// 尽力删除，返回删不掉的残留路径（空数组表示删干净了）。被占用不再抛错，是告警还是退出由调用方定。
export function purge(patterns: string[]): string[] {
  let lastError: unknown
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      deleteSync(patterns)
      return []
    } catch (err) {
      lastError = err
      if (!TRANSIENT.test(String(err)) || attempt === ATTEMPTS) break
      sleep(RETRY_DELAY_MS)
    }
  }

  const files = remaining(patterns)
  console.warn(`\n${chalk.yellow(' WARN ')} 清理 ${patterns.join(' ')} 未完成：${lastError}`)
  if (files.length === 0) {
    console.warn('       目标其实已不存在（多为删除过程中已释放），继续构建。')
    return []
  }
  console.warn(`       仍有 ${files.length} 项在磁盘上：${files.slice(0, 3).join(', ')}${files.length > 3 ? ' …' : ''}`)
  console.warn('       正在运行的 AppApiProxy / IDE 索引 / 杀软都会占住 win-unpacked 下的 app.asar，占用方：')
  nameHolders(files)
  return files
}
