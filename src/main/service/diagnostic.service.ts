import { promises as dnsPromises } from 'dns'
import http from 'http'
import https from 'https'
import { injectable } from 'inversify'
import net from 'net'
import tls from 'tls'
import type { Diagnostic } from '@shared/diagnostic.models'

const MAX_BUFFER = 20
const DIAGNOSE_BUDGET = 5000

@injectable()
export class DiagnosticService {
  private readonly startedAt = Date.now()
  private requests: Diagnostic.RecentRequest[] = []
  private errors: Diagnostic.RecentError[] = []

  get uptimeSec(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000)
  }

  public recordRequest(entry: Omit<Diagnostic.RecentRequest, 'mockHit'>) {
    this.push(this.requests, { ...entry })
  }

  public markMockHit(sessionId: number) {
    for (let i = this.requests.length - 1; i >= 0; i--) {
      if (this.requests[i].sessionId === sessionId) {
        this.requests[i].mockHit = true
        return
      }
    }
  }

  public recordError(entry: Omit<Diagnostic.RecentError, 'at'>) {
    this.push(this.errors, { at: Date.now(), ...entry })
  }

  public recentRequests(): Diagnostic.RecentRequest[] {
    return [...this.requests].reverse()
  }

  public unknownUidRequests(): Diagnostic.RecentRequest[] {
    return this.recentRequests().filter(it => !it.uidKnown)
  }

  public recentErrors(): Diagnostic.RecentError[] {
    return [...this.errors].reverse()
  }

  // 诊断结果中的每一步都带耗时；任一步失败即停止，方便定位卡在哪一层
  public async diagnose(input: string): Promise<Diagnostic.DiagnoseResult> {
    const url = this.parseTarget(input)
    const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1')
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    const startedAt = Date.now()
    const steps: Diagnostic.DiagnoseStep[] = []

    const fail = (step: Diagnostic.DiagnoseStepName, start: number, detail: string): Diagnostic.DiagnoseResult => {
      steps.push({ step, ok: false, ms: Date.now() - start, detail })
      return { target: url.toString(), ok: false, steps }
    }

    let start = Date.now()
    let remaining = this.remaining(startedAt)
    if (remaining <= 0) return fail('dns', start, 'diagnose timeout')
    try {
      const address = await this.withTimeout(dnsPromises.lookup(hostname), remaining, 'dns timeout')
      steps.push({ step: 'dns', ok: true, ms: Date.now() - start, detail: address.address })
    } catch (err) {
      return fail('dns', start, this.message(err))
    }

    start = Date.now()
    remaining = this.remaining(startedAt)
    if (remaining <= 0) return fail('tcp', start, 'diagnose timeout')
    try {
      await this.probeTcp(hostname, port, remaining)
      steps.push({ step: 'tcp', ok: true, ms: Date.now() - start, detail: `${hostname}:${port}` })
    } catch (err) {
      return fail('tcp', start, this.message(err))
    }

    if (url.protocol === 'https:') {
      start = Date.now()
      remaining = this.remaining(startedAt)
      if (remaining <= 0) return fail('tls', start, 'diagnose timeout')
      try {
        const detail = await this.probeTls(hostname, port, remaining)
        steps.push({ step: 'tls', ok: true, ms: Date.now() - start, detail })
      } catch (err) {
        return fail('tls', start, this.message(err))
      }
    }

    start = Date.now()
    remaining = this.remaining(startedAt)
    if (remaining <= 0) return fail('http', start, 'diagnose timeout')
    try {
      const statusCode = await this.probeHttp(url, remaining)
      steps.push({ step: 'http', ok: true, ms: Date.now() - start, statusCode })
    } catch (err) {
      return fail('http', start, this.message(err))
    }

    return {
      target: url.toString(),
      ok: true,
      statusCode: steps[steps.length - 1]?.statusCode,
      steps,
    }
  }

  private parseTarget(input: string): URL {
    const raw = String(input ?? '').trim()
    if (raw.length === 0) throw new Error('target is required')
    const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(raw) ? raw : `http://${raw}`
    let url: URL
    try {
      url = new URL(withProtocol)
    } catch (err) {
      throw new Error(`invalid target: ${raw}`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`unsupported protocol: ${url.protocol}`)
    }
    return url
  }

  private remaining(startedAt: number): number {
    return Math.max(0, DIAGNOSE_BUDGET - (Date.now() - startedAt))
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms)
      promise.then(
        value => { clearTimeout(timer); resolve(value) },
        err => { clearTimeout(timer); reject(err) },
      )
    })
  }

  private probeTcp(host: string, port: number, timeout: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = net.connect({ host, port })
      const finish = (err?: Error) => {
        socket.removeAllListeners()
        socket.destroy()
        if (err != null) reject(err)
        else resolve()
      }
      socket.setTimeout(Math.max(1, timeout), () => finish(new Error('tcp timeout')))
      socket.once('connect', () => finish())
      socket.once('error', err => finish(err))
    })
  }

  private probeTls(host: string, port: number, timeout: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const servername = net.isIP(host) ? undefined : host
      const socket = tls.connect({ host, port, servername, rejectUnauthorized: false })
      const finish = (err?: Error) => {
        socket.removeAllListeners()
        socket.destroy()
        if (err != null) reject(err)
      }
      socket.setTimeout(Math.max(1, timeout), () => finish(new Error('tls timeout')))
      socket.once('secureConnect', () => {
        const detail = socket.authorized
          ? 'certificate verified'
          : String(socket.authorizationError ?? 'certificate not verified')
        socket.removeAllListeners()
        socket.destroy()
        resolve(detail)
      })
      socket.once('error', err => finish(err))
    })
  }

  private probeHttp(url: URL, timeout: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http
      const req = transport.request(url, { method: 'HEAD', timeout, rejectUnauthorized: false }, resp => {
        resp.resume()
        resolve(resp.statusCode ?? 0)
      })
      req.on('timeout', () => req.destroy(new Error('http timeout')))
      req.on('error', reject)
      req.end()
    })
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  private push<T>(list: T[], item: T) {
    list.push(item)
    if (list.length > MAX_BUFFER) list.splice(0, list.length - MAX_BUFFER)
  }
}
