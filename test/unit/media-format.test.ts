import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mediaKindByUrl, resolveMediaKind, sniffMediaFormat } from '@renderer/common/mediaFormat'

function bytesOf(values: number[]): ArrayBuffer {
  const buffer = new Uint8Array(values.length + 64)
  buffer.set(values)
  return buffer.buffer
}

function asciiOf(text: string): number[] {
  return [...text].map(ch => ch.charCodeAt(0))
}

/** 按偏移铺字节，用来拼 RIFF / ISO-BMFF 这类带长度域的容器头 */
function layout(pairs: Array<[number, number[]]>): ArrayBuffer {
  const values = new Array(32).fill(0)
  pairs.forEach(([offset, bytes]) => bytes.forEach((it, idx) => { values[offset + idx] = it }))
  return bytesOf(values)
}

const PNG = bytesOf([0x89, 0x50, 0x4E, 0x47])
const JPEG = bytesOf([0xFF, 0xD8, 0xFF, 0xE0])
const GIF = bytesOf(asciiOf('GIF89a'))
const BMP = bytesOf([0x42, 0x4D])
const WEBP = layout([[0, asciiOf('RIFF')], [8, asciiOf('WEBP')]])
const WAV = layout([[0, asciiOf('RIFF')], [8, asciiOf('WAVE')]])
const AVI = layout([[0, asciiOf('RIFF')], [8, asciiOf('AVI ')]])
const ID3 = bytesOf(asciiOf('ID3'))
const MP3_FRAME = bytesOf([0xFF, 0xFB])
const MP3_FRAME_CRC = bytesOf([0xFF, 0xFA])
const ADTS = bytesOf([0xFF, 0xF1])
const ADTS_MPEG4 = bytesOf([0xFF, 0xF9])
const MPEG_VIDEO = bytesOf([0xFF, 0xE0])
const FLAC = bytesOf(asciiOf('fLaC'))
const OGG = bytesOf(asciiOf('OggS'))
const MATROSKA = bytesOf([0x1A, 0x45, 0xDF, 0xA3])
const ftyp = (brand: string) => layout([[4, asciiOf('ftyp')], [8, asciiOf(brand)]])
const JUNK = bytesOf([0x00, 0x11, 0x22, 0x33])

describe('sniffMediaFormat 展示用格式名', () => {
  it('文件头优先于 content-type 与后缀', () => {
    assert.equal(sniffMediaFormat(PNG, 'application/octet-stream', 'http://x/a'), 'PNG')
    assert.equal(sniffMediaFormat(JPEG, 'application/octet-stream', 'http://x/a'), 'JPEG')
    assert.equal(sniffMediaFormat(GIF, 'image/png', 'http://x/a.png'), 'GIF')
    assert.equal(sniffMediaFormat(BMP, '', ''), 'BMP')
    assert.equal(sniffMediaFormat(WEBP, '', ''), 'WEBP')
    assert.equal(sniffMediaFormat(WAV, '', ''), 'WAV')
    assert.equal(sniffMediaFormat(FLAC, '', ''), 'FLAC')
    assert.equal(sniffMediaFormat(OGG, '', ''), 'OGG')
    assert.equal(sniffMediaFormat(MATROSKA, '', ''), 'MKV')
  })

  it('RIFF 家族按子 tag 分流，认不出的 RIFF 不当成任何一种', () => {
    assert.equal(sniffMediaFormat(AVI, '', ''), 'AVI')
    assert.equal(sniffMediaFormat(layout([[0, asciiOf('RIFF')], [8, asciiOf('QT  ')]]), '', ''), '')
  })

  it('MPEG 帧头按 layer 位分 AAC 与 MP1/2/3，视频头不算音频', () => {
    assert.equal(sniffMediaFormat(ID3, '', ''), 'MP3')
    assert.equal(sniffMediaFormat(MP3_FRAME, '', ''), 'MP3')
    assert.equal(sniffMediaFormat(MP3_FRAME_CRC, '', ''), 'MP3')
    assert.equal(sniffMediaFormat(ADTS, '', ''), 'AAC')
    assert.equal(sniffMediaFormat(ADTS_MPEG4, '', ''), 'AAC')
    assert.equal(sniffMediaFormat(MPEG_VIDEO, '', ''), '')
  })

  it('ISO-BMFF 按 brand 区分容器，未知 brand 归 MP4', () => {
    assert.equal(sniffMediaFormat(ftyp('isom'), '', ''), 'MP4')
    assert.equal(sniffMediaFormat(ftyp('M4A '), '', ''), 'M4A')
    assert.equal(sniffMediaFormat(ftyp('qt  '), '', ''), 'MOV')
    assert.equal(sniffMediaFormat(ftyp('avif'), '', ''), 'AVIF')
    assert.equal(sniffMediaFormat(ftyp('abcd'), '', ''), 'MP4')
  })

  it('没有字节时退回 content-type，再退回 URL 后缀', () => {
    assert.equal(sniffMediaFormat(null, 'audio/mpeg', 'http://x/a'), 'MP3')
    assert.equal(sniffMediaFormat(null, 'image/svg+xml', ''), 'SVG')
    assert.equal(sniffMediaFormat(null, 'IMAGE/JPEG; charset=binary', ''), 'JPEG')
    assert.equal(sniffMediaFormat(null, 'image/png', ''), 'PNG')
    assert.equal(sniffMediaFormat(null, 'application/octet-stream', 'http://x/a.MP3?sig=1'), 'MP3')
    assert.equal(sniffMediaFormat(null, 'application/octet-stream', 'http://x/a.tar.gz'), '')
  })

  it('认不出来返回空串，由调用方省略', () => {
    assert.equal(sniffMediaFormat(null, '', ''), '')
    assert.equal(sniffMediaFormat(JUNK, 'application/octet-stream', 'http://x/a'), '')
    assert.equal(sniffMediaFormat(new Uint8Array(0).buffer, '', ''), '')
  })
})

