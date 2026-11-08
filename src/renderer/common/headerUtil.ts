export interface HeaderEntry {
  key: string
  value: string
}

export function toKeyValueEntries(source: Record<string, any> | null | undefined): HeaderEntry[] {
  if (source == null) return []
  return Object.keys(source).map(key => {
    const value = source[key]
    const text = Array.isArray(value) ? value.map(it => String(it ?? '')).join('\n')
      : typeof value === 'object' && value != null ? JSON.stringify(value) : String(value ?? '')
    return { key, value: text }
  })
}
