import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { methodTagType } from '@renderer/common/tag'

describe('方法色块 · 配色表', () => {
  it('方法：GET 蓝 / POST 绿 / DELETE 红 / ANY 橙 / 其余默认，大小写不敏感', () => {
    assert.equal(methodTagType('get'), 'primary')
    assert.equal(methodTagType('POST'), 'success')
    assert.equal(methodTagType('delete'), 'danger')
    assert.equal(methodTagType('ANY'), 'warning')
    assert.equal(methodTagType('PUT'), 'default')
    assert.equal(methodTagType(undefined), 'default')
  })
})
