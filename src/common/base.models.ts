export enum BizCode {
  SUCCESS = 8000,
  FAIL = 4000,
  ERROR = 1000,
}

export interface BizResponse<T> {
  code: number
  msg?: string
  data?: T
}

/**
 * @public
 */
export class BizFail {
  code: BizCode
  msg: string

  constructor(code: number, msg: string) {
    if (code < BizCode.FAIL || code > 5000) throw 'biz code must between 4000~5000'
    this.code = code
    this.msg = msg
  }
}

/**
 * @public
 */
export interface UserDevice {
  os: string, // 操作系统
  version: string, // 系统版本
  brand: string, // 品牌
  model: string, // 型号
}

/**
 * @public
 */
export enum UserNetwork {
  UNKNOWN,
  Ethernet, // 有线
  WIFI, // 无线
  G2, // 2G
  G3, // 3G
  G4, // 4G
  G5, // 5G
}
/**
 * @public
 */
export interface BizContext {
  token?: string,
  uid?: string, // 用户ID
  did: string, // 设备ID
  ua: string, // UserAgent example: mapi/1.0 (Android 12;com.github.lynxchina.argus 1.0.1;vivo:V2171A;huaiwei)
  network: UserNetwork,
  deviceInfo: UserDevice,
  appId: string,
  version: string, // app version
  channel: string // app channel
}

export interface Paged<T> {
  data: Array<T>
  page: any
  totalPage: number
  isEnd: boolean
}


export interface AppInfo {
  env: string
  version: string
  bundleId: string
}

export interface LocalIP {
  address: string
  netmask: string
  family: string
  mac: string
  internal: boolean
  cidr: string
  name: string
}

export interface LocalServerConfig {

  platform: string
  arch: string
  updateServer?: string
  protocol: string
  ip?: string
  port?: number
  domain?: string
  ips?: Array<LocalIP>
  apiDefineServer?: string // API定义服务地址
  statRuleServer?: string // 埋点定义服务地址
  dataServer?: string // 流量代理服务地址
  status?: boolean // 流量代理服务是否开启
  versionCheckServer?: string // 应用版本更新检查服务
  mqttBroker?: string // MQTT Broker地址

  appVersion: string
  theme: string
  locales: string
}

export interface Version {
  forceUpdate: boolean
  fullUpdate: boolean
  restart: boolean
  updateUrl: string
  message: string
  version: string
  sha512: string
  releaseDate: string
}