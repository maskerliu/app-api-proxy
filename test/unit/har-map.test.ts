import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ProxyMock } from '@shared/proxy.models'
import { MockError } from '@shared/mock.errors'
import { MOCK_HAR_MAX_ENTRIES } from '@shared/mock.pack'
import { MOCK_MAX_BODY_BYTES, validateMockRecord } from '@shared/mock.validation'
import { mapHarEntries, parseHarEntries } from '@main/service/mock.har'
import type { HarEntry } from '@main/service/mock.har'

/**
 * R4C-22 的验收面：附录 B.3 那张映射表逐行落地，且 **match 全部由既有派生层产出**。
 * R4C-23（响应体解码与类型、AC-R4-07）也在这张面上：`bodyOf` 的四种正文形态与那个码的跳过都在下面。
 * R4C-24 的三道策略过滤（entry 上限、静态资源开关）同样长在这个函数里，用例在最后一张 describe。
 */

/** 一条能走完映射的 entry，用例在它上面改 response 的一个字段 */
function entry(overrides: Record<string, unknown> = {}): HarEntry {
  return only({
    request: { method: 'GET', url: 'https://api.example.com/v1/users?token=abc&page=2', headers: [] },
    response: {
      status: 200,
      headers: [{ name: 'content-type', value: 'application/json;charset=utf-8' }],
      content: { size: 2, mimeType: 'application/json', text: '{}' },
      ...overrides,
    },
  })
}

/** 解析层收下、坐标与原顺序都保留，映射层拿到的就是它 */
function only(raw: Record<string, unknown>): HarEntry {
  const result = parseHarEntries([raw])
  assert.deepEqual(result.skipped, [], `样本本身就该被解析层收下：${JSON.stringify(result.skipped)}`)
  assert.equal(result.entries.length, 1)
  return result.entries[0]
}

function mapOne(input: HarEntry, options?: { analyzedAt?: number }) {
  const result = mapHarEntries([input], options)
  assert.deepEqual(result.skipped, [], `本该映射成功却被跳过：${JSON.stringify(result.skipped)}`)
  assert.equal(result.records.length, 1)
  return result.records[0]
}

function recordOf(input: HarEntry, options?: { analyzedAt?: number }) {
  return mapOne(input, options).record
}

function codesOf(record: ProxyMock.MockRecord): string[] {
  return validateMockRecord(record).map(it => it.code)
}

/** 按 HAR 的写法给正文打 base64（Node 侧编码，与被测代码的 `atob` 解码互为对照） */
function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

