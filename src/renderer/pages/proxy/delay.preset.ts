import { MOCK_MAX_DELAY_MS } from '@shared/mock.validation'

// 纯函数模块：延时档位与取值校验，不依赖 vant / vue。

export interface DelayPreset {
  key: string
  ms: number
  // 文案键写成字面量，供 i18n 引用审计按完整路径命中
  labelKey: string
}

/** 预设档位：只在这些毫秒值之间切换，其余值一律按自定义处理 */
export const DELAY_PRESETS: DelayPreset[] = [
  { key: 'none', ms: 0, labelKey: 'proxy.presetNone' },
  { key: 'fast', ms: 150, labelKey: 'proxy.presetFast' },
  { key: 'slow', ms: 800, labelKey: 'proxy.presetSlow' },
  { key: 'weak', ms: 2000, labelKey: 'proxy.presetWeak' },
]

export const DELAY_CUSTOM_KEY = 'custom'
export const DELAY_CUSTOM_LABEL_KEY = 'proxy.presetCustom'

/** 当前延时对应的档位，非预设值返回自定义键 */
export function presetKeyOf(ms: number): string {
  return DELAY_PRESETS.find(it => it.ms === ms)?.key ?? DELAY_CUSTOM_KEY
}

/** 选中档位对应的毫秒数，自定义没有固定毫秒数因此返回 null */
export function presetMsOf(key: string): number | null {
  return DELAY_PRESETS.find(it => it.key === key)?.ms ?? null
}

/** 输入框文本转毫秒，非整数或超出 0–60000 返回 null */
export function toDelayMs(raw: unknown): number | null {
  const text = String(raw ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  const ms = Number(text)
  return ms <= MOCK_MAX_DELAY_MS ? ms : null
}
