import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MOCK_PACK_MAX_RECORDS } from '@shared/mock.pack'
import { MAIN_API_CMD } from '@shared/ipc.api'
import { formatDay, isOverImportLimit, packFileName, sanitizeNamePart } from '@renderer/pages/proxy/mock/pack.export'
import en from '../../src/lang/en'
import zhCN from '../../src/lang/zh-CN'

// 文件名里的 `-raw` 是「这份包含真实凭证」的唯一可携带标记，测试盯的就是它会不会漏标或误标
describe('R4C-08 导出文件名', () => {
  const day = new Date(2026, 10, 19, 1, 2, 3)

  it('全场景固定用 all，不掺场景名', () => {
    assert.equal(packFileName({ scope: 'all', date: day }), 'appapi-mock-all-2026-11-19.json')
  })

  it('单场景用净化后的场景名', () => {
    assert.equal(packFileName({ scope: 'rule', ruleName: '订单 中心', date: day }),
      'appapi-mock-订单-中心-2026-11-19.json')
  })

  it('场景名被剥空时回落 rule，不产出 appapi-mock---日期 这种残缺名', () => {
    for (const ruleName of ['', null, undefined, '???', '...']) {
      assert.equal(packFileName({ scope: 'rule', ruleName, date: day }),
        'appapi-mock-rule-2026-11-19.json', `${ruleName} 应回落 rule`)
    }
  })

  it('只有显式关闭脱敏才带 -raw：默认与 redact=true 都不标', () => {
    const base = { scope: 'all' as const, date: day }
    assert.equal(packFileName({ ...base, redact: false }), 'appapi-mock-all-2026-11-19-raw.json')
    assert.equal(packFileName({ ...base, redact: true }), 'appapi-mock-all-2026-11-19.json')
    assert.equal(packFileName(base), 'appapi-mock-all-2026-11-19.json')
  })
})

describe('R4C-08 文件名净化', () => {
  it('Windows 保留字符与路径分隔符换成 -，连续折成一个', () => {
    assert.equal(sanitizeNamePart('a/b\\\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j')
  })

  it('空白折成 -，首尾的点与 - 去掉（资源管理器会吃掉末位点）', () => {
    assert.equal(sanitizeNamePart('  .订单 中心.  '), '订单-中心')
    assert.equal(sanitizeNamePart('---name---'), 'name')
  })

  it('截到 40 字符，且切口的 - 不留在末位', () => {
    const long = sanitizeNamePart('x'.repeat(45))
    assert.equal(long.length, 40)
    const dashed = sanitizeNamePart(`${'y'.repeat(39)}-z`)
    assert.equal(dashed.length, 39, '第 40 位正好是分隔符时要一起削掉')
    assert.match(dashed, /[^-.]$/)
  })

  it('中文名与 emoji 原样保留：文件名可读性优先，长度才是唯一约束', () => {
    assert.equal(sanitizeNamePart('支付回调 😀 v2'), '支付回调-😀-v2')
  })
})

describe('R4C-08 日期与上限判定', () => {
  it('用本地日期而不是 toISOString：跨零点的包不能标成昨天', () => {
    // 本地 11-19 00:30，UTC 还停在 11-18（东八区）；若写成 toISOString 就会拿到 18 号
    const justAfterMidnight = new Date(2026, 10, 19, 0, 30)
    assert.equal(formatDay(justAfterMidnight), '2026-11-19')
    assert.equal(formatDay(justAfterMidnight), new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(justAfterMidnight))
  })

  it('月/日补零', () => {
    assert.equal(formatDay(new Date(2026, 0, 5)), '2026-01-05')
  })

  it('恰好 5,000 条不算超，超出与缺数都不误报', () => {
    assert.equal(isOverImportLimit(MOCK_PACK_MAX_RECORDS), false)
    assert.equal(isOverImportLimit(MOCK_PACK_MAX_RECORDS + 1), true)
    assert.equal(isOverImportLimit(undefined), false)
  })
})

describe('R4C-08 导出 IPC 通道与文案', () => {
  it('两段式通道名不与既有通道重名：重名会让后注册的 handler 顶掉前一个', () => {
    const channels = Object.values(MAIN_API_CMD)
    assert.equal(channels.includes(MAIN_API_CMD.SelectSavePath), true)
    assert.equal(channels.includes(MAIN_API_CMD.ExportMockPack), true)
    assert.equal(new Set(channels).size, channels.length)
  })

  it('mock.export 中英键集相等且文案非空：$t 没有 te() 兜底，缺一边就显示原始键名', () => {
    const keysOf = (messages: any) => Object.keys(messages?.mock?.export ?? {})
    const zhKeys = keysOf(zhCN)
    assert.ok(zhKeys.length > 0, 'zh-CN 侧没有 mock.export')
    assert.deepEqual(zhKeys.sort(), keysOf(en).sort())
    for (const messages of [zhCN, en] as any[]) {
      for (const key of zhKeys) {
        assert.notEqual(`${messages.mock.export[key]}`.trim(), '', `mock.export.${key} 是空的`)
      }
    }
  })
})
