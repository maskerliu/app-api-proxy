<template>
  <van-row ref="container" class="full-row" justify="start" style="overflow-y: auto;">
    <van-col ref="leftDom" class="bg-border left-panel">
      <van-checkbox-group size="mini" v-model="recordStore.proxyTypes" direction="horizontal"
        style="width: 100%; padding: 5px 5px; ">
        <van-checkbox shape="square" name="5010" style="padding: 5px 10px">
          <i class="iconfont icon-api" style="font-weight: blod"></i>
        </van-checkbox>
        <van-checkbox shape="square" name="5020" style="padding: 5px 10px">
          <van-icon class="iconfont icon-maidian" style="font-weight: blod" />
        </van-checkbox>
        <van-checkbox shape="square" name="5030" style="padding: 5px 10px">
          <van-icon class="iconfont icon-shuiguan" style="font-weight: blod" />
        </van-checkbox>
        <van-icon class="iconfont icon-qrcode" style="font-size: 1.4rem; margin: 6px; color: gray"
          @click="commonStore.showQrCode = true" />
        <van-icon class="iconfont icon-rule" style="font-size: 1.4rem; margin: 6px; color: gray"
          @click="recordStore.showMockRuleMgr = true" />
        <van-icon class="iconfont icon-setting" style="font-size: 1.4rem; margin: 6px; color: gray"
          @click="showSettings = true" />
      </van-checkbox-group>

      <van-field v-model="proxyDelay" type="number">
        <template #label>
          <van-icon class="iconfont icon-delay" style="font-size: 16px; margin-top: 5px;" />
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
          <van-button plain size="small" type="primary" @click="recordStore.mockRecord" icon="delete-o" />
        </template>
      </van-field>

      <van-list class="record-snap-panel" ref="snaplist">
        <proxy-record-snap v-for="key in [...recordStore.records.keys()].reverse()"
          :source="recordStore.records.get(key)" />
      </van-list>
    </van-col>

    <van-col ref="resizeBar" class="resize-bar">
      <div class="division-line"></div>
      <i class="iconfont icon-division division" @mousedown.stop.prevent="resizeDown"></i>
    </van-col>

    <van-col ref="rightDom" class="right-panel">
      <proxy-request-detail :record="recordStore.records.get(recordStore.curRecordId) as ProxyMock.ProxyRequestRecord"
        v-if="recordStore.curRecordId != -1 && recordStore.records.get(recordStore.curRecordId).type !== 5020" />
      <proxy-stat-detail :record="recordStore.records.get(recordStore.curRecordId) as ProxyMock.ProxyStatRecord"
        v-if="recordStore.curRecordId != -1 && recordStore.records.get(recordStore.curRecordId).type == 5020" />
    </van-col>

    <van-popup v-model:show="recordStore.showMockRuleMgr" position="right">
      <mock-rule-mgr :record="recordStore.records.get(recordStore.curRecordId)" />
    </van-popup>

    <van-popup :title="$t('proxy.scanQrCode')" v-model:show="commonStore.showQrCode">
      <qrcode-vue :value="commonStore.registerUrl" :size="300" center style="margin: 5px" />
      <div class="register-url" @click="click2Reg">
        {{ commonStore.registerUrl }}
      </div>
    </van-popup>

    <van-popup v-model:show="showSettings" position="right">
      <settings />
    </van-popup>
  </van-row>
</template>

<script lang="ts" setup>
import QrcodeVue from 'qrcode.vue'
import { showNotify } from 'vant'
import { defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { mockRegister, setProxyDelay } from '../../../common/proxy.api'
import { ProxyMock } from '../../../common/proxy.models'
import { useCommonStore } from '../../store'
import { useProxyRecordStore } from '../../store/ProxyRecords'
import Settings from '../settings/Settings.vue'
import ProxyRecordSnap from './ProxyRecordSnap.vue'
import ProxyRequestDetail from './ProxyRequestDetail.vue'
import ProxyStatDetail from './ProxyStatDetail.vue'

const MockRuleMgr = defineAsyncComponent(() => import('./MockRuleMgr.vue'))
const proxyDelay = ref('0')
const container = ref()
const leftDom = ref()
const rightDom = ref()
const snaplist = ref()
const commonStore = useCommonStore()
const recordStore = useProxyRecordStore()
const showSettings = ref<boolean>(false)

onMounted(() => {
  if (!__IS_WEB__) {
    window.electronAPI.onOpenMockRuleMgr(() => {
      recordStore.showMockRuleMgr = true
    })

    window.electronAPI.onOpenSettings(() => {
      showSettings.value = true
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

async function saveProxyDelay() {
  try {
    await setProxyDelay(Number(proxyDelay.value))
    showNotify({ message: '成功设置延迟', type: 'success' })
  } catch (err) {
    showNotify({ message: '设置延迟失败', type: 'danger' })
  }
}

function resizeDown(e: MouseEvent) {
  // clientStartX = e.clientX
  document.onmousemove = (e) => {
    moveHandle(e.clientX)
    return false
  }

  document.onmouseup = () => {
    document.onmousemove = null
    document.onmouseup = null
  }
  return false
}

function moveHandle(curWidth: any) {
  let changeWidth = curWidth - 85
  if (changeWidth < 300) {
    changeWidth = 300
    curWidth = 330
  }
  let remainWidth = container.value.$el.clientWidth - changeWidth - 20
  leftDom.value.$el.style.width = changeWidth + 'px'
  rightDom.value.$el.style.width = remainWidth + 'px'
}

function click2Reg() {
  mockRegister().then((resp) => {
    showNotify({ message: resp, type: 'success', duration: 500 })
    commonStore.showQrCode = resp == null
  })
}

</script>

<style scoped>
.left-panel {
  margin: 5px;
  min-width: 348px;
  height: calc(100vh - 10px);
}

.record-snap-panel {
  height: calc(100vh - 176px);
  overflow-y: scroll;
  overflow-x: hidden;
  margin: 5px 0 0px 0;
}

.resize-bar {
  position: relative;
  width: 10px;
  height: calc(100% - 10px);
  margin: 5px 5px 5px 0;
  text-align: center;
}

.right-panel {
  flex: 1;
  padding: 0;
  /* flex-shrink: 0;
  flex-grow: 1; */
  position: relative;
  height: 100%;
  min-width: 375px;
}

.resize-bar .division-line {
  width: 1px;
  height: 100%;
  position: absolute;
  left: 4px;
  z-index: 0;
  border-left: 2px dotted #d6d6d6;
}

.resize-bar .division {
  font-size: 0.7rem;
  font-weight: bold;
  color: grey;
  position: relative;
  top: 50%;
  transform: translateY(-50%);
}

.resize-bar .division:hover {
  cursor: col-resize;
}

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
</style>
