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
// saveConflict 的文案由调用方按 kind==='conflict' 自取（乐观锁三选项弹窗），不进 mock.editor.validation 码表
export const MOCK_CONFLICT_CODES = [
  'matchDuplicate',
  'saveConflict',
  'notImplemented',
] as const

/**
 * 导入/导出（R4）：包级失败要在文件侧修，条目级失败要在数据侧修，
 * 两者都不属于「编辑器里就能改好」，因此文案独立落在 mock.pack.* 一块。
 */
export const MOCK_PACK_CODES = [
  'packFormatUnknown',
  'packVersionUnsupported',
  'packTooLarge',
  'packRecordLimit',
  'packEmpty',
  'packModeUnsupported',
  'harEntryLimit',
  'harNoResponse',
  'harBodyUnreadable',
  'harUnsupportedProtocol',
  'harStaticResource',
  'packFieldDefaulted',
  'packIdCollision',
  'packImportInProgress',
  'packWriteAborted',
] as const

/**
 * 云共享（v1.3 Phase A）：远端失败的归因空间比本地大一个量级（配置 / 网络 / 权限 / 内容 / 写 / 上限 / 并发），
 * 不许统一成「同步失败」，因此文案独立落在 mock.share.* 一块（PRD 6.3）。
 * `shareSceneLimit` 不在 PRD 那张十码表里：上限三问第 3 行要求「场景数超限拒绝新备份并提示拆分」，
 * 这句话由不得借用 `sceneTooLargeForCloud`（那说的是单场景体积），也不该塞进 `remoteWriteFailed` 的 detail 里当副文案。
 */
export const MOCK_SHARE_CODES = [
  'remotePathMissing',
  'remoteUnreachable',
  'remoteNotFound',
  'remoteForbidden',
  'remoteCorrupted',
  'remoteVersionTooNew',
  'remoteShapeUnknown',
  'remoteWriteFailed',
  'sceneTooLargeForCloud',
  'shareSceneLimit',
  'shareInProgress',
] as const

export const MOCK_ERROR_CODES = [
  ...MOCK_VALIDATION_CODES, ...MOCK_SERVER_CODES, ...MOCK_CONFLICT_CODES, ...MOCK_PACK_CODES, ...MOCK_SHARE_CODES,
] as const

export type MockErrorCode = typeof MOCK_ERROR_CODES[number]
export type MockValidationCode = typeof MOCK_VALIDATION_CODES[number]
export type MockPackCode = typeof MOCK_PACK_CODES[number]
export type MockShareCode = typeof MOCK_SHARE_CODES[number]

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