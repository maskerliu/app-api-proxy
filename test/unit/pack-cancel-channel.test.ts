import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { registerHooks } from 'node:module'
import { after, describe, it } from 'node:test'
import axios from 'axios'
import express from 'express'

// 与 pack-web-export.test.ts 同一套替身：路由链上的 electron 只用到 app.getPath，
// base.api 顶层 import vant 只为失败提示，记到 globalThis 才能断言「同一次失败只弹一次」。
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

const { AppMockRouter } = await import('@main/router/appmock.router')
const { cancelMockPackImport, importMockPack, previewMockPack } = await import('@shared/proxy.api')
const { updateBaseDomain } = await import('@shared/base.api')

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

class FakePackService {
  calls: Array<string> = []
  cancelCalls = 0
  cancelResult = true
  delayMs = 0
  previewError: Error = null

  async cancelImport() {
    this.cancelCalls++
    if (this.delayMs > 0) await sleep(this.delayMs)
    return this.cancelResult
  }

  async preview() {
    this.calls.push('preview')
    if (this.delayMs > 0) await sleep(this.delayMs)
    if (this.previewError != null) throw this.previewError
    return { kind: 'pack', recordCount: 1 }
  }

  async import() {
    this.calls.push('import')
    return { ruleIds: [] }
  }
}

const fake = new FakePackService()
// 真路由 + 真客户端，只把 pack 服务换成替身：这张卡要钉的是「渲染层调用 → HTTP 通道 → 服务层单例方法」
// 这条链，自写一条同形状的路由就变成把契约抄一遍，端点改了测试也不会红。
const router = new AppMockRouter()
;(router as any).mockPackService = fake

const app = express()
app.use(router.router)
const server = app.listen(0)
await new Promise<void>(resolve => server.once('listening', () => resolve()))
updateBaseDomain(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)

// axios 的默认超时是模块级的，本文件要拿它当尺子量「有没有覆盖成功」，跑完必须交还原值
const defaultTimeout = axios.defaults.timeout
after(() => {
  axios.defaults.timeout = defaultTimeout
  return new Promise<void>(resolve => server.close(() => resolve()))
})

function packFile(): File {
  return new File(['{"format":"appapi-mock-pack","version":1,"rules":[]}'], 'pack.json',
    { type: 'application/json' })
}

describe('导入取消通道', () => {
  it('取消命中任务回 true、没有任务回 false，都原样交到调用方', async () => {
    fake.cancelResult = true
    assert.equal(await cancelMockPackImport(), true)
    fake.cancelResult = false
    assert.equal(await cancelMockPackImport(), false)
    assert.equal(fake.cancelCalls, 2, '一次调用只应打中服务层那一个方法')
  })

  it('取消请求不带请求体也能过路由（参数表为空，不是漏传字段）', async () => {
    fake.cancelCalls = 0
    await cancelMockPackImport()
    assert.equal(fake.cancelCalls, 1)
  })
})

describe('大文件上传的超时口径', () => {
  it('服务端慢过 axios 默认值时，预览与导入照样等到回执', async () => {
    axios.defaults.timeout = 300
    fake.delayMs = 600
    try {
      assert.equal((await previewMockPack(packFile(), { mode: 'new' }) as any).recordCount, 1)
      assert.equal((await importMockPack(packFile(), { mode: 'new' }) as any).ruleIds.length, 0)
    } finally {
      axios.defaults.timeout = defaultTimeout
      fake.delayMs = 0
    }
  })

  it('没做覆盖的那一侧照样被默认值掐掉——上一条不是因为超时机制失效才通过', async () => {
    axios.defaults.timeout = 300
    fake.delayMs = 600
    try {
      await assert.rejects(() => cancelMockPackImport(), /timeout/i)
    } finally {
      axios.defaults.timeout = defaultTimeout
      fake.delayMs = 0
    }
  })

  it('调用方传的 silentError 不被这层默认值吃掉', async () => {
    globalThis.__notifies = []
    fake.previewError = new Error('包格式不对')
    try {
      await assert.rejects(() => previewMockPack(packFile(), { mode: 'new' }), /包格式不对/)
      assert.equal(globalThis.__notifies.length, 1)

      await assert.rejects(
        () => previewMockPack(packFile(), { mode: 'new' }, { silentError: true }), /包格式不对/)
      assert.equal(globalThis.__notifies.length, 1, 'silentError 那一侧不该再弹一次')
    } finally {
      fake.previewError = null
    }
  })
})
