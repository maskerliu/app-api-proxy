<template>
  <div class="onboarding-page">
    <div class="onboarding-card">
      <div class="onboarding-head">
        <div class="onboarding-title">
          <i class="iconfont icon-link onboarding-logo" />
          <span>{{ $t('onboarding.title') }}</span>
        </div>
        <div class="onboarding-subtitle">{{ $t('onboarding.subtitle') }}</div>
        <van-steps :active="step" active-color="var(--van-success-color)" inactive-color="var(--van-gray-5)">
          <van-step>{{ $t('onboarding.step.service') }}</van-step>
          <van-step>{{ $t('onboarding.step.client') }}</van-step>
          <van-step>{{ $t('onboarding.step.verify') }}</van-step>
          <van-step>{{ $t('onboarding.step.mock') }}</van-step>
        </van-steps>
      </div>

      <OverlayScrollbarsComponent class="onboarding-body" :options="scrollOptions" defer>
        <!-- 1. 服务就绪 -->
        <div v-if="step === 0" class="step-panel">
          <div class="step-head">
            <i class="iconfont icon-check step-icon" :style="{ color: health?.ok ? 'var(--van-success-color)' : 'var(--van-gray-5)' }" />
            <span>{{ $t('onboarding.service.title') }}</span>
          </div>
          <div class="step-desc">{{ $t('onboarding.service.desc') }}</div>
          <van-cell-group inset>
            <van-cell :title="$t('onboarding.service.status')"
              :value="health?.ok ? $t('onboarding.service.running') : '--'" />
            <van-cell :title="$t('onboarding.service.protocol')" :value="config.protocol || '--'" />
            <van-cell :title="$t('onboarding.service.ip')" :value="config.ip || '--'" />
            <van-cell :title="$t('onboarding.service.port')" :value="config.port == null ? '--' : `${config.port}`" />
            <van-cell :title="$t('onboarding.service.uptime')" :value="formatDuration(health?.uptimeSec)" />
          </van-cell-group>
          <van-notice-bar v-if="config.portValid === false" wrapable :scrollable="false"
            color="var(--van-warning-color)" background="color-mix(in srgb, var(--van-warning-color) 10%, transparent)" :text="$t('onboarding.service.portInvalid')">
            <template #left-icon>
              <i class="iconfont icon-warning notice-icon" />
            </template>
          </van-notice-bar>
          <div class="step-actions">
            <van-button plain type="primary" size="small" :loading="healthLoading" @click="refreshHealth(true)">
              {{ $t('onboarding.service.refresh') }}
            </van-button>
            <van-button plain size="small" :disabled="!proxyBaseUrl"
              @click="copyText(proxyBaseUrl, $t('onboarding.service.copied'))">
              {{ $t('onboarding.service.copy') }}
            </van-button>
          </div>
          <div class="proxy-address">{{ proxyBaseUrl || '--' }}</div>
        </div>

        <!-- 2. 接入客户端 -->
        <div v-else-if="step === 1" class="step-panel client-step">
          <div class="step-head">
            <i class="iconfont icon-qrcode step-icon" style="color: var(--van-primary-color)" />
            <span>{{ $t('onboarding.client.title') }}</span>
          </div>
          <div class="step-desc">{{ $t('onboarding.client.desc') }}</div>

          <div class="client-grid">
            <div class="client-col qr-col">
              <div class="col-title">{{ $t('onboarding.client.qrcode') }}</div>
              <qrcode-vue v-if="commonStore.registerUrl" :value="commonStore.registerUrl" :size="180" :margin="1"
                level="Q" gradient gradient-type="linear" gradient-start-color="#4338ca"
                gradient-end-color="#0f766e" />
              <div class="register-url" @click="copyText(commonStore.registerUrl, $t('common.copy'))">
                {{ commonStore.registerUrl || $t('onboarding.client.waitingUid') }}
              </div>
            </div>

            <div class="client-col">
              <van-field v-model="targetHost" :label="$t('onboarding.client.targetHost')" label-width="110"
                :placeholder="$t('onboarding.client.targetHostPlaceholder')" clearable />
              <div class="col-title">{{ $t('onboarding.client.snippet') }}</div>
              <van-radio-group v-model="snippetIndex" direction="horizontal" class="snippet-tabs">
                <van-radio v-for="(item, idx) in snippets" :key="item.lang" :name="idx">{{ item.label }}</van-radio>
              </van-radio-group>
              <div class="snippet">
                <SnippetAce :mode="activeSnippet.mode" :code="activeSnippet.code" />
              </div>
              <van-button plain type="primary" size="mini" class="copy-btn"
                @click="copyText(activeSnippet.code, $t('onboarding.client.snippetCopied'))">
                {{ $t('onboarding.client.copySnippet') }}
              </van-button>
            </div>
          </div>

          <van-notice-bar wrapable :scrollable="false" :text="$t('onboarding.client.note')">
            <template #left-icon>
              <i class="iconfont icon-info notice-icon" />
            </template>
          </van-notice-bar>
        </div>

        <!-- 3. 连接验证 -->
        <div v-else-if="step === 2" class="step-panel">
          <div class="step-head">
            <i class="iconfont step-icon" :class="received ? 'icon-check' : 'icon-refresh'"
              :style="{ color: received ? 'var(--van-success-color)' : 'var(--van-gray-5)' }" />
            <span>{{ $t('onboarding.verify.title') }}</span>
            <van-loading v-if="!received" size="14" style="margin-left: 6px;" />
          </div>
          <div class="step-desc">{{ $t('onboarding.verify.desc') }}</div>

          <van-notice-bar v-if="latestRequest" wrapable :scrollable="false"
            color="var(--van-success-color)" background="color-mix(in srgb, var(--van-success-color) 8%, transparent)" :text="$t('onboarding.verify.received')">
            <template #left-icon>
              <i class="iconfont icon-check notice-icon" />
            </template>
          </van-notice-bar>
          <div v-if="latestRequest" class="latest-request">
            <div class="latest-line">
              <van-tag type="success">{{ latestRequest.method }}</van-tag>
              <span class="latest-url">{{ latestRequest.url }}</span>
            </div>
            <div class="latest-meta">
              <span>{{ latestRequest.host || '--' }}</span>
              <span>UID: {{ latestRequest.uid || '(empty)' }}</span>
              <van-tag :type="latestRequest.uidKnown ? 'primary' : 'danger'">
                {{ latestRequest.uidKnown ? $t('diagnostic.uidKnown') : $t('diagnostic.uidUnknown') }}
              </van-tag>
            </div>
          </div>
          <van-empty v-else image="search" :description="$t('onboarding.verify.empty')" />

          <van-notice-bar v-if="unknownRequests.length > 0" wrapable :scrollable="false"
            color="var(--van-warning-color)" background="color-mix(in srgb, var(--van-warning-color) 10%, transparent)" :text="$t('onboarding.verify.unknownUidTip')">
            <template #left-icon>
              <i class="iconfont icon-warning notice-icon" />
            </template>
          </van-notice-bar>
          <van-cell-group v-if="unknownRequests.length > 0" inset>
            <van-cell :title="$t('onboarding.verify.unknownUid')" :label="unknownUidList" />
            <van-cell :title="$t('onboarding.verify.currentUid')" :value="commonStore.uid || '--'"
              is-link @click="copyText(commonStore.uid, $t('onboarding.verify.uidCopied'))" />
          </van-cell-group>

          <div class="step-actions">
            <van-button plain type="primary" size="small" :loading="healthLoading" @click="refreshHealth(true)">
              {{ $t('onboarding.verify.refresh') }}
            </van-button>
            <span v-if="!received" class="poll-tip">{{ $t('onboarding.verify.waiting') }}</span>
          </div>
        </div>

        <!-- 4. 第一条 Mock -->
        <div v-else class="step-panel">
          <div class="step-head">
            <i class="iconfont step-icon" :class="mockHit ? 'icon-check' : 'icon-mock'"
              :style="{ color: mockHit ? 'var(--van-success-color)' : 'var(--van-primary-color)' }" />
            <span>{{ $t('onboarding.mock.title') }}</span>
          </div>
          <div class="step-desc">{{ $t('onboarding.mock.desc') }}</div>

          <van-cell-group inset>
            <van-field v-model="ruleName" :label="$t('onboarding.mock.ruleName')" label-width="90" :disabled="mockCreated" />
            <van-field v-model="mockPath" :label="$t('onboarding.mock.path')" label-width="90"
              placeholder="/api/demo" :disabled="mockCreated" />
          </van-cell-group>
          <div class="body-label">{{ $t('onboarding.mock.body') }}</div>
          <textarea v-model="responseBody" class="json-editor" spellcheck="false" :disabled="mockCreated"></textarea>

          <div class="step-actions">
            <van-button type="primary" size="small" :loading="creating" :disabled="mockCreated" @click="createMock">
              {{ creating ? $t('onboarding.mock.creating') : $t('onboarding.mock.create') }}
            </van-button>
            <van-button v-if="latestRequest && !mockCreated" plain size="small" @click="useLatestRequest">
              {{ $t('onboarding.mock.useLatest') }}
            </van-button>
            <van-tag v-if="mockCreated" type="success">{{ $t('onboarding.mock.created') }}</van-tag>
          </div>

          <template v-if="mockCreated">
            <van-notice-bar v-if="mockHit" wrapable :scrollable="false"
              color="var(--van-success-color)" background="color-mix(in srgb, var(--van-success-color) 8%, transparent)" :text="$t('onboarding.mock.hit')">
              <template #left-icon>
                <i class="iconfont icon-check notice-icon" />
              </template>
            </van-notice-bar>
            <van-notice-bar v-else wrapable :scrollable="false"
              color="var(--van-primary-color)" background="color-mix(in srgb, var(--van-primary-color) 8%, transparent)" :text="$t('onboarding.mock.testing')">
              <template #left-icon>
                <i class="iconfont icon-refresh notice-icon" />
              </template>
            </van-notice-bar>

            <div class="body-label">{{ $t('onboarding.mock.curlTip') }}</div>
            <pre class="snippet">{{ mockCurl }}</pre>
            <van-button plain type="primary" size="mini" @click="copyText(mockCurl, $t('onboarding.client.snippetCopied'))">
              {{ $t('common.copy') }}
            </van-button>
          </template>
        </div>
      </OverlayScrollbarsComponent>

      <div class="onboarding-foot">
        <van-button plain size="small" @click="finish">{{ $t('onboarding.skip') }}</van-button>
        <div class="foot-right">
          <van-button v-if="step > 0" plain size="small" style="margin-right: 10px;" @click="step--">
            {{ $t('onboarding.prev') }}
          </van-button>
          <van-button v-if="step < 3" type="primary" size="small" @click="step++">
            {{ $t('onboarding.next') }}
          </van-button>
          <van-button v-else type="primary" size="small" @click="finish">
            {{ $t('onboarding.finish') }}
          </van-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Diagnostic, ProxyMock, getHealth, saveMockRecord, saveMockRule } from '@shared'
