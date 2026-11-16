<template>
  <Teleport to="body">
    <div v-if="state.visible" ref="node" class="app-tooltip" :class="{ 'is-placed': state.placed }"
      :style="{ left: `${state.left}px`, top: `${state.top}px` }">{{ state.text }}</div>
  </Teleport>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { setTooltipNode, tooltipState as state } from '../../common/tooltip'

const node = ref<HTMLElement | null>(null)
// v-if 每次显示都会重建节点，所以用 watch 而不是 onMounted 把它交给定位逻辑
watch(node, el => setTooltipNode(el))
onBeforeUnmount(() => setTooltipNode(null))
</script>

<style>
/* 气泡恒深底（与 DevTools / VS Code 的 tooltip 一致），不随明暗主题反色：
   暗色主题下浅色气泡会在深底上糊成一块高光，描边负责和同样很深的弹窗层拉开边界。
   尺寸全部走全站档位——teleport 到 body 也能读到 :root 上的 token，
   因为 ConfigProvider 的 theme-vars-scope="global" 把主题类加在 documentElement 上。 */
.app-tooltip {
  position: fixed;
  /* Vant 的浮层 z-index 从 2000 起自增，提示要叠在它们之上 */
  z-index: 10000;
  max-width: min(calc(var(--van-font-size-md) * 26), 70vw);
  /* 超长报文/JSON 只保证不占满屏，完整内容仍在详情面板里看 */
  max-height: 45vh;
  overflow: hidden;
  padding: var(--app-sp-md) calc(var(--app-sp-md) * 1.25);
  border: 1px solid rgba(255, 255, 255, 0.14);
  /* 圆角与投影和下拉弹层同款，提示不该比浮层更「方」 */
  border-radius: var(--van-radius-md);
  background: rgba(26, 26, 28, 0.94);
  color: #f2f3f5;
  font-size: var(--van-font-size-sm);
  line-height: 1.5;
  white-space: pre-wrap;
  /* 长 URL、无空格的 JSON 要能断开，否则宽度上限形同虚设 */
  overflow-wrap: anywhere;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s ease;
  box-shadow: var(--app-shadow-float);
}

.app-tooltip.is-placed {
  opacity: 1;
}
</style>
