import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MOCK_CONFLICT_CODES, MOCK_ERROR_CODES, MOCK_PACK_CODES, MOCK_SHARE_CODES, MOCK_SERVER_CODES, MOCK_VALIDATION_CODES,
} from '@shared/mock.errors'
import en from '../../src/lang/en'
import zhCN from '../../src/lang/zh-CN'

// mock.share.* 与 mock.pack.* 同样是「数据字面量当键、由界面动态拼键交给 $t」，没有 te() 兜底：
// 码表与两侧文案任缺其一，远端失败就显示成原始键名——而远端失败恰恰是最需要一句人话的那类错误。
// 断言照 pack-errors.test.ts 抄，不发明第二套闸门。
describe('v1.3 云共享码表与 i18n', () => {
  const shareKeys = (messages: any) => Object.keys(messages?.mock?.share ?? {})

  it('第五组自身无重复，且与其他四组互不重叠', () => {
    assert.equal(new Set(MOCK_SHARE_CODES).size, MOCK_SHARE_CODES.length)
    const others = new Set<string>([
      ...MOCK_VALIDATION_CODES, ...MOCK_SERVER_CODES, ...MOCK_CONFLICT_CODES, ...MOCK_PACK_CODES,
    ])
    for (const code of MOCK_SHARE_CODES) {
      assert.equal(others.has(code), false, `${code} 同时存在于云共享码表与既有码表`)
    }
  })

  it('第五组并入全表', () => {
    const all = [
      ...MOCK_VALIDATION_CODES, ...MOCK_SERVER_CODES, ...MOCK_CONFLICT_CODES, ...MOCK_PACK_CODES, ...MOCK_SHARE_CODES,
    ]
    assert.deepEqual([...MOCK_ERROR_CODES].sort(), all.sort())
  })

  it('中英两侧的 mock.share 键集与码表完全相等', () => {
    for (const [locale, messages] of [['zh-CN', zhCN], ['en', en]] as const) {
      assert.deepEqual(
        shareKeys(messages).sort(),
        [...MOCK_SHARE_CODES].sort(),
        `${locale} 的 mock.share 键集与 MOCK_SHARE_CODES 不一致`
      )
    }
  })

  it('mock.share 文案非空', () => {
    for (const [locale, messages] of [['zh-CN', zhCN], ['en', en]] as const) {
      for (const code of MOCK_SHARE_CODES) {
        const text = (messages as any).mock.share[code]
        assert.equal(typeof text, 'string', `${locale} mock.share.${code} 缺失`)
        assert.notEqual(text.trim(), '', `${locale} mock.share.${code} 为空`)
      }
    }
  })

  it('远端码不塞进编辑器校验块，也不与导入码同块', () => {
    const validationKeys = new Set(Object.keys((zhCN as any).mock.editor.validation))
    const packKeys = new Set(Object.keys((zhCN as any).mock.pack))
    for (const code of MOCK_SHARE_CODES) {
      assert.equal(validationKeys.has(code), false, `${code} 应在 mock.share 而不是 mock.editor.validation`)
      assert.equal(packKeys.has(code), false, `${code} 应在 mock.share 而不是 mock.pack`)
    }
  })

  // C6 最后一条：界面不许把「只脱了凭证头」说成「可放心分享」。文案块里出现这种承诺就该拦下——
  // 这条比逐条目测稳定，因为下一次改文案的人不会读到 PRD 那一行。
  it('远端文案不许出现「可以放心 / safe to share」这类夸大', () => {
    const banned = [/放心/, /安全无风险/, /safe to share/, /fully private/, /no privacy risk/]
    for (const [locale, messages] of [['zh-CN', zhCN], ['en', en]] as const) {
      for (const code of MOCK_SHARE_CODES) {
        const text = String((messages as any).mock.share[code])
        for (const re of banned) {
          assert.equal(re.test(text), false, `${locale} mock.share.${code} 含夸大措辞：${text}`)
        }
      }
    }
  })

  // C1-4 / 11.3 的唯一可见落点就是这几句：拒读类必须说清本地库没被动过，否则用户只能猜。
  it('拒读类文案说明本地库未受影响', () => {
    const refusal = ['remoteCorrupted', 'remoteUnreachable']
    for (const code of refusal) {
      assert.match(String((zhCN as any).mock.share[code]), /本地库未受影响/, `${code} 缺本机侧结论`)
      assert.match(String((en as any).mock.share[code]), /local data untouched/i, `${code} 缺本机侧结论`)
    }
  })

  // PRD 10 节状态矩阵那格要求「这个目录里还没有备份」这句提示由码本身带出来
  it('远端没有 manifest 与远端连不上是两句话', () => {
    assert.match(String((zhCN as any).mock.share.remoteNotFound), /还没有备份/)
    assert.doesNotMatch(String((zhCN as any).mock.share.remoteUnreachable), /还没有备份/)
  })
})
