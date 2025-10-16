import { Connection } from "sockjs"
import { get, post } from './base.api'
import { LocalServerConfig } from './base.models'
import { API_URL } from "./api.const"

export namespace ProxyMock {

  export type ProxyConfig = {
    dataServer: string, // 数据代理服务器，可以指向开发自己的
    status: boolean,
    delay: number
  }

  export interface StatisticRecord {
    app_id: string
    app_version: string
    os: string
    rule: string
    pageId: string
    elementId: string
    event_id: number
    arg1: string
    arg2: string
    arg3: string
    args: string
    desc: string
  }

  export interface ProxyRequestRecord {
    id: number
    type: number
    // _idx?: string // 列表索引
    timestamp?: number // 请求发起时间
    method?: string
    url?: string
    statusCode?: number // 请求状态
    timelineColor?: string
    time?: number // 请求耗时
    isMock?: boolean // 是否为Mock数据
    headers?: any // 请求头
    requestData?: any // 请求参数
    data?: any
    responseHeaders?: any // 响应头
    responseData?: any // 响应数据
  }

  export interface ProxyStatRecord extends ProxyRequestRecord {
    timelineColor?: string
    statistics: {
      bps: StatisticRecord[]
    }
  }

  export class MockRule {
    _id: string
    _rev: string
    name: string
    desc: string
    isMock?: boolean = false
    requests: Map<string, ProxyRequestRecord> = new Map()
    jsonRequests: JSON
  }

  export interface MsgPushClient extends ClientInfo {
    username: string
    conn?: Connection
  }

  export interface ClientInfo {
    connId: string
    uid: string
    ip: string
    port: number
    username?: string
  }

  export enum PushMsgType {
    TXT = 0,
    CMD = 1,
  }

  export enum CMDType {
    REGISTER = 0,
    KICKDOWN = 1,
    RECONNECT = 2,
    BROADCAST = 3
  }

  export enum BizType {
    IM = 0,
    Proxy = 1,
    ClientInfos = 2,
  }

  export interface PushMsg<T> {
    type: PushMsgType
    from?: string
    to?: string
    payload?: PushMsgPayload<T>
  }

  export interface PushMsgPayload<T> {
    type: BizType | CMDType
    content: T
  }

  export enum PorxyType {
    REQUEST = 5010,
    REQUEST_START = 5011,
    REQUEST_END = 5012,
    STATISTICS = 5020,
    SOCKET = 5030,
  }


  export function searchMockRules(keyword: string) {
    return get<Array<ProxyMock.MockRule>>(`${API_URL.AppMock}${API_URL.SearchMockRules}`, null, { keyword })
  }

  export function getMockRuleDetail(ruleId: string) {
    return get<ProxyMock.MockRule>(`${API_URL.AppMock}${API_URL.GetMockRuleDetail}`, null, { ruleId })
  }

  export function saveMockRule(mockRule: ProxyMock.MockRule, onlySnap: boolean) {
    return post<string>(`${API_URL.AppMock}${API_URL.SaveMockRule}`, null, { onlySnap }, mockRule)
  }

  export function deleteMockRule(ruleId: string) {
    return post<string>(`${API_URL.AppMock}${API_URL.DeleteMockRule}`, null, { ruleId })
  }

  export function getServerConfig() {
    return get<LocalServerConfig>(`${API_URL.AppMock}${API_URL.GetServerConfig}`)
  }

  export async function saveProxyConfig(config: Partial<ProxyMock.ProxyConfig>) {
    return post<string>('/appmock/saveProxyConfig', null, null, config)
  }

  export function getAllPushClients() {
    return get<Array<ProxyMock.MsgPushClient>>('/appmock/getAllPushClients')
  }

  export function mockRegister(uid: string) {
    return get<string>(`/appmock/register/${uid}`)
  }

  export function broadcast(uid: string) {
    return get<string>(`/appmock/sse/broadcast/${uid}`)
  }
}
