import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import { registerHooks } from 'node:module'
import { after, describe, it } from 'node:test'
import express from 'express'
import { BizCode } from '@shared/base.models'

// base.router 经 misc/utils → constants 引用 electron，单测环境用最小替身；
// base.api 顶层 import vant 只为报错提示，一并替掉才能在 Node 里跑真实的 formPost
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>process.env.TMPDIR||"/tmp"};export const BrowserWindow={getFocusedWindow:()=>undefined}',
        shortCircuit: true,
      }
    }
    if (specifier === 'vant') {
      return { url: 'data:text/javascript,export const showNotify=()=>{}', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { BaseRouter, ParamType } = await import('@main/router/base.router')
const { formPost } = await import('@shared/base.api')

// 带非 ASCII 与换行：按 mimetype 猜派发的旧实现会在 utf-8 之外悄悄改字符或整段丢掉
const PROBE_TEXT = '{"log":{"version":"1.2","entries":[]}}\r\n中文路径 /用户/列表\r\n'

class ProbeRouter extends BaseRouter {
  protected initApiInfos(): void {
    this.addApiInfo({
      method: 'post',
      path: '/probe/text',
      params: [{ key: 'pack', type: ParamType.FormFileText }],
      handler: (pack: unknown) => ({ received: pack, typeofPack: typeof pack }),
    })
    this.addApiInfo({
      method: 'post',
      path: '/probe/fails',
      params: [{ key: 'pack', type: ParamType.FormFileText }],
      // 模拟包校验不通过：抛错走 route 的 catch，清理只靠 finally
      handler: () => {
        throw new Error('包校验失败')
      },
    })
  }
}

const router = new ProbeRouter()
// 走真实挂载路径：BaseRouter 构造时已把 addApiInfos 注册进自己的 express.Router
const app = express()
app.use(router.router)
const server = app.listen(0)
await new Promise<void>(resolve => server.once('listening', () => resolve()))
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

interface ProbeUpload {
  filepath: string
  /** 解析期是否真的落过盘——没有这一步，「响应后文件已删除」会因为从来没写过而假通过 */
  existedDuringRequest: boolean
}
const uploads: ProbeUpload[] = []

// parseMultipart 是 private，但运行时只是实例上的普通方法：影子一层才能拿到 formidable 的落盘位置
const parseMultipart = (router as any).parseMultipart.bind(router)
;(router as any).parseMultipart = async (req: any, uploaded: Array<{ filepath: string }>) => {
  try {
    return await parseMultipart(req, uploaded)
  } finally {
    // reject 时清单同样要看：这正是「解析失败还留不留临时文件」要验的路径
    for (const file of uploaded) {
      if (uploads.some(item => item.filepath === file.filepath)) continue
      uploads.push({ filepath: file.filepath, existedDuringRequest: fs.existsSync(file.filepath) })
    }
  }
}

async function postMultipart(
  pathname: string,
  options: { filename?: string; mime?: string; text?: string; fields?: Record<string, string> },
) {
  const boundary = '----AppApiProxyFormFileProbe'
  const parts: string[] = []
  for (const [key, value] of Object.entries(options.fields ?? {})) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
  }
  if (options.filename) {
    const typeLine = options.mime ? `Content-Type: ${options.mime}\r\n` : ''
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="pack"; filename="${options.filename}"\r\n${typeLine}\r\n${options.text ?? ''}\r\n`,
    )
  }
  parts.push(`--${boundary}--\r\n`)
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: parts.join(''),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function assertCleanedUp(from: number) {
  const remaining = () => uploads.slice(from).filter(item => fs.existsSync(item.filepath))
  // 解析失败时删除动作来自 formidable 的 destroy（fs.unlink 是异步的），给它收敛的时间
  const deadline = Date.now() + 1000
  let leaked = remaining()
  while (leaked.length && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
    leaked = remaining()
  }
  assert.deepEqual(leaked.map(item => item.filepath), [], '临时文件在响应结束后仍留在磁盘上')
}

describe('multipart 文件读取通道', () => {
  it('浏览器给出的多种 .har mimetype 都读到同一份 utf-8 文本', async () => {
    for (const mime of [undefined, 'application/octet-stream', 'application/json', 'application/x-har', 'text/plain']) {
      const mark = uploads.length
      const { status, body } = await postMultipart('/probe/text', { filename: 'traffic.har', mime, text: PROBE_TEXT })
      assert.equal(status, 200, `mimetype=${mime ?? '(缺省)'}`)
      assert.equal(body.data.received, PROBE_TEXT, `mimetype=${mime ?? '(缺省)'} 没有原样到达 handler`)
      await assertCleanedUp(mark)
    }
  })

  it('后缀与 mimetype 不一致时仍按包内容处理，不做二次猜测', async () => {
    const { body } = await postMultipart('/probe/text', { filename: '导出结果.json', mime: 'application/octet-stream', text: PROBE_TEXT })
    assert.equal(body.data.received, PROBE_TEXT)
  })

  it('只带普通字段、没有文件时回 undefined 而不是抛异常', async () => {
    const { status, body } = await postMultipart('/probe/text', { fields: { mode: 'merge' } })
    assert.equal(status, 200)
    assert.equal(body.data.typeofPack, 'undefined')
  })

  it('0 字节文件是一段空文本，不是一个 500', async () => {
    const mark = uploads.length
    const { status, body } = await postMultipart('/probe/text', { filename: 'empty.har', mime: 'application/json', text: '' })
    assert.equal(status, 200)
    assert.equal(body.data.received, '')
    await assertCleanedUp(mark)
  })

  it('同请求里的普通字段不影响文件文本', async () => {
    const mark = uploads.length
    const { body } = await postMultipart('/probe/text', {
      filename: 'traffic.har',
      mime: 'application/octet-stream',
      text: PROBE_TEXT,
      fields: { mode: 'new' },
    })
    assert.equal(body.data.received, PROBE_TEXT)
    await assertCleanedUp(mark)
  })

  it('handler 抛错时同样不留临时文件', async () => {
    const mark = uploads.length
    const { status, body } = await postMultipart('/probe/fails', { filename: 'traffic.har', mime: 'application/json', text: PROBE_TEXT })
    // 全仓约定：异常也回 HTTP 200 + BizCode.ERROR，靠 msg/errorCode 分诊
    assert.equal(status, 200)
    assert.equal(body.code, BizCode.ERROR)
    assert.equal(uploads.length, mark + 1, '抛错前文件应当已经落盘')
    await assertCleanedUp(mark)
  })

  it('formidable 自己在解析阶段失败也不留临时文件', async () => {
    const mark = uploads.length
    const boundary = '----AppApiProxyFormFileProbe'
    // 只有起始分隔线、没有结束分隔线：模拟客户端中途断开，parse 直接 reject
    const res = await fetch(`${baseUrl}/probe/text`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: `--${boundary}\r\nContent-Disposition: form-data; name="pack"; filename="traffic.har"\r\nContent-Type: application/json\r\n\r\n${PROBE_TEXT}\r\n`,
    })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).code, BizCode.ERROR, '截断的 multipart 要以错误码回，不能当正常包继续解析')
    assert.ok(uploads.length > mark, '文件在解析阶段就已落盘，才有东西可清')
    await assertCleanedUp(mark)
  })

  it('渲染层 formPost 不写死 Content-Type，multipart 边界由发送方补全', async () => {
    const form = new FormData()
    // File.type 为空串，正是 .har 在浏览器里的常见形态
    form.append('pack', new File([PROBE_TEXT], 'traffic.har'))
    const received = await formPost<{ received: string }>('/probe/text', baseUrl, undefined, form)
    assert.equal(received.received, PROBE_TEXT)
  })

  it('每一次上传都真实落过盘，清理断言不是空转', () => {
    const landed = uploads.filter(item => item.existedDuringRequest).length
    assert.ok(landed >= 6, `只有 ${landed} 次请求在解析期观察到已落盘的文件`)
    assert.ok(uploads.length >= 8, `只观察到 ${uploads.length} 次文件打开`)
  })
})

after(() => {
  server.close()
})
