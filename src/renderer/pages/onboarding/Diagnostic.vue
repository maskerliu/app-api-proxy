<template>
  <div class="diagnostic-page">
    <div class="diagnostic-card">
      <div class="diagnostic-head">
        <div class="head-left">
          <i class="iconfont icon-arrow-left head-icon" @click="goBack" />
          <div>
            <div class="head-title">{{ $t('diagnostic.title') }}</div>
            <div class="head-desc">{{ $t('diagnostic.desc') }}</div>
          </div>
        </div>
        <div class="head-actions">
          <van-button plain size="small" :loading="healthLoading" @click="refreshHealth">
            <template #icon>
              <van-icon class="iconfont icon-refresh" />
            </template>
            {{ $t('diagnostic.refresh') }}
          </van-button>
          <van-button plain type="primary" size="small" @click="copyReport">
            <template #icon>
              <van-icon class="iconfont icon-list" />
            </template>
            {{ $t('diagnostic.report') }}
          </van-button>
        </div>
      </div>

      <OverlayScrollbarsComponent class="diagnostic-body" :options="scrollOptions" defer>
        <van-cell-group inset>
          <van-cell :title="$t('onboarding.service.status')" :value="health?.ok ? $t('onboarding.service.running') : '--'">
            <template #icon>
              <i class="iconfont icon-check status-icon" :style="{ color: health?.ok ? '#62bc3e' : 'var(--van-gray-5)' }" />
            </template>
          </van-cell>
          <van-cell :title="$t('diagnostic.address')"
            :value="address" />
          <van-cell :title="$t('diagnostic.clients')"
            :value="health == null ? '--' : `${health.clients.viewers} / ${health.clients.devices}`"
            :label="`${$t('diagnostic.viewers')} / ${$t('diagnostic.devices')}`" />
          <van-cell :title="$t('diagnostic.activeMocks')" :value="health?.activeMockRules ?? '--'" />
          <van-cell :title="$t('diagnostic.uptime')" :value="formatDuration(health?.uptimeSec)" />
        </van-cell-group>

        <van-cell-group inset :title="$t('diagnostic.unknownUid')">
          <van-cell v-for="item in unknownRequests" :key="`${item.sessionId}-${item.at}`"
            :title="`${item.method} ${item.url}`"
            :label="`UID: ${item.uid || '(empty)'} | ${item.host || '--'} | ${formatTime(item.at)}`">
            <template #value>
              <van-tag type="danger">{{ $t('diagnostic.uidUnknown') }}</van-tag>
            </template>
          </van-cell>
          <van-cell v-if="unknownRequests.length === 0" :title="$t('diagnostic.unknownUidEmpty')" />
        </van-cell-group>

        <van-cell-group inset :title="$t('diagnostic.errors')">
          <van-cell v-for="(item, index) in recentErrors" :key="`${item.at}-${index}`" :title="item.error"
            :label="`UID: ${item.uid || '(empty)'} | ${item.url || '--'} | ${formatTime(item.at)}`" />
          <van-cell v-if="recentErrors.length === 0" :title="$t('diagnostic.errorsEmpty')" />
        </van-cell-group>

        <van-cell-group inset :title="$t('diagnostic.requests')">
          <van-cell v-for="item in recentRequests" :key="`${item.sessionId}-${item.at}`"
            :title="`${item.method} ${item.url}`"
            :label="`UID: ${item.uid || '(empty)'} | ${item.host || '--'} | ${formatTime(item.at)}`">
            <template #value>
              <van-tag v-if="item.mockHit" type="success" style="margin-right: 4px;">{{ $t('diagnostic.mockHit') }}</van-tag>
              <van-tag :type="item.uidKnown ? 'primary' : 'danger'">
                {{ item.uidKnown ? $t('diagnostic.uidKnown') : $t('diagnostic.uidUnknown') }}
              </van-tag>
            </template>
          </van-cell>
          <van-cell v-if="recentRequests.length === 0" :title="$t('diagnostic.requestsEmpty')" />
        </van-cell-group>

        <van-cell-group inset :title="$t('diagnostic.target')">
          <van-field v-model="target" :placeholder="$t('diagnostic.targetPlaceholder')" clearable
            @keyup.enter="runDiagnose">
            <template #button>
              <van-button size="small" type="primary" :loading="diagnosing" @click="runDiagnose">
                {{ diagnosing ? $t('diagnostic.diagnosing') : $t('diagnostic.start') }}
              </van-button>
            </template>
          </van-field>
        </van-cell-group>

        <div v-if="result" class="diagnose-result">
          <div class="result-head">
            <van-tag :type="result.ok ? 'success' : 'danger'">
              {{ result.ok ? $t('diagnostic.reachable') : $t('diagnostic.unreachable') }}
            </van-tag>
            <span class="result-target">{{ result.target }}</span>
          </div>
          <div v-for="step in result.steps" :key="step.step" class="result-step">
            <van-tag :type="step.ok ? 'success' : 'danger'" plain>{{ $t(`diagnostic.step.${step.step}`) }}</van-tag>
            <span class="step-ms">{{ step.ms }}ms</span>
            <span class="step-detail">{{ step.detail || (step.statusCode == null ? '' : `HTTP ${step.statusCode}`) }}</span>
          </div>
        </div>
      </OverlayScrollbarsComponent>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Diagnostic, diagnose, getHealth } from '@shared'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { showNotify } from 'vant'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { scrollOptions } from '../../common/scroll'
