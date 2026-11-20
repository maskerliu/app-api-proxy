import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MockError } from '@shared/mock.errors'
import { MOCK_PACK_FORMAT, MOCK_PACK_MAX_FILE_BYTES, readMockPackText } from '@shared/mock.pack'
import { utf8ByteLength } from '@shared/mock.validation'
import { parseLooseUrl, queryParts } from '@shared/url'
import { parseHarEntries, readHarText } from '@main/service/mock.har'
import type { HarEntry } from '@main/service/mock.har'

/**
 * R4C-21 的验收面：解析层只保证「读得到的读进来、读不到的按 §9 那两种原因跳过」。
 * 映射（R4C-22）、解码（R4C-23）、上限与静态资源（R4C-24）的用例不写在这里，
 * 写在这里就等于给下一张卡预先定口径。
 */

/** 手工形态样本：真实导出样本（Chrome / Firefox / Charles）仍未采集，见任务拆分「前置动作」 */
function har(entries: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ log: { version: '1.2', creator: { name: 'hand-made', version: '0' }, entries, ...extra } })
}

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

function errorCode(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof MockError, `抛的不是 MockError：${String(err)}`)
    return (err as MockError).code
  }
  throw new assert.AssertionError({ message: '期待抛出 MockError，实际没抛' })
}

/** 一条读得到的 entry 的最小形状，其余用例在它上面改一个字段 */
function readable(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    request: { method: 'GET', url: 'https://api.example.com/v1/users?token=abc', headers: [] },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [{ name: 'content-type', value: 'application/json' }],
      content: { size: 2, mimeType: 'application/json', text: '{}' },
      ...overrides,
    },
  }
}

function only(entry: Record<string, unknown>): HarEntry {
  const result = parseHarEntries([entry])
  assert.deepEqual(result.skipped, [], `这条本该读进来，却被跳过：${JSON.stringify(result.skipped)}`)
  assert.equal(result.entries.length, 1)
  return result.entries[0]
}

describe('readHarText：包级信封与按内容分派', () => {
  it('字节先于解析：超限的文件不先 JSON.parse 一遍再拒', () => {
    // 故意用一段坏 JSON：拿到的必须是 packTooLarge，而不是 'not valid json'
    assert.equal(errorCode(() => readHarText('{', MOCK_PACK_MAX_FILE_BYTES + 1)), 'packTooLarge')
    const ok = readHarText(har([readable()]), MOCK_PACK_MAX_FILE_BYTES)
    assert.equal(ok.entries.length, 1)
    assert.equal(ok.version, '1.2')
    assert.equal(ok.creator, 'hand-made')
  })

  it('空文本与压根没带文件部分是同一个原因', () => {
    assert.equal(errorCode(() => readHarText('', 0)), 'packEmpty')
    assert.equal(errorCode(() => readHarText('   ', 3)), 'packEmpty')
    assert.equal(errorCode(() => readHarText(undefined, 0)), 'packEmpty')
    // 信封完整但一条没录：与「空文件」同一个用户动作（回去重新录一次），不给格式错误
    assert.equal(errorCode(() => readHarText(har([]), bytes(har([])))), 'packEmpty')
  })

  it('坏 JSON 与不是档案的形状各给 detail，但都是 packFormatUnknown', () => {
    const broken = '{"log":'
    const topArray = '[1,2]'
    const noLog = '{"log":"x","entries":[]}'
    assert.equal(errorCode(() => readHarText(broken, bytes(broken))), 'packFormatUnknown')
    assert.match(readHarTextError(broken), /not valid json/)
    assert.equal(errorCode(() => readHarText(topArray, bytes(topArray))), 'packFormatUnknown')
    assert.match(readHarTextError(topArray), /top level is array/)
    assert.equal(errorCode(() => readHarText(noLog, bytes(noLog))), 'packFormatUnknown')
    assert.match(readHarTextError(noLog), /log is string/)
  })

  it('选错 kind 时 detail 说破「这是一份规则包」——分派靠内容，不靠用户选的扩展名', () => {
    const pack = JSON.stringify({ format: MOCK_PACK_FORMAT, version: 1, rules: [] })
    assert.equal(errorCode(() => readHarText(pack, bytes(pack))), 'packFormatUnknown')
    assert.match(readHarTextError(pack), /rule pack/)
    // 反过来：真 HAR 走规则包那道闸门同样被拒，两边都不认对方的顶层形状
    // （用共享层的 `utf8ByteLength` 而不是 Buffer：那条闸门是渲染层也要走的，字节口径不能只有主进程算得出）
    const asPack = har([readable()])
    assert.equal(errorCode(() => readMockPackText(asPack, utf8ByteLength(asPack))), 'packFormatUnknown')
    assert.match(mockPackTextError(asPack), /format=\(missing\)/)
  })

  it('log.entries 不是数组属格式问题，不是空档案', () => {
    const text = JSON.stringify({ log: { version: '1.2', entries: {} } })
    assert.equal(errorCode(() => readHarText(text, bytes(text))), 'packFormatUnknown')
  })
})

