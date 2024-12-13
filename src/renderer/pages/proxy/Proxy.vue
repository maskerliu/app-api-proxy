<template>
  <van-row style="height: 100vh; overflow: hidden;">
    <van-col class="bg-border left-panel">
      <van-row style="display: flex; width:100%;" justify="space-between">
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
        <div style="padding-top: 6px;">
          <van-icon class="iconfont icon-qrcode left-panel-icon" @click="commonStore.showQrCode = true" />
          <van-icon class="iconfont icon-rule left-panel-icon" @click="openRuleMgr" />
          <van-icon class="iconfont icon-setting left-panel-icon" @click="showSettings = true" />
        </div>
      </van-row>
      <van-field v-model="proxyDelay" type="number">
        <template #label>
          <van-icon class="iconfont icon-delay" style="font-size: 16px; margin-top: 8px;" />
        </template>
        <template #button>
          <van-button plain size="small" type="primary" @click="saveProxyDelay">
            <van-icon class="iconfont icon-cloud-sync" style="font-size: 16px;" />
          </van-button>
        </template>
      </van-field>
      <van-field v-model="recordStore.filterKeyword" :placeholder="$t('common.searchPlaceholder')" clearable center
        left-icon="filter-o" style="margin-top: 5px">
        <template #button>
          <van-button plain size="small" type="primary" @click="onMockRecordStart" icon="delete-o" />
        </template>
      </van-field>

      <OverlayScrollbarsComponent class="record-snap-panel border-bg"
        :options="{ scrollbars: { theme: 'os-theme-light' } }" defer>
        <van-list ref="snaplist">
          <proxy-record-snap v-for="key in [...recordStore.records.keys()].reverse()"
            :source="recordStore.records.get(key)" />
        </van-list>
      </OverlayScrollbarsComponent>
    </van-col>
    <OverlayScrollbarsComponent class="right-panel" :options="{ scrollbars: { theme: 'os-theme-light', } }" defer>
      <div class="drag-bar" v-if="!isWeb"></div>
      <proxy-request-detail :record="recordStore.records.get(recordStore.curRecordId)"
        v-if="recordStore.curRecordId != -1 && recordStore.records.get(recordStore.curRecordId)?.type !== 5020" />

      <proxy-stat-detail :record="recordStore.records.get(recordStore.curRecordId)"
        v-if="recordStore.curRecordId != -1 && recordStore.records.get(recordStore.curRecordId)?.type == 5020" />
    </OverlayScrollbarsComponent>

    <van-popup v-model:show="showMockRuleMgr" position="right" :closeable="isWeb" close-icon="close">
      <mock-rule-mgr />
    </van-popup>

    <van-popup v-model:show="showSettings" position="right" :closeable="isWeb" close-icon="close">
      <settings />
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
import { List, showNotify } from 'vant'
import { defineAsyncComponent, onMounted, provide, ref, watch } from 'vue'
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
const showMockRuleMgr = ref<boolean>(false)
const withCurRecord = ref<boolean>(false)
const showSettings = ref<boolean>(false)

provide('showMockRuleMgr', showMockRuleMgr)
provide('withCurRecord', withCurRecord)
provide('showSettings', showSettings)

let mockRecordId = -1

onMounted(() => {
  // console.log(/(192|169)\.(172|168|254)\.(99|59|164)\.[1-9]\d{0,2}/.test('192.168.59.1'))

  if (!__IS_WEB__) {
    window.electronAPI.onOpenMockRuleMgr(() => {
      showMockRuleMgr.value = true
      withCurRecord.value = false
      showSettings.value = false
    })

    window.electronAPI.onOpenSettings(() => {
      showMockRuleMgr.value = false
      showSettings.value = true
    })
  }
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
  showMockRuleMgr.value = true
  withCurRecord.value = false
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
    let resp = await ProxyMock.mockRegister()
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
  height: calc(100vh - 5px);
  margin: 5px 2px;
  overflow: hidden;
  overflow-y: auto;
}

.left-panel-icon {
  font-size: 1.4rem;
  margin: 6px;
  color: var(--van-gray-8)
}

.record-snap-panel {
  width: 100%;
  height: calc(100vh - 164px);
  overflow-y: auto;
  overflow-x: hidden;
  margin: 5px 0 0 0;
}

/* .record-snap-panel::-webkit-scrollbar {
  display: none;
} */

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
