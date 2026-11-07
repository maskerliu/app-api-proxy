import { describe, it } from 'node:test'
import { previewLevel } from '../../src/renderer/pages/proxy/mock/match.helper'
import { createDefaultMatch, levelOf } from '@shared/mock.models'
import { normalizeMatchRule } from '@shared/mock.validation'

function rec(url: string, matchPatch: any = {}, withSource = true): any {
  const base = createDefaultMatch({ method: 'GET', host: '', path: new URL(url, 'http://x').pathname, source: 'manual' })
  const match = normalizeMatchRule({ ...base, ...matchPatch })
  return { id: 'r1', url, source: withSource ? { url, method: 'GET' } : undefined, match }
}

describe('scratch', () => {
  it('matrix', () => {
    const cases: Array<[string, any]> = [
      ['no-query, loose', rec('/v1/users')],
      ['no-query, custom(header)', rec('/v1/users', { headers: { ignoreKeys: [], conditions: [{ name: 'x', op: 'equals', value: '1' }] } })],
      ['query, loose', rec('/v1/users?a=1&b=2')],
      ['query, standard', rec('/v1/users?a=1&b=2', { query: { mode: 'match', ignoreKeys: [], conditions: [{ key: 'a', op: 'equals', value: '1' }], allowExtra: true, multiValue: 'any' } })],
      ['query, strict', rec('/v1/users?a=1&b=2', { query: { mode: 'match', ignoreKeys: [], conditions: [{ key: 'a', op: 'equals', value: '1' }], allowExtra: false, multiValue: 'any' } })],
      ['query, regex path', rec('/v1/users?a=1', { pathType: 'regex' })],
      ['no source', rec('/v1/users?a=1', {}, false)],
    ]
    for (const [name, record] of cases) {
      record.match.level = levelOf(record.match)
      const lines = []
      for (const level of ['loose', 'standard', 'strict', 'custom'] as const) {
        const p = previewLevel(level, record)
        lines.push(`${level}->${p.match.level}${p.changed ? '' : ' (unchanged)'}${p.diff.empty ? ' empty' : ''}${p.reason ? ' ' + p.reason : ''}`)
      }
      console.log(`${name} [cur=${record.match.level}]: ${lines.join(' | ')}`)
    }
  })
})
