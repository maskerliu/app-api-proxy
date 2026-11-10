import { ProxyMock } from '@shared/proxy.models'
import { prettifyJson } from '../../common/format'

export type FrameCategory = 'text' | 'binary' | 'control'

export function frameCategory(opcode: ProxyMock.SocketOpcode): FrameCategory {
  if (opcode === 'text') return 'text'
  if (opcode === 'binary') return 'binary'
  return 'control'
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
  return prettifyJson(frame.data ?? '')
}