<template>
  <van-row class="proxy-page" :wrap="false">
    <van-col class="bg-border left-panel">
      <van-row class="left-toolbar" justify="space-between" :wrap="false">
        <van-checkbox-group class="proxy-type-group" v-model="recordStore.proxyTypes" direction="horizontal">
          <van-checkbox shape="square" name="5010">
            <i class="iconfont icon-api proxy-type-icon"></i>
          </van-checkbox>
          <van-checkbox shape="square" name="5020">
            <van-icon class="iconfont icon-statistics proxy-type-icon" />
          </van-checkbox>
          <van-checkbox shape="square" name="5030">
            <van-icon class="iconfont icon-websocket proxy-type-icon"
              :class="{ 'is-live': recordStore.activeSocketCount > 0 }" />
          </van-checkbox>
        </van-checkbox-group>
        <van-row class="left-toolbar-actions" align="center" :wrap="false">
          <van-icon class="iconfont icon-qrcode left-panel-icon" @click="commonStore.showQrCode = true" />
          <van-icon class="iconfont icon-rule left-panel-icon" @click="openRuleMgr" />
          <van-icon class="iconfont icon-setting left-panel-icon" @click="openSettings">
            <span class="badge-dot"></span>
          </van-icon>
        </van-row>
      </van-row>
      <van-row class="mock-global-bar" :class="{ 'is-on': mockEnabled }" align="center" :wrap="false"
        @click="toggleMock">
        <i class="iconfont icon-rule mock-global-icon"></i>
        <span class="mock-global-text">{{ mockLabel }}</span>
        <van-switch :model-value="mockEnabled" :loading="mockToggling" class="mock-global-switch"
          @click.stop="toggleMock" />
      </van-row>
      <van-row class="proxy-delay-bar" align="center" :wrap="false">
        <mini-select class="client-picker" :model-value="targetUid ?? ''" :options="clientOptions" font-size="sm"
          :placeholder="$t('proxy.clientUnset')" :title="$t('proxy.clientScopeHint')" @open="loadClients"
          @change="onClientChange" />
        <mini-select v-model="delayPreset" class="delay-preset" :options="delayOptions" font-size="sm" align="end"
          :title="delayHint" @change="onPresetChange" />
      </van-row>
      <van-row v-if="showCustomDelay" class="proxy-delay-custom" align="center" :wrap="false">
        <span class="delay-label">{{ $t('proxy.delay') }}</span>
        <van-field ref="delayField" v-model="proxyDelay" type="digit" class="delay-input" maxlength="5"
          :placeholder="$t('proxy.delayPlaceholder')" @keyup.enter="applyDelay">
          <template #extra><span class="delay-unit">ms</span></template>
        </van-field>
        <span v-if="delayDirty" class="delay-dirty" :title="$t('proxy.delayPending')"></span>
        <van-button class="delay-apply" size="mini" :loading="delaySaving" :disabled="!delayDirty"
          @click="applyDelay">{{ $t('proxy.delayApply') }}</van-button>
        <van-button class="btn-icon-only delay-close" size="mini" plain :title="$t('proxy.delayClose')"
          @click="closeCustomDelay">
          <van-icon name="cross" />
        </van-button>
      </van-row>
      <van-search v-model="recordStore.filterKeyword" show-action class="record-search"
        :placeholder="$t('common.searchPlaceholder')">
        <template #action>
          <van-icon class="iconfont icon-remove action-icon" @click="recordStore.clearRecords" />
        </template>
      </van-search>

      <OverlayScrollbarsComponent class="snap-panel border-bg" :options="scrollOptions" defer>
        <div v-if="showSocketEmpty" class="socket-empty-state">
          <van-empty :image="socketEmptyQuery ? 'search' : 'network'" image-size="120"
            :description="socketEmptyQuery ? $t('proxy.socket.emptyQuery') : $t('proxy.socket.emptyTitle')">
            <div v-if="!socketEmptyQuery" class="socket-empty-hint">
              <div>{{ $t('proxy.socket.emptyHint') }}</div>
            </div>
          </van-empty>
        </div>
        <van-list v-else>
          <proxy-record-snap v-for="record in recordStore.visibleRecords" :key="record.id"
            :source="record as ProxyMock.ProxyRequestRecord" />
        </van-list>
      </OverlayScrollbarsComponent>
    </van-col>
    <OverlayScrollbarsComponent class="right-panel" :options="scrollOptions" defer>
      <span v-if="recordStore.curRecord() == null"></span>
      <proxy-stat-detail :record="recordStore.records.get(recordStore.curRecordId) as ProxyMock.ProxyStatRecord"
        v-else-if="recordStore.curRecord()?.type == 5020" />
      <socket-detail :record="recordStore.records.get(recordStore.curRecordId) as ProxyMock.SocketRecord"
        v-else-if="recordStore.curRecord()?.type == 5030" />
      <proxy-request-detail :record="recordStore.records.get(recordStore.curRecordId) as ProxyMock.ProxyRequestRecord"
        v-else />
    </OverlayScrollbarsComponent>

    <van-popup v-model:show="showPopup" position="right" close-icon="close" @closed="onPopupClosed">
      <mock-rule-mgr v-if="showMockRuleMgr" />
      <settings v-if="showSettings" />
    </van-popup>

    <van-popup v-model:show="commonStore.showQrCode" round>
      <qrcode-vue v-if="commonStore.registerUrl" :value="commonStore.registerUrl" :size="310" :margin="2" level="Q"
        gradient gradient-type="linear" gradient-start-color="#4338ca" gradient-end-color="#0f766e" />
      <div class="register-url" @click="copyRegisterUrl">
        {{ commonStore.registerUrl || $t('proxy.waitingRegister') }}
      </div>
    </van-popup>
  </van-row>
