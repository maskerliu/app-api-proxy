import type { Connection } from 'sockjs'
import type { MockHitMeta, MockLimitState, MockMatchRule, MockMatchWarning } from './mock.models'

/**
 * 纯模型层：只包含类型、枚举与无副作用的类，
 * 可被主进程安全引入，不得依赖 axios / vant 等渲染层库。
 */
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
    // R1 命中/未命中元数据，仅 REQUEST_END 携带
    mock?: MockHitMeta
  }

  export interface MockResponse {
    statusCode: number
    headers?: Record<string, any>
    data?: any
    // 有效延迟（变体覆盖设备级延迟）；未设置时使用设备级延迟
    delay?: number
  }

  export type MockBodyType = 'json' | 'xml' | 'text' | 'binary'
  export type MockBodyEncoding = 'utf8' | 'base64'

  // 同名头可能多值（如 set-cookie），存储层用数组表达
  export interface MockResponseHeaders {
    [name: string]: string | string[]
  }

  export interface MockResponseDef {
    statusCode: number
    headers: MockResponseHeaders
    body: string
    bodyType: MockBodyType
    bodyEncoding?: MockBodyEncoding
    delayMs: number
  }

  export interface MockVariant extends MockResponseDef {
    id: string
    name: string
    updatedAt?: number
  }

  export interface MockRecordSource {
    method?: string
    url?: string
    statusCode?: number
    headers?: any
    capturedAt?: number
  }

  export interface MockRecord {
    id: string
    ruleId: string
    name: string
    // 展示与旧版本兼容字段；唯一性由 matchFingerprint 决定，仅有 match 时可为空
    url?: string
    // R1 匹配条件；历史记录在 v3→v4 迁移时生成
    match?: MockMatchRule
    matchInvalid?: string
    matchFingerprint?: string
    // 列表接口返回的冲突标记，不持久化
    matchWarnings?: MockMatchWarning[]
    response: MockResponseDef
    variants: MockVariant[]
    activeVariantId: string | null
    source?: MockRecordSource
    createdAt: number
    updatedAt: number
  }

  export interface MockRecordSaveResult {
    id: string
    updatedAt: number
  }

  export interface ProxyStatRecord extends ProxyRequestRecord {
    timelineColor?: string
    statistics: {
      bps: StatisticRecord[]
    }
  }

  export type SocketPhase = 'open' | 'frames' | 'close'
  export type SocketDirection = 'c2s' | 's2c'
  export type SocketOpcode = 'text' | 'binary' | 'ping' | 'pong' | 'close'
  export type SocketCloseBy = 'client' | 'upstream' | 'proxy'

  export interface SocketFrame {
    seq: number
    dir: SocketDirection
    opcode: SocketOpcode
    at: number // 相对连接开始的毫秒数
    size: number // 原始字节数
    data: string // 文本原样；二进制 base64；超限截断
    encoding: 'utf8' | 'base64'
    truncated?: boolean
    mock?: boolean
  }

  export interface SocketRecord extends ProxyRequestRecord {
    type: PorxyType.SOCKET
    wsPhase: SocketPhase
    wsId: number
    // 握手阶段
    subprotocol?: string
    requestHeaders?: Record<string, string | string[]>
    responseHeaders?: Record<string, string | string[]>
    // 消息阶段
    frames?: SocketFrame[]
    // 结束阶段
    closeCode?: number
    closeReason?: string
    closeBy?: SocketCloseBy
    bytesSent?: number
    bytesReceived?: number
    frameCount?: number
    droppedFrames?: number
    // 失败诊断（WS-E01 ~ WS-E12）
    errorCode?: string
    errorMessage?: string
  }

  export enum SocketErrorCode {
    MISSING_TARGET = 'WS-E01',
    UNKNOWN_UID = 'WS-E02',
    UNSUPPORTED_PROTOCOL = 'WS-E03',
    CONNECT_FAILED = 'WS-E04',
    TLS_FAILED = 'WS-E05',
    UPSTREAM_REJECTED = 'WS-E06',
    HANDSHAKE_TIMEOUT = 'WS-E07',
    SUBPROTOCOL_MISMATCH = 'WS-E08',
    UNSUPPORTED_VERSION = 'WS-E09',
    TOO_MANY_CONNECTIONS = 'WS-E10',
    MESSAGE_TOO_LARGE = 'WS-E11',
    INTERNAL_ERROR = 'WS-E12',
  }

  export class MockRule {
    _id: string
    _rev: string
    name: string
    desc: string
    isMock?: boolean = false
    // 仅渲染层使用的列表缓存，不参与持久化；key 为记录 ID
    requests: Map<string, MockRecord> = new Map()
    // 规则详情接口返回的记录规模提示，不持久化
    limitState?: MockLimitState
  }

  export interface MockRecordPage {
    items: MockRecord[]
    hasMore: boolean
  }

  export function defaultResponse(): MockResponseDef {
    return {
      statusCode: 200,
      headers: {},
      body: '',
      bodyType: 'json',
      delayMs: 0
    }
  }

  // 有效响应：activeVariantId 命中变体时使用变体，否则回退基础响应
  export function effectiveResponse(record: MockRecord): MockResponseDef {
    if (record?.activeVariantId) {
      const variant = record.variants?.find(it => it.id === record.activeVariantId)
      if (variant != null) return variant
    }
    return record?.response ?? defaultResponse()
  }

  export interface MsgPushClient extends ClientInfo {
    username: string
    conn?: Connection
  }

  export type ClientKind = 'viewer' | 'device'

  export interface ClientInfo {
    connId: string
    uid: string
    ip: string
    port: number
    username?: string
    // viewer: 通过 SockJS 注册的 UI；device: 通过注册地址接入的被调试设备
    kind?: ClientKind
    ownerUid?: string // device 归属的 viewer uid
  }

  export interface RegisterResult {
    uid: string
    ownerUid?: string
    message?: string
  }

  export enum PushMsgType {
    TXT = 0,
    CMD = 1,
  }

  export enum CMDType {
    REGISTER = 0, // client -> server: 请求注册，由服务端分配 uid
    KICKDOWN = 1,
    RECONNECT = 2,
    BROADCAST = 3,
    REGISTERED = 4, // server -> client: 注册成功，content 为新的 uid
    DEVICE_REGISTERED = 5 // server -> viewer: 有设备通过注册地址接入，content 为设备 uid
  }

  export enum BizType {
    IM = 0,
    Proxy = 1,
    ClientInfos = 2,
    MockStatus = 3,
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
}
