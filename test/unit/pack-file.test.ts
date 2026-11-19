import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { registerHooks } from 'node:module'
import { after, describe, it } from 'node:test'
import express from 'express'

// 选择器只用到 vant 的提示，替身把每次弹提示记下来，才能断言「超大只说一次、取消一次都不说」。
// 语言包是真的：文案键写错会退化成把键名显示给用户，用真实 $t 断言才拦得住。
// base.router 经 misc/utils → main/constants 摸到 electron，路由链上只用到 app.getPath，一并替掉。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>process.env.TMPDIR||"/tmp"};export const BrowserWindow={getFocusedWindow:()=>undefined}',
        shortCircuit: true,
      }
    }
    if (specifier === 'vant') {
      return {
        url: 'data:text/javascript,export const showNotify=(m)=>{globalThis.__notifies=(globalThis.__notifies||[]).concat([m])}',
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { API_URL } = await import('@shared/api.const')
const { MOCK_PACK_FILE_ACCEPT, MOCK_PACK_KINDS, MOCK_PACK_MAX_FILE_BYTES } = await import('@shared/mock.pack')
const { pickPackFile } = await import('@renderer/common/pack-file')
const { BaseRouter, ParamType } = await import('@main/router/base.router')
const { importHar } = await import('@shared/proxy.api')
const { updateBaseDomain } = await import('@shared/base.api')
const { $t } = await import('../../src/lang')

const MB = 1024 * 1024
// 非 ASCII + CRLF + emoji：按 mimetype 猜编码或中途重新序列化过的实现，就是在这种字符上改字节
const NON_ASCII = '中文\r\n表情 😀 与 emoji 🎉 混排\r\n"路径":"/用户/列表"'

class FakeInput {
  type: string
  accept: string
  style: any = {}
  files: Array<File> = []
  listeners: Record<string, Array<Function>> = {}
  removed = false
  clicked = false

  addEventListener(name: string, fn: Function) {
    (this.listeners[name] ||= []).push(fn)
  }

  remove() { this.removed = true }

  click() { this.clicked = true }

  // 浏览器在用户选完或取消后触发事件，这里替它触发
  emit(name: string) {
    this.listeners[name]?.forEach((fn) => fn())
  }
}

let lastInput: FakeInput

function installDom() {
  globalThis.__notifies = []
  lastInput = null
  globalThis.document = {
    body: { appendChild() {} },
    createElement(tag: string) {
      assert.equal(tag, 'input', '选择器只该造 input；换成别的元素，这条通道就不再是浏览器读文件')
      lastInput = new FakeInput()
      return lastInput
    },
  } as any
}

function fileOf(name: string, bytes: number, type = ''): File {
  // Buffer.alloc 只在内存里待一瞬间：这几条断言关心 size 与 type 两个字段，不关心内容
  return new File([Buffer.alloc(bytes)], name, { type })
}

/** click 之后由测试替浏览器触发事件；不传 file 就是用户按了取消 */
async function pick(kind: string, file?: File) {
  installDom()
  const pending = pickPackFile(kind as any)
  assert.ok(lastInput.clicked, '没有 click 就不会弹选择框')
  if (file == null) lastInput.emit('cancel')
  else {
    lastInput.files = [file]
    lastInput.emit('change')
  }
  return pending
}

// 探针挂在真实端点上、客户端用真实 importHar，只把路由处理换成回显：
// 桩端点会把包内容丢掉，用它测不出「字节有没有原样到齐」。
class EchoRouter extends BaseRouter {
  received: Array<any> = []

  protected initApiInfos(): void {
    this.addApiInfo({
      method: 'post',
      path: API_URL.IMPORT_HAR,
      params: [
        { key: 'pack', type: ParamType.FormFileText },
        { key: 'mode', type: ParamType.Query },
      ],
      handler: (pack: unknown, mode: unknown) => {
        this.received.push({ pack, mode })
        return { echo: true }
      },
    })
  }
}

const echo = new EchoRouter()
const app = express()
app.use(echo.router)
const server = app.listen(0)
await new Promise<void>(resolve => server.once('listening', () => resolve()))
updateBaseDomain(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)

after(() => new Promise<void>(resolve => server.close(() => resolve())))

describe('导入文件选择通道（R4C-27 前置）', () => {
  it('两种 kind 的白名单都在，且没有第三种 kind 漏配', () => {
    assert.deepEqual(Object.keys(MOCK_PACK_FILE_ACCEPT).sort(), [...MOCK_PACK_KINDS].sort())
    assert.ok(MOCK_PACK_FILE_ACCEPT.pack.includes('.json'), '规则包按扩展名放行')
    assert.ok(MOCK_PACK_FILE_ACCEPT.pack.includes('application/json'))
    // .har 在多数系统里没有登记 MIME，扩展名那一半才是主力，mimetype 只给只认类型的系统对话框
    assert.ok(MOCK_PACK_FILE_ACCEPT.har.includes('.har'))
    assert.ok(MOCK_PACK_FILE_ACCEPT.har.includes('application/har+json'))
  })

  it('accept 由 kind 决定，选择框只收这一种文件', async () => {
    await pick('har')
    assert.equal(lastInput.type, 'file')
    assert.equal(lastInput.accept, MOCK_PACK_FILE_ACCEPT.har)
    await pick('pack')
    assert.equal(lastInput.accept, MOCK_PACK_FILE_ACCEPT.pack)
  })

  it('未超大的文件原样交出句柄，不读进内存也不重新包装', async () => {
    const picked = fileOf('订单中心.json', 49 * MB, 'application/json')
    assert.equal(await pick('pack', picked), picked)
    // 一旦转成字符串或 Blob，50MB 就真进了 JS 堆，multipart 还要再复制一遍才发得出去
    assert.equal(globalThis.__notifies.length, 0)
    assert.ok(lastInput.removed, '用完要摘掉，反复导入不能在 body 上堆节点')
  })

  it('恰好 50MB 放行：闸门是「超过」不是「达到」', async () => {
    const edge = fileOf('edge.json', MOCK_PACK_MAX_FILE_BYTES)
    assert.equal(await pick('pack', edge), edge)
    assert.equal(globalThis.__notifies.length, 0)
  })

  it('超过 50MB 先在本机拦下，只给一句可读的文案', async () => {
    assert.equal(await pick('pack', fileOf('huge.har', MOCK_PACK_MAX_FILE_BYTES + 1)), null)
    assert.deepEqual(globalThis.__notifies, [
      { type: 'warning', message: $t('mock.pack.packTooLarge'), duration: 2000 },
    ])
    // 断言的是真实文案而不是键名：键漏翻时 vue-i18n 会把键原样显示给用户
    assert.notEqual(globalThis.__notifies[0].message, 'mock.pack.packTooLarge')
    assert.ok(globalThis.__notifies[0].message.includes('50MB'))
  })

  it('取消不是失败：不回文件、也不弹任何提示', async () => {
    assert.equal(await pick('har'), null)
    assert.equal(globalThis.__notifies.length, 0)
    assert.ok(lastInput.removed)
  })

  it('选择器交出的 File 一路到服务端文本，非 ASCII 与 CRLF 原样到齐', async () => {
    const text = `{"log":{"version":"1.2","comment":"${NON_ASCII}","entries":[]}}`
    // Windows 下 .har 常常没有登记 MIME，浏览器给的 File.type 就是空串；
    // 客户端补上 octet-stream 之后服务端才把它当文件而不是普通字段——文本能原样回来就是证明
    const file = await pick('har', new File([text], '订单中心.har'))
    assert.equal(file.type, '')

    await importHar(file, { mode: 'new' })
    assert.equal(echo.received.length, 1)
    assert.equal(echo.received[0].pack, text)
    assert.equal(echo.received[0].mode, 'new')
  })

  it('浏览器给出 mimetype 时结果不变：格式分派不看 mimetype', async () => {
    const text = `{"log":{"version":"1.2","comment":"${NON_ASCII}","entries":[]}}`
    const file = await pick('har', new File([text], '订单中心.har', { type: 'application/har+json' }))
    await importHar(file, { mode: 'merge', targetRuleId: 'r1' })
    assert.equal(echo.received.at(-1).pack, text)
    assert.equal(echo.received.at(-1).mode, 'merge')
  })
})