function readHarTextError(text: string): string {
  try {
    readHarText(text, bytes(text))
  } catch (err) {
    return (err as MockError).detail ?? ''
  }
  return ''
}

function mockPackTextError(text: string): string {
  try {
    readMockPackText(text, utf8ByteLength(text))
  } catch (err) {
    return (err as MockError).detail ?? ''
  }
  return ''
}

describe('parseHarEntries：§9 列出的真实形态', () => {
  it('status 为 0 是没有响应，不是状态码', () => {
    const result = parseHarEntries([readable({ status: 0 })])
    assert.deepEqual(result.entries, [])
    assert.equal(result.skipped.length, 1)
    assert.equal(result.skipped[0].reason, 'harNoResponse')
    assert.equal(result.skipped[0].detail, 'status=0')
    assert.equal(result.skipped[0].entryIndex, 0)
  })

  it('status 缺失 / 非数字与 0 同解；工具有把它写成 "200" 的，那种条目不许静默丢掉', () => {
    const codes = [undefined, 'abc', {}, -0].map(status =>
      parseHarEntries([readable({ status })]).skipped.map(it => it.reason))
    for (const code of codes) assert.deepEqual(code, ['harNoResponse'])
    assert.equal(only(readable({ status: '200' })).response.status, 200)
  })

  it('没有 response 对象与 entry 压根不是对象都归 harNoResponse，detail 指得出是哪种', () => {
    const result = parseHarEntries([
      { request: { method: 'GET', url: 'https://a/b' } },
      'garbage',
      null,
    ])
    assert.equal(result.entries.length, 0)
    assert.deepEqual(result.skipped.map(it => it.reason), ['harNoResponse', 'harNoResponse', 'harNoResponse'])
    assert.match(String(result.skipped[0].detail), /response is \(missing\)/)
    assert.match(String(result.skipped[1].detail), /entry is string/)
    assert.match(String(result.skipped[2].detail), /entry is \(missing\)/)
  })

  it('正文缺失但报得出大小：跳过并说明大小与 mimeType（Chrome 的二进制常态）', () => {
    const entry = readable({ content: { size: 18273, mimeType: 'image/png' } })
    const result = parseHarEntries([entry])
    assert.equal(result.skipped.length, 1)
    assert.equal(result.skipped[0].reason, 'harBodyUnreadable')
    assert.equal(result.skipped[0].detail, 'size=18273 mimeType=image/png')
    // mimeType 也没写时不许报成空字符串看不出所以然
    assert.match(String(parseHarEntries([readable({ content: { size: 5 } })]).skipped[0].detail),
      /size=5 mimeType=\(missing\)/)
  })

  it('真的没有正文（size 为 0）照常导入，且「空串」与「没这个字段」分得开', () => {
    const noBody = only(readable({ content: { size: 0, mimeType: '' } }))
    assert.equal(noBody.response.content.text, null)
    assert.equal(noBody.response.content.size, 0)
    const emptyText = only(readable({ content: { size: 0, mimeType: 'text/plain', text: '' } }))
    assert.equal(emptyText.response.content.text, '')
    // 只有 text 没有 size（Firefox 有过这种写法）：有正文就是读到了，别按「读不到」跳
    assert.equal(only(readable({ content: { mimeType: 'text/plain', text: 'hi' } })).response.content.text, 'hi')
  })

  it('base64 只记账不解码：这一层不碰正文内容', () => {
    const entry = only(readable({ content: { size: 4, mimeType: 'image/png', text: 'YWJj', encoding: 'BASE64' } }))
    assert.equal(entry.response.content.text, 'YWJj')
    assert.equal(entry.response.content.encoding, 'base64')
    // 认不出的编码不冒充 utf8：原样留着，判不判得了是 R4C-23 的事
    assert.equal(only(readable({ content: { size: 1, text: 'x', mimeType: '', encoding: 'gzip' } })).response.content.encoding, 'gzip')
    assert.equal(only(readable()).response.content.encoding, '')
  })

  it('postData.params 与 text 各留一份，这层不替映射决定用哪个', () => {
    const params = only({
      request: {
        method: 'POST',
        url: 'https://a/upload',
        postData: {
          mimeType: 'multipart/form-data; boundary=x',
          params: [{ name: 'file', value: 'x', fileName: 'a.png' }, { name: 'note' }, 'junk'],
        },
      },
      response: { status: 201, content: { size: 0, text: '' } },
    })
    assert.equal(params.request.text, null)
    assert.deepEqual(params.request.params, [
      { name: 'file', value: 'x', fileName: 'a.png' },
      { name: 'note', value: '', fileName: '' },
    ])
    assert.equal(params.request.mimeType, 'multipart/form-data; boundary=x')
    // 两者都有（Charles 会同时写出 text 与 params）：两份都保住，params 不因 text 存在被丢
    const both = only({
      request: { method: 'POST', url: 'https://a', postData: { text: 'a=1', params: [{ name: 'a', value: '1' }] } },
      response: { status: 200, content: { size: 0, text: '' } },
    })
    assert.equal(both.request.text, 'a=1')
    assert.equal(both.request.params.length, 1)
  })

  it('fragment 丢弃：截完之后按串读与按 URL 读才不会再给两种答案', () => {
    const urls = [
      'https://a.example/x?token=1#frag',
      'https://a.example/x#seg?token=1',
      'https://a.example/x#',
      'https://a.example/x',
    ]
    for (const url of urls) {
      const parsed = only({ request: { method: 'GET', url }, response: { status: 200, content: { size: 0, text: '' } } })
      assert.ok(!parsed.request.url.includes('#'), `fragment 没丢干净：${parsed.request.url}`)
      // 截断点必须与引擎用 `new URL()` 看到的是同一个 path/query（R4C-22 只会用 shared/url.ts 拆）
      const before = parseLooseUrl(url)
      const after = parseLooseUrl(parsed.request.url)
      assert.ok(before != null && after != null)
      assert.equal(after?.pathname, before?.pathname)
      assert.equal(after?.search, before?.search)
      // 存下来的 url 从此只有一种读法：`queryParts`（按串）与 `URL.search`（按 URL）答案相同
      assert.deepEqual(queryParts(parsed.request.url), after!.search === '' ? [] : after!.search.slice(1).split('&'))
    }
    // 不截就会分叉：'#' 在 '?' 之前时，按串读出一个 query、按 URL 读一个也没有。
    // 这一句钉的是「为什么丢弃要落在解析层」——留到映射层就变成两份真相（`shared/url.ts:73-82` 自己也说了 # 只认出现在 ? 之后的）
    const fork = 'https://a.example/x#seg?token=1'
    const stored = only({ request: { method: 'GET', url: fork }, response: { status: 200, content: { size: 0, text: '' } } }).request.url
    assert.deepEqual(queryParts(fork), ['token=1'])
    assert.deepEqual(queryParts(stored), [])
    assert.equal(only(readable({ status: 200 })).request.url, 'https://api.example.com/v1/users?token=abc')
  })

  it('method 原样交出：大小写与「空即 ANY」是 normalizeMethod 的口径，这层不另判', () => {
    assert.equal(only({ request: { method: 'get', url: 'https://a/b' }, response: { status: 200, content: { size: 0, text: '' } } }).request.method, 'get')
    // 缺 request 不在这层跳：URL 为空是阶段二 matchMissing 的话
    const noRequest = only(readable())
    assert.equal(noRequest.request.url, 'https://api.example.com/v1/users?token=abc')
    const orphan = parseHarEntries([{ response: { status: 200, content: { size: 0, text: '' } } }])
    assert.equal(orphan.entries.length, 1)
    assert.equal(orphan.entries[0].request.method, '')
    assert.equal(orphan.entries[0].request.url, '')
  })

  it('头：重名收成等长数组，单值仍是字符串，键名原样；cookies 那份副本不读', () => {
    const entry = only({
      request: {
        method: 'GET',
        url: 'https://a/b',
        headers: [
          { name: 'Cookie', value: 'a=1' },
          { name: 'set-cookie', value: 'x=1' },
          { name: 'set-cookie', value: 'y=2' },
          { name: 'set-cookie', value: 'z=3' },
          { name: '', value: 'no-name' },
          { name: 'X-Count', value: 7 },
          'junk',
        ],
        cookies: [{ name: 'a', value: '1' }],
      },
      response: { status: 200, headers: [], content: { size: 0, text: '' } },
    })
    assert.deepEqual(entry.request.headers, {
      Cookie: 'a=1',
      'set-cookie': ['x=1', 'y=2', 'z=3'],
      'X-Count': '7',
    })
    assert.ok(Object.keys(entry.request.headers).every(name => name !== 'a'), 'cookies 不该被当成第二份头')
  })

  it('下标指向文件里的那一条，且保留 + 跳过 = 全部', () => {
    const mixed = [
      readable(),
      readable({ status: 0 }),
      'junk',
      readable({ content: { size: 10, mimeType: 'image/jpeg' } }),
      readable({ status: 404 }),
    ]
    const result = parseHarEntries(mixed)
    assert.deepEqual(result.entries.map(it => it.index), [0, 4])
    assert.deepEqual(result.skipped.map(it => [it.entryIndex, it.reason]), [
      [1, 'harNoResponse'],
      [2, 'harNoResponse'],
      [3, 'harBodyUnreadable'],
    ])
    assert.equal(result.entries.length + result.skipped.length, mixed.length)
    // 原顺序：解析层不许排序、不许去重（那是映射与匹配引擎的事）
    assert.equal(result.entries[1].response.status, 404)
  })
})
