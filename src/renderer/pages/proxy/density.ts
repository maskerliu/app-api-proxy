// 纯函数模块：单条请求的「波次」密度与同组判定，配色走 Vant 语义档（灰=低频 / 绿=正常 / 橙=密集）。

// 相邻两条间隔 ≤ 这个数就算同一波：波界由请求自己的时间差决定，
// 所以一波请求不会被墙上时钟的整秒边界从中间劈开（固定 1s 桶的老毛病）。
// 取 500ms 而不是 1s：并发一簇的请求间隔通常在百毫秒级，而半秒以上一条的心跳不该算密集。
export const DENSITY_GAP_MS = 500

// 一波最多跨这么长：只看间隔的话，每 250ms 一条的心跳会一路串成一条无限长的「密集」组。
// 超过上限就另起一波，密集仍然是「短时间内的一簇」而不是「一直在发」。
export const DENSITY_MAX_SPAN_MS = 2000

// 每档条数下限（同一波内），下标 +1 即档位：1 条起低频，3 条起正常，6 条起密集
const LEVEL_COUNTS = [1, 3, 6]

/** 达到这个档位即为「过于密集」：颜色、连线与提示共用这一张表，不另设阈值 */
export const DENSITY_WARN_LEVEL = 3

export interface DensityMark {
  /** 同波条数 */
  count: number
  /** 1–3；0 只留给不画时间线的记录（长连接） */
  level: number
  dense: boolean
  /** 这一波自己的时长（波内最晚与最早之差），孤条为 0 */
  span: number
}

export interface DensityRow<T> {
  source: T
  mark: DensityMark
  /** 列表里上一条（时间更近）与它同波：两段连线用同色实线串成一组 */
  joinTop: boolean
  joinBottom: boolean
}

/** 时长文案：1000 → 1s，1500 → 1.5s */
export function spanText(ms: number): string {
  const seconds = Math.max(0, ms) / 1000
  return `${Number(seconds.toFixed(1))}s`
}

/** 按波内条数定档；只要有一条就至少上第 1 档，0 档专属不计密的记录，否则无时间戳的行与孤条看起来一样 */
function levelOf(count: number): number {
  let level = 0
  while (level < LEVEL_COUNTS.length && count >= LEVEL_COUNTS[level]) level += 1
  return count > 0 && level === 0 ? 1 : level
}

/** 波内统计 → 档位标记 */
function markOf(stat?: { count: number, max: number, min: number }): DensityMark {
  if (stat == null) return { count: 0, level: 0, dense: false, span: 0 }
  const level = levelOf(stat.count)
  return { count: stat.count, level, dense: level >= DENSITY_WARN_LEVEL, span: stat.max - stat.min }
}

/**
 * 按渲染顺序（上=新、下=旧）把记录切成一波一波，再给每条打上波次密度与同组连线标记。
 * 同波且相邻的两条用同色实线串起来，跨波仍用淡虚线——组感靠连线，密度靠颜色。
 */
export function densityRows<T>(items: { source: T, timestamp: number }[]): DensityRow<T>[] {
  const times = items.map(it => (Number.isFinite(it.timestamp) ? it.timestamp : Number.NaN))

  // 1) 切波：与紧挨着的上一条（时间更近的）间隔 ≤ DENSITY_GAP_MS 就续上这一波；
  //    波从最晚那条算起的跨度超过 DENSITY_MAX_SPAN_MS 时另起一波。
  const groupId: number[] = []
  let group = 0
  let anchor = Number.NaN // 当前波最晚（列表里最靠上）的那条
  let prev = Number.NaN // 上一行的时刻，用来算相邻间隔
  let chained = false
  times.forEach((at, i) => {
    if (Number.isNaN(at)) {
      groupId[i] = -1 // 没有时间戳就不成波，也把前后打断
      chained = false
      prev = Number.NaN
      return
    }
    const sameWave = chained
      && Math.abs(prev - at) <= DENSITY_GAP_MS
      && Math.abs(anchor - at) <= DENSITY_MAX_SPAN_MS
    if (sameWave) {
      groupId[i] = group
    } else {
      group += 1
      anchor = at
      groupId[i] = group
    }
    chained = true
    prev = at
  })

  // 2) 逐波统计条数与跨度（跨度取波内最晚与最早之差，不假设列表已按时间排好）
  const stats = new Map<number, { count: number, max: number, min: number }>()
  groupId.forEach((g, i) => {
    if (g < 0) return
    const stat = stats.get(g) ?? { count: 0, max: times[i], min: times[i] }
    stat.count += 1
    stat.max = Math.max(stat.max, times[i])
    stat.min = Math.min(stat.min, times[i])
    stats.set(g, stat)
  })

  // 3) 越界下标取到 undefined，与任何波号都不相等，首尾行自然不连线
  return items.map((it, i) => {
    const g = groupId[i]
    return {
      source: it.source,
      mark: markOf(g < 0 ? undefined : stats.get(g)),
      joinTop: g >= 0 && groupId[i - 1] === g,
      joinBottom: g >= 0 && groupId[i + 1] === g,
    }
  })
}
