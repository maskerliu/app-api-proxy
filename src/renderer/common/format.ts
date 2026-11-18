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

/** 媒体时长，入参秒：m:ss，超过一小时补时位；直播流的 Infinity 与无效值返回空串。 */
export function formatDuration(seconds?: number): string {
  const total = Math.floor(Number(seconds) || 0)
  if (!Number.isFinite(total) || total <= 0) return ''
  const ss = `${total % 60}`.padStart(2, '0')
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  if (hours > 0) return `${hours}:${`${minutes}`.padStart(2, '0')}:${ss}`
  return `${minutes}:${ss}`
}

/** 墙上时钟：HH:mm:ss.SSS，本地时区。密集段两端的时间戳用同一档精度，
 *  因为同桶的两条往往只差毫秒，秒级会显示成一模一样。 */
export function formatClock(at?: number): string {
  if (at == null || !Number.isFinite(at)) return ''
  const date = new Date(at)
  const pad = (n: number, len = 2) => `${n}`.padStart(len, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/** 采样率：Hz 转 kHz，整数档不带小数（8 kHz / 44.1 kHz / 48 kHz）。 */
export function formatSampleRate(hz?: number): string {
  const value = Number(hz) || 0
  if (!Number.isFinite(value) || value <= 0) return ''
  const khz = value / 1000
  return `${khz % 1 == 0 ? khz.toFixed(0) : khz.toFixed(1)} kHz`
}

/** 码率：入参 bps，一兆以下用 kbps 取整，以上换 Mbps 留一位小数。 */
export function formatBitrate(bps?: number): string {
  const value = Number(bps) || 0
  if (!Number.isFinite(value) || value <= 0) return ''
  const kbps = Math.round(value / 1000)
  if (kbps < 1000) return `${kbps} kbps`
  return `${(kbps / 1000).toFixed(1)} Mbps`
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
