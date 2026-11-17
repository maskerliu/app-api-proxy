// 预览用的媒体识别：只看文件头、content-type 与 URL 后缀，不依赖 DOM 与网络。
// 展示名（PNG/MP3/M4A…）与大类（image/audio/video）都由这一份表推导，避免两处各判一次。

export type MediaKind = 'image' | 'audio' | 'video' | ''

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|m4b|aac|flac|opus)$/i
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|flv)$/i

// 与上面三组后缀一一对应，新增后缀要同时改两处
const EXT_FORMATS: Record<string, string> = {
  png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG', gif: 'GIF', webp: 'WEBP', bmp: 'BMP', svg: 'SVG', avif: 'AVIF', ico: 'ICO',
  mp3: 'MP3', wav: 'WAV', ogg: 'OGG', opus: 'OPUS', m4a: 'M4A', m4b: 'M4B', aac: 'AAC', flac: 'FLAC',
  mp4: 'MP4', m4v: 'M4V', mov: 'MOV', webm: 'WEBM', mkv: 'MKV', flv: 'FLV',
}

// content-type 别名：只列不能由子类型大写直接读出来的
const MIME_FORMATS: Record<string, string> = {
  'image/jpeg': 'JPEG', 'image/pjpeg': 'JPEG', 'image/svg+xml': 'SVG', 'image/x-icon': 'ICO',
  'image/vnd.microsoft.icon': 'ICO', 'application/ogg': 'OGG',
  'audio/mpeg': 'MP3', 'audio/mp3': 'MP3', 'audio/mp4': 'M4A', 'audio/x-m4a': 'M4A',
  'audio/wav': 'WAV', 'audio/x-wav': 'WAV', 'audio/wave': 'WAV', 'audio/vnd.wave': 'WAV',
  'audio/x-flac': 'FLAC', 'audio/aiff': 'AIFF', 'audio/x-aiff': 'AIFF',
  'video/quicktime': 'MOV', 'video/x-matroska': 'MKV', 'video/x-msvideo': 'AVI', 'video/x-flv': 'FLV',
  'video/mp2t': 'TS',
}

// 展示名 → 大类：content-type 缺失或报成 octet-stream 时的兜底依据
const FORMAT_KINDS: Record<string, MediaKind> = {
  PNG: 'image', JPEG: 'image', GIF: 'image', BMP: 'image', WEBP: 'image', AVIF: 'image', SVG: 'image', ICO: 'image',
  MP3: 'audio', MP2: 'audio', MP1: 'audio', AAC: 'audio', WAV: 'audio', AIFF: 'audio', OGG: 'audio', OPUS: 'audio',
  FLAC: 'audio', M4A: 'audio', M4B: 'audio', MIDI: 'audio',
  MP4: 'video', M4V: 'video', MOV: 'video', WEBM: 'video', MKV: 'video', FLV: 'video', AVI: 'video', '3GP': 'video', TS: 'video',
}

// ISO-BMFF 的 ftyp brand：只列常见项，未知 brand 统一按 MP4 容器
const FTYP_BRANDS: Record<string, string> = {
  'isom': 'MP4', 'iso2': 'MP4', 'iso4': 'MP4', 'iso5': 'MP4', 'iso6': 'MP4', 'mp41': 'MP4', 'mp42': 'MP4',
  'avc1': 'MP4', 'dash': 'MP4', 'M4A ': 'M4A', 'M4B ': 'M4B', 'M4V ': 'M4V', 'qt  ': 'MOV',
  'avif': 'AVIF', 'avis': 'AVIF', 'msdh': 'MP4',
}

// MPEG 音频帧头的 layer 位：00 是 ADTS(AAC)，01/10/11 是 Layer III/II/I
const MPEG_LAYERS = ['', 'MP3', 'MP2', 'MP1']

function normalizeMime(contentType?: string | null): string {
  return String(contentType ?? '').split(';')[0].trim().toLowerCase()
}

