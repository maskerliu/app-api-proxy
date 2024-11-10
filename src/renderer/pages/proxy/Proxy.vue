<template>
  <van-row justify="start" style="height: 100%; width: 100%; overflow-x: hidden; overflow-y: auto;">
    <van-col :span="4" class="bg-border" style="flex-grow: 0; min-width: 340px; height: calc(100% - 10px);">
      <van-row style="display: flex; width:100%;" justify="space-between">
        <van-checkbox-group size="mini" v-model="recordStore.proxyTypes" direction="horizontal" style="width: 235px;">
          <van-checkbox shape="square" name="5010" style="padding: 5px 10px">
            <i class="iconfont icon-api" style="font-weight: blod"></i>
          </van-checkbox>
          <van-checkbox shape="square" name="5020" style="padding: 5px 10px">
            <van-icon class="iconfont icon-maidian" style="font-weight: blod" />
          </van-checkbox>
          <van-checkbox shape="square" name="5030" style="padding: 5px 10px">
            <van-icon class="iconfont icon-shuiguan" style="font-weight: blod" />
          </van-checkbox>
        </van-checkbox-group>
        <div style="padding-top: 6px;">
          <van-icon class="iconfont icon-qrcode" style="font-size: 1.4rem; margin: 6px; color: gray"
            @click="commonStore.showQrCode = true" />
          <van-icon class="iconfont icon-rule" style="font-size: 1.4rem; margin: 6px; color: gray"
            @click="recordStore.showMockRuleMgr = true" />
          <van-icon class="iconfont icon-setting" style="font-size: 1.4rem; margin: 6px; color: gray"
            @click="showSettings = true" />
        </div>
      </van-row>
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

    <van-col :span="17" style="flex-grow: 0; min-width: 375px; height: 100%; overflow-y: auto;">
      <van-form label-align="right" colon
        v-if="recordStore.curRecordId != -1 && recordStore.records.get(recordStore.curRecordId).type !== 5020">
        <van-cell-group inset title="">
          <van-cell center :title="recordStore.records.get(recordStore.curRecordId).url">
            <template #right-icon>
              <van-button style="margin: 0 10px;" plain size="small" type="success" icon="description"
                @click="copyLink" />
              <van-button plain size="small" type="primary" icon="bookmark-o" @click="addToMockRule" />
            </template>
          </van-cell>
        </van-cell-group>

        <van-cell-group inset :title="$t('proxy.requestHeader')">
          <van-cell>
            <template #value>
              <vue-json-pretty :show-icon="true" theme="light" :deep="0" :showDoubleQuotes="false"
                :data="recordStore.records.get(recordStore.curRecordId).headers == null ? {} : recordStore.records.get(recordStore.curRecordId).headers" />
            </template>
          </van-cell>
        </van-cell-group>

        <van-cell-group inset :title="$t('proxy.requestParams')">
          <van-cell>
            <vue-json-pretty :show-icon="true" theme="light" :deep="0" :showDoubleQuotes="false"
              :data="recordStore.records.get(recordStore.curRecordId).requestData == null ? {} : recordStore.records.get(recordStore.curRecordId).requestData" />
          </van-cell>
        </van-cell-group>

        <van-cell-group inset :title="$t('proxy.responseHeader')">
          <van-cell>
            <vue-json-pretty :show-icon="true" theme="light" :deep="0" :showDoubleQuotes="false"
              :data="recordStore.records.get(recordStore.curRecordId).responseHeaders == null ? {} : recordStore.records.get(recordStore.curRecordId).responseHeaders" />
          </van-cell>
        </van-cell-group>
        <van-cell-group inset :title="$t('proxy.responseBody')" style="margin-bottom: 5px;">
          <van-cell>
            <template #value>
              <vue-json-pretty :show-icon="true" theme="light" :showLineNumber="true" :showDoubleQuotes="false"
                style=" max-height: calc(100vh - 125px); overflow-y: auto;"
                :data="recordStore.records.get(recordStore.curRecordId).responseData == null ? {} : recordStore.records.get(recordStore.curRecordId).responseData">
                <template #renderNodeValue="{ node, defaultValue }">
                  <template v-if="typeof node.content === 'string' && node.content.startsWith('https://')">
                    <a :href="node.content" target="_blank">{{ node.content }}</a>
                  </template>
                  <template v-else>{{ defaultValue }}</template>
                </template>
              </vue-json-pretty>
            </template>
          </van-cell>
        </van-cell-group>
      </van-form>

      <!-- <proxy-request-detail :record="recordStore.records.get(recordStore.curRecordId)"
        v-if="recordStore.curRecordId != -1 && recordStore.records.get(recordStore.curRecordId).type !== 5020" /> -->

      <!--  <proxy-stat-detail :record="recordStore.records.get(recordStore.curRecordId) as ProxyMock.ProxyStatRecord"
        v-if="recordStore.curRecordId != -1 && recordStore.records.get(recordStore.curRecordId).type == 5020"
        class="right-panel" /> -->
    </van-col>

    <van-popup v-model:show="recordStore.showMockRuleMgr" position="right" closeable close-icon="close">
      <mock-rule-mgr :record="recordStore.records.get(recordStore.curRecordId)" />
    </van-popup>

    <van-popup v-model:show="showSettings" position="right" closeable close-icon="close">
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
import 'vue-json-pretty/lib/styles.css'
import { mockRegister, setProxyDelay } from '../../../common/proxy.api'
import { ProxyMock } from '../../../common/proxy.models'
import { useCommonStore } from '../../store'
import { useProxyRecordStore } from '../../store/ProxyRecords'
import Settings from '../settings/Settings.vue'
import ProxyRecordSnap from './ProxyRecordSnap.vue'
import ProxyRequestDetail from './ProxyRequestDetail.vue'
import ProxyStatDetail from './ProxyStatDetail.vue'
import VueJsonPretty from 'vue-json-pretty'
import 'vue-json-pretty/lib/styles.css'

const MockRuleMgr = defineAsyncComponent(() => import('./MockRuleMgr.vue'))
const proxyDelay = ref('0')
const snaplist = ref<typeof List>()
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
  recordStore.curRecordId = -1
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


function copyLink() {
  // clipboard.writeText(this.record.url)
}

function addToMockRule() {
  recordStore.showMockRuleMgr = true
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
  flex-shrink: 0;
  min-width: 380px;
  height: 100%;
}

.record-snap-panel {
  width: 100%;
  height: calc(100vh - 176px);
  overflow-y: scroll;
  overflow-x: hidden;
  margin: 5px 0 0 0;
}

.record-snap-panel::-webkit-scrollbar {
  display: none;
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