describe('mapHarEntries：B.3 的字段映射', () => {
  it('method / path / query 都来自 shared/url 那一套，host 一律留空串（Q2）', () => {
    const match = recordOf(entry()).match
    assert.ok(match != null)
    assert.equal(match.method, 'GET')
    assert.equal(match.path, '/v1/users')
    assert.equal(match.pathType, 'exact')
    // B.3 原写「hostname（显式端口；无端口=任意）」，Q2 改成一概不写：空串就是引擎既有的任意 host + 任意端口
    assert.equal(match.host, '', 'host 非空就意味着 HAR 导入的规则被域名绑死')
    assert.equal(match.query.allowExtra, true)
    assert.equal(match.query.mode, 'match')
  })

  it('E2 高风险键剔出条件、记进 ignoreKeys，并留 autoIgnoredKeys 证据', () => {
    const match = recordOf(entry()).match
    assert.deepEqual(match.query.conditions.map(it => it.key), ['page'], 'token 该被剔掉')
    assert.deepEqual(match.query.ignoreKeys, ['token'])
    assert.deepEqual(match.derivation.autoIgnoredKeys, ['token'])
    // E5：page 是业务语义键，永不自动忽略，只出建议
    assert.ok(match.derivation.suggestions.some(it => it.key === 'page' && it.evidence === 'E5'))
  })

  it('逐条分析，不许把整份文件当一组：E1 不自动忽略、Path 不自动参数化', () => {
    // 实测对照（两份同接口、filter 与 ID 段都不同）：攒成一组会得到
    //   path `/v1/orders/*` + pathType glob + ignoreKeys [filter, token]
    // 逐条才是 B.3 要的 `/v1/orders/123456` 精确匹配 + ignoreKeys 只有 token
    const pair = parseHarEntries([
      {
        request: { method: 'GET', url: 'https://a/v1/orders/123456?filter=a&page=1&token=1', headers: [] },
        response: { status: 200, headers: [{ name: 'content-type', value: 'text/plain' }], content: { size: 1, mimeType: 'text/plain', text: 'a' } },
      },
      {
        request: { method: 'GET', url: 'https://a/v1/orders/789012?filter=b&page=2&token=2', headers: [] },
        response: { status: 200, headers: [{ name: 'content-type', value: 'text/plain' }], content: { size: 1, mimeType: 'text/plain', text: 'b' } },
      },
    ])
    assert.equal(pair.entries.length, 2)
    const result = mapHarEntries(pair.entries)
    assert.equal(result.records.length, 2)
    const expectedPaths = ['/v1/orders/123456', '/v1/orders/789012']
    result.records.forEach((item, position) => {
      const match = item.record.match
      assert.equal(match.path, expectedPaths[position], '自动参数化会把同接口的其他请求一起吞掉，B.3 明令单份 HAR 不做')
      assert.equal(match.pathType, 'exact')
      assert.deepEqual(match.query.ignoreKeys, ['token'], '只有 E2 那批高风险键起作用')
      // page 属 E5 语义键、filter 属 E1：单条没有跨录制证据，两者都只能留在条件里
      assert.deepEqual(match.query.conditions.map(it => it.key).sort(), ['filter', 'page'])
      assert.deepEqual(match.derivation.autoIgnoredKeys, ['token'])
      // 但建议照给，UI 才有的可「立即应用」
      assert.deepEqual(item.suggestion, { original: expectedPaths[position], suggested: '/v1/orders/*' })
    })
  })

  it('ID 形态段只给参数化建议，path 仍是原样精确匹配', () => {
    assert.ok(mapOne(entry()).suggestion == null, '没有 ID 段时不该凭空造建议')

    const order = only({
      request: { method: 'GET', url: 'https://api.example.com/v1/orders/123456', headers: [] },
      response: { status: 200, headers: [{ name: 'content-type', value: 'application/json' }], content: { size: 2, mimeType: 'application/json', text: '{}' } },
    })
    const mapped = mapOne(order)
    assert.equal(mapped.record.match.path, '/v1/orders/123456', '自动参数化会把同接口的其他请求一起吞掉，B.3 明令只给建议')
    assert.equal(mapped.record.match.pathType, 'exact')
    assert.deepEqual(mapped.suggestion, { original: '/v1/orders/123456', suggested: '/v1/orders/*' })
  })

  it('响应：status 进 statusCode，content-type 定 bodyType，正文原样进 body', () => {
    const response = recordOf(entry()).response
    assert.equal(response.statusCode, 200)
    assert.equal(response.bodyType, 'json')
    assert.equal(response.body, '{}')
    assert.equal(response.delayMs, 0)
    assert.equal(response.bodyEncoding, undefined, '没写编码就不冒充 base64')
  })

  it('base64 的二进制档原样存：解成文本再发就会被当 UTF-8 改坏', () => {
    // 用 octet-stream 而不是 png：png 属 R4C-24 的静态资源，默认档下走不到正文这一道（png 那条在下面那张 describe 里验）
    const binary = entry({
      headers: [{ name: 'content-type', value: 'application/octet-stream' }],
      content: { size: 4, mimeType: 'application/octet-stream', text: 'iVBORw0KGgo=', encoding: 'BASE64' },
    })
    const response = recordOf(binary).response
    assert.equal(response.body, 'iVBORw0KGgo=')
    assert.equal(response.bodyEncoding, 'base64')
    assert.equal(response.bodyType, 'binary')
  })

  it('base64 的文本档解成文本（AC-R4-07）：编辑器可直接改，字节与原始 base64 一致', () => {
    const payload = '{"code":0,"data":{"message":"你好"}}'
    const json = entry({
      content: { size: payload.length, mimeType: 'application/json', text: b64(payload), encoding: 'base64' },
    })
    const record = recordOf(json)
    assert.equal(record.response.body, payload, '解出来的文本必须逐字符等于录制的那份')
    assert.equal(record.response.bodyType, 'json')
    assert.equal(record.response.bodyEncoding, undefined, '存的是文本还标 base64，发送时会被再解一次')
    assert.deepEqual(codesOf(record), [])
  })

  it('折行 base64 照常解（Chrome / Fiddler 每 76 字符折一行）：不因为换行降级成二进制', () => {
    const payload = JSON.stringify({ list: Array.from({ length: 40 }, (_, i) => `item-${i}`) })
    const wrapped = b64(payload).replace(/(.{20})/g, '$1\n')
    assert.notEqual(wrapped, b64(payload), '样本得真是折过行的')
    const response = recordOf(entry({
      content: { size: payload.length, mimeType: 'application/json', text: wrapped, encoding: 'base64' },
    })).response
    assert.equal(response.body, payload)
    assert.equal(response.bodyType, 'json', '折行不是「读不出」的理由')
  })

  it('解不出 UTF-8 时改按二进制存：mimeType 报文本而字节不是文本，发出去才不是乱码', () => {
    const rawBytes = Buffer.from([0xff, 0xfe, 0x00, 0x41])
    const notText = rawBytes.toString('base64')
    const response = recordOf(entry({
      content: { size: rawBytes.length, mimeType: 'text/plain', text: notText, encoding: 'base64' },
    })).response
    assert.equal(response.body, notText, '解不开就一个字都不动')
    assert.equal(response.bodyType, 'binary')
    assert.equal(response.bodyEncoding, 'base64')
    assert.deepEqual(Buffer.from(response.body, 'base64'), rawBytes, '引擎按 base64 发出，字节必须等于录制原文')
  })

  it('二进制却没有 base64 标记 → 逐条跳过 harBodyUnreadable，不静默交出一条回乱码的规则', () => {
    const result = mapHarEntries([entry({
      headers: [{ name: 'content-type', value: 'application/octet-stream' }],
      content: { size: 4, mimeType: 'application/octet-stream', text: '‰PNG' },
    })])
    assert.deepEqual(result.records.map(it => it.entryIndex), [])
    assert.equal(result.skipped.length, 1)
    assert.equal(result.skipped[0].reason, 'harBodyUnreadable')
    assert.match(result.skipped[0].detail ?? '', /encoding=\(missing\)/)
    assert.match(result.skipped[0].detail ?? '', /mimeType=application\/octet-stream/)
  })

  it('空正文不猜编码：204 那类没有字节的照样导入，不占跳过数', () => {
    const empty = entry({
      headers: [{ name: 'content-type', value: 'application/octet-stream' }],
      content: { size: 0, mimeType: 'application/octet-stream', text: '' },
    })
    const response = recordOf(empty).response
    assert.equal(response.body, '')
    assert.equal(response.bodyEncoding, undefined)
  })

  it('2MB 判在解码之后的真实字节上：复用阶段二那把尺，映射层不起第二道', () => {
    // 1.6MB 文本的 base64 是 2.19MB：不解码就会撞上限被拒，解完才是真实字节数
    const fits = 'a'.repeat(1.6 * 1024 * 1024)
    const fitsRecord = recordOf(entry({
      content: { size: fits.length, mimeType: 'application/json', text: b64(fits), encoding: 'base64' },
    }))
    assert.ok(fitsRecord.response.body.length > MOCK_MAX_BODY_BYTES / 4, '样本够大才验得出上限语义')
    assert.deepEqual(codesOf(fitsRecord), [], 'base64 文本长度越过 2MB 不该算超限')
    // 真超限时由既有的 `validateResponseDef` 报 bodyTooLarge，与手工保存同一条标准
    const tooBig = 'a'.repeat(MOCK_MAX_BODY_BYTES + 1)
    assert.ok(codesOf(recordOf(entry({
      content: { size: tooBig.length, mimeType: 'application/json', text: b64(tooBig), encoding: 'base64' },
    }))).includes('bodyTooLarge'))
  })

  it('bodyType 认响应头优先于 content.mimeType：两头不一致时命中后带回去的是头', () => {
    const mixed = entry({
      headers: [{ name: 'content-type', value: 'text/plain' }],
      content: { size: 5, mimeType: 'application/json', text: 'hello' },
    })
    assert.equal(recordOf(mixed).response.bodyType, 'text')
    const noHeader = entry({ headers: [], content: { size: 2, mimeType: 'application/json', text: '{}' } })
    assert.equal(recordOf(noHeader).response.bodyType, 'json')
  })

  it('响应头走既有 sanitize：逐跳头与 content-length 剔掉，多值 set-cookie 仍是数组', () => {
    const withCookies = only({
      request: { method: 'GET', url: 'https://a/b', headers: [] },
      response: {
        status: 200,
        headers: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Transfer-Encoding', value: 'chunked' },
          { name: 'Content-Length', value: '2' },
          { name: 'Connection', value: 'keep-alive' },
          { name: 'Set-Cookie', value: 'x=1' },
          { name: 'Set-Cookie', value: 'y=2' },
        ],
        content: { size: 2, mimeType: 'application/json', text: '{}' },
      },
    })
    const headers = recordOf(withCookies).response.headers
    assert.deepEqual(Object.keys(headers).sort(), ['Content-Type', 'Set-Cookie'])
    assert.deepEqual(headers['Set-Cookie'], ['x=1', 'y=2'])
  })

  it('请求头进 source.headers，url/method/statusCode 一并留着供展示与排查', () => {
    const withReq = only({
      request: {
        method: 'post',
        url: 'https://api.example.com/v1/upload?token=1',
        headers: [{ name: 'x-trace', value: 'abc' }, { name: 'Cookie', value: 'a=1' }],
      },
      response: { status: 201, headers: [{ name: 'content-type', value: 'application/json' }], content: { size: 2, mimeType: 'application/json', text: '{}' } },
    })
    const record = recordOf(withReq)
    assert.equal(record.source.method, 'post', '方法原样留着，ANY 与大小写的口径由 normalizeMethod 单源决定')
    assert.equal(record.source.url, 'https://api.example.com/v1/upload?token=1')
    assert.equal(record.source.statusCode, 201)
    assert.deepEqual(record.source.headers, { 'x-trace': 'abc', Cookie: 'a=1' })
    assert.equal(record.match.host, '')
    assert.equal(record.match.method, 'POST')
    assert.equal(record.match.path, '/v1/upload')
  })

  it('url 与指纹都不手填、name 也不编：派生值与默认值各有主人', () => {
    const record = recordOf(entry())
    assert.deepEqual(Object.keys(record).sort(), ['match', 'response', 'source'])
    assert.ok(record.url == null, 'url 是派生值，手填等于绕过查重（包内记录同此口径）')
    assert.ok(record.name == null, 'name 由 R4C-12 的默认值补齐走 notes 通道，不在这里编一个')
    assert.ok(record.id == null, 'ID 由写入层分配')
  })

  it('postData 不入库：text 与 params 都留在解析层，记录里一个字节都不带', () => {
    const uploaded = only({
      request: {
        method: 'POST',
        url: 'https://a/upload?token=1',
        postData: { mimeType: 'multipart/form-data; boundary=x', text: 'password=secret', params: [{ name: 'file', fileName: 'a.png' }] },
      },
      response: { status: 200, headers: [{ name: 'content-type', value: 'application/json' }], content: { size: 0, text: '' } },
    })
    const record = recordOf(uploaded)
    assert.ok(!JSON.stringify(record).includes('password=secret'), 'B.3 写的 source.requestBody 在模型里不存在，映射层不许自己造一个')
    assert.ok(!JSON.stringify(record).includes('a.png'))
    // 也不生成 match.body 条件——请求体匹配本版本不做
    assert.equal(record.match.body.mode, 'ignore')
  })

  it('重复 query 键取首值、multiValue 留 any，与匹配引擎同一个读法', () => {
    const dup = only({
      request: { method: 'GET', url: 'https://a/tag?tag=1&tag=2&token=9', headers: [] },
      response: { status: 200, headers: [{ name: 'content-type', value: 'text/plain' }], content: { size: 1, mimeType: 'text/plain', text: 'x' } },
    })
    const query = recordOf(dup).match.query
    assert.deepEqual(query.conditions.map(it => [it.key, it.value]), [['tag', '1']])
    assert.equal(query.multiValue, 'any')
  })

  it('fragment 早在解析层就截了，映射读不到 `#` 之后的东西', () => {
    const withHash = only({
      request: { method: 'GET', url: 'https://a/x#seg?token=1', headers: [] },
      response: { status: 200, headers: [{ name: 'content-type', value: 'text/plain' }], content: { size: 1, mimeType: 'text/plain', text: 'x' } },
    })
    const match = recordOf(withHash).match
    assert.equal(match.path, '/x')
    assert.deepEqual(match.query.conditions, [])
    assert.deepEqual(match.query.ignoreKeys, [])
  })

  it('相对地址照收，但 placeholder 主机名不许落进匹配条件', () => {
    const relative = only({
      request: { method: 'GET', url: '/v1/users?token=1', headers: [] },
      response: { status: 200, headers: [{ name: 'content-type', value: 'text/plain' }], content: { size: 1, mimeType: 'text/plain', text: 'x' } },
    })
    const match = recordOf(relative).match
    assert.equal(match.path, '/v1/users')
    assert.equal(match.host, '')
    assert.ok(!JSON.stringify(match).includes('placeholder.local'), '占位主机名一旦落进 match 就成了真的匹配条件')
  })
})

