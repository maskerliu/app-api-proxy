<template>
  <van-row class="proxy-page">
    <van-col class="bg-border left-panel">
      <van-row class="left-toolbar" justify="space-between">
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
        <div class="left-toolbar-actions">
          <van-icon class="iconfont icon-qrcode left-panel-icon" @click="commonStore.showQrCode = true" />
          <van-icon class="iconfont icon-rule left-panel-icon" @click="openRuleMgr" />
          <van-icon class="iconfont icon-setting left-panel-icon" @click="openSettings">
            <span class="badge-dot"></span>
          </van-icon>
        </div>
      </van-row>
      <div class="mock-global-bar" :class="{ 'is-on': mockEnabled }" @click="toggleMock">
        <i class="iconfont icon-rule mock-global-icon"></i>
        <span class="mock-global-text">{{ mockLabel }}</span>
        <van-switch :model-value="mockEnabled" :loading="mockToggling" class="mock-global-switch"
          @click.stop="toggleMock" />
      </div>
      <div class="proxy-delay-bar">
        <van-popover v-model:show="showClientPicker" placement="bottom-start" class="client-picker-popup">
          <OverlayScrollbarsComponent class="client-picker-list" :options="scrollOptions" defer>
            <van-cell v-for="item in clientInfos" :key="item.uid" clickable :title="clientLabel(item)"
              :title-style="{ color: item.uid == targetUid ? 'var(--van-primary-color)' : '' }"
              @click="selectClient(item)" />
            <van-cell v-if="clientInfos.length == 0" title="暂无在线客户端" />
          </OverlayScrollbarsComponent>
          <template #reference>
            <div class="client-picker">
              <van-icon class="iconfont icon-device client-picker-icon" />
              <span class="client-picker-name">{{ targetLabel }}</span>
              <van-icon name="arrow-down" class="client-picker-arrow" />
            </div>
          </template>
        </van-popover>
        <van-field v-model="proxyDelay" type="number" placeholder="延迟(ms)" class="delay-input">
          <template #right-icon>
            <van-icon class="iconfont icon-cloud-sync action-icon" @click="saveProxyDelay" />
          </template>
        </van-field>
      </div>
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
        <van-list v-else ref="snaplist">
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
import { List, showNotify } from 'vant'
import { computed, defineAsyncComponent, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { copyToClipboard } from '../../common/clipboard'
import { scrollOptions } from '../../common/scroll'
import { CommonStore, ProxyRecordStore } from '../../store'
import Settings from '../settings/Settings.vue'
import ProxyRecordSnap from './ProxyRecordSnap.vue'
import ProxyRequestDetail from './ProxyRequestDetail.vue'
import ProxyStatDetail from './ProxyStatDetail.vue'
import SocketDetail from './SocketDetail.vue'
import { MockMgrTarget } from './mock/recording'
import { readRecentRuleId } from './mock/rule.recent'

const MockRuleMgr = defineAsyncComponent(() => import('./MockRuleMgr.vue'))
const proxyDelay = ref('0')
const showClientPicker = ref(false)
const targetUid = ref<string>(null)
const clientInfos = ref<ProxyMock.ClientInfo[]>([])
const snaplist = ref<typeof List>()
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

const targetLabel = computed(() => {
  if (targetUid.value == null) return '选择客户端'
  return shortUid(targetUid.value) + uidSuffix(targetUid.value)
})

const socketEmptyQuery = computed(() => String(recordStore.filterKeyword ?? '').trim() !== '')
const showSocketEmpty = computed(() => recordStore.proxyTypes.includes(String(ProxyMock.PorxyType.SOCKET))
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

watch(() => showClientPicker.value, (show) => {
  if (show) loadClients()
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

watch(() => recordStore.isChanged, () => {
  // snaplist.value.$el.scrollTo({ top: 0, behavior: 'smooth' })
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

async function loadDelay() {
  if (targetUid.value == null) return
  try {
    const config = await getProxyConfig(targetUid.value)
    proxyDelay.value = `${config?.delay ?? 0}`
  } catch (err) {
    // 错误提示已由请求层弹出
  }
}

async function selectClient(client: ProxyMock.ClientInfo) {
  targetUid.value = client.uid
  showClientPicker.value = false
  await loadDelay()
}

function uidSuffix(uid: string): string {
  if (!uid) return ''
  if (uid == commonStore.uid) return ' (本机)'
  return clientInfos.value.find(it => it.uid == uid)?.kind == 'device' ? ' (设备)' : ''
}

function clientLabel(client: ProxyMock.ClientInfo) {
  return shortUid(client.uid) + uidSuffix(client.uid)
}

function shortUid(uid: string) {
  return uid.length > 12 ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : uid
}

async function saveProxyDelay() {
  if (targetUid.value == null) {
    showNotify({ message: '请先选择客户端', type: 'warning', duration: 800 })
    return
  }
  try {
    const delay = Math.max(0, Number(proxyDelay.value) || 0)
    await saveProxyConfig(targetUid.value, { delay })
    proxyDelay.value = `${delay}`
    showNotify({ message: `已为 [${shortUid(targetUid.value)}] 设置延迟 ${delay}ms`, type: 'success', duration: 800 })
  } catch (err) {
    showNotify({ message: '设置延迟失败', type: 'danger', duration: 1200 })
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
    showNotify({ message: '链接已复制到剪贴板', type: 'success', duration: 800 })
  } catch (err) {
    showNotify({ message: '复制失败，请手动复制', type: 'danger', duration: 1200 })
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

.proxy-page {
  flex-wrap: nowrap;
}

.left-panel {
  display: flex;
  flex-direction: column;
  width: 340px;
  height: calc(100% - 10px);
  min-height: 0;
  margin: 5px;
}

/* 列表内容过长时只压缩列表，避免头部工具行被挤扁后与相邻行重叠 */
.left-panel>.van-row {
  flex: none;
}

.right-panel {
  flex-grow: 19;
  flex-basis: 50%;
  min-width: 375px;
  height: calc(100% - 10px);
  min-height: 0;
  margin: 5px 2px;
}

.right-panel [data-overlayscrollbars-content] {
  height: 100%;
}

.left-panel-icon {
  font-size: 1.4rem;
  margin: 3px 6px;
  color: var(--van-gray-8)
}

/* 顶部工具行：左侧类型筛选 + 右侧功能图标，禁用拖拽区穿透 */
.left-toolbar {
  flex-wrap: nowrap;
  z-index: 100;
  -webkit-app-region: no-drag;
}

.left-toolbar-actions {
  display: flex;
  align-items: center;
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
  gap: 6px;
  margin-top: 4px;
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-xs);
  text-align: left;
}

.client-picker {
  display: flex;
  align-items: center;
  color: var(--van-text-color);
  cursor: pointer;
  padding-left: 4px;
}

.client-picker-icon {
  font-size: calc(var(--van-font-size-md) * 1.8);
  color: var(--van-gray-8);
}

.client-picker-name {
  font-size: var(--van-font-size-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: calc(var(--van-font-size-md) * 0.2);
}

.client-picker-arrow {
  font-size: calc(var(--van-font-size-md) * 0.8);
}

.client-picker-popup {
  min-width: calc(var(--van-font-size-md) * 16.9);
}

.snap-panel {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  margin: calc(var(--van-font-size-md) * 0.4) 0 0 0;
}

/* 全局 Mock 开关：状态与场景名同处一行，点击整行即可切换 */
.mock-global-bar {
  display: flex;
  align-items: center;
  gap: calc(var(--van-font-size-md) * 0.5);
  flex: none;
  margin-top: calc(var(--van-font-size-md) * 0.3);
  padding: calc(var(--van-font-size-md) * 0.2) calc(var(--van-font-size-md) * 0.6);
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

.client-picker-list {
  max-height: 45vh;
}

.proxy-delay-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0 8px 4px;
}

.proxy-delay-bar .client-picker {
  flex: 3;
  min-width: 0;
}

.proxy-delay-bar .delay-input {
  flex: 2;
  min-width: 0;
  --van-field-input-height: calc(var(--van-font-size-md) * 2.6);
  --van-cell-vertical-padding: 0;
  padding: 0 4px 0 5px;
}

.proxy-delay-bar .delay-input :deep(.van-field__right-icon) {
  width: calc(var(--van-font-size-md) * 2.6);
  margin-right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.proxy-delay-bar .delay-input :deep(.van-field__body) {
  height: 100%;
}

.proxy-delay-bar .delay-input :deep(.van-field__control) {
  height: 100%;
  line-height: calc(var(--van-font-size-md) * 2.6);
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
    margin: 5px;
  }

  .right-panel {
    flex: 1 1 0;
    width: auto;
    min-width: 0;
    height: auto;
    min-height: 0;
    margin: 5px;
  }
}

.register-url {
  text-decoration: underline;
  width: 300px;
  color: var(--van-text-color);
  padding: 5px;
  font-size: var(--van-font-size-md);
  user-select: text;
  word-break: break-all;
  cursor: pointer;
}

.register-url:focus {
  font-weight: bold;
}
</style>
