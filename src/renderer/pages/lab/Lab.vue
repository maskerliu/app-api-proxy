<template>
  <van-row gutter="24" class="full-row" justify="center" align="center">

    <van-col gutter="24" class="full-row bg-border" style="max-height: 174px;">
      <van-search v-model="searchKey" :placeholder="$t('common.searchPlaceholder')" background="#4fc08d" />
      <van-grid clickable style="overflow-y: auto;  overflow-x: hidden;">
        <van-grid-item v-for="item in devices" :key="item.deviceId" @click="onDeviceSelected(item)" badge="">
          <template #text>
            <div class="single-line">{{ item.deviceId }}</div>
            <div class="single-line">地址: {{ item.address }}</div>
            <div>
              <van-button type="warning" plain size="mini" @click.stop.prevent="rebootDevice(item.deviceId)">
                <template #icon>
                  <van-icon class="iconfont icon-shut-down" />
                </template>
              </van-button>
              <van-button type="primary" plain size="mini" @click.stop.prevent="infoEdit(item)"
                style="margin-left: 10px;">
                <template #icon>
                  <van-icon class="iconfont icon-info" />
                </template>
              </van-button>
              <van-button type="danger" plain size="mini" @click.stop.prevent="showRemoveConfirm(item)"
                style="margin-left: 10px;">
                <template #icon>
                  <van-icon class="iconfont icon-delete" />
                </template>
              </van-button>
            </div>
          </template>
          <template #icon>
            <van-icon class="iconfont icon-wulianwangwangguan" color="#1989fa" size="30" />
          </template>
        </van-grid-item>
      </van-grid>
    </van-col>

    <van-row gutter="24" class="full-row bg-border" style="height: 50px;" align="center">
      <van-col span="20">
        {{ curDevice?.deviceId }}
      </van-col>
      <van-col>
        <van-switch v-model="isSubscribe" size="24px">
          <template #node>
            <div class="icon-wrapper">
              <van-icon size="24" class="iconfont" v-bind:class="isSubscribe ? 'icon-subscribed' : 'icon-subscribe'" />
            </div>
          </template>
        </van-switch>
      </van-col>
    </van-row>

    <van-row gutter="24" class="full-row bg-border" justify="center"
      style="height: calc(100% - 276px); padding: 5px; overflow-y: auto;">
      <van-col span="9" style="min-width: 360px; padding:0;">
        <div ref="echartsElectric" style="width:100%; height:260px;"></div>
      </van-col>
      <van-col span="6" style="min-width: 260px; padding: 0;">
        <div ref="echartsTemperature" style="width: 100%; height: 260px;"></div>
      </van-col>
      <van-col span="9" style="min-width: 360px; padding: 0;">
        <div ref="echartsHumidity" style="width: 100%; height: 260px;">
        </div>
      </van-col>
    </van-row>
    <van-popup v-model:show="showInfoDialog" :close-on-click-overlay="false" style="padding: 5px;">
      <van-form style="margin-top: 15px; width: 100%" label-align="right" label-width="4em" colon>
        <van-field :label="$t('iot.device.name')" :model-value="curDevice.deviceId" readonly />
        <van-field :label="$t('iot.device.address')" v-model="curDevice.address" placeholder="设备所在地" />
        <amap-viewer style="width: 500px; height: 300px;" v-model:lng="curDevice.lng" v-model:lat="curDevice.lat"
          v-model:address="curDevice.address"></amap-viewer>
        <div align="end" style="padding: 10px;">
          <van-button plain type="default" size="small" @click="showInfoDialog = false">
            {{ $t('common.cancel') }}
          </van-button>
          <van-button plain type="primary" size="small" :loading="updating" @click="updateDeviceInfo"
            style="margin-left: 20px;">
            {{ $t('common.done') }}
          </van-button>
        </div>
      </van-form>
    </van-popup>

    <van-dialog v-model:show="removeConfirmDialog" :title="$t('iot.device.delete')" show-cancel-button
      :cancel-button-text="$t('common.cancel')" :confirmButtonText="$t('common.delete')" confirmButtonColor="#ee0a24"
      @confirm="deleteDevice">
      <div style="font-size: 0.8rem; padding: 15px;">
        <p>{{ $t('iot.device.delete.confirm', { deviceId: curDevice.deviceId }) }}</p>
        <p>{{ $t('iot.device.delete.confirm1') }}</p>
      </div>
    </van-dialog>

  </van-row>