describe('mapHarEntries：本步的跳过与不跳过', () => {
  it('白名单外的协议逐条拒，detail 报得出是哪个协议', () => {
    const schemes = ['file:///C:/x/y.js', 'chrome://settings', 'ws://a/b', 'data:image/png;base64,iVBORw0KGgo=', 'javascript:alert(1)']
    // 五条一次解析，entryIndex 才是文件里的真实下标；逐条单独解析会把下标全压成 0，那条断言就白写了
    const result = mapHarEntries(parseHarEntries(schemes.map(url => ({
      request: { method: 'GET', url, headers: [] },
      response: { status: 200, headers: [{ name: 'content-type', value: 'text/plain' }], content: { size: 1, mimeType: 'text/plain', text: 'x' } },
    }))).entries)
    assert.deepEqual(result.records, [])
    assert.deepEqual(result.skipped.map(it => [it.entryIndex, it.reason, it.detail]), [
      [0, 'harUnsupportedProtocol', 'scheme=file:'],
      [1, 'harUnsupportedProtocol', 'scheme=chrome:'],
      [2, 'harUnsupportedProtocol', 'scheme=ws:'],
      [3, 'harUnsupportedProtocol', 'scheme=data:'],
      [4, 'harUnsupportedProtocol', 'scheme=javascript:'],
    ])
  })

  it('data:/javascript: 靠 parseLooseUrl 才拒得掉——toAbsoluteTarget 会先补成 http:// 再报 invalid', () => {
    // 这一条钉的是「为什么不照卡片字面用 toAbsoluteTarget」：它读不出这两个串的协议，
    // 于是 entry 会带着 pathname = `image/png;base64,…` 导进来，变成一条永不命中的路径规则
    const data = only({
      request: { method: 'GET', url: 'data:image/png;base64,iVBORw0KGgo=', headers: [] },
      response: { status: 200, headers: [{ name: 'content-type', value: 'text/plain' }], content: { size: 1, mimeType: 'text/plain', text: 'x' } },
    })
    assert.equal(mapHarEntries([data]).skipped[0].detail, 'scheme=data:')
  })

  it('http/https 不拒；空 URL 也不拒，那是阶段二 matchMissing 的话', () => {
    assert.equal(mapHarEntries([entry()]).skipped.length, 0)

    const noUrl = only({
      response: { status: 200, headers: [{ name: 'content-type', value: 'text/plain' }], content: { size: 1, mimeType: 'text/plain', text: 'x' } },
    })
    const result = mapHarEntries([noUrl])
    assert.deepEqual(result.skipped, [], '地址为空不属「协议不对」，在这里跳就是第二套判定')
    assert.equal(result.records.length, 1)
    assert.equal(result.records[0].record.match, undefined, '拆不出条件就不填，交给阶段二说 matchMissing')
    assert.deepEqual(codesOf(result.records[0].record), ['matchMissing'])
  })

  it('status 越界不夹成 200：留给阶段二报 statusRange', () => {
    const weird = only({
      request: { method: 'GET', url: 'https://a/b', headers: [] },
      response: { status: 999, headers: [{ name: 'content-type', value: 'text/plain' }], content: { size: 1, mimeType: 'text/plain', text: 'x' } },
    })
    const record = recordOf(weird)
    assert.equal(record.response.statusCode, 999)
    assert.ok(codesOf(record).includes('statusRange'))
  })

  it('保留原下标与原顺序，不排序、不去重、不合并', () => {
    const mixed = parseHarEntries([
      { request: { method: 'GET', url: 'https://a/1', headers: [] }, response: { status: 200, headers: [], content: { size: 0, text: '' } } },
      { request: { method: 'GET', url: 'file:///C:/skip.js', headers: [] }, response: { status: 200, headers: [], content: { size: 0, text: '' } } },
      { request: { method: 'GET', url: 'https://a/1', headers: [] }, response: { status: 204, headers: [], content: { size: 0, text: '' } } },
    ])
    const result = mapHarEntries(mixed.entries)
    assert.deepEqual(result.records.map(it => it.entryIndex), [0, 2])
    assert.deepEqual(result.skipped.map(it => [it.entryIndex, it.reason]), [[1, 'harUnsupportedProtocol']])
    // 同 URL 两条（一条 200 一条 204）都留着：查重与取舍是写库那一步的事
    assert.deepEqual(result.records.map(it => it.record.response.statusCode), [200, 204])
  })

  it('派生时间由调用方注入，这一层不读时钟', () => {
    const sample = entry()
    assert.equal(recordOf(sample, { analyzedAt: 1762310400000 }).match.derivation.analyzedAt, 1762310400000)
    assert.equal(recordOf(sample).match.derivation.analyzedAt, 0, '没给就不许自己取当前时间')
  })
})

