import { ProxyMock, inferBodyType, sanitizeResponseHeaders } from '@shared'
import { pickHeader } from '@shared/http-header'
import { prettifyJson } from '../../../common/format'

export function cloneRecord(record: ProxyMock.MockRecord): ProxyMock.MockRecord {
  return record == null ? null : JSON.parse(JSON.stringify(record))
}

export function emptyRecord(ruleId: string): ProxyMock.MockRecord {
  return {
    id: null,
    ruleId,
    name: '',
    url: '',
    response: ProxyMock.defaultResponse(),
    variants: [],
    activeVariantId: null,
    createdAt: 0,
    updatedAt: 0,
  }
}

/** 从一条实时请求生成可编辑记录草稿 */
export function recordFromRequest(ruleId: string, request: ProxyMock.ProxyRequestRecord): ProxyMock.MockRecord {
  const record = emptyRecord(ruleId)
  if (request == null) return record

  const headers = sanitizeResponseHeaders(request.responseHeaders ?? {})
  let body = ''
  let bodyType = inferBodyType(pickHeader(headers, 'content-type') ?? '')
  // 抓包只保留二进制占位文本，按文本回填，避免保存后被当作 base64 解码
  if (bodyType === 'binary') bodyType = 'text'
  if (request.responseData != null) {
    if (typeof request.responseData === 'string') {
      body = request.responseData
    } else {
      body = JSON.stringify(request.responseData, null, 2)
      bodyType = 'json'
    }
  }

  const status = Number(request.statusCode)
  record.name = [request.method, request.url].filter(it => it != null && it !== '').join(' ')
  record.url = request.url ?? ''
  record.response = {
    statusCode: Number.isInteger(status) && status >= 100 && status <= 599 ? status : 200,
    headers,
    body,
    bodyType,
    delayMs: 0,
  }
  record.source = {
    method: request.method,
    url: request.url,
    statusCode: request.statusCode,
    headers: request.headers,
    capturedAt: Date.now(),
  }
  return prettifyRecordJson(record)
}

/** 打开记录时按多行展示 JSON 响应体，调用方应传入编辑副本，避免改动列表里的原始数据 */
export function prettifyRecordJson(record: ProxyMock.MockRecord): ProxyMock.MockRecord {
  if (record == null) return record
  prettifyDef(record.response)
  for (const variant of record.variants ?? []) prettifyDef(variant)
  return record
}

function prettifyDef(def: ProxyMock.MockResponseDef) {
  if (def?.bodyType !== 'json' || typeof def.body !== 'string') return
  // 非法 JSON 保持原样，编辑器里已有提示
  def.body = prettifyJson(def.body)
}

export function createVariant(base: ProxyMock.MockResponseDef, index: number): ProxyMock.MockVariant {
  return {
    ...JSON.parse(JSON.stringify(base)),
    id: `var_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: `变体 ${index}`,
    updatedAt: Date.now(),
  }
}

export function toRawJson(record: ProxyMock.MockRecord): string {
  return JSON.stringify(record, null, 2)
}