import { API_URL } from '@shared/api.const'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import QrcodeVue from 'qrcode.vue'
import { showNotify } from 'vant'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { scrollOptions } from '../../common/scroll'
import { formatDuration } from '../../common/format'
import { copyToClipboard } from '../../common/clipboard'
import { CommonStore } from '../../store'
import SnippetAce from './SnippetAce.vue'
import { buildSnippets } from './snippets'

const commonStore = CommonStore()
const router = useRouter()
const { t } = useI18n()

const step = ref(0)
const health = ref<Diagnostic.HealthInfo>(null)
const healthLoading = ref(false)
const targetHost = ref('https://api.example.com')
const snippetIndex = ref(0)
const ruleName = ref('接入向导示例')
const mockPath = ref('/api/demo')
const responseBody = ref(JSON.stringify({ code: 0, message: 'hello from AppApiProxy', data: { uid: 'demo' } }, null, 2))
const creating = ref(false)
const mockCreated = ref(false)

let pollTimer: ReturnType<typeof setInterval> = null

const config = computed(() => commonStore.serverConfig ?? ({} as any))
const proxyBaseUrl = computed(() => {
  const { protocol, ip, port } = config.value
  if (!protocol || port == null) return ''
  return `${protocol}://${ip || '127.0.0.1'}:${port}${API_URL.Proxy}`
})
const snippets = computed(() => buildSnippets({
  proxyUrl: proxyBaseUrl.value,
  targetHost: targetHost.value,
  uid: commonStore.uid,
  path: mockPath.value || '/',
}))
const activeSnippet = computed(() => snippets.value[Math.min(snippetIndex.value, snippets.value.length - 1)])
const latestRequest = computed(() => health.value?.recentRequests?.[0] ?? null)
const unknownRequests = computed(() => health.value?.unknownUidRequests ?? [])
const unknownUidList = computed(() => unknownRequests.value
  .slice(0, 3)
  .map(it => `${it.method} ${it.url} (${it.uid || 'empty'})`)
  .join(' / '))
