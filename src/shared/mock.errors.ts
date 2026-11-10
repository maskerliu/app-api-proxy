// Mock 错误码的唯一真源：新增码必须同时补 zh-CN / en 文案。
// 说明：当前 API 框架统一返回 HTTP 200，错误通过响应体 { code, msg } 表达；
// MockErrorCode 写在 msg 中（见 BaseRouter），不使用 HTTP 400/500 区分业务错误。

/** 校验类：由 validateMockRecord / validateMatchRule 产出，在编辑器里就能修好 */
export const MOCK_VALIDATION_CODES = [
  'statusRange',
  'delayRange',
  'bodyType',
  'bodyEncoding',
  'bodyTooLarge',
  'bodyModeUnsupported',
  'variantLimit',
  'variantIdMissing',
  'headerName',
  'headerValue',
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
  'priorityInvalid',
  'matchMissing',
] as const

/** 服务端状态类：编辑器改不了，但仍属用户可操作的失败 */
export const MOCK_SERVER_CODES = [
  'recordTooMany',
  'migrationFailed',
  'ruleMissing',
  'recordMissing',
] as const

/** 冲突与未实现：UI 要单独分流，不能混进校验提示 */
export const MOCK_CONFLICT_CODES = [
  'matchDuplicate',
  'notImplemented',
] as const

export const MOCK_ERROR_CODES = [
  ...MOCK_VALIDATION_CODES, ...MOCK_SERVER_CODES, ...MOCK_CONFLICT_CODES,
] as const

export type MockErrorCode = typeof MOCK_ERROR_CODES[number]
export type MockValidationCode = typeof MOCK_VALIDATION_CODES[number]

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