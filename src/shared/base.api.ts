import axios from 'axios'
import { BizCode, BizResponse, Version } from './base.models'
import { MOCK_UID_HEADER } from './http-header'
import { stripTrailingSlash } from './url'

import { showNotify } from 'vant'

axios.defaults.timeout = 10000
axios.defaults.withCredentials = false

let clientUID: string = null
let BASE_DOMAIN: string = null
let UPDATE_SERVER: string = null

export interface RequestOptions {
  // 调用方自行处理失败提示时关闭全局 notify，避免同一错误弹两次
  silentError?: boolean
  // 单次请求的超时毫秒数，0 = 不限时。不传则沿用 axios.defaults.timeout
  timeout?: number
}

async function request<T>(method: string, path: string, baseURL?: string, headers?: any, params?: {}, data?: any,
  options?: RequestOptions) {
  const resp = await axios.request<BizResponse<T>>({
    baseURL: baseURL ? baseURL : BASE_DOMAIN,
    url: path,
    method, params, data,
    // 只在这一次调用显式给了值时才覆盖，否则交回 axios.defaults.timeout：传 undefined 在 axios 的
    // mergeConfig 里等于「用默认值」，写出来不影响任何没传 timeout 的调用点
    timeout: options?.timeout,
    // 注册完成前还没有 uid，避免带上空值被服务端当成有效客户端
    headers: Object.assign(
      clientUID ? { [MOCK_UID_HEADER]: clientUID } : {},
      headers
    )
  })

  let bizResp = resp.data
  switch (bizResp.code) {
    case BizCode.SUCCESS:
      return bizResp.data
    case BizCode.FAIL:
      if (!options?.silentError) showNotify({ message: bizResp.msg, type: "warning", duration: 1000 })
      return rejectBizError(bizResp)
    case BizCode.ERROR:
      console.log(resp.data)
      if (!options?.silentError) showNotify({ message: bizResp.msg, type: "danger", duration: 1200 })
      return rejectBizError(bizResp)
    default:
      break
  }
}

// 以 Error 拒绝，同时保留结构化错误码；调用方仍可把 err.message 当作文案使用
function rejectBizError(bizResp: BizResponse<any>) {
  const error: any = new Error(bizResp.msg ?? '')
  if (bizResp.errorCode != null) error.errorCode = bizResp.errorCode
  if (bizResp.existingRecordId != null) error.existingRecordId = bizResp.existingRecordId
  if (bizResp.detail != null) error.detail = bizResp.detail
  if (Array.isArray(bizResp.issues)) error.issues = bizResp.issues
  return Promise.reject(error)
}

export async function get<T>(path: string, baseURL?: string, params?: {}, options?: RequestOptions) {
  return request<T>('GET', path, baseURL, null, params, null, options)
}

export async function post<T>(path: string, baseURL?: string, params?: {}, data?: any, options?: RequestOptions) {
  return request<T>('POST', path, baseURL, { 'Content-Type': 'application/json' }, params, data, options)
}

/**
 * 上传 FormData：不显式写 Content-Type，交给浏览器补 boundary。
 * 写死 'multipart/form-data' 会原样发出去（axios 只在 data 为 undefined 时才摘掉头），
 * 缺少 boundary 的请求体服务端根本无法解析。
 */
export async function formPost<T>(path: string, baseURL?: string, params?: {}, data?: FormData,
  options?: RequestOptions) {
  return request<T>('POST', path, baseURL, { 'Content-Type': null }, params, data, options)
}

export function updateUpdateServer(url?: string) {
  const trimmed = stripTrailingSlash(url?.trim())
  UPDATE_SERVER = trimmed ? trimmed : null
}

export async function versionCheck(platform: string, arch: string, url?: string) {
  const baseURL = url?.trim() ? stripTrailingSlash(url.trim()) : UPDATE_SERVER
  return request<Version>('GET', `/version-${platform}-${arch}.json`, baseURL ?? 'http://127.0.0.1:4000')
}

export function updateClientUID(uid: string) {
  clientUID = uid
}

export function updateBaseDomain(domain: string) {
  BASE_DOMAIN = domain
}

export function baseDomain() {
  return BASE_DOMAIN
}