const received = computed(() => (health.value?.recentRequests?.length ?? 0) > 0)
const mockHit = computed(() => mockCreated.value
  && (health.value?.recentRequests ?? []).some(it => it.mockHit))
const mockCurl = computed(() => buildSnippets({
  proxyUrl: proxyBaseUrl.value,
  targetHost: targetHost.value,
  uid: commonStore.uid,
  path: mockPath.value || '/',
})[0].code)

const REFRESH_MIN_MS = 500
let healthInFlight = false

// manual 为 false 时静默刷新（轮询），避免按钮 loading 每 2 秒闪一下
async function refreshHealth(manual = false) {
  if (healthInFlight) return
  healthInFlight = true
  if (manual) healthLoading.value = true
  const startedAt = Date.now()
  try {
    health.value = await getHealth()
  } catch (err) {
    // 请求层已经提示过错误
  } finally {
    if (manual) {
      // 本地请求通常几毫秒就返回，保证 loading 有最短可见时长，避免闪烁
      const remain = REFRESH_MIN_MS - (Date.now() - startedAt)
      if (remain > 0) await new Promise(resolve => setTimeout(resolve, remain))
      healthLoading.value = false
    }
    healthInFlight = false
  }
}

async function copyText(text: string, message: string) {
  if (!text) return
  try {
    await copyToClipboard(text)
    showNotify({ message, type: 'success', duration: 800 })
  } catch (err) {
    showNotify({ message: t('common.copyFailed'), type: 'danger', duration: 1200 })
  }
}

