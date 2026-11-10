// 匹配相关错误码：作为 UI 文案的键使用，新增码必须同时补 zh-CN / en 文案。
// 说明：当前 API 框架统一返回 HTTP 200，错误通过响应体 { code, msg } 表达；
// MockErrorCode 写在 msg 中（见 BaseRouter），不使用 HTTP 400/500 区分业务错误。

export const MOCK_ERROR_CODES = [
  'methodInvalid',
  'hostInvalid',
  'pathTypeInvalid',
  'pathEmpty',
  'pathRegexInvalid',
  'pathRegexTooLong',
  'pathRegexUnsafe',
  'queryOperatorInvalid',
  'queryValueMissing',
  'headerNameInvalid',
  'headerValueInvalid',
  'bodyModeUnsupported',
  'priorityInvalid',
  'matchMissing',
  'matchDuplicate',
  'recordTooMany',
  'migrationFailed',
  'ruleMissing',
  'recordMissing',
  'notImplemented',
] as const

export type MockErrorCode = typeof MOCK_ERROR_CODES[number]

export interface MockErrorPayload {
  code: MockErrorCode | string
  msg?: string
  detail?: string
  existingRecordId?: string
}

/** 业务错误：由服务层抛出，BaseRouter 统一转为 { code: BizCode.ERROR, msg } */
export class MockError extends Error {
  readonly code: MockErrorCode
  readonly detail?: string
  readonly existingRecordId?: string

  constructor(code: MockErrorCode, detail?: string, existingRecordId?: string) {
    super(code)
    this.name = 'MockError'
    this.code = code
    this.detail = detail
    this.existingRecordId = existingRecordId
  }
}