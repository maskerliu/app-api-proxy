import { ProxyMock } from '@shared'

/** 单次录制结果；previous 为覆盖前快照，支持撤销 */
export interface MockRecordHistoryEntry {
  id: string
  ruleId: string
  recordId: string
  ruleName: string
  recordName: string
  url: string
  created: boolean
  enabled: boolean
  previous: ProxyMock.MockRecord | null
  at: number
}

const LIMIT = 10
// 只保留本次运行的历史：记录快照可能含 2MB 响应体，不写入 localStorage
const entries: MockRecordHistoryEntry[] = []

export function listRecordHistory(): MockRecordHistoryEntry[] {
  return entries.slice()
}

export function pushRecordHistory(entry: Omit<MockRecordHistoryEntry, 'id' | 'at'>): MockRecordHistoryEntry[] {
  entries.unshift({
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
  })
  entries.splice(LIMIT)
  return listRecordHistory()
}

export function removeRecordHistory(id: string): MockRecordHistoryEntry[] {
  const index = entries.findIndex(it => it.id === id)
  if (index >= 0) entries.splice(index, 1)
  return listRecordHistory()
}
