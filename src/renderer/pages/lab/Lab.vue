<template>
  <van-row gutter="24" class="full-row" justify="center" align="center">

    <van-col gutter="24" class="full-row bg-border" style="max-height: 174px;">
      <van-search v-model="searchKey" placeholder="请输入搜索关键词" background="#4fc08d" />
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

    <van-row gutter="24" class="full-row bg-border" justify="center" style="height: calc(100% - 276px); padding: 5px; overflow-y: auto;">
      <van-col span="9" style="min-width: 360px; padding:0;">
        <div ref="echartsElectric" style="width:100%; height:260px;"></div>
        <div>
          <van-switch v-model="test" />
        </div>
      </van-col>
      <van-col span="6" style="min-width: 260px; padding: 0;">
        <div ref="echartsTemperature" style="width: 100%; height: 260px;"></div>
      </van-col>
      <van-col span="9" style="min-width: 360px; padding: 0;">
        <div ref="echartsHumidity" style="width: 100%; height: 260px;">
        </div>
        <div>
          <van-switch v-model="test" />
        </div>
      </van-col>
    </van-row>
    <van-popup v-model:show="showInfoDialog" :close-on-click-overlay="false" style="padding: 5px;">
      <van-form style="margin-top: 15px; width: 100%" label-align="right" label-width="4em" colon>
        <van-field label="设备号" :model-value="curDevice.deviceId" readonly />
        <van-field label="地址" v-model="curDevice.address" placeholder="设备所在地" />
        <amap-viewer style="width: 500px; height: 300px;" v-model:lng="curDevice.lng" v-model:lat="curDevice.lat"
          v-model:address="curDevice.address"></amap-viewer>
        <div align="end" style="padding: 10px;">
          <van-button plain type="default" size="small" @click="showInfoDialog = false">取消</van-button>
          <van-button plain type="primary" size="small" :loading="updating" @click="updateDeviceInfo"
            style="margin-left: 20px;">确定
          </van-button>
        </div>
      </van-form>
    </van-popup>

    <van-dialog v-model:show="removeConfirmDialog" title="警告❗️" show-cancel-button confirmButtonText="删除"
      confirmButtonColor="#ee0a24" @confirm="deleteDevice">
      <div style="font-size: 0.8rem; padding: 15px;">
        <p>确定要从系统中移除【{{ curDevice.deviceId }}】这台设备吗？</p>
        <p>设备移除后，设备上的数据将在系统中无法收集，请谨慎操作！！！</p>
      </div>
    </van-dialog>

  </van-row>
</template>

<script lang="ts">
import { defineAsyncComponent, defineComponent, provide } from 'vue'

