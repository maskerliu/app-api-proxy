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

// 列表只做单行预览，完整内容交给详情编辑器，避免大 payload 拖慢列表
export function framePreview(frame: ProxyMock.SocketFrame): string {
  const data = frame.data ?? ''
  if (frame.opcode === 'text') return data.replace(/\s+/g, ' ').slice(0, 240)
  const prefix = frame.opcode === 'binary' ? 'base64:' : `${frame.opcode}:`
  return prefix + data.slice(0, 200)
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