import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeRequest } from '@main/service/mock.matcher'
import type { MatcherRequestInput, NormalizedRequest } from '@main/service/mock.matcher'

interface NormalizeCase {
  ac: string
  name: string
  input: MatcherRequestInput
  check: (request: NormalizedRequest) => void
}

const cases: NormalizeCase[] = [
  // AC-R1-03：Host 回落与优先级
  {
    ac: 'AC-R1-03',
    name: '无 x-mock-host 时回落到 host 头',
    input: { method: 'GET', url: '/v1/users', headers: { host: 'api.example.com' } },
    check: request => {
      assert.equal(request.host, 'api.example.com')
      assert.equal(request.port, null)
    },
  },
  {
    ac: 'AC-R1-03',
    name: 'x-mock-host 优先于 host 头',
    input: {
      url: '/v1/users',
      headers: { host: 'origin.local', 'x-mock-host': 'mock.example.com' },
    },
    check: request => assert.equal(request.host, 'mock.example.com'),
  },
  {
    ac: 'AC-R1-03',
    name: 'Host 端口被保留',
    input: { url: '/v1/users', headers: { 'x-mock-host': 'api.example.com:8443' } },
    check: request => {
      assert.equal(request.host, 'api.example.com')
      assert.equal(request.port, 8443)
    },
  },
  {
    ac: 'AC-R1-03',
    name: 'IPv6 Host 与端口分离',
    input: { url: '/v1/users', headers: { 'x-mock-host': '[::1]:8080' } },
    check: request => {
      assert.equal(request.host, '::1')
      assert.equal(request.port, 8080)
    },
  },
  {
    ac: 'AC-R1-03',
    name: 'Host 中的协议、路径与大小写被归一化',
    input: { url: '/v1/users', headers: { 'x-mock-host': 'HTTPS://API.Example.com/v1/users' } },
    check: request => assert.equal(request.host, 'api.example.com'),
  },
  {
    ac: 'AC-R1-03',
    name: '缺少 Host 头时 host 为空且不抛错',
    input: { url: 'https://unknown.example.com/v1/users' },
    check: request => {
      assert.equal(request.host, '')
      assert.equal(request.path, '/v1/users')
    },
  },

  // AC-R1-14：重复键与多值
  {
    ac: 'AC-R1-14',
    name: '重复 Query 键保留为数组且顺序不变',
    input: { url: '/v1/users?id=1&id=2' },
    check: request => {
      const entry = request.query.get('id')
      assert.deepEqual(entry.values, ['1', '2'])
      assert.equal(entry.hasEquals, true)
    },
  },
  {
    ac: 'AC-R1-14',
    name: 'a 与 a= 混合时记录不带等号',
    input: { url: '/v1/users?a&a=' },
    check: request => {
      const entry = request.query.get('a')
      assert.deepEqual(entry.values, ['', ''])
      assert.equal(entry.hasEquals, false)
    },
  },
  {
    ac: 'AC-R1-14',
    name: '无等号键视为空值',
    input: { url: '/v1/users?flag' },
    check: request => {
      const entry = request.query.get('flag')
      assert.deepEqual(entry.values, [''])
      assert.equal(entry.hasEquals, false)
    },
  },
  {
    ac: 'AC-R1-14',
    name: '空查询串不产生键',
    input: { url: '/v1/users?' },
    check: request => assert.equal(request.query.size, 0),
  },

  // AC-R1-15：编码、尾斜杠与多斜杠
  {
    ac: 'AC-R1-15',
    name: 'Query 中文百分号编码被解码',
    input: { url: '/v1/search?q=%E4%B8%AD%E6%96%87' },
    check: request => assert.deepEqual(request.query.get('q').values, ['中文']),
  },
  {
    ac: 'AC-R1-15',
    name: 'Path 中文百分号编码被解码',
    input: { url: '/v1/%E4%B8%AD%E6%96%87/users' },
    check: request => assert.equal(request.path, '/v1/中文/users'),
  },
  {
    ac: 'AC-R1-15',
    name: '加号解码为空格，%20 同样为空格',
    input: { url: '/v1/search?q=a+b&r=a%20b' },
    check: request => {
      assert.equal(request.query.get('q').values[0], 'a b')
      assert.equal(request.query.get('r').values[0], 'a b')
    },
  },
  {
    ac: 'AC-R1-15',
    name: '连续斜杠折叠为单斜杠',
    input: { url: '/v1//users///detail' },
    check: request => assert.equal(request.path, '/v1/users/detail'),
  },
  {
    ac: 'AC-R1-15',
    name: '归一化保留尾斜杠（由匹配器决定是否忽略）',
    input: { url: '/v1/users/' },
    check: request => assert.equal(request.path, '/v1/users/'),
  },
  {
    ac: 'AC-R1-15',
    name: 'fragment 不进入 Query',
    input: { url: '/v1/users?x=1#section' },
    check: request => {
      assert.deepEqual(request.query.get('x').values, ['1'])
      assert.equal(request.query.has('section'), false)
    },
  },

  // 无法解析的 URL 不能中断链路
  {
    ac: 'AC-R1-09',
    name: 'IPv6 残缺导致 URL 解析失败时退回字符串切片',
    input: { url: 'http://[::1?x=1' },
    check: request => {
      assert.equal(request.path, '/http:/[::1')
      assert.deepEqual(request.query.get('x').values, ['1'])
    },
  },

  // 其他归一化契约
  {
    ac: 'AC-R1-02',
    name: 'Method 统一大写',
    input: { method: 'post', url: '/v1/users' },
    check: request => assert.equal(request.method, 'POST'),
  },
  {
    ac: 'AC-R1-02',
    name: '空 Method 保持空串，由匹配器当作任意方法',
    input: { method: '   ', url: '/v1/users' },
    check: request => assert.equal(request.method, ''),
  },
  {
    ac: 'AC-R1-03',
    name: 'Header 名统一小写且数组值保留',
    input: { url: '/v1/users', headers: { 'X-Trace-Id': ['a', 'b'] } },
    check: request => assert.deepEqual(request.headers.get('x-trace-id'), ['a', 'b']),
  },
]

describe('normalizeRequest', () => {
  for (const item of cases) {
    it(`${item.ac} · ${item.name}`, () => {
      const request = normalizeRequest(item.input)
      item.check(request)
    })
  }

  it('AC-R1-03 · 不抛错并保留原始 URL', () => {
    const request = normalizeRequest({ url: 'http://[::1' })
    assert.equal(request.rawUrl, 'http://[::1')
    assert.ok(request.path.length > 0)
  })
})