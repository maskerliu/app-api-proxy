<template>
  <van-row>

    <van-col class="bg-border left-panel">
      <van-row justify="space-between">
        <van-checkbox-group size="mini" v-model="recordStore.proxyTypes" direction="horizontal" style="width: 235px;">
          <van-checkbox shape="square" name="5010" style="padding: 5px 10px">
            <i class="iconfont icon-api" style="font-weight: blod"></i>
          </van-checkbox>
          <van-checkbox shape="square" name="5020" style="padding: 5px 10px">
            <van-icon class="iconfont icon-statistics" style="font-weight: blod" />
          </van-checkbox>
          <van-checkbox shape="square" name="5030" style="padding: 5px 10px">
            <van-icon class="iconfont icon-websocket" style="font-weight: blod" />
          </van-checkbox>
        </van-checkbox-group>
        <div style="padding: 1px 0;">
          <van-icon class="iconfont icon-qrcode left-panel-icon" @click="commonStore.showQrCode = true" />
          <van-icon class="iconfont icon-rule left-panel-icon" @click="openRuleMgr" />
          <van-icon class="iconfont icon-setting left-panel-icon" @click="openSettings">
            <span class="badge-dot"></span>
          </van-icon>
        </div>
      </van-row>
      <van-field v-model="proxyDelay" type="number">
        <template #label>
          <van-icon class="iconfont icon-delay" style="font-size: 16px; margin-top: 8px;" />
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
          <van-button plain size="mini" type="primary" @click="onMockRecordStart">
            <van-icon class="iconfont icon-remove" style="font-size: 1rem;" />
          </van-button>
        </template>
      </van-field>

      <OverlayScrollbarsComponent class="snap-panel border-bg"
        :options="{ scrollbars: { theme: `os-theme-${reverseTheme}` } }" defer>
        <van-list ref="snaplist">
          <proxy-record-snap v-for="key in [...recordStore.records.keys()].reverse()"
            :source="recordStore.records.get(key)" />
        </van-list>
      </OverlayScrollbarsComponent>
    </van-col>
    <OverlayScrollbarsComponent class="right-panel" :options="{ scrollbars: { theme: `os-theme-${reverseTheme}`, } }"
      defer>
      <div class="drag-bar" v-if="!isWeb"></div>
      <span v-if="recordStore.curRecord() == null"></span>
      <proxy-stat-detail :record="recordStore.records.get(recordStore.curRecordId)"
        v-else-if="recordStore.curRecord()?.type == 5020" />
      <proxy-request-detail :record="recordStore.records.get(recordStore.curRecordId)" v-else />
    </OverlayScrollbarsComponent>

    <van-popup v-model:show="showPopup" position="right" :closeable="isWeb" close-icon="close">
      <mock-rule-mgr v-if="showMockRuleMgr" />
      <settings v-if="showSettings" />
    </van-popup>

    <van-popup :title="$t('proxy.scanQrCode')" v-model:show="commonStore.showQrCode" round>
      <qrcode-vue :value="commonStore.registerUrl" :size="310" center />
      <div class="register-url" @click="click2Reg">
        {{ commonStore.registerUrl }}
      </div>
    </van-popup>
  </van-row>
</template>

<script lang="ts" setup>
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import QrcodeVue from 'qrcode.vue'
import { ConfigProviderTheme, List, showNotify } from 'vant'
import { defineAsyncComponent, inject, onMounted, provide, Ref, ref, watch } from 'vue'
import { ProxyMock } from '../../../common'
import { CommonStore, ProxyRecordStore } from '../../store'
import Settings from '../settings/Settings.vue'
import ProxyRecordSnap from './ProxyRecordSnap.vue'
import ProxyRequestDetail from './ProxyRequestDetail.vue'
import ProxyStatDetail from './ProxyStatDetail.vue'

const MockRuleMgr = defineAsyncComponent(() => import('./MockRuleMgr.vue'))
const proxyDelay = ref('0')
const snaplist = ref<typeof List>()
const commonStore = CommonStore()
const recordStore = ProxyRecordStore()

const isWeb = __IS_WEB__
const showPopup = ref(false)
const showMockRuleMgr = ref<boolean>(false)
const withCurRecord = ref<boolean>(false)
const showSettings = ref<boolean>(false)

const theme = inject<Ref<ConfigProviderTheme>>('theme')

const reverseTheme = ref<string>(theme.value == 'dark' ? 'light' : 'dark')

provide('showMockRuleMgr', showMockRuleMgr)
provide('withCurRecord', withCurRecord)
provide('showSettings', showSettings)

let mockRecordId = -1

onMounted(() => {
  if (!__IS_WEB__) {
    window.mainApi.onOpenMockRuleMgr(() => { openRuleMgr() })
    window.mainApi.onOpenSettings(() => { openSettings() })
  }
})

watch(() => theme.value, () => {
  reverseTheme.value = theme.value == 'dark' ? 'light' : 'dark'
})

watch(() => recordStore.isChanged, () => {
  // snaplist.value.$el.scrollTo({ top: 0, behavior: 'smooth' })
})

watch(() => recordStore.filterKeyword, () => {
  recordStore.updateFilter()
})

watch(() => recordStore.proxyTypes, () => {
  recordStore.updateFilter()
})

function openRuleMgr() {
  showPopup.value = true
  showMockRuleMgr.value = true
  withCurRecord.value = false
  showSettings.value = false
}

function openSettings() {
  showPopup.value = true
  showMockRuleMgr.value = false
  showSettings.value = true
}

async function saveProxyDelay() {
  try {
    await ProxyMock.saveProxyConfig({ delay: Number(proxyDelay.value) })
    showNotify({ message: '成功设置延迟', type: 'success', duration: 500 })
  } catch (err) {
    showNotify({ message: '设置延迟失败', type: 'danger', duration: 1200 })
  }
}

async function click2Reg() {
  try {
    let resp = await ProxyMock.mockRegister(commonStore.uid)
    showNotify({ message: resp, type: 'success', duration: 500 })
    commonStore.showQrCode = resp == null
  } catch (err: any) {
    showNotify({ message: err, type: 'danger', duration: 800 })
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

.left-panel {
  flex-grow: 1;
  min-width: 340px;
  height: calc(100% - 10px);
  margin: 5px;
}

.right-panel {
  flex-grow: 19;
  flex-basis: 50%;
  min-width: 375px;
  height: calc(100vh - 10px);
  margin: 5px 2px;
  overflow: hidden;
  overflow-y: auto;
}

.left-panel-icon {
  font-size: 1.4rem;
  margin: 3px 6px;
  color: var(--van-gray-8)
}

.snap-panel {
  width: 100%;
  height: calc(100vh - 154px);
  overflow-y: auto;
  overflow-x: hidden;
  margin: 5px 0 0 0;
}

.register-url {
  text-decoration: underline;
  width: 300px;
  color: var(--van-text-color);
  padding: 5px;
  font-size: 0.8rem;
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