describe('mapHarEntries：R4C-24 的静态资源开关与 entry 上限', () => {
  /** 一条只用来判类型的 entry：正文留空，好让 R4C-23 那几道正文判定不掺进这张面 */
  function typed(contentType: string, url = 'https://a/x'): Record<string, unknown> {
    return {
      request: { method: 'GET', url, headers: [] },
      response: {
        status: 200,
        headers: contentType === '' ? [] : [{ name: 'content-type', value: contentType }],
        content: { size: 0, mimeType: contentType, text: '' },
      },
    }
  }

  /** 上限用例要的是成百上千条；path 按序号错开，免得同指纹的条目被读成一回事 */
  function many(count: number, contentType: string): HarEntry[] {
    return parseHarEntries(Array.from({ length: count }, (_, i) => typed(contentType, `https://a/api/${i}`))).entries
  }

  function thrown(fn: () => unknown): MockError {
    try {
      fn()
    } catch (err) {
      assert.ok(err instanceof MockError, `抛的不是 MockError：${String(err)}`)
      return err as MockError
    }
    throw new assert.AssertionError({ message: '期待抛出 MockError，实际没抛' })
  }

  it('js / css / 图片默认逐条跳过并计数，detail 报得出是哪一类', () => {
    const result = mapHarEntries(parseHarEntries([
      typed('text/javascript'),
      typed('text/css; charset=utf-8'),
      typed('image/png'),
      typed('image/svg+xml'),
      typed('application/json'),
    ]).entries)
    assert.deepEqual(result.skipped.map(it => [it.entryIndex, it.reason, it.detail]), [
      [0, 'harStaticResource', 'kind=js mimeType=text/javascript'],
      [1, 'harStaticResource', 'kind=css mimeType=text/css; charset=utf-8'],
      [2, 'harStaticResource', 'kind=image mimeType=image/png'],
      [3, 'harStaticResource', 'kind=image mimeType=image/svg+xml'],
    ])
    assert.deepEqual(result.records.map(it => it.entryIndex), [4])
  })

  it('静态资源判据与 bodyType 读同一个 content-type：响应头说了算', () => {
    // 头是 json、content.mimeType 是 png：这一条既要留下来，也要按 json 存——两头各判一次就会出现「算图片却按文本存」
    const headerWins = only({
      request: { method: 'GET', url: 'https://a/app.js', headers: [] },
      response: { status: 200, headers: [{ name: 'content-type', value: 'application/json' }], content: { size: 2, mimeType: 'image/png', text: '{}' } },
    })
    assert.equal(mapOne(headerWins).record.response.bodyType, 'json')

    const headerImage = only({
      request: { method: 'GET', url: 'https://a/data', headers: [] },
      response: { status: 200, headers: [{ name: 'content-type', value: 'image/png' }], content: { size: 2, mimeType: 'application/json', text: '{}' } },
    })
    assert.deepEqual(mapHarEntries([headerImage]).skipped.map(it => [it.entryIndex, it.reason]), [[0, 'harStaticResource']],
      '命中后带回去的是头那一份类型，跳过的也按头那一份判')
  })

  it('类型读不出来不算静态资源，字体与音视频也不在字面范围内', () => {
    const noType = only({
      request: { method: 'GET', url: 'https://a/x', headers: [] },
      response: { status: 200, headers: [], content: { size: 0, mimeType: '', text: '' } },
    })
    assert.deepEqual(mapHarEntries([noType]).skipped, [], '宁可多导一条，也不静默跳掉用户没要求跳的条目')

    const outOfScope = parseHarEntries([typed('font/woff2'), typed('audio/mpeg'), typed('video/mp4')]).entries
    assert.equal(mapHarEntries(outOfScope).records.length, 3, 'PRD 4.4.5 只裁决了 js / css / 图片三类')
  })

  it('includeStatic 打开时静态资源照常导入，存法仍由 R4C-23 那把尺决定', () => {
    const png = only({
      request: { method: 'GET', url: 'https://a/logo.png', headers: [] },
      response: { status: 200, headers: [{ name: 'content-type', value: 'image/png' }], content: { size: 4, mimeType: 'image/png', text: 'iVBORw0KGgo=', encoding: 'BASE64' } },
    })
    assert.deepEqual(mapHarEntries([png]).skipped.map(it => it.reason), ['harStaticResource'])
    const opened = mapHarEntries([png], { includeStatic: true })
    assert.deepEqual(opened.skipped, [])
    assert.equal(opened.records[0].record.response.bodyType, 'binary')
    assert.equal(opened.records[0].record.response.bodyEncoding, 'base64')
  })

  it('上限判在候选数上：正好 1,000 条要得下，1,001 条整包拒绝', () => {
    assert.equal(mapHarEntries(many(MOCK_HAR_MAX_ENTRIES, 'application/json')).records.length, MOCK_HAR_MAX_ENTRIES)

    const over = many(MOCK_HAR_MAX_ENTRIES + 1, 'application/json')
    const err = thrown(() => mapHarEntries(over))
    assert.equal(err.code, 'harEntryLimit')
    assert.equal(err.detail, `parsed=${over.length} candidates=${MOCK_HAR_MAX_ENTRIES + 1} limit=${MOCK_HAR_MAX_ENTRIES}`)
  })

  it('被跳过的条目不占名额：判的是这一次会写进库几条，不是文件里有多少条', () => {
    // 1,200 条里 300 张图 → 候选 900 条，这份包本该吃得下；判文件总数就等于白装那道静态资源开关
    const page = parseHarEntries([
      ...Array.from({ length: 900 }, (_, i) => typed('application/json', `https://a/api/${i}`)),
      ...Array.from({ length: 300 }, (_, i) => typed('image/png', `https://a/img/${i}`)),
    ]).entries
    assert.equal(mapHarEntries(page).records.length, 900)
    assert.equal(thrown(() => mapHarEntries(page, { includeStatic: true })).code, 'harEntryLimit',
      '开关打开后同一份文件就是 1,200 条候选，必须回到整包拒绝')

    // 正文读不出那一道也排在判定之前：1,001 条里有一条回乱码 → 候选 1,000 条 → 要吃得下
    const unreadable = {
      request: { method: 'GET', url: 'https://a/blob', headers: [] },
      response: { status: 200, headers: [{ name: 'content-type', value: 'application/octet-stream' }], content: { size: 4, mimeType: 'application/octet-stream', text: 'abcd' } },
    }
    const batch = parseHarEntries([
      ...Array.from({ length: MOCK_HAR_MAX_ENTRIES }, (_, i) => typed('application/json', `https://a/api/${i}`)),
      unreadable,
    ]).entries
    const result = mapHarEntries(batch)
    assert.equal(result.records.length, MOCK_HAR_MAX_ENTRIES)
    assert.deepEqual(result.skipped.map(it => it.reason), ['harBodyUnreadable'])
  })

  it('三道跳过的明细合在一张表里仍按文件下标升序，坐标指向原 entry', () => {
    const parsed = parseHarEntries([
      typed('image/png'),
      { request: { method: 'GET', url: 'file:///C:/x.js', headers: [] }, response: { status: 200, headers: [{ name: 'content-type', value: 'application/json' }], content: { size: 0, mimeType: 'application/json', text: '' } } },
      typed('application/json', 'https://a/keep'),
      { request: { method: 'GET', url: 'https://a/gone' }, response: { status: 0, headers: [], content: { size: 0, text: '' } } },
      typed('image/jpeg', 'https://a/logo'),
    ])
    assert.equal(parsed.skipped.length, 1, 'status=0 那条在解析层就掉了，不进映射层')
    const result = mapHarEntries(parsed.entries)
    assert.deepEqual(result.skipped.map(it => [it.entryIndex, it.reason]), [
      [0, 'harStaticResource'],
      [1, 'harUnsupportedProtocol'],
      [4, 'harStaticResource'],
    ])
    assert.deepEqual(result.records.map(it => it.entryIndex), [2])
  })
})
