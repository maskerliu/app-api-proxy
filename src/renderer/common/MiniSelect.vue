<template>
  <div ref="rootRef" class="mini-select"
    :class="[`mini-select--font-${fontSize}`, { 'is-disabled': disabled, 'mini-select--up': opensUp }]"
    @pointerdown="prepareDirection">
    <van-dropdown-menu :overlay="false" :duration="0.15" :direction="opensUp ? 'up' : 'down'">
      <van-dropdown-item :model-value="modelValue" :options="columns" :disabled="disabled"
        :title="selectedText == null ? placeholder : undefined" class="mini-select-popup"
        :class="`mini-select-popup--font-${fontSize}`" teleport="body" :data-mini-select="popupId" @change="onChange"
        @open="alignPopup" @opened="onOpened" @close="onClosing" />
    </van-dropdown-menu>
  </div>
</template>

<script lang="ts" setup>
import { computed, nextTick, ref, useId } from 'vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  options?: Array<{ label: string; value: string }>
  placeholder?: string
  disabled?: boolean
  // 弹层选项的间距档位；选中值字号始终跟随所在行
  fontSize?: 'sm' | 'md'
}>(), {
  modelValue: '',
  options: () => [],
  placeholder: '',
  disabled: false,
  fontSize: 'sm',
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
}>()

const rootRef = ref<HTMLElement>()
const popupId = useId()
// 弹层朝上弹时要把 Vant 的 direction 切到 up：Vant 的滑入动画与裁剪边都跟着 direction 走
const opensUp = ref(false)
const measuredHeight = ref(0)
const columns = computed(() => (props.options ?? []).map(it => ({ text: it.label, value: it.value })))
const selectedText = computed(() => props.options.find(it => it.value === props.modelValue)?.label ?? null)

function baseFontSize(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--van-font-size-md')) || 13
}

function barRect(): DOMRect | null {
  const bar = rootRef.value?.querySelector('.van-dropdown-menu__bar') as HTMLElement | null
  return bar == null ? null : bar.getBoundingClientRect()
}

// 方向必须在展开前定好（展开后再切 direction 会让滑入动画翻转），
// 首次打开用选项行高估算，之后沿用上次量到的内容高度
function prepareDirection() {
  const rect = barRect()
  if (rect == null) return
  // 展开中不再改方向：Vant 只在展开时缓存锚点，收起前切方向会让弹层跳位
  const popup = popupEl()
  if (popup != null && popup.offsetHeight > 0) return
  const spaceBelow = window.innerHeight - rect.bottom - 8
  const spaceAbove = rect.top - 8
  const estimated = measuredHeight.value || columns.value.length * baseFontSize() * 2.8
  opensUp.value = estimated > spaceBelow && spaceAbove > spaceBelow
}

function onChange(value: string) {
  emit('update:modelValue', value)
  emit('change', value)
}

function popupEl() {
  return document.querySelector(`.van-dropdown-item[data-mini-select="${popupId}"]`) as HTMLElement | null
}

