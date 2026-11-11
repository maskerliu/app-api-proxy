import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MOCK_CONFLICT_CODES, MOCK_ERROR_CODES, MOCK_SERVER_CODES, MOCK_VALIDATION_CODES, MockError,
} from '@shared/mock.errors'
import { describeMockSaveError, normalizeErrorText } from '@renderer/pages/proxy/mock/save-error'

describe('mock 保存失败分型', () => {
  it('码表三分组互不重叠并等于全表', () => {
    const groups = [...MOCK_VALIDATION_CODES, ...MOCK_SERVER_CODES, ...MOCK_CONFLICT_CODES]
    assert.equal(new Set(groups).size, groups.length)
    assert.deepEqual([...MOCK_ERROR_CODES].sort(), groups.sort())
  })

  it('乐观锁冲突文案优先于错误码', () => {
    const info = describeMockSaveError(new Error('Error: 记录已被其他人修改，请刷新后重试'))
    assert.equal(info.kind, 'conflict')
    assert.ok(info.message.includes('已被其他人修改'))
  })

  it('指纹冲突归为重复并带回已存在记录号', () => {
    const info = describeMockSaveError({ errorCode: 'matchDuplicate', existingRecordId: 'r-1' })
    assert.equal(info.kind, 'duplicateUrl')
    assert.equal(info.code, 'matchDuplicate')
    assert.equal(info.existingRecordId, 'r-1')
  })

  it('旧版 url 重复文案仍可识别', () => {
    const info = describeMockSaveError(new Error('url [http://a/b] 已存在'))
    assert.equal(info.kind, 'duplicateUrl')
    assert.equal(info.url, 'http://a/b')
  })

  it('校验码与服务端拒绝码都归为 validation', () => {
    for (const code of [...MOCK_VALIDATION_CODES, ...MOCK_SERVER_CODES]) {
      const info = describeMockSaveError({ code })
      assert.equal(info.kind, 'validation', `${code} 应判为 validation`)
      assert.equal(info.code, code)
    }
  })

  it('冲突与未实现不混进校验提示', () => {
    for (const code of MOCK_CONFLICT_CODES) {
      if (code === 'matchDuplicate') continue
      assert.equal(describeMockSaveError({ code }).kind, 'unknown')
    }
  })

  it('只有 msg 是错误码的旧形式也能分类', () => {
    const info = describeMockSaveError(new MockError('matchMissing'))
    assert.equal(info.kind, 'validation')
    assert.equal(info.code, 'matchMissing')

    const bare = describeMockSaveError(new Error('priorityInvalid'))
    assert.equal(bare.kind, 'validation')
    assert.equal(bare.code, 'priorityInvalid')
  })

  it('normalizeErrorText 去掉 Error: 前缀且空值返回空串', () => {
    assert.equal(normalizeErrorText(new Error('Error:   bad gateway')), 'bad gateway')
    assert.equal(normalizeErrorText(null), '')
    assert.equal(normalizeErrorText(undefined), '')
  })
})
