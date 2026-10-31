<template>
  <van-cell-group inset :title="$t('settings.sys.title')" :style="{ paddingTop: isWeb ? '0' : '10px' }">
    <van-field center :label="$t('settings.sys.protocol')" label-width="10rem" readonly>
      <template #input>
        <van-tabs v-model:active="protocol" type="card" style="margin: 0;">
          <van-tab title="https[2]" :title-style="{ width: '5rem' }"></van-tab>
          <van-tab title="http" :title-style="{ width: '5rem' }"></van-tab>
        </van-tabs>
      </template>
    </van-field>

    <van-field :label="$t('settings.sys.server')" label-width="10rem" readonly>
      <template #input>
        <van-popover v-model:show="showPopover" placement="bottom-start" style="min-width: 300px"
          v-if="commonStore.serverConfig.ips">
          <van-cell v-for="item in commonStore.serverConfig.ips" :value="item.address" clickable is-link
            @click="onSelectIP(item)">
            <template #title>
              <div style="max-width: 140px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">
                {{ item.name }}
              </div>
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

    <van-field center :label="$t(item.tooltip)" label-width="10rem" v-for="item in perferences"
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
import { inject, onMounted, ref, Ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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
const showPopover = ref<boolean>(false)
const isWeb = window.isWeb
const showSettings = inject<Ref<boolean>>('showSettings')
const protocol = ref(0)

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
  showPopover.value = false
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