function useLatestRequest() {
  const request = latestRequest.value
  if (request == null) return
  mockPath.value = request.url
}

async function createMock() {  let parsed: any
  try {
    parsed = JSON.parse(responseBody.value)
  } catch (err) {
    showNotify({ message: t('onboarding.mock.invalidJson'), type: 'warning', duration: 1200 })
    return
  }
  const path = mockPath.value.trim()
  if (!path.startsWith('/')) {
    showNotify({ message: t('onboarding.mock.invalidPath'), type: 'warning', duration: 1000 })
    return
  }

  creating.value = true
  try {
    const rule = new ProxyMock.MockRule()
    rule.name = ruleName.value.trim() || 'onboarding'
    rule.desc = 'created by onboarding'
    rule.isMock = true
    const ruleId = await saveMockRule(rule)
    if (!ruleId) throw new Error('missing rule id')

    const record: ProxyMock.MockRecord = {
      id: null,
      ruleId,
      name: `GET ${path}`,
      url: path,
      response: {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed, null, 2),
        bodyType: 'json',
        delayMs: 0,
      },
      variants: [],
      activeVariantId: null,
      createdAt: 0,
      updatedAt: 0,
    }
    await saveMockRecord(record)
    mockCreated.value = true
    showNotify({ message: t('onboarding.mock.created'), type: 'success', duration: 1000 })
    await refreshHealth()
  } catch (err) {
    showNotify({ message: t('onboarding.mock.createFailed'), type: 'danger', duration: 1200 })
  } finally {
    creating.value = false
  }
}

