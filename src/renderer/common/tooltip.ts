import { nextTick, reactive, type ObjectDirective } from 'vue'

// 全站 hover 提示的单例状态：v-tip 指令只登记文案与锚点，真正的浮层由 GlobalTooltip.vue 渲染到 body 末尾。
// 不用原生 title：它的宽度、配色、字号在 Chromium 里一概不可控，长 URL 与 JSON 会撑出超宽气泡。
const SHOW_DELAY = 300
const GAP = 6
const EDGE = 8

export const tooltipState = reactive({
  visible: false,
  // 量尺与定位完成前保持透明，避免先画在旧坐标上闪一下
  placed: false,
  text: '',
  left: 0,
  top: 0,
})

let node: HTMLElement | null = null
let anchor: Element | null = null
let pending: Element | null = null
let timer: ReturnType<typeof setTimeout> | null = null

export function setTooltipNode(el: HTMLElement | null) {
  node = el
}

function hide() {
  if (timer != null) {
    clearTimeout(timer)
    timer = null
  }
  anchor = null
  pending = null
  tooltipState.visible = false
  tooltipState.placed = false
}

function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(value, min), max)
}

async function show(el: Element, text: string) {
  pending = null
  anchor = el
  tooltipState.text = text
  tooltipState.visible = true
  tooltipState.placed = false
  await nextTick()
  place(el)
}

// 默认贴在锚点上方，上方放不下就翻到下方；左右一律夹在视口内
function place(el: Element) {
  const box = node?.getBoundingClientRect()
  if (box != null && box.width > 0) {
    const rect = el.getBoundingClientRect()
    const above = rect.top - GAP - box.height
    tooltipState.top = above >= EDGE
      ? above
      : clamp(rect.bottom + GAP, EDGE, window.innerHeight - box.height - EDGE)
    tooltipState.left = clamp(rect.left + rect.width / 2 - box.width / 2, EDGE,
      window.innerWidth - box.width - EDGE)
  }
  tooltipState.placed = true
}

function enter(el: Element, value: unknown) {
  const tip = textOf(value)
  if (tip === '') return
  // 从一处提示直接移到另一处时不再等延时，只有首次悬停才等
  if (tooltipState.visible) show(el, tip)
  else if (timer == null) {
    pending = el
    timer = setTimeout(() => { timer = null; show(el, tip) }, SHOW_DELAY)
  }
}

interface TipTarget {
  text: unknown
  onEnter: () => void
  onLeave: () => void
  onClick: () => void
  // disabled 按钮专用（见 mounted 里的注释）
  onMove?: (ev: MouseEvent) => void
  onParentLeave?: () => void
}

const targets = new WeakMap<Element, TipTarget>()

function textOf(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function inside(el: Element, ev: MouseEvent): boolean {
  const r = el.getBoundingClientRect()
  return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
}

export const vTip: ObjectDirective<Element, unknown> = {
  mounted(el, binding) {
    const target: TipTarget = {
      text: binding.value,
      onEnter: () => enter(el, target.text),
      onLeave: hide,
      onClick: hide,
    }
    targets.set(el, target)
    el.addEventListener('mouseenter', target.onEnter)
    el.addEventListener('mouseleave', target.onLeave)
    el.addEventListener('click', target.onClick)

    // Chromium 不给 disabled 的表单元素派发鼠标事件，而原生 title 以前照样弹。
    // 按钮的禁用态常和提示同时出现（「已达变体上限」这类），所以在父层按矩形代理判定；
    // 启用态仍走 el 自己的 mouseenter/mouseleave，不受影响。
    if (el instanceof HTMLButtonElement && el.parentElement != null) {
      const btn = el
      const parent = el.parentElement
      target.onMove = (ev) => {
        if (!btn.disabled) return
        if (inside(el, ev)) enter(el, target.text)
        else if (anchor === el || pending === el) hide()
      }
      target.onParentLeave = () => { if (anchor === el || pending === el) hide() }
      parent.addEventListener('mousemove', target.onMove)
      parent.addEventListener('mouseleave', target.onParentLeave)
    }
  },
  updated(el, binding) {
    const target = targets.get(el)
    if (target != null) target.text = binding.value
  },
  unmounted(el) {
    const target = targets.get(el)
    if (target != null) {
      el.removeEventListener('mouseenter', target.onEnter)
      el.removeEventListener('mouseleave', target.onLeave)
      el.removeEventListener('click', target.onClick)
      const parent = el.parentElement
      if (parent != null && target.onMove != null && target.onParentLeave != null) {
        parent.removeEventListener('mousemove', target.onMove)
        parent.removeEventListener('mouseleave', target.onParentLeave)
      }
      targets.delete(el)
    }
    if (anchor === el || pending === el) hide()
  },
}

// 滚动或缩放后锚点位置已变，直接收起：下一次悬停会重新量尺与定位
window.addEventListener('scroll', hide, true)
window.addEventListener('resize', hide)
window.addEventListener('blur', hide)
