import type { LocalServerConfig } from '@shared/base.models'
import type { Diagnostic } from '@shared/diagnostic.models'
import { app, nativeTheme } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { inject, injectable } from 'inversify'
import path from 'path'
import 'reflect-metadata'
import { IOC_TYPES, USER_DATA_DIR } from '../constants'
import { getLocalIPs } from '../misc/utils'
import { DiagnosticService } from './diagnostic.service'
import { MockService } from './mock.service'
import { ProxyService } from './proxy.service'
import { PushService } from './push.service'

const DEFAULT_PORT = 8884
const DEFAULT_PROTOCOL = 'http'

@injectable()
export class CommonService {

  private _serverConfig: LocalServerConfig

  get serverConfig() {
    return this._serverConfig
  }

  set serverConfig(config: LocalServerConfig) {
    this._serverConfig = config
  }

  @inject(IOC_TYPES.ProxyService)
  private proxyService: ProxyService
  @inject(IOC_TYPES.PushService)
  private pushService: PushService
  @inject(IOC_TYPES.MocksService)
  private mockService: MockService
  @inject(IOC_TYPES.DiagnosticService)
  private diagnosticService: DiagnosticService

  constructor() {
    const filePath = path.join(USER_DATA_DIR, 'local.config.json')
    const config = this.readLocalConfig(filePath)
    const ips = getLocalIPs()
    this.serverConfig = {
      appVersion: app.getVersion(),
      theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      locales: app.getLocale(),
      platform: process.platform,
      arch: process.arch,
      updateServer: config.updateServer,
      apiDefineServer: config.apiDefineServer,
      statRuleServer: config.statRuleServer,
      dataServer: config.dataServer,
      status: config.status,
      protocol: config.protocol ? config.protocol : DEFAULT_PROTOCOL,
      ip: ips[0]?.address ?? '127.0.0.1',
      port: config.port ? Number(config.port) : DEFAULT_PORT,
      portValid: config.portValid,
      domain: config.domain,
      ips,
      onboarded: config.onboarded === true,
    }
  }

  private readLocalConfig(filePath: string): any {
    let fallback: any = {}
    try {
      fallback = JSON.parse(process.env.BUILD_CONFIG ?? '{}')
    } catch (err) {
      console.error('BUILD_CONFIG 解析失败，使用空配置', err)
    }

    try {
      if (!existsSync(filePath)) writeFileSync(filePath, JSON.stringify(fallback), 'utf-8')
      const raw = readFileSync(filePath, 'utf-8').trim()
      return raw.length > 0 ? JSON.parse(raw) : fallback
    } catch (err) {
      // 配置损坏时不能让应用启动失败：备份坏文件后回退默认配置
      console.error('读取 local.config.json 失败，回退默认配置', err)
      try { renameSync(filePath, `${filePath}.bad`) } catch { /* ignore */ }
      try { writeFileSync(filePath, JSON.stringify(fallback), 'utf-8') } catch (e) { console.error(e) }
      return fallback
    }
  }

  getServerConfig(): LocalServerConfig {
    return this._serverConfig
  }

  getHealth(): Diagnostic.HealthInfo {
    const clients = this.pushService.getAllPushClients()
    const viewers = clients.filter(it => it.kind === 'viewer').length
    return {
      ok: true,
      version: this.serverConfig.appVersion,
      protocol: this.serverConfig.protocol,
      ip: this.serverConfig.ip,
      port: this.serverConfig.port,
      uptimeSec: this.diagnosticService.uptimeSec,
      clients: {
        viewers,
        devices: clients.length - viewers,
      },
      activeMockRules: this.mockService.getActiveMockCount(),
      recentRequests: this.diagnosticService.recentRequests(),
      unknownUidRequests: this.diagnosticService.unknownUidRequests(),
      errors: this.diagnosticService.recentErrors(),
    }
  }

  public registerDevice(ownerUid: string, username?: string) {
    return this.pushService.registerDevice(ownerUid, username)
  }

  saveServerConfig(config: LocalServerConfig) {
    const filePath = path.join(USER_DATA_DIR, 'local.config.json')
    const port = Number.parseInt(String(config.port ?? ''))
    const validPort = Number.isInteger(port) && port > 0 && port < 65536
    this.serverConfig.updateServer = config.updateServer
    this.serverConfig.apiDefineServer = config.apiDefineServer
    this.serverConfig.statRuleServer = config.statRuleServer
    this.serverConfig.dataServer = config.dataServer
    this.serverConfig.status = config.status
    this.serverConfig.domain = config.domain
    this.serverConfig.port = validPort ? port : DEFAULT_PORT
    this.serverConfig.portValid = config.portValid as boolean
    this.serverConfig.ip = config.ip ?? this.serverConfig.ip
    this.serverConfig.protocol = config.protocol ?? this.serverConfig.protocol
    this.serverConfig.onboarded = config.onboarded ?? this.serverConfig.onboarded
    try {
      writeFileSync(filePath, JSON.stringify(this.serverConfig), 'utf-8')
    } catch (err) {
      throw new Error(`保存配置失败: ${err instanceof Error ? err.message : err}`)
    }
  }
}