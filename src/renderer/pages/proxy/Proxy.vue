<template>
  <van-row class="proxy-page">
    <van-col class="bg-border left-panel">
      <van-row justify="space-between">
        <van-checkbox-group size="mini" v-model="recordStore.proxyTypes" direction="horizontal"
          style="z-index: 100; -webkit-app-region: no-drag; width: 235px;">
          <van-checkbox shape="square" name="5010" style="padding: 5px 10px">
            <i class="iconfont icon-api proxy-type-icon" style="font-weight: blod"></i>
          </van-checkbox>
          <van-checkbox shape="square" name="5020" style="padding: 5px 10px">
            <van-icon class="iconfont icon-statistics proxy-type-icon" style="font-weight: blod" />
          </van-checkbox>
          <van-checkbox shape="square" name="5030" style="padding: 5px 10px">
            <van-icon class="iconfont icon-websocket proxy-type-icon" style="font-weight: blod" />
          </van-checkbox>
        </van-checkbox-group>
        <div style="padding: 1px 0; z-index: 100; -webkit-app-region: no-drag;">
          <van-icon class="iconfont icon-qrcode left-panel-icon" @click="commonStore.showQrCode = true" />
          <van-icon class="iconfont icon-rule left-panel-icon" @click="openRuleMgr" />
          <van-icon class="iconfont icon-setting left-panel-icon" @click="openSettings">
            <span class="badge-dot"></span>
          </van-icon>
        </div>
      </van-row>
      <van-field v-model="proxyDelay" type="number" placeholder="延迟(ms)" center label-width="6.5rem">
        <template #label>
          <van-popover v-model:show="showClientPicker" placement="bottom-start"
            style="min-width: 220px; max-height: 45vh; overflow-y: auto;">
            <van-cell v-for="item in clientInfos" :key="item.uid" clickable :title="clientLabel(item)"
              :title-style="{ color: item.uid == targetUid ? 'var(--van-primary-color)' : '' }"
              @click="selectClient(item)" />
            <van-cell v-if="clientInfos.length == 0" title="暂无在线客户端" />
            <template #reference>
              <div class="client-picker">
                <van-icon class="iconfont icon-network-data client-picker-icon" />
                <span class="client-picker-name">{{ targetLabel }}</span>
                <van-icon name="arrow-down" size="10" />
              </div>
            </template>
          </van-popover>
        </template>
        <template #button>
          <van-button plain size="mini" type="primary" @click="saveProxyDelay">
            <van-icon class="iconfont icon-cloud-sync" style="font-size: 1rem;" />
          </van-button>
        </template>
      </van-field>
      <van-field v-model="recordStore.filterKeyword" :placeholder="$t('common.searchPlaceholder')" clearable center
        left-icon="filter-o" style="margin-top: 5px">
        <template #button>
          <van-button plain size="mini" type="primary" @click="recordStore.clearRecords">
            <van-icon class="iconfont icon-remove" style="font-size: 1rem;" />
          </van-button>
        </template>
      </van-field>

      <OverlayScrollbarsComponent class="snap-panel border-bg"
        :options="{ scrollbars: { theme: `os-theme-${reverseTheme}` } }" defer>
        <van-list ref="snaplist">
          <proxy-record-snap v-for="record in recordStore.visibleRecords" :key="record.id" :source="record" />
        </van-list>
      </OverlayScrollbarsComponent>
    </van-col>
    <OverlayScrollbarsComponent class="right-panel" :options="{ scrollbars: { theme: `os-theme-${reverseTheme}`, } }"
      defer>
      <span v-if="recordStore.curRecord() == null"></span>
      <proxy-stat-detail :record="recordStore.records.get(recordStore.curRecordId)"
        v-else-if="recordStore.curRecord()?.type == 5020" />
      <proxy-request-detail :record="recordStore.records.get(recordStore.curRecordId)" v-else />
    </OverlayScrollbarsComponent>

    <van-popup v-model:show="showPopup" position="right" close-icon="close" @closed="onPopupClosed">
      <mock-rule-mgr v-if="showMockRuleMgr" />
      <settings v-if="showSettings" />
    </van-popup>

    <van-popup :title="$t('proxy.scanQrCode')" v-model:show="commonStore.showQrCode" round>
      <qrcode-vue v-if="commonStore.registerUrl" :value="commonStore.registerUrl" :size="310" :margin="2" level="Q"
        gradient gradient-type="linear" gradient-start-color="#4338ca" gradient-end-color="#0f766e" />
      <div class="register-url" @click="copyRegisterUrl">
        {{ commonStore.registerUrl || $t('proxy.waitingRegister') }}
      </div>
    </van-popup>
  </van-row>
