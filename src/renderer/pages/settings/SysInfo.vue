<template>
  <van-cell-group inset :title="$t('settings.sys.title')" :style="{ paddingTop: isWeb ? '0' : '10px' }">
    <van-field center :label="$t('settings.sys.protocol')" label-width="12.3em" readonly>
      <template #input>
        <van-radio-group v-model="protocol" direction="horizontal">
          <van-radio :name="0">https</van-radio>
          <van-radio :name="1">http</van-radio>
        </van-radio-group>
      </template>
    </van-field>

    <van-field :label="$t('settings.sys.server')" label-width="12.3em" readonly>
      <template #input>
        <MiniSelect
          :model-value="curServerIp?.address"
          :options="ipOptions"
          :placeholder="$t('settings.sys.server')"
          @change="onSelectIPByAddress" />
      </template>
    </van-field>

    <van-field center :label="$t(item.tooltip)" label-width="12.3em" v-for="item in perferences"
      v-model="commonStore.serverConfig[item.key]" :readonly="item.readonly ? true : item.readonly"
      :error-message="!commonStore.serverConfig['portValid'] && item.tooltip == 'settings.sys.port' ? $t('settings.sys.porterror') : null">
      <template #right-icon>
        <van-switch v-if="item.hasStatus" style="margin-top: 5px;" :model-value="!!commonStore.serverConfig.status"
          @update:model-value="(val: boolean) => commonStore.serverConfig.status = val"></van-switch>
      </template>
    </van-field>

    <van-cell v-if="!isWeb">
      <template #value>
        <van-button plain type="primary" size="small" block @click="onSave">
          {{ $t('common.save') }}
        </van-button>
      </template>
    </van-cell>
  </van-cell-group>
</template>
<script lang="ts" setup>
import { LocalIP } from '@shared'
import { showNotify } from 'vant'
import { computed, inject, onMounted, ref, Ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MiniSelect from '../components/MiniSelect.vue'
import { CommonStore } from '../../store'

type SettingPreference = {
  key: string
  tooltip: string
  hasStatus?: boolean
  statusKey?: string
  readonly?: boolean
}

const { t } = useI18n()
const commonStore = CommonStore()
const curServerIp = ref<LocalIP>(null)
const isWeb = window.isWeb
const showSettings = inject<Ref<boolean>>('showSettings')
const protocol = ref(0)

const ipOptions = computed(() =>
  (commonStore.serverConfig.ips ?? []).map(ip => ({
    label: `${ip.name}  ${ip.address}`,
    value: ip.address,
  })),
)

let perferences = [
  { tooltip: 'settings.sys.serverDomain', key: 'domain' },
  { tooltip: 'settings.sys.port', key: 'port', readonly: isWeb },
  { tooltip: 'settings.sys.updateServer', key: 'updateServer', readonly: isWeb },
  { tooltip: 'settings.sys.apiDefineServer', key: 'apiDefineServer', readonly: isWeb },
  { tooltip: 'settings.sys.statRuleServer', key: 'statRuleServer', readonly: isWeb },
  {
    tooltip: 'settings.sys.dataProxyServer',
    key: 'dataServer',
    hasSave: true,
    hasStatus: true,
  },
] as Array<SettingPreference>

onMounted(() => {
  if (commonStore.serverConfig.ips) curServerIp.value = commonStore.serverConfig.ips[0]

  protocol.value = commonStore.serverConfig.protocol == 'https' ? 0 : 1
})

watch(() => commonStore.serverConfig, () => {
  if (commonStore.serverConfig.ips) curServerIp.value = commonStore.serverConfig.ips[0]
})

watch(() => protocol.value, () => {
  commonStore.serverConfig.protocol = protocol.value == 0 ? 'https' : 'http'
})

function onSelectIP(ip: LocalIP) {
  curServerIp.value = ip
  commonStore.serverConfig.ip = ip.address
}

function onSelectIPByAddress(address: string) {
  const ip = (commonStore.serverConfig.ips ?? []).find(x => x.address === address)
  if (ip) onSelectIP(ip)
}

async function onSave() {
  if (curServerIp.value) commonStore.serverConfig.ip = curServerIp.value.address

  try {
    const config = await window.mainApi?.updateBizConfig(JSON.stringify(commonStore.serverConfig))
    if (config) {
      // 服务可能因端口/协议变化而重启，以主进程返回的配置为准同步渲染层与推送连接
      commonStore.updateServerConfig(config)
    }
    showSettings.value = false
  } catch (err: any) {
    showNotify({ type: 'warning', message: `保存配置失败: ${err?.message ?? err}` })
  }
}

</script>
