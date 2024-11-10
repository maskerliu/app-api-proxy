import axios from 'axios'
import { BizCode, BizResponse } from './base.models'

import { showNotify } from 'vant'

axios.defaults.timeout = 10000
axios.defaults.withCredentials = true

let clientUID: string = null
let BASE_DOMAIN: string = null


async function request<T>(method: string, path: string, baseURL?: string, headers?: any, params?: {}, data?: any) {
  const resp = await axios.request<BizResponse<T>>({
    baseURL: baseURL ? baseURL : BASE_DOMAIN,
    url: path,
    method: method,
    params: Object.assign({ uid: clientUID }, params),
    data: data,
    headers: headers
  })

  let bizResp = resp.data
  switch (bizResp.code) {
    case BizCode.SUCCESS:
      return bizResp.data
    case BizCode.FAIL:
      showNotify({ message: bizResp.msg, type: "warning", duration: 1000 })
      return Promise.reject(bizResp.msg)
    case BizCode.ERROR:
      console.log(resp.data)
      showNotify({ message: bizResp.msg, type: "danger", duration: 1200 })
      return Promise.reject(bizResp.msg)
    default:
      break
  }
}

export async function get<T>(path: string, baseURL?: string, params?: {}) {
  return request<T>('GET', path, baseURL, null, params)
}

export async function post<T>(path: string, baseURL?: string, params?: {}, data?: any) {
  return request<T>('POST', path, baseURL, { 'Content-Type': 'application/json' }, params, data)
}

export async function formPost<T>(path: string, baseURL?: string, params?: {}, data?: FormData) {
  return request<T>('POST', path, baseURL, { 'Content-Type': 'multipart/form-data' }, params, data)
}


export function updateClientUID(uid: string) {
  clientUID = uid
}

export function updateBaseDomain(domain: string) {
  BASE_DOMAIN = domain
}