function urlPath(url: string) {
  return url.split(/[?#]/)[0]
}

/** 文件头识别：源站常把 content-type 报成 octet-stream，此时只有字节可信。 */
function sniffMagic(data?: ArrayBuffer | null): string {
  if (data == null || data.byteLength < 3) return ''
  const b = new Uint8Array(data.byteLength < 32 ? data : data.slice(0, 32))
  const starts = (...bytes: number[]) => bytes.every((it, idx) => b[idx] == it)
  const tag = (from: number) => from + 4 > b.length ? '' : String.fromCharCode(b[from], b[from + 1], b[from + 2], b[from + 3])

  if (starts(0xFF, 0xD8, 0xFF)) return 'JPEG'
  if (starts(0x89, 0x50, 0x4E, 0x47)) return 'PNG'
  if (starts(0x47, 0x49, 0x46)) return 'GIF'
  if (starts(0x42, 0x4D)) return 'BMP'
  if (starts(0x49, 0x44, 0x33)) return 'MP3'
  if (starts(0x66, 0x4C, 0x61, 0x43)) return 'FLAC'
  if (starts(0x4F, 0x67, 0x67, 0x53)) return 'OGG'
  if (starts(0x1A, 0x45, 0xDF, 0xA3)) return 'MKV'
  if (starts(0x52, 0x49, 0x46, 0x46)) {
    const sub = tag(8)
    return sub == 'WEBP' ? 'WEBP' : sub == 'WAVE' ? 'WAV' : sub == 'AIFF' ? 'AIFF' : sub == 'AVI ' ? 'AVI' : ''
  }
  if (tag(4) == 'ftyp') return FTYP_BRANDS[tag(8)] ?? 'MP4'
  // 帧同步 11 位之后是 2 位版本、2 位 layer：layer 01/10/11 才是 MPEG 音频，
  // 00 只有 ADTS（低 4 位固定 0/1/8/9）一种可能，0xFFE0 这类 MPEG 视频头必须排除
  if (b[0] == 0xFF && (b[1] & 0xE0) == 0xE0) {
    let layer = (b[1] >> 1) & 0x03
    if (layer != 0) return MPEG_LAYERS[layer]
    return (b[1] & 0xF6) == 0xF0 ? 'AAC' : ''
  }
  return ''
}

function formatFromUrl(url: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(urlPath(url))?.[1]?.toLowerCase() ?? ''
  return EXT_FORMATS[ext] ?? ''
}

function formatFromMime(contentType?: string | null): string {
  const type = normalizeMime(contentType)
  if (MIME_FORMATS[type]) return MIME_FORMATS[type]
  // image/audio/video 的子类型名基本可读（image/png → PNG），
  // application/* 与 text/* 太杂，交给后缀兜底，别把 octet-stream 显示成格式
  const [major, sub] = type.split('/')
  if (major != 'image' && major != 'audio' && major != 'video') return ''
  return (sub ?? '').replace(/^x-/, '').split('+')[0].toUpperCase()
}

/** 展示用格式名：文件头 > content-type > URL 后缀，认不出来返回空串。 */
export function sniffMediaFormat(data: ArrayBuffer | null | undefined, contentType?: string | null, url?: string): string {
  return sniffMagic(data) || formatFromMime(contentType) || formatFromUrl(url ?? '') || ''
}

export function mediaKindByUrl(url: string): MediaKind {
  const path = urlPath(url)
  if (IMAGE_EXT.test(path)) return 'image'
  if (AUDIO_EXT.test(path)) return 'audio'
  if (VIDEO_EXT.test(path)) return 'video'
  return ''
}

// 部分 CDN/对象存储会把媒体文件的 content-type 返回成 application/octet-stream，
// 此时按文件头、再按 URL 后缀兜底判断
export function resolveMediaKind(contentType: string, data: ArrayBuffer, url: string): MediaKind {
  const type = normalizeMime(contentType)
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'

  const magic = sniffMagic(data)
  if (magic != '') return FORMAT_KINDS[magic] ?? ''

  const path = urlPath(url)
  if (IMAGE_EXT.test(path)) return 'image'
  if (AUDIO_EXT.test(path)) return 'audio'
  if (VIDEO_EXT.test(path)) return 'video'
  return ''
}
