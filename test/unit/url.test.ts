import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decodeQueryPart, decodeRawToken, normalizePathname, pathSegments, PLACEHOLDER_BASE,
  parseLooseUrl, queryParts, queryTokenOf, splitHostPort, stripTrailingSlash, toAbsoluteTarget,
  UrlTargetError,
} from '@shared/url'

describe('parseLooseUrl 宽松解析', () => {
  it('相对地址按 placeholder base 解析，空串得到根路径', () => {
    const parsed = parseLooseUrl('/api/users?page=2')
    assert.equal(parsed.pathname, '/api/users')
    assert.equal(parsed.search, '?page=2')
    assert.equal(parseLooseUrl('').pathname, '/')
    assert.equal(parseLooseUrl('').hostname, new URL(PLACEHOLDER_BASE).hostname)
  })

  it('空与缺失按根路径解析，与 new URL(raw, base) 一致', () => {
    assert.equal(parseLooseUrl(undefined as any).pathname, '/')
    assert.equal(parseLooseUrl(null as any).pathname, '/')
  })

  it('无法解析时返回 null；带 base 解析会把裸 host 的 "example.com:" 当成协议名', () => {
    assert.equal(parseLooseUrl('http://'), null)
    assert.equal(parseLooseUrl('example.com:8080').pathname, '8080')
    assert.equal(parseLooseUrl('example.com:8080').hostname, '')
    assert.equal(parseLooseUrl('/api/users').hostname, new URL(PLACEHOLDER_BASE).hostname)
  })
})

describe('normalizePathname 路径归一', () => {
  it('折叠重复分隔符并补前导斜杠', () => {
    assert.equal(normalizePathname('//a//b/'), '/a/b/')
    assert.equal(normalizePathname('a/b'), '/a/b')
    assert.equal(normalizePathname('/'), '/')
    assert.equal(normalizePathname(''), '/')
  })

  it('decodeURI 不把 %2F 还原成分隔符，非法百分号序列保留原文', () => {
    assert.equal(normalizePathname('/a%2Fb'), '/a%2Fb')
    assert.equal(normalizePathname('/%E4%B8%AD'), '/中')
    assert.equal(normalizePathname('/%E0%A4%A'), '/%E0%A4%A')
  })
})

describe('stripTrailingSlash 尾斜杠', () => {
  it('keepRoot 时保留根路径，且长度 <=1 的输入原样返回', () => {
    assert.equal(stripTrailingSlash('/', true), '/')
    assert.equal(stripTrailingSlash('', true), '')
    assert.equal(stripTrailingSlash('//', true), '/')
    assert.equal(stripTrailingSlash('/a//', true), '/a')
    assert.equal(stripTrailingSlash('/a', true), '/a')
  })

  it('默认全部剥掉，根路径变空串（拼接用）', () => {
    assert.equal(stripTrailingSlash('/'), '')
    assert.equal(stripTrailingSlash('/a/'), '/a')
    assert.equal(stripTrailingSlash(''), '')
  })
})

describe('pathSegments 分段', () => {
  it('丢弃空段，不 decode', () => {
    assert.deepEqual(pathSegments('/a//b/'), ['a', 'b'])
    assert.deepEqual(pathSegments(''), [])
    assert.deepEqual(pathSegments(undefined as any), [])
  })
})

describe('queryParts 原始 query 拆分', () => {
  it('无 ? 时为空，? 之前的 # 不参与截断', () => {
    assert.deepEqual(queryParts('/a?x=1&y=2'), ['x=1', 'y=2'])
    assert.deepEqual(queryParts('/a'), [])
    assert.deepEqual(queryParts('/a?'), [])
    assert.deepEqual(queryParts('/a?x=1#frag'), ['x=1'])
    assert.deepEqual(queryParts('/a#b?x=1'), ['x=1'])
    assert.deepEqual(queryParts('/a?&&x=1'), ['x=1'])
  })
})

describe('query 解码的两种语义', () => {
  it('decodeQueryPart 把 + 还原成空格，失败时返回已替换 + 的原文', () => {
    assert.equal(decodeQueryPart('a+b'), 'a b')
    assert.equal(decodeQueryPart('%E4%B8%AD'), '中')
    assert.equal(decodeQueryPart('100%+'), '100% ')
  })

  it('decodeRawToken 不动 +，只用于保留原始编码的链路', () => {
    assert.equal(decodeRawToken('a+b'), 'a+b')
    assert.equal(decodeRawToken('%E4%B8%AD'), '中')
    assert.equal(decodeRawToken('100%%'), '100%%')
  })
})

describe('queryTokenOf 取单个控制参数', () => {
  it('按原始编码匹配键名，空值与无值都返回 null', () => {
    assert.equal(queryTokenOf('/a?__mock_uid=ws-lab', '__mock_uid'), 'ws-lab')
    assert.equal(queryTokenOf('/a?__mock_uid', '__mock_uid'), null)
    assert.equal(queryTokenOf('/a?__mock_uid=', '__mock_uid'), null)
    assert.equal(queryTokenOf('/a?%5F%5Fmock_uid=x', '__mock_uid'), 'x')
    assert.equal(queryTokenOf('/a?uid=1', '__mock_uid'), null)
    assert.equal(queryTokenOf(undefined as any, 'k'), null)
  })

  it('重复键取第一次出现', () => {
    assert.equal(queryTokenOf('/a?k=1&k=2', 'k'), '1')
  })
})

describe('splitHostPort 主机端口', () => {
  it('大小写归一并 trim，IPv6 取方括号内', () => {
    assert.deepEqual(splitHostPort('  API.Example.COM:8443 '), { host: 'api.example.com', port: 8443 })
    assert.deepEqual(splitHostPort('api.example.com'), { host: 'api.example.com', port: null })
    assert.deepEqual(splitHostPort('[::1]:9000'), { host: '::1', port: 9000 })
    assert.deepEqual(splitHostPort('[::1]'), { host: '::1', port: null })
  })

  it('端口非纯数字时整体视为主机名', () => {
    assert.deepEqual(splitHostPort('example.com:http'), { host: 'example.com:http', port: null })
    assert.deepEqual(splitHostPort(':8080'), { host: ':8080', port: null })
    assert.deepEqual(splitHostPort(''), { host: '', port: null })
  })
})

describe('toAbsoluteTarget 上游地址', () => {
  it('裸 host 补 http，已有协议保持', () => {
    assert.equal(toAbsoluteTarget('example.com:8080', ['http:', 'https:']).protocol, 'http:')
    assert.equal(toAbsoluteTarget('https://example.com', ['http:', 'https:']).protocol, 'https:')
    assert.equal(toAbsoluteTarget('  example.com  ', ['http:', 'https:']).hostname, 'example.com')
  })

  it('协议白名单与非法地址分别抛出可区分的错误', () => {
    assert.throws(() => toAbsoluteTarget('ftp://example.com', ['http:', 'https:']), (err: any) => {
      return err instanceof UrlTargetError && err.code === 'unsupported' && err.detail === 'ftp:'
    })
    assert.throws(() => toAbsoluteTarget('http://', ['http:', 'https:']), (err: any) => {
      return err instanceof UrlTargetError && err.code === 'invalid' && err.detail === 'http://'
    })
    assert.equal(toAbsoluteTarget('ws://example.com', ['http:', 'https:', 'ws:', 'wss:']).protocol, 'ws:')
  })
})