async function finish() {
  await commonStore.markOnboarded()
  router.replace('/proxy')
}

onMounted(async () => {
  await refreshHealth()
  pollTimer = setInterval(() => refreshHealth(), 2000)
})

onBeforeUnmount(() => {
  if (pollTimer != null) clearInterval(pollTimer)
  pollTimer = null
})
</script>

<style scoped>
.onboarding-page {
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

.onboarding-card {
  width: min(900px, 94vw);
  min-width: min(360px, 100%);
  box-sizing: border-box;
  height: 100%;
  max-height: 720px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 18px 22px 14px;
  border-radius: 12px;
  background-color: var(--van-background-2);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

.onboarding-head {
  flex: none;
  margin-bottom: 12px;
}

.onboarding-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
}

.onboarding-logo {
  font-size: 22px;
  color: var(--van-primary-color);
}

.onboarding-subtitle {
  margin: 6px 0 10px;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.onboarding-body {
  flex: 1 1 auto;
  min-height: 0;
  padding-right: 4px;
}

/* 视口默认按内容撑高，保持步骤面板按滚动区高度铺满的原有布局 */
.onboarding-body :deep([data-overlayscrollbars-padding]),
.onboarding-body :deep([data-overlayscrollbars-viewport]) {
  height: 100%;
}

.step-panel {
  padding-top: 4px;
}

.step-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: var(--van-font-size-lg);
  font-weight: 600;
}

.step-icon {
  font-size: 20px;
  line-height: 1;
}

.notice-icon {
  font-size: 16px;
}

.step-desc {
  margin-bottom: 12px;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
  line-height: 1.6;
}

.step-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.proxy-address,
.register-url {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background-color: var(--van-gray-2);
  font-family: Consolas, Monaco, monospace;
  font-size: var(--van-font-size-sm);
  word-break: break-all;
  cursor: pointer;
}

.register-url {
  margin-top: 10px;
  width: 100%;
  box-sizing: border-box;
  text-align: center;
}

.client-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.client-col {
  flex: 1 1 320px;
  min-width: 280px;
}

.qr-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 220px;
}

.col-title {
  margin: 6px 0;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

@media (min-width: 720px) {
  .client-step {
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }

  .client-step .client-grid {
    flex: 1 1 auto;
    min-height: 0;
    align-items: stretch;
    flex-wrap: nowrap;
  }

  .client-step .client-col {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .client-step .qr-col {
    justify-content: flex-start;
  }

  .client-step .van-tabs {
    flex: none;
  }

  .client-step > .van-notice-bar {
    flex: none;
    margin-top: 8px;
  }
}

.snippet-tabs {
  margin-bottom: 4px;
}

.snippet {
  position: relative;
  box-sizing: border-box;
  margin: 0 0 8px;
  height: 160px;
  padding: 6px 0 6px 6px;
  overflow: hidden;
  border-radius: 6px;
  background-color: var(--van-gray-2);
}

.snippet :deep(.ace_scroller) {
  overscroll-behavior: contain;
}

@media (min-width: 720px) {
  .client-step .snippet {
    flex: 1 1 0;
    height: auto;
    min-height: 0;
    box-sizing: border-box;
  }

  .client-step .copy-btn {
    flex: none;
    align-self: flex-start;
  }
}

.copy-btn {
  margin-bottom: 8px;
}

.latest-request {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 8px;
  background-color: var(--van-gray-2);
}

.latest-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.latest-url {
  font-family: Consolas, Monaco, monospace;
  word-break: break-all;
}

.latest-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.poll-tip {
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-sm);
}

.body-label {
  margin: 10px 0 6px;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.json-editor {
  width: 100%;
  height: 150px;
  padding: 10px;
  box-sizing: border-box;
  border: 1px solid var(--van-gray-3);
  border-radius: 6px;
  background-color: var(--van-gray-1);
  color: var(--van-text-color);
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
}

.onboarding-foot {
  flex: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--van-gray-2);
}
</style>
