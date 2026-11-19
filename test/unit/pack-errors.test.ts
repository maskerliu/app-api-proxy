import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MOCK_CONFLICT_CODES, MOCK_ERROR_CODES, MOCK_PACK_CODES, MOCK_SERVER_CODES, MOCK_VALIDATION_CODES,
} from '@shared/mock.errors'
import en from '../../src/lang/en'
import zhCN from '../../src/lang/zh-CN'

// mock.pack.* 用数据字面量当键、由导入弹窗动态拼键交给 $t，没有 te() 兜底：
// 码表与两侧文案任缺其一，界面就会显示原始键名。这条断言是 R4 新建的闸门。
describe('R4 导入/导出码表与 i18n', () => {
  const packKeys = (messages: any) => Object.keys(messages?.mock?.pack ?? {})

  it('第四组自身无重复，且与其他三组互不重叠', () => {
    assert.equal(new Set(MOCK_PACK_CODES).size, MOCK_PACK_CODES.length)
    const others = new Set<string>([...MOCK_VALIDATION_CODES, ...MOCK_SERVER_CODES, ...MOCK_CONFLICT_CODES])
    for (const code of MOCK_PACK_CODES) {
      assert.equal(others.has(code), false, `${code} 同时存在于导入码表与既有码表`)
    }
  })

  it('第四组并入全表', () => {
    const all = [...MOCK_VALIDATION_CODES, ...MOCK_SERVER_CODES, ...MOCK_CONFLICT_CODES, ...MOCK_PACK_CODES]
    assert.deepEqual([...MOCK_ERROR_CODES].sort(), all.sort())
  })

  it('中英两侧的 mock.pack 键集与码表完全相等', () => {
    for (const [locale, messages] of [['zh-CN', zhCN], ['en', en]] as const) {
      assert.deepEqual(
        packKeys(messages).sort(),
        [...MOCK_PACK_CODES].sort(),
        `${locale} 的 mock.pack 键集与 MOCK_PACK_CODES 不一致`
      )
    }
  })

  it('mock.pack 文案非空', () => {
    for (const [locale, messages] of [['zh-CN', zhCN], ['en', en]] as const) {
      for (const code of MOCK_PACK_CODES) {
        const text = (messages as any).mock.pack[code]
        assert.equal(typeof text, 'string', `${locale} mock.pack.${code} 缺失`)
        assert.notEqual(text.trim(), '', `${locale} mock.pack.${code} 为空`)
      }
    }
  })

  it('导入码不塞进编辑器校验块', () => {
    const validationKeys = new Set(Object.keys((zhCN as any).mock.editor.validation))
    for (const code of MOCK_PACK_CODES) {
      assert.equal(validationKeys.has(code), false, `${code} 应在 mock.pack 而不是 mock.editor.validation`)
    }
  })
})