</template>

<script lang="ts" setup>
import {
  ProxyMock,
  getActiveMockRule,
  getAllPushClients,
  getMockRuleDetail, getProxyConfig, getSocketConnections,
  saveMockRule, saveProxyConfig
} from '@shared'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import QrcodeVue from 'qrcode.vue'
import { showNotify } from 'vant'
import type { FieldInstance } from 'vant'
import { computed, defineAsyncComponent, nextTick, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { copyToClipboard } from '../../common/clipboard'
import { scrollOptions } from '../../common/scroll'
import { CommonStore, ProxyRecordStore } from '../../store'
import MiniSelect from '../components/MiniSelect.vue'
import Settings from '../settings/Settings.vue'
import ProxyRecordSnap from './ProxyRecordSnap.vue'
import ProxyRequestDetail from './ProxyRequestDetail.vue'
import ProxyStatDetail from './ProxyStatDetail.vue'
import SocketDetail from './SocketDetail.vue'
import {
  DELAY_CUSTOM_KEY, DELAY_CUSTOM_LABEL_KEY, DELAY_PRESETS, presetKeyOf, presetMsOf, toDelayMs,
} from './delay.preset'
import { MockMgrTarget } from './mock/recording'
import { readRecentRuleId } from './mock/rule.recent'

const MockRuleMgr = defineAsyncComponent(() => import('./mock/MockRuleMgr.vue'))
const proxyDelay = ref('0')
// savedDelay 是最近一次写入服务端的值，档位与脏态都由它推导
const savedDelay = ref(0)
const delayPreset = ref(presetKeyOf(0))
// 档位为自定义时输入行是否展开，档位标签本身仍由 presetKeyOf 推导
const customOpen = ref(false)
const delaySaving = ref(false)
const delayField = ref<FieldInstance>()
const targetUid = ref<string>(null)
const clientInfos = ref<ProxyMock.ClientInfo[]>([])
const commonStore = CommonStore()
const recordStore = ProxyRecordStore()
const { t } = useI18n()
const router = useRouter()

const showPopup = ref(false)
const showMockRuleMgr = ref<boolean>(false)
// 录制成功后通过深链打开规则管理器：定位规则，可选定位记录
const mockMgrTarget = ref<MockMgrTarget>(null)
const showSettings = ref<boolean>(false)

const mockRuleId = ref('')
const mockRuleName = ref('')
const mockToggling = ref(false)
const mockEnabled = computed(() => mockRuleId.value !== '')
const mockLabel = computed(() => mockEnabled.value
  ? t('mock.global.enabled', { rule: mockRuleName.value || shortUid(mockRuleId.value) })
  : t('mock.global.disabled'))

// 在线列表为空时用哨兵项占位：它的值不等于任何 uid，被选中时直接忽略
const CLIENT_NONE = '__client_none__'
// targetUid 可能来自本机注册或上次的兜底选择，此刻还没进在线列表；
// 不补一项的话 MiniSelect 查不到文案，触发条会退回「选择客户端」而不是当前设备
const clientOptions = computed(() => {
  const items = clientInfos.value.map(it => ({ label: it.uid, value: it.uid, tag: uidTag(it.uid) }))
  if (targetUid.value != null && !items.some(it => it.value === targetUid.value)) {
    items.unshift({ label: targetUid.value, value: targetUid.value, tag: uidTag(targetUid.value) })
  }
  return items.length > 0 ? items : [{ label: t('proxy.noClients'), value: CLIENT_NONE }]
})

const delayOptions = computed(() => [
  ...DELAY_PRESETS.map(it => ({ value: it.key, label: t(it.labelKey) })),
  { value: DELAY_CUSTOM_KEY, label: t(DELAY_CUSTOM_LABEL_KEY) },
])
const showCustomDelay = computed(() => delayPreset.value === DELAY_CUSTOM_KEY && customOpen.value)
const delayDirty = computed(() => toDelayMs(proxyDelay.value) !== savedDelay.value)
// 档位标签不再带毫秒数，对应关系放进悬停说明，数字仍取自档位表本身
const delayHint = computed(() => `${t('proxy.delayHint')}（${DELAY_PRESETS
  .map(it => `${t(it.labelKey)}=${it.ms}ms`).join(' · ')}）`)

const socketEmptyQuery = computed(() => String(recordStore.filterKeyword ?? '').trim() !== '')
const showSocketEmpty = computed(() => recordStore.proxyTypes.includes(String(ProxyMock.ProxyType.SOCKET))
  && recordStore.visibleRecords.length === 0)

provide('mockMgrTarget', mockMgrTarget)
provide('showSettings', showSettings)
provide('openMockRuleMgr', openMockRuleMgr)

onMounted(async () => {
  window.mainApi?.onOpenMockRuleMgr(() => { openRuleMgr() })
  window.mainApi?.onOpenSettings(() => { openSettings() })
  await loadClients()
  await refreshMockRule()
  await loadSocketSnapshot()
})

// 其他窗口切换 Mock 后同步本窗口的全局开关
watch(() => commonStore.mockStatus, (status) => {
  if (status == null) return
  mockRuleId.value = status.enabled ? (status.ruleId ?? '') : ''
  mockRuleName.value = status.enabled ? (status.ruleName ?? '') : ''
})

// 注册前 uid 为空，拿到服务端分配的 uid 后补选默认客户端
watch(() => commonStore.uid, async (uid) => {
  if (!uid || (targetUid.value != null && targetUid.value !== '')) return
  targetUid.value = uid
  await loadDelay()
})

function openRuleMgr() {
  openMockRuleMgr(null)
}

function openMockRuleMgr(target?: MockMgrTarget) {
  showPopup.value = true
  showSettings.value = false
  mockMgrTarget.value = target ?? null
  showMockRuleMgr.value = true
}

function onPopupClosed() {
  showMockRuleMgr.value = false
  mockMgrTarget.value = null
  showSettings.value = false
  // 规则管理器中可能切换了启用场景
  void refreshMockRule()
}

async function refreshMockRule() {
  try {
    const ruleId = await getActiveMockRule()
    if (ruleId == null || ruleId === '') {
      mockRuleId.value = ''
      mockRuleName.value = ''
      return
    }
    const detail = await getMockRuleDetail(ruleId).catch(() => null)
    mockRuleId.value = ruleId
    mockRuleName.value = detail?.name ?? ''
  } catch (err) {
    // 读取失败保留当前展示，避免开关闪烁
  }
}

// 关闭时直接停用当前场景；开启时优先恢复上次使用的场景，没有则进入规则管理器
async function toggleMock() {
  if (mockToggling.value) return
  mockToggling.value = true
  try {
    if (mockEnabled.value) {
      const detail = await getMockRuleDetail(mockRuleId.value)
      await saveMockRule({ ...detail, isMock: false })
      mockRuleId.value = ''
      mockRuleName.value = ''
      return
    }

    const ruleId = readRecentRuleId()
    if (ruleId === '') {
      openMockRuleMgr(null)
      showNotify({ message: t('mock.global.selectRule'), type: 'warning', duration: 1200 })
      return
    }
    let detail: ProxyMock.MockRule
    try {
      detail = await getMockRuleDetail(ruleId)
    } catch (err) {
      openMockRuleMgr(null)
      showNotify({ message: t('mock.global.ruleMissing'), type: 'warning', duration: 1600 })
      return
    }
    await saveMockRule({ ...detail, isMock: true })
    mockRuleId.value = ruleId
    mockRuleName.value = detail.name ?? ''
  } catch (err) {
    showNotify({ message: t('mock.global.toggleFailed'), type: 'danger', duration: 1200 })
    await refreshMockRule()
  } finally {
    mockToggling.value = false
  }
}

function openSettings() {
  showPopup.value = true
  showMockRuleMgr.value = false
  showSettings.value = true
}

// 刷新或新窗口打开时，恢复仍在进行的 WS 连接，避免 5030 徽标归零
async function loadSocketSnapshot() {
  try {
    const list = await getSocketConnections()
    recordStore.applySocketSnapshot(list ?? [])
  } catch (err) {
    // 快照失败不影响后续实时推送
  }
}

async function loadClients() {
  try {
    clientInfos.value = await getAllPushClients() ?? []
  } catch (err) {
    clientInfos.value = commonStore.clientInfos
  }

  if (targetUid.value != null && clientInfos.value.some(it => it.uid == targetUid.value)) return
  const other = clientInfos.value.find(it => it.uid != commonStore.uid)
  targetUid.value = (other ?? clientInfos.value[0])?.uid ?? (commonStore.uid || null)
  await loadDelay()
}

// 载入或写入成功后统一重置基线值、输入文本与档位
function setDelay(ms: number) {
  savedDelay.value = ms
  proxyDelay.value = `${ms}`
  delayPreset.value = presetKeyOf(ms)
}

async function loadDelay() {
  if (targetUid.value == null) return
  try {
    const config = await getProxyConfig(targetUid.value)
    setDelay(toDelayMs(config?.delay) ?? 0)
  } catch (err) {
    // 错误提示已由请求层弹出
  }
}

async function onClientChange(uid: string) {
  if (uid == CLIENT_NONE || uid == targetUid.value) return
  targetUid.value = uid
  await loadDelay()
}

// 本机/设备标签：交给 MiniSelect 当 tag 渲染，触发条与弹层选项里都单独成段、不参与截断
function uidTag(uid: string): string {
  if (!uid) return ''
  if (uid == commonStore.uid) return t('proxy.clientLocal')
  return clientInfos.value.find(it => it.uid == uid)?.kind == 'device' ? t('proxy.clientDevice') : ''
}

function shortUid(uid: string) {
  return uid.length > 12 ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : uid
}

// 预设档位立即写盘；自定义档位只展开输入框，由回车或应用按钮提交
async function onPresetChange(key: string) {
  const ms = presetMsOf(key)
  if (ms == null) {
    customOpen.value = true
    await nextTick()
    delayField.value?.focus()
    return
  }
  customOpen.value = false
  proxyDelay.value = `${ms}`
  await applyDelay()
}

// 收起输入行只丢弃未应用的编辑，已生效的延迟与对应档位保持不变
function closeCustomDelay() {
  customOpen.value = false
  setDelay(savedDelay.value)
}

async function applyDelay() {
  if (delaySaving.value) return
  if (targetUid.value == null) {
    showNotify({ message: t('proxy.pickClientFirst'), type: 'warning', duration: 800 })
    // 没有写入对象，档位选择要退回上次生效值
    setDelay(savedDelay.value)
    customOpen.value = false
    return
  }

  const ms = toDelayMs(proxyDelay.value)
  if (ms == null) {
    showNotify({ message: t('mock.editor.validation.delayRange'), type: 'warning', duration: 1200 })
    return
  }
  if (ms === savedDelay.value) return

  delaySaving.value = true
  try {
    await saveProxyConfig(targetUid.value, { delay: ms })
    setDelay(ms)
    customOpen.value = false
    showNotify({
      message: t('proxy.delayApplied', { uid: shortUid(targetUid.value), delay: ms }),
      type: 'success',
      duration: 800,
    })
  } catch (err) {
    showNotify({ message: t('proxy.delayApplyFailed'), type: 'danger', duration: 1200 })
    // 写入失败退回上次生效值，档位与脏态才不会骗人
    setDelay(savedDelay.value)
  } finally {
    delaySaving.value = false
  }
}

async function copyRegisterUrl() {
  const url = commonStore.registerUrl
  if (!url) {
    showNotify({ message: t('proxy.waitingRegister'), type: 'warning', duration: 800 })
    return
  }
  try {
    await copyToClipboard(url)
    showNotify({ message: t('common.linkCopied'), type: 'success', duration: 800 })
  } catch (err) {
    showNotify({ message: t('common.copyFailed'), type: 'danger', duration: 1200 })
  }
}

</script>

<style>
.badge-dot {
  position: absolute;
  display: block;
  border-radius: 50%;
  font-size: var(--van-font-size-xs);
  width: 8px;
  height: 8px;
  background-color: var(--van-danger-color);
  top: -3px;
  right: -3px;
}

.left-panel {
  display: flex;
  flex-direction: column;
  /* 地板 340px 即原先写死的值：字号 7/9 都是 340，字号 10 放宽到 md*26=364。
     新增的 40% 封顶只在包含块窄于 850px 时才接管，而窗口 ≤900px 已切到上下堆叠（width:auto），
     所以字号 9 的观感与改写前一致，封顶只在中等窄窗口（约 900–950px）按回 364 以下。 */
  width: min(max(340px, calc(var(--van-font-size-md) * 26)), 40%);
  height: calc(100% - var(--app-card-gutter) * 2);
  min-height: 0;
  margin: var(--app-card-gutter);
  /* 设备 chip、档位下拉、自定义数值框共用同一行高 */
  --delay-control-height: calc(var(--van-font-size-md) * 2.2);
}

/* 列表内容过长时只压缩列表，避免头部工具行被挤扁后与相邻行重叠 */
.left-panel>.van-row {
  flex: none;
}

.right-panel {
  flex-grow: 19;
  flex-basis: 50%;
  min-width: 375px;
  height: calc(100% - var(--app-card-gutter) * 2);
  min-height: 0;
  margin: var(--app-card-gutter) var(--app-sp-xs);
}

.right-panel [data-overlayscrollbars-content] {
  height: 100%;
}

.left-panel-icon {
  font-size: 1.4rem;
  margin: var(--app-sp-xs) var(--app-sp-md);
  color: var(--van-gray-8)
}

/* 顶部工具行：左侧类型筛选 + 右侧功能图标，禁用拖拽区穿透 */
.left-toolbar {
  z-index: 100;
  -webkit-app-region: no-drag;
}

.left-toolbar-actions {
  padding: 1px 0;
}

.left-panel .van-checkbox__label .proxy-type-icon {
  font-size: 14px;
  font-weight: bold;
}

/* 类型筛选组：宽度按内容自适应，避免因图标字号变化后固定宽度不足 */
.proxy-type-group {
  padding-left: 7px;
}

.proxy-type-group :deep(.van-checkbox) {
  padding: 5px 10px;
  --van-checkbox-size: 16px;
}

/* 有活跃连接时图标变绿，配合徽标数字作为 WS 入口提示 */
.proxy-type-icon.is-live {
  color: var(--van-success-color);
}

.socket-empty-state {
  padding: 24px 12px;
}

.socket-empty-hint {
  display: flex;
  flex-direction: column;
  gap: var(--app-sp-md);
  margin-top: var(--app-sp-sm);
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-xs);
  text-align: left;
}

