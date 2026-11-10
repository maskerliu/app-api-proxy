import type { MockHitMeta } from '@shared/mock.models'
import { ProxyMock } from '@shared/proxy.models'

export interface RequestStartInfo {
  sessionId: number
  // 请求发起的毫秒时间戳，与诊断记录、mock 判定共用同一个 at
  at: number
  url: string
  method: string
  headers: any
  requestData: any
  data: any
}

export interface RequestEndInfo {
  sessionId: number
  url: string
  // 从请求发起到打这条记录经过的毫秒数
  elapsed: number
  statusCode: number
  responseHeaders: any
  responseData: any
  isMock: boolean
  mock?: MockHitMeta
}

export function requestStart(info: RequestStartInfo): ProxyMock.ProxyRequestRecord {
  return {
    id: info.sessionId,
    type: ProxyMock.ProxyType.REQUEST_START,
    url: info.url,
    method: info.method,
    headers: info.headers,
    requestData: info.requestData,
    data: info.data,
    timestamp: info.at,
  }
}

export function requestEnd(info: RequestEndInfo): ProxyMock.ProxyRequestRecord {
  return {
    id: info.sessionId,
    url: info.url,
    type: ProxyMock.ProxyType.REQUEST_END,
    statusCode: info.statusCode,
    responseHeaders: info.responseHeaders,
    responseData: info.responseData,
    time: info.elapsed,
    isMock: info.isMock,
    mock: info.mock,
  }
}

/** 统计上报记录以毫秒时间戳兼作列表主键，与 HTTP 会话 ID 区间不冲突 */
export function statRecord(at: number, statistics: ProxyMock.ProxyStatRecord['statistics']): ProxyMock.ProxyStatRecord {
  return {
    id: at,
    type: ProxyMock.ProxyType.STATISTICS,
    timestamp: at,
    statistics,
  }
}
