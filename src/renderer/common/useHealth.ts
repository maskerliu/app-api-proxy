import { Diagnostic, getHealth } from '@shared'
import { onBeforeUnmount, onMounted, ref } from 'vue'

// 手动刷新的最短可见时长：本地健康检查通常几毫秒返回，不等一下按钮 loading 只是一闪。
const MIN_LOADING_MS = 500

/**
 * 健康检查的唯一入口：轮询静默、只有手动刷新点亮按钮 loading，
 * 两条路径共用同一个 in-flight 标志，避免同一时刻发出两次请求。
 */
export function useHealth(pollMs: number) {
  const health = ref<Diagnostic.HealthInfo>(null)
  const healthLoading = ref(false)
  let inFlight = false
  let pollTimer: ReturnType<typeof setInterval> = null

  // manual 为 false 时静默刷新（首次加载与轮询都走这里）
  async function refreshHealth(manual = false) {
    if (inFlight) return
    inFlight = true
    if (manual) healthLoading.value = true
    const startedAt = Date.now()
    try {
      health.value = await getHealth()
    } catch (err) {
      // 请求层已经提示过错误
    } finally {
      if (manual) {
        const remain = MIN_LOADING_MS - (Date.now() - startedAt)
        if (remain > 0) await new Promise(resolve => setTimeout(resolve, remain))
        healthLoading.value = false
      }
      inFlight = false
    }
  }

  onMounted(async () => {
    await refreshHealth()
    if (pollMs > 0) pollTimer = setInterval(() => refreshHealth(), pollMs)
  })

  onBeforeUnmount(() => {
    if (pollTimer != null) clearInterval(pollTimer)
    pollTimer = null
  })

  return { health, healthLoading, refreshHealth }
}