</template>

<script lang="ts" setup>
import { ProxyMock, getAllPushClients, getProxyConfig, saveProxyConfig } from '@shared'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import QrcodeVue from 'qrcode.vue'
import { List, showNotify } from 'vant'
import { computed, defineAsyncComponent, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CommonStore, ProxyRecordStore } from '../../store'
import Settings from '../settings/Settings.vue'
import ProxyRecordSnap from './ProxyRecordSnap.vue'
import ProxyRequestDetail from './ProxyRequestDetail.vue'
import ProxyStatDetail from './ProxyStatDetail.vue'

const MockRuleMgr = defineAsyncComponent(() => import('./MockRuleMgr.vue'))
const proxyDelay = ref('0')
const showClientPicker = ref(false)
const targetUid = ref<string>(null)
const clientInfos = ref<ProxyMock.ClientInfo[]>([])
const snaplist = ref<typeof List>()
const commonStore = CommonStore()
const recordStore = ProxyRecordStore()
const { t } = useI18n()

const showPopup = ref(false)
const showMockRuleMgr = ref<boolean>(false)
const withCurRecord = ref<boolean>(false)
const showSettings = ref<boolean>(false)

const reverseTheme = ref<string>(commonStore.theme == 'dark' ? 'light' : 'dark')

const targetLabel = computed(() => {
  if (targetUid.value == null) return '选择客户端'
  return shortUid(targetUid.value) + uidSuffix(targetUid.value)
})

provide('withCurRecord', withCurRecord)
provide('showSettings', showSettings)
provide('openMockRuleMgr', openMockRuleMgr)

let mockRecordId = -1

onMounted(async () => {
  window.mainApi?.onOpenMockRuleMgr(() => { openRuleMgr() })
  window.mainApi?.onOpenSettings(() => { openSettings() })
  await loadClients()
})

watch(() => showClientPicker.value, (show) => {
  if (show) loadClients()
})

watch(() => commonStore.theme, () => {
  reverseTheme.value = commonStore.theme == 'dark' ? 'light' : 'dark'
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
  openMockRuleMgr(false)
}

function openMockRuleMgr(withRecord: boolean) {
  showPopup.value = true
  showSettings.value = false
  withCurRecord.value = withRecord
  showMockRuleMgr.value = true
}

function onPopupClosed() {
  showMockRuleMgr.value = false
  withCurRecord.value = false
  showSettings.value = false
}

function openSettings() {
  showPopup.value = true
  showMockRuleMgr.value = false
  showSettings.value = true
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
    if (window.mainApi) {
      await window.mainApi.writeClipboard(url)
    } else {
      await navigator.clipboard.writeText(url)
    }
    showNotify({ message: '链接已复制到剪贴板', type: 'success', duration: 800 })
  } catch (err) {
    showNotify({ message: '复制失败，请手动复制', type: 'danger', duration: 1200 })
  }
}

function onMockRecordStart() {
  mockRecordId = new Date().getTime()
  recordStore.mockRecordStart(mockRecordId)
  setTimeout(() => {
    recordStore.mockRecordEnd(mockRecordId)
  }, Math.random() * 1000)

}

</script>

<style>
.badge-dot {
  position: absolute;
  display: block;
  border-radius: 50%;
  font-size: 4px;
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
  flex-grow: 1;
  min-width: 340px;
  height: calc(100% - 10px);
  min-height: 0;
  margin: 5px;
}

/* 列表内容过长时只压缩列表，避免头部工具行被挤扁后与相邻行重叠 */
.left-panel>.van-row,
.left-panel>.van-field {
  flex: none;
}

.right-panel {
  flex-grow: 19;
  flex-basis: 50%;
  min-width: 375px;
  height: calc(100% - 10px);
  min-height: 0;
  margin: 5px 2px;
  overflow: hidden;
  overflow-y: auto;
}

.left-panel-icon {
  font-size: 1.4rem;
  margin: 3px 6px;
  color: var(--van-gray-8)
}

.left-panel .van-checkbox__label .proxy-type-icon {
  font-size: 16px;
}

.client-picker {
  display: flex;
  align-items: center;
  max-width: 6.2rem;
  color: var(--van-text-color);
  cursor: pointer;
}

.client-picker-icon {
  font-size: 15px;
  color: var(--van-gray-8);
  margin-right: 3px;
}

.client-picker-name {
  font-size: var(--van-font-size-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 3px;
}

.snap-panel {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  margin: 5px 0 0 0;
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

a {
  color: rgb(31, 187, 166);
  text-decoration: underline;
}
</style>