describe('sniffMediaFormat 认 SVG 的文本头', () => {
  const svgTag = asciiOf('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>')
  const decl = asciiOf('<?xml version="1.0" encoding="UTF-8"?>\n')
  // 长 DOCTYPE 把 <svg 推到 64 字节之后，窗口不够就漏认
  const doctype = asciiOf('<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n')

  it('根元素、xml 声明、DOCTYPE 之后的 <svg 都认得', () => {
    assert.equal(sniffMediaFormat(bytesOf(svgTag), 'application/octet-stream', ''), 'SVG')
    assert.equal(sniffMediaFormat(bytesOf([...decl, ...svgTag]), 'application/octet-stream', ''), 'SVG')
    assert.equal(sniffMediaFormat(bytesOf([...doctype, ...svgTag]), 'application/octet-stream', ''), 'SVG')
  })

  it('BOM 与前导空白不影响判断，大小写也认', () => {
    assert.equal(sniffMediaFormat(bytesOf([0xEF, 0xBB, 0xBF, ...svgTag]), '', ''), 'SVG')
    assert.equal(sniffMediaFormat(bytesOf([...asciiOf('\n  ')]), '', ''), '')
    assert.equal(sniffMediaFormat(bytesOf([...asciiOf('\n  '), ...svgTag]), '', ''), 'SVG')
    assert.equal(sniffMediaFormat(bytesOf(asciiOf('<SVG xmlns="x"></SVG>')), '', ''), 'SVG')
  })

  it('文件头优先于 content-type 与后缀', () => {
    assert.equal(sniffMediaFormat(bytesOf(svgTag), 'image/png', 'http://x/a.png'), 'SVG')
  })

  it('内嵌 <svg> 的 HTML 页面与纯文本都不当成 SVG', () => {
    assert.equal(sniffMediaFormat(bytesOf(asciiOf('<!DOCTYPE html>\n<html><head><title>t</title></head><body><svg>')), '', ''), '')
    assert.equal(sniffMediaFormat(bytesOf(asciiOf('{"a":1}')), '', ''), '')
    assert.equal(sniffMediaFormat(bytesOf(asciiOf('<s'))), '')
  })

  it('后缀认得的 SVG 在没有字节时也能读出来', () => {
    assert.equal(sniffMediaFormat(null, 'application/octet-stream', 'http://x/icon.svg?v=1'), 'SVG')
  })
})

describe('mediaKindByUrl 按后缀定大类', () => {
  it('大小写与查询串都不影响判断', () => {
    assert.equal(mediaKindByUrl('http://x/a.MP3?token=1'), 'audio')
    assert.equal(mediaKindByUrl('http://x/a.Wav'), 'audio')
    assert.equal(mediaKindByUrl('http://x/a.jpeg#frag'), 'image')
    assert.equal(mediaKindByUrl('http://x/a.mp4'), 'video')
    assert.equal(mediaKindByUrl('http://x/a.pdf'), '')
  })
})

describe('resolveMediaKind 大类判定', () => {
  it('content-type 前缀直接定类', () => {
    assert.equal(resolveMediaKind('image/heic', JUNK, 'http://x/a'), 'image')
    assert.equal(resolveMediaKind('audio/aac-pure', JUNK, 'http://x/a'), 'audio')
    assert.equal(resolveMediaKind('video/mp4', JUNK, 'http://x/a'), 'video')
  })

  it('octet-stream 时按文件头定类', () => {
    assert.equal(resolveMediaKind('application/octet-stream', PNG, 'http://x/a'), 'image')
    assert.equal(resolveMediaKind('application/octet-stream', WEBP, 'http://x/a'), 'image')
    assert.equal(resolveMediaKind('application/octet-stream', MP3_FRAME, 'http://x/a'), 'audio')
    assert.equal(resolveMediaKind('application/octet-stream', ftyp('isom'), 'http://x/a'), 'video')
    // 原实现把一切 ftyp 都当视频，M4A 由此修成音频
    assert.equal(resolveMediaKind('application/octet-stream', ftyp('M4A '), 'http://x/a'), 'audio')
    // 源站报 octet-stream 的 SVG，靠文本头定成图片
    assert.equal(resolveMediaKind('application/octet-stream', bytesOf(asciiOf('<svg xmlns="x"></svg>')), 'http://x/a'), 'image')
    assert.equal(resolveMediaKind('text/plain', bytesOf(asciiOf('<svg xmlns="x"></svg>')), 'http://x/a'), 'image')
    assert.equal(resolveMediaKind('application/octet-stream', MPEG_VIDEO, 'http://x/a'), '')
  })

  it('文件头认不出再按后缀兜底', () => {
    assert.equal(resolveMediaKind('', JUNK, 'http://x/a.flac'), 'audio')
    assert.equal(resolveMediaKind('', JUNK, 'http://x/a.webm'), 'video')
    assert.equal(resolveMediaKind('', JUNK, 'http://x/a.pdf'), '')
  })
})
