import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import express from 'express'
import { API_URL } from '@shared/api.const'

describe('API_URL 完整路径表', () => {
  it('业务路径自带挂载前缀，调用点无需再拼 AppMock', () => {
    for (const [key, value] of Object.entries(API_URL)) {
      if (key === 'AppMock' || key === 'Proxy' || key === 'CorsMediaProxy') continue
      assert.ok(value.startsWith(`${API_URL.AppMock}/`), `${key} 应以 ${API_URL.AppMock}/ 开头：${value}`)
    }
  })

  it('前缀与特殊端点逐字锁死', () => {
    assert.equal(API_URL.AppMock, '/_appmock')
    assert.equal(API_URL.MockRegister, '/_appmock/register')
    assert.equal(API_URL.Sse, '/_appmock/sse')
    assert.equal(API_URL.Broadcast, '/_appmock/sse/broadcast')
    assert.equal(API_URL.SaveMockRecord, '/_appmock/saveMockRecord')
    assert.equal(API_URL.Health, '/_appmock/health')
    assert.equal(API_URL.Proxy, '/_proxy')
    assert.equal(API_URL.CorsMediaProxy, '/corsMediaProxy')
  })

  it('二维码注册地址与两段拼接的历史写法一致', () => {
    const uid = 'u-1'
    const legacy = `${API_URL.AppMock}${API_URL.MockRegister.slice(API_URL.AppMock.length)}/${uid}`
    assert.equal(`${API_URL.MockRegister}/${uid}`, legacy)
  })

  it('无空片段、无重复斜杠、无尾斜杠', () => {
    for (const value of Object.values(API_URL)) {
      assert.ok(value.startsWith('/'), value)
      assert.ok(!value.includes('//'), value)
      assert.ok(!value.endsWith('/'), value)
    }
  })
})

describe('appmock 挂载方式', () => {
  it('parser 仍按前缀生效，路由按完整路径匹配', async () => {
    const app = express()
    const urls: string[] = []
    const router = express.Router()
    router.post(API_URL.SaveMockRecord, (req, resp) => {
      urls.push(req.url)
      resp.json({ body: req.body })
    })

    app.use(API_URL.AppMock, express.json())
    app.use(router)

    const server = app.listen(0)
    try {
      const port = (server.address() as any).port
      const url = `http://127.0.0.1:${port}${API_URL.SaveMockRecord}?expectedUpdatedAt=1`
      const resp = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":"r-1"}',
      })
      assert.deepEqual(await resp.json(), { body: { id: 'r-1' } })
      assert.deepEqual(urls, [`${API_URL.SaveMockRecord}?expectedUpdatedAt=1`])
    } finally {
      server.close()
    }
  })
})
