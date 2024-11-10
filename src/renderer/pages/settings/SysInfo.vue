<template>
  <van-cell-group inset :title="$t('settings.sys.title')">
    <van-field :label="$t('settings.sys.server')" label-width="10rem" readonly>
      <template #input>
        <van-popover v-model:show="showPopover" placement="bottom-start" style="min-width: 300px"
          v-if="commonStore.serverConfig.ips">
          <van-cell v-for="item in commonStore.serverConfig.ips" :value="item.address" clickable is-link
            @click="onSelectIP(item)">
            <template #title>
              <div style="max-width: 140px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">{{
                item.name }}</div>
            </template>
          </van-cell>

          <template #reference>
            <div style="min-width: 120px; height: 1rem; padding: 2px; margin-top: -5px;">
              {{ curServerIp?.address }}
            </div>
          </template>
        </van-popover>
      </template>
    </van-field>

    <van-field center :label="item.tooltip" label-width="10rem" v-for="item in perferences"
      :model-value="commonStore.serverConfig[item.key]" :readonly="item.readonly ? true : item.readonly">
      <template #button>
        <van-button plain type="primary" size="small" v-if="item.hasSave" @click="onSave">{{ $t('common.save') }}
        </van-button>
        <van-switch v-if="item.hasStatus"></van-switch>
      </template>
    </van-field>

  </van-cell-group>
</template>
<script lang="ts" setup>
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { IP } from '../../../common/base.models'

import { useCommonStore } from '../../store'

type SettingPreference = {
  key: string
  tooltip: string
  hasSave?: boolean
  hasStatus?: boolean
  statusKey?: string
  readonly?: boolean
}

const { t } = useI18n()
const commonStore = useCommonStore()
const curServerIp = ref<IP>(null)
const showPopover = ref(false)

let perferences = [
  { tooltip: t('settings.sys.serverDomain'), key: 'domain' },
  { tooltip: t('settings.sys.port'), key: 'port', hasSave: !__IS_WEB__, readonly: __IS_WEB__ },
  { tooltip: t('settings.sys.proxySocketPort'), key: 'proxySocketPort', readonly: false },
  { tooltip: t('settings.sys.apiDefineServer'), key: 'apiDefineServer', hasSave: true },
  { tooltip: t('settings.sys.statRuleServer'), key: 'statRuleServer', hasSave: true },
  {
    tooltip: t('settings.sys.dataProxyServer'),
    key: 'dataProxyServer',
    hasSave: true,
    hasStatus: true,
    statusKey: 'dataProxyStatus',
  },
  {
    tooltip: t('settings.sys.mqttBroker'),
    key: 'mqttBroker',
  },
] as Array<SettingPreference>

onMounted(() => {
  if (commonStore.serverConfig.ips) curServerIp.value = commonStore.serverConfig.ips[0]
})

watch(() => commonStore.serverConfig, () => {
  if (commonStore.serverConfig.ips) curServerIp.value = commonStore.serverConfig.ips[0]
})

function onSelectIP(ip: IP) {
  curServerIp.value = ip
  showPopover.value = false
}

function onSave() {

  if (!__IS_WEB__) {
    console.log(commonStore.serverConfig)
  }
}

</script>

<style scoped>
.single-line {
  max-width: 80px;
  font-size: 0.7rem;
  color: #34495e;
  padding: 5px;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>