import {
  BarChart, BarSeriesOption, GaugeChart,
  GaugeSeriesOption, LineChart,
  LineSeriesOption
} from 'echarts/charts'
import {
  DatasetComponent,
  DatasetComponentOption, GridComponent,
  GridComponentOption, LegendComponent,
  LegendComponentOption, TitleComponent,
  TitleComponentOption,
  TooltipComponent,
  TooltipComponentOption,
  TransformComponent
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { LabelLayout, UniversalTransition } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'

import { mapActions, mapState, mapWritableState } from 'pinia'
import { removeDevice, searchDevices, updateDevice } from '../../../common/iot.api'
import { IOT } from '../../../common/iot.models'
import { useCommonStore } from '../../store'
import { useIOTDeviceStore } from '../../store/IOTDevices'

import { Notify } from 'vant'


type ECOption = echarts.ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | TitleComponentOption
  | TooltipComponentOption
  | GridComponentOption
  | DatasetComponentOption
  | DatasetComponentOption
  | LegendComponentOption
  | GaugeSeriesOption
>

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

const Lab = defineComponent({
  name: "Lab",
  components: {
    AmapViewer: defineAsyncComponent(() => import('../components/AmapViewer.vue'))
  },
  setup() {
    provide('echarts', echarts)
  },
  data() {
    return {
      isSubscribe: false,
      searchKey: null as string,
      test: false,
      electricChart: null as ECOption,
      tempChart: null as ECOption,
      humidityChart: null as ECOption,
      electricOpts: {} as ECOption,
      tempOpts: {} as ECOption,
      humidityOpts: {} as ECOption,
      devices: [] as Array<IOT.IOTDevice>,
      showInfoDialog: false,
      removeConfirmDialog: false,
      curDevice: null as IOT.IOTDevice,
      updating: false,
    }
  },
  computed: {
    ...mapState(useIOTDeviceStore, ['temperature', 'humidityData', 'voltageData', 'electricData', 'xAxisLabel']),
    ...mapWritableState(useIOTDeviceStore, ['curDeviceId'])
  },
  mounted() {
    console.log('mounted')
    this.initElectric()
    this.initTemperature()
    this.initHumidity()
  },
  methods: {
    ...mapActions(useIOTDeviceStore, ['updateDevice']),
    ...mapActions(useCommonStore, ['rebootDevice', 'deviceTmpSubscribe', 'deviceTmpUnsubscribe']),
    initElectric() {
      this.electricOpts = {
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

      this.electricChart = echarts.init(this.$refs.echartsElectric)
      this.electricChart.setOption(this.electricOpts)
    },
    initTemperature() {
      this.tempOpts = {
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
      this.tempChart = echarts.init(this.$refs.echartsTemperature)
      this.tempChart.setOption(this.tempOpts)
    },
    initHumidity() {
      this.humidityOpts = {
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

      this.humidityChart = echarts.init(this.$refs.echartsHumidity)
      this.humidityChart.setOption(this.humidityOpts)
    },
    async onDeviceSelected(device: IOT.IOTDevice) {
      if (this.curDevice == null || this.curDevice.clientId != device.deviceId) {
        // this.curDevice = await deviceInfo(deviceId)
        this.curDevice = device
        this.updateDevice(this.curDevice.deviceId)
        this.isSubscribe = true
        this.deviceTmpSubscribe(this.curDevice.deviceId)
      }
    },
    async infoEdit(device: IOT.IOTDevice) {
      this.showInfoDialog = true
      this.curDevice = device
      this.updateDevice(this.curDevice.deviceId)
    },
    async updateDeviceInfo() {
      this.updating = true
      await updateDevice(this.curDevice)
      this.updating = false
      this.showInfoDialog = false
    },
    showRemoveConfirm(device: IOT.IOTDevice) {
      this.removeConfirmDialog = true
      this.curDevice = device
      this.updateDevice(this.curDevice.deviceId)
    },
    async deleteDevice() {
      try {
        let result = await removeDevice(this.curDevice.deviceId)
        this.curDevice = null
        this.isSubscribe = false
        Notify({ type: 'success', message: result, duration: 500 })
      } catch (err) {
        Notify({ type: 'warning', message: err as string, duration: 500 })
      }
      this.removeConfirmDialog = false
    },
    updateData() {
      if (this.tempOpts.series[0].data == null) {
        this.tempOpts.series[1].data = [{ value: this.temperature }]
      } else {
        this.tempOpts.series[1].data = this.tempOpts.series[0].data
      }
      this.tempOpts.series[0].data = [{ value: this.temperature }]
      this.tempChart.setOption(this.tempOpts)


      this.electricOpts.xAxis.data = this.xAxisLabel
      this.electricOpts.series[0].data = this.voltageData
      this.electricOpts.series[1].data = this.electricData
      this.electricChart.setOption(this.electricOpts)

      this.humidityOpts.xAxis.data = this.xAxisLabel
      this.humidityOpts.series.data = this.humidityData
      this.humidityChart.setOption(this.humidityOpts)
    }
  },
  watch: {
    async searchKey() {
      this.devices = await searchDevices(this.searchKey)
    },
    temperature() {
      this.updateData()
    },
    isSubscribe() {
      if (this.curDevice != null) {
        if (this.isSubscribe) {
          this.deviceTmpSubscribe(this.curDevice.deviceId)
        } else {
          this.deviceTmpUnsubscribe(this.curDevice.deviceId)
        }
      }
    }
  }
})

export default Lab
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