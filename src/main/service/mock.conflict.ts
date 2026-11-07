import type { ProxyMock } from '@shared/proxy.models'
import type { MockMatchRule, MockMatchWarning, MockQueryMatch } from '@shared/mock.models'
import { canonicalMatch, normalizeMatchRule } from '@shared/mock.validation'

// 冲突扫描只在列表/保存时执行，绝不进入请求热路径。

function hostCovers(cover: string, target: string): boolean {
  if (cover === '') return true
  if (cover.startsWith('*.')) return target.endsWith(cover.slice(1))
  return cover === target
}

function pathCovers(cover: MockMatchRule, target: MockMatchRule): boolean {
  if (target.pathType !== 'exact' && target.pathType !== 'prefix') return false
  if (cover.pathType === 'exact') {
    return cover.path === target.path
  }
  if (cover.pathType === 'prefix') {
    return target.path.startsWith(cover.path)
  }
  return false
}

function conditionSignature(match: MockQueryMatch): Set<string> {
  const result = new Set<string>()
  if (match.mode !== 'match') return result
  for (const condition of match.conditions ?? []) {
    result.add(`${condition.key}\u0000${condition.op}\u0000${condition.value}\u0000${condition.ignoreCase ? 1 : 0}`)
  }
  return result
}

function headerSignature(match: MockMatchRule): Set<string> {
  const result = new Set<string>()
  for (const condition of match.headers?.conditions ?? []) {
    const name = condition.name.toLowerCase()
    result.add(`${name}\u0000${condition.op}\u0000${condition.value}\u0000${condition.ignoreCase ? 1 : 0}`)
  }
  return result
}

function isSubset(source: Set<string>, target: Set<string>): boolean {
  for (const value of source) {
    if (!target.has(value)) return false
  }
  return true
}

function isRepeat(a: MockMatchRule, b: MockMatchRule): boolean {
  return canonicalMatch(a) === canonicalMatch(b)
}

function priorityWins(a: MockMatchRule, b: MockMatchRule): boolean {
  if (b.priority != null && (a.priority == null || b.priority > a.priority)) return false
  return true
}

function covers(a: MockMatchRule, b: MockMatchRule): boolean {
  if (!priorityWins(a, b)) return false
  if (a.method !== 'ANY' && a.method !== b.method) return false
  if (!hostCovers(a.host, b.host)) return false
  if (!pathCovers(a, b)) return false
  if (a.query.allowExtra === false) return false
  if (!isSubset(conditionSignature(a.query), conditionSignature(b.query))) return false
  if (!isSubset(headerSignature(a), headerSignature(b))) return false
  return true
}

function warningRank(type: MockMatchWarning['type']): number {
  switch (type) {
    case 'invalid': return 4
    case 'unreachable': return 3
    case 'duplicate': return 2
    case 'shadowed': return 1
    default: return 0
  }
}

interface Entry {
  record: ProxyMock.MockRecord
  match: MockMatchRule
  order: number
}

/**
 * 扫描规则内记录，返回每个记录的冲突提示（重复 / 遮蔽 / 不可达 / 无效）。
 * 只提示不自动禁用，是否处理由用户决定。
 */
export function detectMatchWarnings(records: ProxyMock.MockRecord[]): MockMatchWarning[] {
  const entries: Entry[] = []
  const warnings = new Map<string, MockMatchWarning>()

  ;(records ?? []).forEach((record, index) => {
    if (record == null) return
    if (record.match == null || record.matchInvalid != null) {
      warnings.set(record.id, {
        recordId: record.id,
        type: 'invalid',
        message: record.matchInvalid ?? 'matchMissing',
      })
      return
    }
    const match = normalizeMatchRule(record.match)
    if (match.enabled === false) return
    entries.push({ record, match, order: index })
  })

  const groups = new Map<string, Entry[]>()
  for (const entry of entries) {
    const key = canonicalMatch(entry.match)
    const group = groups.get(key)
    if (group == null) groups.set(key, [entry])
    else group.push(entry)
  }

  const shadowExcluded = new Set<string>()
  groups.forEach(group => {
    if (group.length < 2) return
    const sorted = [...group].sort((a, b) => {
      if (a.match.priority != null || b.match.priority != null) {
        if (a.match.priority == null) return 1
        if (b.match.priority == null) return -1
        if (a.match.priority !== b.match.priority) return b.match.priority - a.match.priority
      }
      if (a.record.updatedAt !== b.record.updatedAt) return b.record.updatedAt - a.record.updatedAt
      return a.record.id < b.record.id ? -1 : 1
    })
    const keeper = sorted[0]
    for (const loser of sorted.slice(1)) {
      shadowExcluded.add(loser.record.id)
      const higherPriority = keeper.match.priority != null
        && (loser.match.priority == null || keeper.match.priority > loser.match.priority)
      warnings.set(loser.record.id, {
        recordId: loser.record.id,
        type: higherPriority ? 'unreachable' : 'duplicate',
        coveredBy: keeper.record.id,
      })
    }
  })

  const shadowCandidates = entries.filter(it => !shadowExcluded.has(it.record.id))
  for (const target of shadowCandidates) {
    let cover: Entry = null
    for (const candidate of shadowCandidates) {
      if (candidate === target) continue
      if (isRepeat(candidate.match, target.match)) continue
      if (!covers(candidate.match, target.match)) continue
      const candidatePriority = candidate.match.priority ?? -Infinity
      const coverPriority = cover?.match.priority ?? -Infinity
      if (cover == null
        || candidatePriority > coverPriority
        || (candidatePriority === coverPriority && candidate.order < cover.order)) {
        cover = candidate
      }
    }
    if (cover == null) continue

    const existing = warnings.get(target.record.id)
    if (existing != null && warningRank(existing.type) >= warningRank('shadowed')) continue
    warnings.set(target.record.id, {
      recordId: target.record.id,
      type: 'shadowed',
      coveredBy: cover.record.id,
    })
  }

  return [...warnings.values()]
}