import { MOCK_ANY_METHOD } from '@shared'

// 跨页面共用的标签配色：同一个语义在不同列表里必须是同一个颜色，所以取值表放在渲染层公共目录。

/** van-tag 的 type 取值。 */
export type TagType = 'primary' | 'success' | 'warning' | 'danger' | 'default'

/** 方法色块（.method-square）的配色：代理记录列表与 Mock 规则记录条目共用。 */
export function methodTagType(method: string): TagType {
  const value = String(method ?? '').toUpperCase()
  if (value === 'GET') return 'primary'
  if (value === 'POST') return 'success'
  if (value === 'DELETE') return 'danger'
  if (MOCK_ANY_METHOD === value) return 'warning'
  return 'default'
}