</template>

<script lang="ts" setup>
import { defineAsyncComponent, onMounted, ref, watch } from 'vue'

import { BarChart, BarSeriesOption, GaugeChart, GaugeSeriesOption, LineChart, LineSeriesOption } from 'echarts/charts'
import {
  DatasetComponent, DatasetComponentOption,
  GridComponent, GridComponentOption,
  LegendComponent, LegendComponentOption,
  TitleComponent, TitleComponentOption,
  TooltipComponent, TooltipComponentOption,
  TransformComponent
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { LabelLayout, UniversalTransition } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'
import { Notify } from 'vant'
import { removeDevice, searchDevices, updateDevice } from '../../../common/iot.api'
import { IOT } from '../../../common/iot.models'
import { useCommonStore } from '../../store'
import { useIOTDeviceStore } from '../../store/IOTDevices'


type ECOption = echarts.ComposeOption<BarSeriesOption | LineSeriesOption | TitleComponentOption | TooltipComponentOption | GridComponentOption | DatasetComponentOption | DatasetComponentOption | LegendComponentOption | GaugeSeriesOption>

echarts.use([
  TitleComponent,
  LegendComponent,
  TooltipComponent,
  GridComponent,
  DatasetComponent,
  TransformComponent,
  BarChart,
  LineChart,
  LabelLayout,
  GaugeChart,
  UniversalTransition,
  CanvasRenderer,
])

const AmapViewer = defineAsyncComponent(() => import('../components/AmapViewer.vue'))

const echartsElectric = ref()
const echartsTemperature = ref()
const echartsHumidity = ref()

const isSubscribe = ref(false)
const searchKey = ref('')
const showInfoDialog = ref(false)
const removeConfirmDialog = ref(false)
const curDevice = ref<IOT.IOTDevice>(null)
const updating = ref(false)
const devices = ref<Array<IOT.IOTDevice>>(null)

let electricOpts = {} as ECOption
let electricChart = null as echarts.ECharts

let tempOpts = {} as ECOption
let tempChart = null as echarts.ECharts

let humidityOpts = {} as ECOption
let humidityChart = null as echarts.ECharts

const deviceStore = useIOTDeviceStore()
const commonStore = useCommonStore()

onMounted(() => {
  initElectric()
  initTemperature()
  initHumidity()
})

watch(() => isSubscribe.value, () => {
  if (curDevice.value != null) {
    if (isSubscribe.value) {
      commonStore.deviceTmpSubscribe(curDevice.value.deviceId)
    } else {
      commonStore.deviceTmpUnsubscribe(curDevice.value.deviceId)
    }
  }
})

watch(() => searchKey.value, async () => {
  devices.value = await searchDevices(searchKey.value)
})

watch(() => deviceStore.temperature, () => {
  updateData()
})

function initElectric() {
  electricOpts = {
    title: {
      text: '电机',
      textStyle: {
        fontSize: 14,
        fontWeight: 'bold',
      },
    },
    legend: {
      data: ['电流', '电压',]
    },
    grid: {
      left: '4%',
      right: '4%',
      bottom: '2%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: []
    },
    yAxis: [
      {
        type: 'value',
        name: '-/mA',
        // min: 0,
        // max: 2
      },
      {
        type: 'value',
        name: '-/V',
        // min: 0,
        // max: 5,
      }
    ],
    series: [
      {
        name: '电流',
        type: 'line',
        color: ["#eb9f0d"],
        smooth: true,
        data: []
      },
      {
        name: '电压',
        type: 'line',
        color: ["#969ac7"],
        smooth: true,
        yAxisIndex: 1,
        data: []
      }
    ]
  }

  electricChart = echarts.init(echartsElectric.value)
  electricChart.setOption(electricOpts)
}
function initTemperature() {
  tempOpts = {
    title: {
      text: '温度',
      textStyle: {
        fontSize: 14,
        fontWeight: 'bold',
      },
    },
    grid: {
      left: '2%',
      right: '2%',
      bottom: '2%',
      containLabel: true
    },
    series: [
      {
        type: 'gauge',
        center: ['50%', '60%'],
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 60,
        itemStyle: {
          color: '#FD7347'
        },
        progress: {
          show: true,
          width: 8
        },
        pointer: {
          show: false
        },
        axisLine: {
          show: false
        },
        axisTick: {
          show: false
        },
        splitLine: {
          show: false
        },
        axisLabel: {
          show: false
        },
        detail: {
          show: false
        },
      },
      {
        type: 'gauge',
        center: ['50%', '60%'],
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 60,
        splitNumber: 12,
        itemStyle: {
          color: '#FFAB9155'
        },
        progress: {
          show: true,
          width: 30
        },

        pointer: {
          show: false
        },
        axisLine: {
          lineStyle: {
            width: 30
          }
        },
        axisTick: {
          distance: -45,
          splitNumber: 5,
          lineStyle: {
            width: 1,
            color: '#999'
          }
        },
        splitLine: {
          distance: -52,
          length: 14,
          lineStyle: {
            width: 2,
            color: '#999'
          }
        },
        axisLabel: {
          distance: -8,
          color: '#999',
          fontSize: 12
        },
        anchor: {
          show: false
        },
        title: {
          show: false
        },
        detail: {
          valueAnimation: true,
          width: '50%',
          lineHeight: 40,
          borderRadius: 8,
          offsetCenter: [0, '-15%'],
          fontSize: 16,
          fontWeight: 'bolder',
          formatter: '{value} °C',
          color: 'inherit'
        },
      },
    ]
  }
  tempChart = echarts.init(echartsTemperature.value)
  tempChart.setOption(tempOpts)
}
function initHumidity() {
  humidityOpts = {
    title: {
      text: '湿度',
      textStyle: {
        fontSize: 14,
        fontWeight: 'bold',
      },
    },
    grid: {
      left: '2%',
      right: '2%',
      bottom: '2%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: []
    },
    yAxis: {
      type: 'value',
      boundaryGap: [0, '100%'],
    },
    series: {
      type: 'line',
      smooth: true,
      data: []
    }

  }

  humidityChart = echarts.init(echartsHumidity.value)
  humidityChart.setOption(humidityOpts)
}
async function onDeviceSelected(device: IOT.IOTDevice) {
  if (curDevice.value == null || curDevice.value.clientId != device.deviceId) {
    // this.curDevice = await deviceInfo(deviceId)
    curDevice.value = device
    deviceStore.updateDevice(curDevice.value.deviceId)
    isSubscribe.value = true
    commonStore.deviceTmpSubscribe(curDevice.value.deviceId)
  }
}
async function infoEdit(device: IOT.IOTDevice) {
  showInfoDialog.value = true
  curDevice.value = device
  deviceStore.updateDevice(curDevice.value.deviceId)
}
async function updateDeviceInfo() {
  updating.value = true
  await updateDevice(curDevice.value)
  updating.value = false
  showInfoDialog.value = false
}
function showRemoveConfirm(device: IOT.IOTDevice) {
  removeConfirmDialog.value = true
  curDevice.value = device
  deviceStore.updateDevice(curDevice.value.deviceId)
}
async function deleteDevice() {
  try {
    let result = await removeDevice(curDevice.value.deviceId)
    curDevice.value = null
    isSubscribe.value = false
    Notify({ type: 'success', message: result, duration: 500 })
  } catch (err) {
    Notify({ type: 'warning', message: err as string, duration: 500 })
  }
  removeConfirmDialog.value = false
}
function updateData() {
  if (tempOpts.series[0].data == null) {
    tempOpts.series[1].data = [{ value: deviceStore.temperature }]
  } else {
    tempOpts.series[1].data = tempOpts.series[0].data
  }
  tempOpts.series[0].data = [{ value: deviceStore.temperature }]
  tempChart.setOption(tempOpts)


  electricOpts.xAxis.data = this.xAxisLabel
  electricOpts.series[0].data = this.voltageData
  electricOpts.series[1].data = this.electricData
  electricChart.setOption(this.electricOpts)

  humidityOpts.xAxis.data = this.xAxisLabel
  humidityOpts.series.data = this.humidityData
  humidityChart.setOption(this.humidityOpts)
}

</script>
<style scoped>
.device-status {
  width: 10px;
  height: 10px;
  border-radius: 5px;
  background-color: green;
}

.single-line {
  max-width: 200px;
  font-size: 0.7rem;
  color: #34495e;
  padding: 5px;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.icon-wrapper {
  display: flex;
  width: 100%;
  justify-content: center;
}

.icon-subscribe {
  line-height: 24px;
  color: var(--van-gray-5);
}

.icon-subscribed {
  line-height: 24px;
  color: var(--van-blue);
}
</style>