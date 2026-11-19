import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { registerHooks } from 'node:module'
import { after, describe, it } from 'node:test'
import express from 'express'

// 与 form-file.test.ts 同一套替身：路由链上的 electron 只用到 app.getPath，base.api 顶层 import vant
// 只为失败提示，这里把 showNotify 记到 globalThis，才能断言「同一次失败只弹一次」。
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
const { exportMockPack } = await import('@shared/proxy.api')
const { updateBaseDomain } = await import('@shared/base.api')

// 含非 ASCII：客户端到路由再回来必须一字不差，包文本是流式拼出来的，任何一环重解析都会改字节
const PACK_TEXT = '{"format":"appapi-mock-pack","version":1,"rules":[{"name":"订单中心","records":[]}]}'

class FakePackService {
  calls: Array<any> = []
  error: Error = null

  async export(options: any) {
    this.calls.push(options)
    if (this.error != null) throw this.error
    return PACK_TEXT
  }
}

const fake = new FakePackService()
// 真路由 + 真客户端，只把 pack 服务换成替身：这张卡要钉的是「渲染层选项 → 查询串 → MockPackExportOptions」
// 这条链，替身再多一层（自写一条同形状的路由）就变成把契约抄一遍，路由改了测试也不会红。
const router = new AppMockRouter()
;(router as any).mockPackService = fake

const app = express()
app.use(router.router)
const server = app.listen(0)
await new Promise<void>(resolve => server.once('listening', () => resolve()))
updateBaseDomain(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)

after(() => new Promise<void>(resolve => server.close(() => resolve())))

describe('R4C-09 Web 导出选项回传', () => {
  it('五个选项逐个落到 MockPackExportOptions，布尔不再是从查询串读来的字符串', async () => {
    await exportMockPack({
      scope: 'rule', ruleId: 'rule_1',
      includeVariants: true, includeSource: false, redact: false
    })
    assert.deepEqual(fake.calls.at(-1), {
      scope: 'rule', ruleId: 'rule_1',
      includeVariants: true, includeSource: false, redact: false
    })
  })

  it('全场景不带 ruleId，缺省的开关按默认值补齐', async () => {
    await exportMockPack({ scope: 'all' })
    assert.deepEqual(fake.calls.at(-1), {
      scope: 'all', ruleId: null,
      includeVariants: true, includeSource: true, redact: true
    })
  })

  it('scope 只认 all，其余一律按当前场景处理', async () => {
    await exportMockPack({ scope: 'everything' as any, ruleId: 'rule_9' })
    assert.equal(fake.calls.at(-1).scope, 'rule')
    assert.equal(fake.calls.at(-1).ruleId, 'rule_9')
  })
})

describe('R4C-09 Web 导出回包与失败', () => {
  it('客户端拿到的就是主进程拼好的包文本，未解析也未重新序列化', async () => {
    assert.equal(await exportMockPack({ scope: 'all' }), PACK_TEXT)
  })

  it('失败经 BizResponse 变成 reject；silentError 让调用方自己提示时不再弹第二次', async () => {
    globalThis.__notifies = []
    fake.error = new Error('磁盘写入失败')
    try {
      await assert.rejects(() => exportMockPack({ scope: 'all' }), /磁盘写入失败/)
      assert.equal(globalThis.__notifies.length, 1)

      await assert.rejects(() => exportMockPack({ scope: 'all' }, { silentError: true }), /磁盘写入失败/)
      assert.equal(globalThis.__notifies.length, 1)
    } finally {
      fake.error = null
    }
  })
})