import { CommonStore } from '../../store'

const commonStore = CommonStore()
const router = useRouter()
const { t } = useI18n()

const health = ref<Diagnostic.HealthInfo>(null)
const healthLoading = ref(false)
const target = ref('')
const diagnosing = ref(false)
const result = ref<Diagnostic.DiagnoseResult>(null)

let pollTimer: ReturnType<typeof setInterval> = null

const address = computed(() => {
  const { protocol, ip, port } = commonStore.serverConfig ?? ({} as any)
  if (!protocol || port == null) return '--'
  return `${protocol}://${ip || '127.0.0.1'}:${port}`
})
const unknownRequests = computed(() => health.value?.unknownUidRequests ?? [])
const recentErrors = computed(() => health.value?.errors ?? [])
const recentRequests = computed(() => health.value?.recentRequests ?? [])

async function refreshHealth() {
  if (healthLoading.value) return
  healthLoading.value = true
  try {
    health.value = await getHealth()
  } catch (err) {
    // 请求层已经提示过错误
  } finally {
    healthLoading.value = false
  }
}

async function runDiagnose() {
  const value = target.value.trim()
  if (!value) {
    showNotify({ message: t('diagnostic.emptyTarget'), type: 'warning', duration: 1000 })
    return
  }
  diagnosing.value = true
  try {
    result.value = await diagnose(value)
  } catch (err) {
    result.value = null
  } finally {
    diagnosing.value = false
  }
}

function maskUid(uid?: string) {
  if (!uid) return '(empty)'
  if (uid.length <= 6) return `${uid.slice(0, 2)}***`
  return `${uid.slice(0, 4)}***${uid.slice(-2)}`
}

function formatDuration(seconds?: number) {
  const total = Math.max(0, Math.floor(seconds ?? 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${total % 60}s`
  return `${total}s`
}

function formatTime(at?: number) {
  if (at == null) return '--'
  const date = new Date(at)
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
}

function buildReport() {
  const info = health.value
  return {
    generatedAt: new Date().toISOString(),
    app: {
      version: info?.version,
      protocol: info?.protocol ?? commonStore.serverConfig?.protocol,
      ip: info?.ip ?? commonStore.serverConfig?.ip,
      port: info?.port ?? commonStore.serverConfig?.port,
      uptimeSec: info?.uptimeSec,
    },
    clients: info?.clients,
    activeMockRules: info?.activeMockRules,
    unknownUidRequests: (info?.unknownUidRequests ?? []).map(it => ({ ...it, uid: maskUid(it.uid) })),
    recentRequests: (info?.recentRequests ?? []).map(it => ({ ...it, uid: maskUid(it.uid) })),
    errors: (info?.errors ?? []).map(it => ({ ...it, uid: maskUid(it.uid) })),
    diagnose: result.value,
  }
}

async function copyReport() {
  const text = JSON.stringify(buildReport(), null, 2)
  try {
    if (window.mainApi) await window.mainApi.writeClipboard(text)
    else await navigator.clipboard.writeText(text)
    showNotify({ message: t('diagnostic.reportCopied'), type: 'success', duration: 1000 })
  } catch (err) {
    showNotify({ message: t('diagnostic.reportFailed'), type: 'danger', duration: 1200 })
  }
}

function goBack() {
  router.replace('/proxy')
}

onMounted(async () => {
  await refreshHealth()
  pollTimer = setInterval(refreshHealth, 3000)
})

onBeforeUnmount(() => {
  if (pollTimer != null) clearInterval(pollTimer)
  pollTimer = null
})
</script>

<style scoped>
.diagnostic-page {
  width: 100%;
  height: 100%;
  padding: 24px;
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  overflow: hidden;
  background-color: var(--van-gray-1);
}

.diagnostic-card {
  width: min(900px, 94vw);
  min-width: min(360px, 100%);
  box-sizing: border-box;
  height: 100%;
  max-height: 720px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 18px 20px;
  border-radius: 12px;
  background-color: var(--van-background-2);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

.diagnostic-body {
  flex: 1 1 auto;
  min-height: 0;
  padding-right: 4px;
}

.diagnostic-head {
  flex: none;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}

.head-left {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.head-icon {
  margin-top: 4px;
  font-size: 18px;
  cursor: pointer;
}

.status-icon {
  margin-right: 6px;
  font-size: 16px;
}

.head-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}

.head-title {
  font-size: 18px;
  font-weight: 600;
}

.head-desc {
  margin-top: 4px;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.diagnose-result {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background-color: var(--van-gray-2);
}

.result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.result-target {
  font-family: Consolas, Monaco, monospace;
  font-size: var(--van-font-size-sm);
  word-break: break-all;
}

.result-step {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  font-size: var(--van-font-size-sm);
}

.step-ms {
  color: var(--van-text-color-3);
  min-width: 52px;
}

.step-detail {
  color: var(--van-text-color-2);
  word-break: break-all;
}
</style>
