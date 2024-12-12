<template>
  <section>
    <OverlayScrollbarsComponent v-if="overlayScrollbarsApplied" class="overlayscrollbars-vue" ref="osRef"
      :style="{ display: elementHidden ? 'none' : undefined }" :options="{
        scrollbars: {
          theme: 'os-theme-light',
        },
      }" :events="{
        initialized: () => activateEvent('initialized'),
        destroyed: () => activateEvent('destroyed'),
        updated: () => activateEvent('updated'),
        scroll: () => activateEvent('scroll'),
      }" defer>
      <div v-if="!contentHidden" class="logo">
        <img alt="Vue logo" src="logo.svg" />
      </div>
    </OverlayScrollbarsComponent>
  </section>
</template>
<script setup lang="ts">
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-vue'
import { OverlayScrollbarsComponent, useOverlayScrollbars } from 'overlayscrollbars-vue'
import { onMounted, ref } from 'vue'
import { useEventObserver } from './useEventObserver'

const contentHidden = ref(false)
const elementHidden = ref(false)
const overlayScrollbarsApplied = ref(true)
const bodyOverlayScrollbarsApplied = ref<boolean | null>(null)
const osRef = ref<OverlayScrollbarsComponentRef | null>(null)
const [activeEvents, activateEvent] = useEventObserver()
const [initBodyOverlayScrollbars, getBodyOverlayScrollbarsInstance] = useOverlayScrollbars({
  defer: true,
  events: {
    initialized: () => {
      bodyOverlayScrollbarsApplied.value = true
    },
    destroyed: () => {
      bodyOverlayScrollbarsApplied.value = false
    },
  },
  options: {
    scrollbars: {
      theme: 'os-theme-light',
      clickScroll: true,
    },
  },
})

onMounted(() => initBodyOverlayScrollbars(document.body))
</script>

<style scoped>
img {
  width: 100%;
  height: 100%;
}

.overlayscrollbars-vue {
  width: 16rem;
  height: 16rem;
  margin: 0 auto;
  resize: both;
  overflow: auto;
  border-radius: 6px;
  border: 2px solid var(--foreground-color);
  box-shadow: rgb(var(--foreground-color-rgb) / 0.14) 0 0.875rem 3.125rem;
}

.logo {
  width: 32rem;
  height: 32rem;
  padding: 1rem;
  display: block;
  pointer-events: none;
  user-select: none;
  backdrop-filter: brightness(88%) contrast(1.012);
  margin: 0 auto;
}
</style>