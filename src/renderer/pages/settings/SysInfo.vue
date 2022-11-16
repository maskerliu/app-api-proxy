<template>
  <van-cell-group inset :title="$t('settings.sys.title')">
    <van-field :label="$t('settings.sys.server')" label-width="10rem" readonly>
      <template #input>
        <van-popover v-model:show="showPopover" placement="bottom-start" style="width: 300px"
          v-if="commonStore.serverConfig.ips">
          <van-cell v-for="item in commonStore.serverConfig.ips" :title="item.name" :value="item.address" clickable
            is-link @click="onSelectIP(item)" />
          <template #reference>
            <div style="width: 300px; height: 1rem; padding: 2px; margin-top: -5px;">
              {{ curServerIp?.address }}
            </div>
          </template>
        </van-popover>
      </template>
    </van-field>

    <van-field :label="item.tooltip" label-width="10rem" v-for="item in perferences"
      :model-value="commonStore.serverConfig[item.key]" readonly />
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
  hasStatus?: boolean
  statusKey?: string
}

const { t } = useI18n()
const commonStore = useCommonStore()
const curServerIp = ref<IP>(null)
const showPopover = ref(false)

let perferences = [
  { tooltip: t('settings.sys.port'), key: 'port' },
  { tooltip: t('settings.sys.proxySocketPort'), key: 'proxySocketPort' },
  { tooltip: t('settings.sys.apiDefineServer'), key: 'apiDefineServer' },
  { tooltip: t('settings.sys.statRuleServer'), key: 'statRuleServer' },
  {
    tooltip: t('settings.sys.dataProxyServer'),
    key: 'dataProxyServer',
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