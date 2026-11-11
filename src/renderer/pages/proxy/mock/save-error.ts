import { MOCK_SERVER_CODES, MOCK_VALIDATION_CODES } from '@shared/mock.errors'

// 记录保存失败分型：服务端以 BizResponse.msg 返回原因，这里统一转成可操作的类型
export type MockSaveErrorKind = 'conflict' | 'duplicateUrl' | 'validation' | 'unknown'

export interface MockSaveErrorInfo {
  kind: MockSaveErrorKind
  message: string
  code?: string
  url?: string
  /** 指纹冲突时服务端返回的已存在记录，UI 可直接跳转 */
  existingRecordId?: string
}

// 码表来自 @shared/mock.errors，这里只决定「哪些码算用户可在编辑器里修好的失败」；
// matchDuplicate / notImplemented 由下面的分支单独分流，故不入表。
const VALIDATION_CODES = new Set<string>([...MOCK_VALIDATION_CODES, ...MOCK_SERVER_CODES])

export function normalizeErrorText(err: unknown): string {
  if (err == null) return ''
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error:\s*/, '').trim()
}

export function describeMockSaveError(err: unknown): MockSaveErrorInfo {
  const message = normalizeErrorText(err)
  if (message.includes('已被其他人修改')) return { kind: 'conflict', message }

  const extra = err as any
  const code: string = extra?.errorCode ?? extra?.code
  const existingRecordId: string = extra?.existingRecordId

  // R1 起唯一性由匹配指纹决定，错误码比文案更可靠
  if (code === 'matchDuplicate' || message === 'matchDuplicate') {
    return { kind: 'duplicateUrl', code: 'matchDuplicate', existingRecordId, message }
  }

  const duplicate = message.match(/^url \[(.*)\] 已存在$/)
  if (duplicate != null) return { kind: 'duplicateUrl', url: duplicate[1], message }

  if (VALIDATION_CODES.has(code)) return { kind: 'validation', code, message }
  if (VALIDATION_CODES.has(message)) return { kind: 'validation', code: message, message }
  return { kind: 'unknown', message, code }
}
