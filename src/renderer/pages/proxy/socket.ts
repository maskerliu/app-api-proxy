import { ProxyMock } from '@shared/proxy.models'
import { formatBytes, prettifyJson } from '../../common/format'

export type FrameCategory = 'text' | 'binary' | 'control'
export type SocketTranslate = (key: string, params?: any) => string
export type SocketTagType = 'success' | 'warning' | 'danger'

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

// WS 方向图标唯一映射：上行 upstream、下行 downlink
export function dirIcon(dir: ProxyMock.SocketDirection): string {
  return dir === 'c2s' ? 'icon-upstream' : 'icon-downlink'
}

export interface SocketStatus {
  text: string
  tagType: SocketTagType
}

export function socketStatusOf(record: ProxyMock.SocketRecord, t: SocketTranslate): SocketStatus {
  if (record.wsPhase !== 'close') return { text: t('proxy.socket.connected'), tagType: 'success' }
  if (record.errorCode) {
    return { text: `${t('proxy.socket.failed')} ${record.statusCode}`, tagType: 'danger' }
  }
  return { text: t('proxy.socket.closed'), tagType: normalClose(record.closeCode) ? 'success' : 'warning' }
}

export interface SocketStatValue {
  text: string
  icon?: string
  title?: string
  cls?: string
}

export interface SocketStat {
  key: string
  label?: string
  title?: string
  values: SocketStatValue[]
}

// 单行信息带：一次算好条目顺序与显隐，模板里只负责渲染，不再拼条件
export function socketStatsOf(record: ProxyMock.SocketRecord, opts: {
  t: SocketTranslate
  duration: string
  frameTotal: number
}): SocketStat[] {
  const t = opts.t
  const frameValues: SocketStatValue[] = [{ text: String(record.frameCount ?? opts.frameTotal) }]
  if ((record.droppedFrames ?? 0) > 0) {
    frameValues.push({ text: t('proxy.socket.dropped', { count: record.droppedFrames }), cls: 'is-warn' })
  }
  const close: SocketStatValue[] = []
  if (record.wsPhase === 'close') {
    close.push({ text: String(record.closeCode ?? '-'), cls: normalClose(record.closeCode) ? undefined : 'is-danger' })
    if (record.closeBy) close.push({ text: t(`proxy.socket.closeBy.${record.closeBy}`) })
    if (record.closeReason) close.push({ text: record.closeReason, title: record.closeReason })
  }
  const stats: SocketStat[] = [
    { key: 'duration', label: t('proxy.socket.duration'), values: [{ text: opts.duration }] },
    {
      key: 'bytes',
      title: t('proxy.socket.bytesTitle'),
      values: [
        { text: formatBytes(record.bytesSent), icon: dirIcon('c2s') },
        { text: formatBytes(record.bytesReceived), icon: dirIcon('s2c') },
      ],
    },
    { key: 'frames', label: t('proxy.socket.frameCount'), values: frameValues },
  ]
  if (record.subprotocol) {
    stats.push({ key: 'subprotocol', label: t('proxy.socket.subprotocol'), values: [{ text: record.subprotocol }] })
  }
  if (close.length > 0) {
    stats.push({ key: 'close', label: t('proxy.socket.closeCode'), values: close })
  }
  return stats
}

function normalClose(code?: number) {
  return code === 1000 || code === 1001
}