// 弹层被 teleport 到 body：Vant 按 direction 负责纵向定位与滑入裁剪，
// 这里只对齐触发条的横向位置，并把高度限制在可用空间内
async function alignPopup() {
  // 打开事件先于懒渲染的列表挂载，等一帧再量尺寸
  await nextTick()
  const root = rootRef.value
  const rect = barRect()
  const popup = popupEl()
  if (root == null || rect == null || popup == null) return

  const content = popup.querySelector('.van-dropdown-item__content') as HTMLElement | null
  // 弹层被 teleport 到 body，把触发条实际字号带过去，选中值与选项字号才一致
  const title = root.querySelector('.van-dropdown-menu__title') as HTMLElement | null
  if (title != null) popup.style.setProperty('--mini-select-font-size', getComputedStyle(title).fontSize)
  if (content != null) content.style.maxHeight = ''
  const contentHeight = content?.scrollHeight ?? 0
  if (contentHeight > 0) measuredHeight.value = contentHeight

  // 选项文案可能比触发条宽，先按内容自然宽度量一次，避免换行
  let naturalWidth = 0
  if (content != null) {
    content.style.width = 'max-content'
    naturalWidth = Math.ceil(content.getBoundingClientRect().width)
    content.style.width = ''
  }

  const minWidth = baseFontSize() * 9.2
  const width = Math.min(Math.max(rect.width, naturalWidth, minWidth), window.innerWidth - 8)
  popup.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - width - 4))}px`
  popup.style.right = 'auto'
  popup.style.width = `${width}px`
  // 开合动画期间保持裁剪，滑入/滑出才不会飘到触发条外侧
  popup.style.overflow = 'hidden'
  popup.style.zIndex = `${Math.max(2000, stackingZ(root) + 1)}`
  anchorPopup(popup)

  const spaceBelow = window.innerHeight - rect.bottom - 8
  const spaceAbove = rect.top - 8
  if (content != null) {
    const fs = baseFontSize()
    const height = opensUp.value
      ? Math.min(contentHeight || spaceAbove, spaceAbove)
      : Math.min(contentHeight || fs * 24.615, Math.max(fs * 7.385, spaceBelow))
    content.style.maxHeight = `${height}px`
  }
}

// Vant 展开时按当时的 direction 缓存锚点，方向刚切换过可能拿到反向偏移，
// 这里按触发条重新锚定，避免弹层跳到视口外
function anchorPopup(popup: HTMLElement) {
  const rect = barRect()
  if (rect == null) return
  if (opensUp.value) {
    popup.style.top = ''
    popup.style.bottom = `${window.innerHeight - rect.top}px`
  } else {
    popup.style.top = `${rect.bottom}px`
    popup.style.bottom = ''
  }
}

// 动画结束后再放开裁剪，让描边和阴影完整显示
function onOpened() {
  const popup = popupEl()
  if (popup != null) popup.style.overflow = 'visible'
}

function onClosing() {
  const popup = popupEl()
  if (popup != null) popup.style.overflow = 'hidden'
}

// teleport 后脱离原弹窗的层叠上下文，需要接着弹窗的 z-index 往上叠
function stackingZ(el: HTMLElement) {
  let z = 1
  for (let node: HTMLElement | null = el; node != null; node = node.parentElement) {
    const value = Number(getComputedStyle(node).zIndex)
    if (Number.isFinite(value) && value > z) z = value
  }
  return z
}
</script>

<style scoped>
.mini-select {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

.mini-select :deep(.van-dropdown-menu) {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
}

.mini-select :deep(.van-dropdown-menu__bar) {
  /* 使用方可按字号覆盖触发条高度，默认保持紧凑的 28px */
  height: var(--mini-select-bar-height, calc(var(--van-font-size-md) * 2.2));
  background: var(--van-background-2);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
  box-shadow: none;
  box-sizing: border-box;
}

.mini-select :deep(.van-dropdown-menu__item) {
  padding: 0 calc(var(--van-font-size-md) * 0.3);
}

.mini-select :deep(.van-dropdown-menu__title) {
  max-width: 100%;
  padding: 0 calc(var(--van-font-size-md) * 1.2) 0 calc(var(--van-font-size-md) * 0.3);
  /* 选中值跟随所在行的字号，不再单独定格 */
  font-size: inherit;
  line-height: calc(var(--van-font-size-md) * 1.5);
}

.mini-select :deep(.van-dropdown-menu__title::after) {
  right: calc(var(--van-font-size-md) * 0.3);
}

/* md 档用于表单内，行高随字号缩放，避免大字号下文字被 20px 行高卡住 */
.mini-select--font-md :deep(.van-dropdown-menu__title) {
  line-height: calc(var(--van-font-size-md) * 1.5);
}

/* 向上弹时 Vant 的展开/收起箭头语义是反的，这里还原成收起向下、展开向上 */
.mini-select--up :deep(.van-dropdown-menu__title--down)::after {
  margin-top: calc(var(--van-font-size-md) * -0.4);
  transform: rotate(-45deg);
}

.mini-select--up :deep(.van-dropdown-menu__title--active)::after {
  margin-top: calc(var(--van-font-size-md) * -0.1);
  transform: rotate(135deg);
}

.mini-select.is-disabled {
  opacity: 0.55;
}

/* 弹层被 teleport 到 body，字号通过自定义属性从 item 根节点继承 */
:global(.mini-select-popup--font-md) {
  --mini-select-font-size: var(--van-font-size-md);
}

:global(.mini-select-popup .van-dropdown-item__content) {
  overflow: hidden;
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
  background: var(--van-background-2);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.16);
}

:global(.mini-select-popup .van-dropdown-item__option) {
  padding: calc(var(--van-font-size-md) * 0.5) calc(var(--van-font-size-md) * 0.8);
}

/* md 档弹层的选项行高与内边距随字号缩放：md 13px 时仍是 36px 行高 */
:global(.mini-select-popup--font-md .van-dropdown-item__option) {
  padding: calc(var(--van-font-size-md) * 0.5) calc(var(--van-font-size-md) * 0.8);
  line-height: calc(var(--van-font-size-md) * 1.8);
}

:global(.mini-select-popup .van-dropdown-item__option .van-cell__title) {
  flex: 1 1 auto;
  font-size: var(--mini-select-font-size, var(--van-font-size-sm));
}
</style>
