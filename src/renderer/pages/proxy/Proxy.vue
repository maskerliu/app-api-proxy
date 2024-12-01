<template>
  <van-row justify="start" style="height: 100%; width: 100%; overflow-x: hidden; overflow-y: auto;">
    <van-col class="bg-border" style="flex-grow: 1; min-width: 340px; height: calc(100% - 10px);">
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
          <van-icon class="iconfont icon-setting left-panel-icon" @click="commonStore.showSettings = true" />
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

      <van-list class="record-snap-panel border-bg" ref="snaplist">
        <proxy-record-snap v-for="key in [...recordStore.records.keys()].reverse()"
          :source="recordStore.records.get(key)" />
      </van-list>
    </van-col>
    <van-col class="right-panel">
      <proxy-request-detail :record="recordStore.records.get(recordStore.curRecordId)"
        v-if="recordStore.curRecordId != -1 && recordStore.records.get(recordStore.curRecordId).type !== 5020" />

      <proxy-stat-detail :record="recordStore.records.get(recordStore.curRecordId)"
        v-if="recordStore.curRecordId != -1 && recordStore.records.get(recordStore.curRecordId).type == 5020" />
    </van-col>

    <van-popup v-model:show="commonStore.showMockRuleMgr" position="right" closeable close-icon="close">
      <mock-rule-mgr :record="recordStore.records.get(recordStore.curRecordId)" />
    </van-popup>

    <van-popup v-model:show="commonStore.showSettings" position="right" closeable close-icon="close">
      <settings />
    </van-popup>

    <van-popup :title="$t('proxy.scanQrCode')" v-model:show="commonStore.showQrCode">
      <qrcode-vue :value="commonStore.registerUrl" :size="300" center style="margin: 5px" />
      <div class="register-url" @click="click2Reg">
        {{ commonStore.registerUrl }}
      </div>
    </van-popup>

  </van-row>

</template>

<script lang="ts" setup>
import QrcodeVue from 'qrcode.vue'
import { List, showNotify } from 'vant'
import { defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { mockRegister, saveProxyConfig } from '../../../common'
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

let mockRecordId = -1

onMounted(() => {
  // console.log(/(192|169)\.(172|168|254)\.(99|59|164)\.[1-9]\d{0,2}/.test('192.168.59.1'))

  if (!__IS_WEB__) {
    window.electronAPI.onOpenMockRuleMgr(() => {
      commonStore.showMockRuleMgr = true
      commonStore.showSettings = false
      recordStore.curRecordId = -1
    })

    window.electronAPI.onOpenSettings(() => {
      commonStore.showMockRuleMgr = false
      commonStore.showSettings = true
      recordStore.curRecordId = -1
    })
  }
})

watch(() => recordStore.isChanged, () => {
  snaplist.value.$el.scrollTo({ top: 0, behavior: 'smooth' })
})

watch(() => recordStore.filterKeyword, () => {
  recordStore.updateFilter()
})

watch(() => recordStore.proxyTypes, () => {
  recordStore.updateFilter()
})

function openRuleMgr() {
  commonStore.showMockRuleMgr = true
  recordStore.curRecordId = -1
}

async function saveProxyDelay() {
  try {
    await saveProxyConfig({ delay: Number(proxyDelay.value) })
    showNotify({ message: '成功设置延迟', type: 'success', duration: 500 })
  } catch (err) {
    showNotify({ message: '设置延迟失败', type: 'danger', duration: 1200 })
  }
}

function click2Reg() {
  mockRegister().then((resp) => {
    showNotify({ message: resp, type: 'success', duration: 500 })
    commonStore.showQrCode = resp == null
  })
}

function onMockRecordStart() {
  mockRecordId = new Date().getTime()
  recordStore.mockRecordStart(mockRecordId)
  setTimeout(() => {
    recordStore.mockRecordEnd(mockRecordId)
  }, Math.random() * 1000)

}

</script>

<style scoped>
:root {
  --van-popup-close-icon-margin: 40px;
}

.left-panel {
  flex-grow: 1;
  flex-shrink: 0;
  margin: 5px;
  min-width: 345px;
  height: calc(100% - 10px);
}

.right-panel {
  flex-grow: 19;
  flex-basis: 50%;
  min-width: 375px;
  height: calc(100% - 4px);
  margin: 2px 0;
  overflow-y: auto;
}

.right-panel1 {
  flex-grow: 19;
  flex-shrink: 0;
  min-width: 380px;
  height: 100%;
}

.left-panel-icon {
  font-size: 1.4rem;
  margin: 6px;
  color: gray
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
  color: #777;
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

.content {
  width: 300px;
  font-size: 0.7rem;
  padding: 0 5px;
}
</style>
