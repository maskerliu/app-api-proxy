import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DELAY_CUSTOM_KEY, DELAY_PRESETS, presetKeyOf, presetMsOf, toDelayMs,
} from '@renderer/pages/proxy/delay.preset'

describe('delay.preset · 档位推导', () => {
  it('预设毫秒数各自回到对应档位键', () => {
    for (const preset of DELAY_PRESETS) {
      assert.equal(presetKeyOf(preset.ms), preset.key)
    }
  })

  it('非预设毫秒数一律算自定义', () => {
    assert.equal(presetKeyOf(100), DELAY_CUSTOM_KEY)
    assert.equal(presetKeyOf(799), DELAY_CUSTOM_KEY)
    assert.equal(presetKeyOf(60000), DELAY_CUSTOM_KEY)
  })

  it('档位键反查毫秒数，自定义没有固定值', () => {
    assert.equal(presetMsOf('none'), 0)
    assert.equal(presetMsOf('weak'), 2000)
    assert.equal(presetMsOf(DELAY_CUSTOM_KEY), null)
    assert.equal(presetMsOf('nope'), null)
  })

  it('档位文案键齐全，毫秒数都在可输入范围内', () => {
    for (const preset of DELAY_PRESETS) {
      assert.ok(preset.labelKey.startsWith('proxy.preset'))
      assert.equal(toDelayMs(preset.ms), preset.ms)
    }
  })
})

describe('toDelayMs · 输入校验', () => {
  it('空值、负数、小数与非数字都判为不合法', () => {
    for (const raw of ['', '   ', undefined, null, '-1', '12.5', '1e3', 'abc', '800ms']) {
      assert.equal(toDelayMs(raw), null)
    }
  })

  it('去掉首尾空白，并接受上下界', () => {
    assert.equal(toDelayMs(' 300 '), 300)
    assert.equal(toDelayMs('0'), 0)
    assert.equal(toDelayMs('60000'), 60000)
    assert.equal(toDelayMs('60001'), null)
  })

  it('数字入参同样按整数毫秒处理', () => {
    assert.equal(toDelayMs(800), 800)
    assert.equal(toDelayMs(800.5), null)
  })
})
