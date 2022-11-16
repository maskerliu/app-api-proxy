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

export interface IP {
  address: string
  netmask: string
  family: string
  mac: string
  internal: boolean
  cidr: string
  name: string
}

export interface LocalServerConfig {
  ip?: string
  port?: number
  ips?: Array<IP>
  apiDefineServer?: string // API定义服务地址
  statRuleServer?: string // 埋点定义服务地址
  dataServer?: string // 流量代理服务地址
  status?: boolean // 流量代理服务是否开启
  versionCheckServer?: string // 应用版本更新检查服务
  mqttBroker?: string // MQTT Broker地址
}