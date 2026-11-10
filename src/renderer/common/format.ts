// 渲染层展示用的格式化函数：只做数字/文本转换，不依赖 Vant、i18n 与 node 内置模块。

const KB = 1024
const MB = 1024 * 1024

/** 字节阶梯：B 取整，KB/MB 按 digits 保留小数（默认 1 位，贴近上限的体积给 2 位）。 */
export function formatBytes(value?: number, digits = 1): string {
  const bytes = Math.max(0, Number(value) || 0)
  if (bytes < KB) return `${bytes} B`
  if (bytes < MB) return `${(bytes / KB).toFixed(digits)} KB`
  return `${(bytes / MB).toFixed(digits)} MB`
}

/** 耗时，入参毫秒：分 ms / s / 分秒三档。 */
export function formatElapsed(ms: number): string {
  const value = Math.max(0, Number(ms) || 0)
  if (value < 1000) return `${value} ms`
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${Math.round(seconds % 60)}s`
}

/** 服务运行时长，入参秒：整数阶梯，超过一小时只报到分。 */
export function formatUptime(seconds?: number): string {
  const total = Math.max(0, Math.floor(seconds ?? 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${total % 60}s`
  return `${total}s`
}

// 帧相对连接开始的偏移。长连接跑几小时后原始毫秒有 8 位，会把时间列撑爆，
// 所以秒级以内保留 ms，之后压成 mm:ss / h:mm:ss，原始值放在列的 title 里
export function formatFrameOffset(ms: number): string {
  const value = Math.max(0, Math.round(Number(ms) || 0))
  if (value < 1000) return `${value}ms`
  const total = Math.floor(value / 1000)
  const seconds = `${total % 60}`.padStart(2, '0')
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}:${seconds}`
  return `${Math.floor(minutes / 60)}:${`${minutes % 60}`.padStart(2, '0')}:${seconds}`
}

/** 能解析成 JSON 才重排，非法 JSON 原样返回（编辑器里已有提示）。 */
export function prettifyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch (err) {
    return text
  }
}

export function compactJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text))
  } catch (err) {
    return text
  }
}
