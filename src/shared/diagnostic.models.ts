/**
 * 纯模型层：接入诊断相关的类型，主进程与渲染进程共用。
 */
export namespace Diagnostic {
  export type DiagnoseStepName = 'dns' | 'tcp' | 'tls' | 'http'

  export interface RecentRequest {
    sessionId: number
    at: number
    uid: string
    method: string
    url: string
    host?: string
    // uid 是否仍在线；离线/未注册的请求会进入 unknownUidRequests
    uidKnown: boolean
    mockHit?: boolean
  }

  export interface RecentError {
    at: number
    uid?: string
    url?: string
    host?: string
    error: string
  }

  export interface DiagnoseStep {
    step: DiagnoseStepName
    ok: boolean
    ms: number
    detail?: string
    statusCode?: number
  }

  export interface DiagnoseResult {
    target: string
    ok: boolean
    statusCode?: number
    steps: DiagnoseStep[]
  }

  export interface HealthInfo {
    ok: boolean
    version: string
    protocol: string
    ip: string
    port: number
    uptimeSec: number
    clients: {
      viewers: number
      devices: number
    }
    activeMockRules: number
    recentRequests: RecentRequest[]
    unknownUidRequests: RecentRequest[]
    errors: RecentError[]
  }
}