/* 设备作用域 chip：与右侧档位下拉同一个 MiniSelect，描边/圆角/箭头与字号都由组件与所在行提供；
   这里只规定宽度分配——chip 吃掉档位下拉之外的剩余空间 */
.client-picker {
  flex: 1 1 auto;
}

.snap-panel {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  margin: var(--app-sp-tight) 0 0 0;
}

/* 全局 Mock 开关：状态与场景名同处一行，点击整行即可切换 */
.mock-global-bar {
  gap: var(--app-sp-md);
  flex: none;
  margin-top: var(--app-sp-sm);
  padding: var(--app-sp-xs) var(--app-sp-lg);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
  background: var(--van-gray-1);
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
  cursor: pointer;
}

.mock-global-bar.is-on {
  border-color: var(--van-success-color);
  background: color-mix(in srgb, var(--van-success-color) 8%, transparent);
  color: var(--van-success-color);
}

.mock-global-icon {
  flex: none;
  font-size: calc(var(--van-font-size-md) * 1.1);
}

.mock-global-switch {
  --van-switch-size: calc(var(--van-font-size-md) * 1.2);
}

.mock-global-text {
  flex: 1 1 auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 档位行：设备 chip 吃掉剩余宽度，档位下拉定宽；两个下拉共用同一行高 */
.proxy-delay-bar {
  gap: var(--app-sp-lg);
  padding: var(--app-sp-lg) 0 var(--app-sp-sm) var(--app-sp-sm);
  --mini-select-bar-height: var(--delay-control-height);
}

/* 定宽而不是按内容伸缩：切换档位时标签长短不一，让宽度跟着变会把左侧设备 chip 挤来挤去 */
.proxy-delay-bar .delay-preset {
  flex: none;
  width: calc(var(--van-font-size-md) * 6);
}

/* 自定义档位才展开的数值行：单位常驻，未应用点与应用按钮成对 */
.proxy-delay-custom {
  gap: var(--app-sp-lg);
  padding: 0 0 var(--app-sp-lg) var(--app-sp-sm);
}

.proxy-delay-custom .delay-label {
  flex: none;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.proxy-delay-custom .delay-input {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  height: var(--delay-control-height);
  box-sizing: border-box;
  padding: 0 var(--app-sp-tight);
  border: 1px solid var(--van-border-color);
  border-radius: var(--van-radius-md);
  background: var(--van-background-2);
  font-size: var(--van-font-size-sm);
}

.proxy-delay-custom .delay-input .van-field__body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
}

.proxy-delay-custom .delay-unit {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.proxy-delay-custom .delay-dirty {
  flex: none;
  width: calc(var(--van-font-size-md) * 0.5);
  height: calc(var(--van-font-size-md) * 0.5);
  border-radius: 50%;
  background: var(--van-warning-color);
}

.proxy-delay-custom .delay-apply {
  flex: none;
  height: var(--delay-control-height);
  box-sizing: border-box;
  padding: 0 var(--app-sp-xl);
  font-size: var(--van-font-size-sm);
}

/* 关闭按钮复用 .btn-icon-only 的方形尺寸，与「应用」等高 */
.proxy-delay-custom .delay-close {
  flex: none;
  color: var(--van-text-color-3);
}

.record-search {
  --van-search-padding: 0;
  --van-search-input-height: calc(var(--van-font-size-md) * 2.6);
  --van-cell-vertical-padding: 0;
  padding-right: 0;
}

.record-search :deep(.van-search__content) {
  display: flex;
  align-items: center;
  padding-right: 0;
}

.record-search :deep(.van-cell) {
  padding: 0;
}

.record-search :deep(.van-field__body) {
  display: flex;
  align-items: center;
  height: 100%;
}

.record-search :deep(.van-field__control) {
  height: var(--van-search-input-height);
  line-height: var(--van-search-input-height);
}

.record-search :deep(.van-search__action) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--van-font-size-md) * 2.6);
  height: var(--van-search-input-height);
  padding: 0;
  margin-right: calc(var(--van-padding-md) - 4px);
}

.record-search :deep(.van-search__action .action-icon) {
  font-size: calc(var(--van-font-size-md) * 1.8);
}

.action-icon {
  font-size: calc(var(--van-font-size-md));
}

/* 窄窗口下左右面板改为上下堆叠，列表占上方固定比例，详情占剩余空间 */
@media (max-width: 900px) {
  .proxy-page {
    flex-direction: column;
  }

  .left-panel {
    flex: none;
    width: auto;
    min-width: 0;
    height: 42%;
    margin: var(--app-card-gutter);
  }

  .right-panel {
    flex: 1 1 0;
    width: auto;
    min-width: 0;
    height: auto;
    min-height: 0;
    margin: var(--app-card-gutter);
  }
}

.register-url {
  text-decoration: underline;
  width: 300px;
  color: var(--van-text-color);
  /* 下沿单给到弹层沟道那一档：5.2px 时下划线几乎压在 8px 圆角上，看着像被裁掉了 */
  padding: var(--app-sp-tight) var(--app-sp-tight) var(--app-sp-3xl);
  font-size: var(--van-font-size-md);
  user-select: text;
  word-break: break-all;
  cursor: pointer;
}

.register-url:focus {
  font-weight: bold;
}
</style>
