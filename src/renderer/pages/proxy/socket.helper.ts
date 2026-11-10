import { ProxyMock } from '@shared/proxy.models'

export type FrameCategory = 'text' | 'binary' | 'control'

export function frameCategory(opcode: ProxyMock.SocketOpcode): FrameCategory {
  if (opcode === 'text') return 'text'
  if (opcode === 'binary') return 'binary'
  return 'control'
}

export function formatBytes(value?: number): string {
  const bytes = Math.max(0, Number(value) || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${Math.round(seconds % 60)}s`
}

// 帧相对连接开始的偏移。长连接跑几小时后原始毫秒有 8 位，会把时间列撑爆，
// 所以秒级以内保留 ms，之后压成 mm:ss / h:mm:ss，原始值放在列的 title 里
export function formatFrameOffset(ms: number): string {
  const value = Math.max(0, Math.round(ms))
  if (value < 1000) return `${value}ms`
  const total = Math.floor(value / 1000)
  const seconds = `${total % 60}`.padStart(2, '0')
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}:${seconds}`
  return `${Math.floor(minutes / 60)}:${`${minutes % 60}`.padStart(2, '0')}:${seconds}`
}

// 列表只做单行预览，完整内容交给详情编辑器，避免大 payload 拖慢列表
export function framePreview(frame: ProxyMock.SocketFrame): string {
  // 帧类型已由列表的 opcode 列展示，预览只给内容本身
  const data = frame.data ?? ''
  if (frame.opcode === 'text') return data.replace(/\s+/g, ' ').slice(0, 240)
  return data.slice(0, 200)
}

// 文本帧能解析成 JSON 时美化展示，失败时保留原文
export function frameContent(frame: ProxyMock.SocketFrame): string {
  if (frame.encoding !== 'utf8') return frame.data ?? ''
  try {
    return JSON.stringify(JSON.parse(frame.data), null, 2)
  } catch (err) {
    return frame.data ?? ''
  }
}