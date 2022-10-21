import { BizResponse, LocalServerConfig, MockRule, MsgPushClient } from "./models"

import axios, { AxiosResponse } from "axios"
import { BizCode } from "./models"

import { Notify } from 'vant'

axios.defaults.timeout = 10000
axios.defaults.withCredentials = true

let clientUID: string = null
let BASE_DOMAIN: string = null

export async function get<T>(path: string, baseURL?: string, params?: {}) {

  const resp = await axios.request<BizResponse<T>>({
    baseURL: baseURL ? baseURL : BASE_DOMAIN,
    url: path,
    method: "GET",
    params: Object.assign({ uid: clientUID }, params)
  })

  let bizResp = resp.data
  switch (bizResp.code) {
    case BizCode.SUCCESS:
      return bizResp.data
    case BizCode.FAIL:
      Notify({ message: bizResp.msg, type: "warning" })
      return Promise.reject(bizResp.msg)
    case BizCode.ERROR:
      Notify({ message: bizResp.msg, type: "danger" })
      return Promise.reject(bizResp.msg)
    default:
      break
  }
}

export async function post<T>(path: string, baseURL?: string, params?: {}, data?: any) {
  const resp = await axios.post<BizResponse<T>>(path, data, {
    baseURL: baseURL ? baseURL : BASE_DOMAIN,
    params: Object.assign({ uid: clientUID }, params),
  })

  let bizResp = resp.data
  switch (bizResp.code) {
    case BizCode.SUCCESS: {
      return bizResp.data
    }
    case BizCode.FAIL:
      Notify({ message: bizResp.msg, type: "warning" })
      return Promise.reject(bizResp.msg)
    case BizCode.ERROR:
      Notify({ message: bizResp.msg, type: "danger" })
      return Promise.reject(bizResp.msg)
    default:
      return Promise.reject("未知错误")
  }
}

export function updateClientUID(uid: string) {
  clientUID = uid
}

export function updateBaseDomain(domain: string) {
  BASE_DOMAIN = domain
}

export function setProxyDelay(delay: number) {
  return get<string>("/appmock/setProxyDelay", null, { delay })
}

export function searchMockRules(keyword: string) {
  return get<Array<MockRule>>("/appmock/searchMockRules", null, { keyword })
}

export function getMockRuleDetail(ruleId: string) {
  return get<MockRule>("/appmock/getMockRuleDetail", null, { ruleId })
}

export function saveMockRule(mockRule: MockRule, onlySnap: boolean) {
  return post<string>("/appmock/saveMockRule", null, { onlySnap }, mockRule)
}

export function deleteMockRule(ruleId: string) {
  return post<string>("/appmock/deleteMockRule", null, { ruleId })
}

export function getServerConfig() {
  return get<LocalServerConfig>("/appmock/getServerConfig")
}

export async function syncServerConfig(config: LocalServerConfig) {
  return post<LocalServerConfig>("/appmock/saveServerConfig", null, null, config)
}

export function getAllPushClients() {
  return post<Array<MsgPushClient>>("/appmock/getAllPushClients")
}

export function mockRegister() {
  return post<string>("/appmock/register")
}