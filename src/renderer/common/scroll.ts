import type { PartialOptions } from 'overlayscrollbars'

// 统一滚动容器配置，主题档位由 os-theme-van 跟随 Vant 明暗色变量变化
export const scrollOptions: PartialOptions = {
  // 内容均按容器宽度换行，横向溢出直接裁掉，避免出现多余的横向滚动条
  overflow: { x: 'hidden' },
  scrollbars: {
    theme: 'os-theme-van',
    clickScroll: true,
  },
}
