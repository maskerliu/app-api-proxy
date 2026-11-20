import { MOCK_PACK_MAX_RECORDS } from '@shared/mock.pack'
import type { MockPackScope } from '@shared/mock.pack'

// 导出文件名与「这份包导入侧读不读得动」的纯判断：放在 SFC 外面才测得到，
// 也避免文件名模板在对话框与二次确认文案里各写一遍。

/**
 * 文件名模板 `appapi-mock-<场景>-<日期>.json`；关闭脱敏时追加 `-raw`。
 * `-raw` 是包里含真实凭证的唯一可携带标记——勾选状态一关对话框就没了，只剩文件名。
 */
export function packFileName(input: {
  scope: MockPackScope
  ruleName?: string | null
  redact?: boolean
  date?: Date
}): string {
  const subject = input.scope === 'all' ? 'all' : sanitizeNamePart(input.ruleName ?? '') || 'rule'
  const raw = input.redact === false ? '-raw' : ''
  return `appapi-mock-${subject}-${formatDay(input.date ?? new Date())}${raw}.json`
}

/**
 * 场景名直接进文件名会被保留字符与路径分隔符咬到，末位的点与空格也会被资源管理器吃掉。
 * 空白折成 `-`，超长截断；全部被剥掉时返回空串，由调用方回落成 `rule`。
 */
export function sanitizeNamePart(text: string): string {
  const dashed = text
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40)
  // 截断本身可能正好切在分隔符前，留下一个末位 - 或 .（Windows 会连它一起吃掉）
  return dashed.replace(/[-.]+$/g, '')
}

/**
 * 文件名可以改，但改完仍要过一次净化才能交给保存框：`saveDialogOptions` 走的是
 * `path.join(baseDir, fileName)`，带路径分隔符或盘符的名字能直接越出用户数据目录（R4C-29 那条
 * 「文件名不参与路径拼接」在这里的落点）。补 `.json` 是因为过滤器按扩展名生成，
 * 用户删掉后缀会得到一行没有标签的过滤器；剥空了才回落默认名，不产出 `.json` 这种无名文件。
 */
export function normalizeExportFileName(text: string, fallback: string): string {
  const trimmed = (text ?? '').trim()
  if (trimmed === '') return fallback
  const safe = sanitizeNamePart(trimmed.replace(/(\.json)+$/i, ''))
  return safe === '' ? fallback : `${safe}.json`
}

/** 本地日期的 YYYY-MM-DD：toISOString 是 UTC，跨零点导出的包会标错一天 */
export function formatDay(date: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 导出放行但导入侧会整包拒绝：条数超过 MOCK_PACK_MAX_RECORDS 时 UI 要单独说明 */
export function isOverImportLimit(recordCount?: number): boolean {
  return (recordCount ?? 0) > MOCK_PACK_MAX_RECORDS
}
