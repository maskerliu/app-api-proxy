import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DENSITY_GAP_MS, DENSITY_MAX_SPAN_MS, DENSITY_WARN_LEVEL, densityRows, spanText,
} from '@renderer/pages/proxy/density'

// 2026-11-01 00:00:00.000Z，正好落在整秒边界上，毫秒级大数锁死 timestamp 的单位
const AT = 1761955200000

/** 列表顺序：上=新、下=旧，测试用序号当 source 直接读回顺序 */
function marks(offsetsMs: number[]) {
  return densityRows(offsetsMs.map((ms, i) => ({ source: i, timestamp: AT + ms })))
}

describe('density 波界常量与文案', () => {
  it('间隔与跨度上限都是正数，且上限大于间隔（否则一波永远只能有一条）', () => {
    assert.ok(DENSITY_GAP_MS > 0)
    assert.ok(DENSITY_MAX_SPAN_MS > DENSITY_GAP_MS)
    assert.equal(spanText(1000), '1s')
    assert.equal(spanText(1500), '1.5s')
    assert.equal(spanText(0), '0s')
  })
})

describe('density 单条标记', () => {
  it('空列表不产生标记', () => {
    assert.deepEqual(densityRows([]), [])
  })

  it('孤条只上第 1 档，上下都不连线，跨度为 0', () => {
    const [row] = marks([0])
    assert.deepEqual(row.mark, { count: 1, level: 1, dense: false, span: 0 })
    assert.equal(row.joinTop, false)
    assert.equal(row.joinBottom, false)
  })

  it('档位按同波条数分三档：1/3/6 条起分别是低频/正常/密集，再多也不升档', () => {
    const levels = [1, 3, 6, 10].map(count => marks(Array.from({ length: count }, () => 0))[0].mark.level)
    assert.deepEqual(levels, [1, 2, 3, 3])
  })

  it('过于密集就是第 3 档起，与档位色共用同一张表', () => {
    for (const count of [5, 6, 12]) {
      const { level, dense } = marks(Array.from({ length: count }, () => 0))[0].mark
      assert.equal(dense, level >= DENSITY_WARN_LEVEL, `${count} 条`)
    }
  })

  it('无效时间戳不上档，留在 0 档（与低频共用 default 灰）', () => {
    const [row] = marks([Number.NaN])
    assert.deepEqual(row.mark, { count: 0, level: 0, dense: false, span: 0 })
    assert.equal(row.joinTop, false)
    assert.equal(row.joinBottom, false)
  })
})

describe('density 按时间关联切波', () => {
  it('一波请求不再被整秒边界劈开：900/1000/1100 三条同波', () => {
    const rows = marks([900, 1000, 1100])
    assert.deepEqual(rows.map(it => it.mark.count), [3, 3, 3])
    assert.deepEqual(rows.map(it => [it.joinTop, it.joinBottom]), [[false, true], [true, true], [true, false]])
    assert.equal(rows[0].mark.span, 200)
  })

  it('间隔超过阈值的稳定心跳始终算低频：一条都不与邻居同波', () => {
    // 步长跟着 DENSITY_GAP_MS 走，不写死毫秒数：阈值本身是可调的口径，用例要的是「比阈值慢就不算密集」这条性质
    const step = DENSITY_GAP_MS + 100
    const rows = marks([0, step, step * 2, step * 3])
    assert.deepEqual(rows.map(it => it.mark.count), [1, 1, 1, 1])
    assert.ok(rows.every(it => it.mark.level === 1 && !it.joinTop && !it.joinBottom))
  })

  it('间隔没超但一波拉得太长也另起：每 250ms 一条的心跳不会串成无限长一组', () => {
    const offsets = Array.from({ length: 11 }, (_, i) => i * 250) // 0..2500
    const rows = marks(offsets)
    assert.deepEqual(rows.slice(0, 9).map(it => it.mark.count), Array.from({ length: 9 }, () => 9))
    assert.deepEqual(rows.slice(9).map(it => it.mark.count), [2, 2])
    assert.equal(rows[8].joinBottom, false)
    assert.equal(rows[9].joinTop, false)
  })

  it('跨度按波内最晚与最早之差算，不靠列表顺序', () => {
    const rows = marks([200, 0, 100])
    assert.equal(rows[0].mark.span, 200)
    assert.equal(rows[0].mark.count, 3)
  })

  it('无效时间戳把前后打断，自己不算波', () => {
    const rows = marks([0, 100, Number.NaN, 400, 500])
    assert.deepEqual(rows.map(it => it.mark.count), [2, 2, 0, 2, 2])
    assert.equal(rows[2].joinTop, false)
    assert.equal(rows[2].joinBottom, false)
    assert.equal(rows[3].joinTop, false)
  })
})

describe('density 同组连线', () => {
  it('同波且相邻才连：首条只连下、末条只连上、中间两头都连', () => {
    const rows = marks([0, 0, 200])
    assert.deepEqual(rows.map(it => [it.joinTop, it.joinBottom]), [[false, true], [true, true], [true, false]])
    assert.ok(rows.every(it => it.mark.count === 3 && it.mark.level === 2))
  })

  it('同波但不相邻也不连：组感只认列表里的先后', () => {
    const rows = marks([0, 5000, 300])
    assert.equal(rows[0].joinBottom, false)
    assert.equal(rows[2].joinTop, false)
    assert.equal(rows[0].mark.count, 1)
    assert.equal(rows[2].mark.count, 1)
  })

  it('两条长连接式记录各自成组，互不牵连', () => {
    const rows = marks([0, 1500, 3000])
    assert.ok(rows.every(it => it.mark.level === 1 && !it.joinTop && !it.joinBottom))
  })
})
