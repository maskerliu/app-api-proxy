<template>
  <section class="miss-panel">
    <header class="miss-head">
      <div class="miss-title">
        <van-icon name="warning-o" class="miss-icon" />
        <span v-if="miss.recordName">{{ $t('mock.miss.title', {
          record: miss.recordName, score: scorePercent
        }) }}</span>
        <span v-else>{{ $t('mock.miss.noCandidate') }}</span>
      </div>
      <van-button size="mini" plain icon="description" :title="$t('mock.miss.copy')" @click="copyDiagnosis" />
    </header>

    <div v-if="degraded" class="miss-degraded">{{ $t('mock.miss.degraded') }}</div>

    <div v-if="miss.failures?.length > 0" class="miss-table">
      <div class="miss-row miss-row-head">
        <span>{{ $t('mock.miss.dimension') }}</span>
        <span>{{ $t('mock.miss.expected') }}</span>
        <span>{{ $t('mock.miss.actual') }}</span>
        <span>{{ $t('mock.miss.action') }}</span>
      </div>
      <div v-for="(failure, idx) in miss.failures" :key="idx" class="miss-row">
        <span class="miss-dimension">{{ dimensionText(failure.dimension) }}</span>
        <span class="miss-value" :title="failure.expected">{{ failure.expected }}</span>
        <span class="miss-value" :title="failure.actual">{{ failure.actual }}</span>
        <span class="miss-action">
          <van-button v-if="failure.key" size="mini" plain type="primary" @click="emit('ignore-key', failure)">
            {{ $t('mock.miss.ignoreKey') }}
          </van-button>
          <van-button v-else-if="failure.detail === 'extraKeys'" size="mini" plain type="warning"
            @click="emit('loosen')">
            {{ $t('mock.miss.loosen') }}
          </van-button>
          <span v-else class="miss-detail">{{ failure.detail ? detailText(failure.detail) : '' }}</span>
        </span>
      </div>
    </div>

    <footer class="miss-actions">
      <van-button size="mini" plain type="primary" @click="emit('edit')">{{ $t('mock.miss.editRecord') }}</van-button>
      <van-button size="mini" plain @click="emit('loosen')">{{ $t('mock.miss.loosen') }}</van-button>
      <van-button size="mini" plain @click="copyDiagnosis">{{ $t('mock.miss.copy') }}</van-button>
    </footer>
  </section>
</template>

<script lang="ts" setup>
import type { MockMissDiagnostic, MockMissFailure } from '@shared/mock.models'
import { showNotify } from 'vant'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { copyToClipboard } from '../../common/clipboard'

const props = defineProps<{
  miss: MockMissDiagnostic
  degraded?: boolean
}>()
const emit = defineEmits<{
  'ignore-key': [failure: MockMissFailure]
  loosen: []
  edit: []
}>()
const { t } = useI18n()

const miss = computed(() => props.miss)
const scorePercent = computed(() => Math.round((Number(props.miss?.score) || 0) * 100))

function dimensionText(dimension: string): string {
  return t(`mock.miss.dim.${dimension}`)
}

function detailText(detail: string): string {
  const known = ['conditionMismatch', 'extraKeys']
  return known.indexOf(detail) >= 0 ? t(`mock.miss.detail.${detail}`) : detail
}

async function copyDiagnosis() {
  const text = buildMarkdown()
  try {
    await copyToClipboard(text)
    showNotify({ message: t('mock.miss.copied'), type: 'success', duration: 800 })
  } catch (err) {
    showNotify({ message: t('mock.miss.copyFailed'), type: 'warning', duration: 1200 })
  }
}

// 复制为可读 Markdown；服务端诊断已脱敏，这里不再还原任何值
function buildMarkdown(): string {
  const lines: string[] = []
  lines.push(`### ${t('mock.miss.title', {
    record: miss.value?.recordName ?? '', score: scorePercent.value
  })}`)
  if (props.degraded) lines.push(`> ${t('mock.miss.degraded')}`)
  if (miss.value?.failures?.length > 0) {
    lines.push('')
    lines.push(`| ${t('mock.miss.dimension')} | ${t('mock.miss.expected')} | ${t('mock.miss.actual')} |`)
    lines.push('| --- | --- | --- |')
    for (const failure of miss.value.failures) {
      lines.push(`| ${dimensionText(failure.dimension)} | ${failure.expected} | ${failure.actual} |`)
    }
  }
  return lines.join('\n')
}
</script>

<style scoped>
.miss-panel {
  --sp-lg: calc(var(--van-font-size-md) * 0.6154);
  --sp-md: calc(var(--van-font-size-md) * 0.4615);
  --sp-sm: calc(var(--van-font-size-md) * 0.3077);
  --sp-xs: calc(var(--van-font-size-md) * 0.1538);
  padding: var(--sp-lg);
  border: 1px solid var(--van-warning-color);
  border-radius: var(--van-radius-lg);
  background: color-mix(in srgb, var(--van-warning-color) 8%, transparent);
}

.miss-head {
  display: flex;
  align-items: center;
  gap: var(--sp-lg);
}

.miss-title {
  display: flex;
  align-items: center;
  gap: var(--sp-md);
  flex: 1 1 auto;
  min-width: 0;
  color: var(--van-warning-color);
  font-size: var(--van-font-size-md);
}

.miss-icon {
  flex: none;
}

.miss-degraded {
  margin-top: var(--sp-md);
  padding: var(--sp-sm) var(--sp-lg);
  border-radius: var(--van-radius-md);
  background: color-mix(in srgb, var(--van-warning-color) 16%, transparent);
  color: var(--van-warning-color);
  font-size: var(--van-font-size-sm);
}

.miss-table {
  margin-top: var(--sp-lg);
  display: flex;
  flex-direction: column;
  gap: var(--sp-xs);
}

.miss-row {
  display: grid;
  grid-template-columns: calc(var(--van-font-size-md) * 4.923) minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 0.9fr);
  align-items: center;
  gap: var(--sp-md);
  padding: var(--sp-sm) var(--sp-md);
  border-radius: var(--van-radius-md);
  background: var(--van-background-2);
  font-size: var(--van-font-size-sm);
}

.miss-row-head {
  background: transparent;
  color: var(--van-text-color-3);
}

.miss-dimension {
  color: var(--van-text-color-2);
}

.miss-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono-font);
  word-break: break-all;
}

.miss-action {
  display: flex;
  align-items: center;
  min-width: 0;
}

.miss-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--van-text-color-3);
}

.miss-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--sp-md);
  margin-top: var(--sp-lg);
}
</style>