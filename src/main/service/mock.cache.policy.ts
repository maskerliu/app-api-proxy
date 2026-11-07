// 快照缓存策略：纯计算，供主进程与基准脚本共用，避免阈值两处漂移。
export const MEMO_CAPACITY = 1000
// 记录规模相对基线变化超过 10% 时放弃增量维护，交给下一次请求全量重建
export const REBUILD_RATIO = 0.1

export function shouldRebuildSnapshot(baselineCount: number, nextCount: number): boolean {
  return baselineCount > 0
    && Math.abs(nextCount - baselineCount) > baselineCount * REBUILD_RATIO
}