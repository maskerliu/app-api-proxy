import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ProxyMock } from '@shared/proxy.models'
import {
  levelTagType, methodTagType, recordRowOf, warningTagType,
} from '@renderer/pages/proxy/mock/record.row'
import { recordSnapshot } from '@renderer/pages/proxy/mock/mock.record'
import { condition, makeMatch, makeRecord } from './fixtures'

function matched(input = {}, recordInput = {}) {
  const record = makeRecord(recordInput)
  record.match = makeMatch(input)
  return record
}

function variant(id: string, statusCode: number): ProxyMock.MockVariant {
  return { ...ProxyMock.defaultResponse(), id, name: `变体 ${id}`, statusCode, updatedAt: 0 }
}

describe('recordRowOf · 记录行视图模型', () => {
  it('录制自动名换成 path 作标题，第二行只补 host', () => {
    const row = recordRowOf(matched(
      { host: 'api.example.com', conditions: [condition('ts', '1')] },
      { url: '/v1/users?ts=1', name: 'GET /v1/users?ts=1' },
    ))

    assert.equal(row.title, '/v1/users')
    assert.equal(row.subPath, 'api.example.com')
    assert.equal(row.titleHint, '/v1/users?ts=1')
    assert.equal(row.summary.level, 'standard')
  })

  it('手工命名保留为标题，第二行给完整 host + path', () => {
    const row = recordRowOf(matched(
      { host: 'api.example.com' },
      { url: '/v1/users', name: '用户列表' },
    ))

    assert.equal(row.title, '用户列表')
    assert.equal(row.subPath, 'api.example.com/v1/users')
    assert.equal(row.titleHint, '/v1/users')
  })

  it('无匹配条件时回落到 url，第二行为空', () => {
    const named = recordRowOf(makeRecord({ url: '/v1/legacy', name: '旧记录' }))
    assert.equal(named.summary, null)
    assert.equal(named.title, '旧记录')
    assert.equal(named.subPath, '')
    assert.equal(named.titleHint, '/v1/legacy')

    const anonymous = recordRowOf(makeRecord({ url: '/v1/legacy', name: '' }))
    assert.equal(anonymous.title, '/v1/legacy')
    assert.equal(anonymous.titleHint, '/v1/legacy')
  })

  it('状态码取生效响应，启用的变体优先于主响应', () => {
    const record = matched({}, { url: '/v1/users' })
    record.response.statusCode = 200
    assert.equal(recordRowOf(record).statusOk, true)

    record.variants = [variant('v1', 201), variant('v2', 500)]
    record.activeVariantId = 'v2'
    const row = recordRowOf(record)
    assert.equal(row.statusCode, 500)
    assert.equal(row.statusOk, false)
    assert.equal(row.variantCount, 2)
    assert.equal(row.active, true)
  })

  it('告警只展示首条，其余折算成 +N，忽略键取自条件', () => {
    const record = matched({ ignoreKeys: ['ts', 'sign'] }, { url: '/v1/users' })
    record.matchWarnings = [
      { recordId: record.id, type: 'duplicate' },
      { recordId: record.id, type: 'shadowed' },
      { recordId: record.id, type: 'unreachable' },
    ]
    const row = recordRowOf(record)

    assert.equal(row.warning.type, 'duplicate')
    assert.equal(row.warningExtra, 2)
    assert.deepEqual(row.ignoreKeys, ['ts', 'sign'])
    assert.equal(row.active, false)
  })
})

describe('标签配色', () => {
  it('档位：严格红 / 标准蓝 / 宽松绿 / 自定义橙', () => {
    assert.equal(levelTagType('strict'), 'danger')
    assert.equal(levelTagType('standard'), 'primary')
    assert.equal(levelTagType('loose'), 'success')
    assert.equal(levelTagType('custom'), 'warning')
  })

  it('方法：GET 蓝 / POST 绿 / DELETE 红 / ANY 橙 / 其余默认，大小写不敏感', () => {
    assert.equal(methodTagType('get'), 'primary')
    assert.equal(methodTagType('POST'), 'success')
    assert.equal(methodTagType('delete'), 'danger')
    assert.equal(methodTagType('ANY'), 'warning')
    assert.equal(methodTagType('PUT'), 'default')
    assert.equal(methodTagType(undefined), 'default')
  })

  it('告警：重复红，遮挡与不可达橙，其余默认', () => {
    assert.equal(warningTagType('duplicate'), 'danger')
    assert.equal(warningTagType('shadowed'), 'warning')
    assert.equal(warningTagType('unreachable'), 'warning')
    assert.equal(warningTagType('other'), 'default')
  })
})

describe('recordSnapshot · 脏检查快照', () => {
  it('档位被标成 custom 但结构未变时，快照仍等于原快照', () => {
    const record = matched({ conditions: [condition('role', 'admin')] }, { url: '/v1/users' })
    const before = recordSnapshot(record)
    record.match.level = 'custom'
    assert.equal(recordSnapshot(record), before)
  })

  it('条件真的变了才会改变快照', () => {
    const record = matched({ conditions: [condition('role', 'admin')] }, { url: '/v1/users' })
    const before = recordSnapshot(record)
    record.match.query.conditions.push(condition('page', '1'))
    assert.notEqual(recordSnapshot(record), before)
  })
})
