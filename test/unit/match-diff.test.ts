import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MockMatchSuggestion } from '@shared/mock.models'
import { diffLinesOf, ignoreSourceOf, previewLevel } from '@renderer/pages/proxy/mock/match'
import type { LevelPresetDiff, LevelPresetPreview } from '@renderer/pages/proxy/mock/match'
import { condition, headerCondition, makeMatch, makeRecord } from './fixtures'

// 只关心「哪个 key 落到哪句文案」，所以把 t 换成 key + 参数的可读形式
function t(key: string, params?: any): string {
  return params == null ? key.split('.').pop() : `${key.split('.').pop()}:${params.keys ?? params.value ?? params.count}`
}

function diff(input: Partial<LevelPresetDiff> = {}): LevelPresetDiff {
  return {
    addedKeys: [], removedKeys: [], ignoredAdded: [], ignoredRemoved: [],
    allowExtraFrom: true, allowExtraTo: true, headersCleared: 0, pathChanged: false,
    levelChanged: false, empty: true, ...input,
  }
}

function preview(diffValue: LevelPresetDiff, reason?: LevelPresetPreview['reason']): LevelPresetPreview {
  return { level: 'loose', match: makeMatch(), diff: diffValue, changed: true, reason }
}

function suggestion(key: string): MockMatchSuggestion {
  return { key, reason: 'unstable' } as MockMatchSuggestion
}

describe('diffLinesOf · 档位预览文案', () => {
  it('没有预览或因缺少录制来源而不适用时不输出', () => {
    assert.deepEqual(diffLinesOf(null, t), [])
    assert.deepEqual(diffLinesOf(preview(diff(), 'sourceMissing'), t), [])
    assert.deepEqual(diffLinesOf(preview(diff()), t), [])
  })

  it('按「加条件 → 删条件 → 忽略 → 恢复匹配 → 多值 → Header → Path」固定顺序输出', () => {
    const lines = diffLinesOf(preview(diff({
      addedKeys: ['b', 'a'],
      removedKeys: ['c'],
      ignoredAdded: ['ts'],
      ignoredRemoved: ['sign'],
      allowExtraFrom: true,
      allowExtraTo: false,
      headersCleared: 2,
      pathChanged: true,
    })), t)

    assert.deepEqual(lines, ['diffAdd:b, a', 'diffRemove:c', 'diffIgnore:ts', 'diffIgnoreRemove:sign',
      'diffAllowExtra:OFF', 'diffHeaders:2', 'diffPath'])
  })

  it('只改动 allowExtra 时输出开关方向，其余行为空', () => {
    assert.deepEqual(diffLinesOf(preview(diff({
      allowExtraFrom: false, allowExtraTo: true, empty: false,
    })), t), ['diffAllowExtra:ON'])
  })

  it('套到真实档位预览上：宽松档会把条件与 Header 清掉', () => {
    const record = makeRecord({ url: '/v1/users?ts=1&sign=abc' })
    record.match = makeMatch({
      conditions: [condition('ts', '1'), condition('sign', 'abc')],
      headerConditions: [headerCondition('x-tenant-id', 't1')],
    })
    record.match.headers.ignoreKeys = ['x-exp']
    const previewValue = previewLevel('loose', record)

    assert.deepEqual(diffLinesOf(previewValue, t), ['diffRemove:sign, ts', 'diffHeaders:1'])
    // 宽松档清空条件但保留 Header 忽略键，摘要档位随之改变
    assert.deepEqual(previewValue.match.headers.ignoreKeys, ['x-exp'])
    assert.equal(previewValue.match.level, 'loose')
  })
})

describe('ignoreSourceOf · 忽略键来源', () => {
  it('自动分析写入优先于建议，建议优先于手动', () => {
    const match = makeMatch({ ignoreKeys: ['ts', 'sign', 'page'] })
    match.derivation = {
      source: 'recording',
      autoIgnoredKeys: ['ts'],
      suggestions: [suggestion('sign')],
      pathParameterized: false,
      analyzedAt: 0,
    }

    assert.equal(ignoreSourceOf(match, 'ts'), 'auto')
    assert.equal(ignoreSourceOf(match, 'sign'), 'suggestion')
    assert.equal(ignoreSourceOf(match, 'page'), 'manual')
    assert.equal(ignoreSourceOf(match, 'unknown'), 'manual')
  })

  it('建档时带入的忽略键算自动分析，之后追加的和未知键算手动', () => {
    const match = makeMatch({ ignoreKeys: ['ts'] })
    assert.equal(ignoreSourceOf(match, 'ts'), 'auto')
    match.query.ignoreKeys.push('page')
    assert.equal(ignoreSourceOf(match, 'page'), 'manual')
    assert.equal(ignoreSourceOf(match, 'unknown'), 'manual')
  })

  it('没有 match 时算手动添加', () => {
    assert.equal(ignoreSourceOf(null, 'ts'), 'manual')
    assert.equal(ignoreSourceOf(undefined, 'ts'), 'manual')
  })
})
