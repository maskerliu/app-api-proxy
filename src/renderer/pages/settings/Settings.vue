<template>
  <van-row class="full-row" gutter="24" justify="space-around" style="overflow-y: auto">
    <van-col class="bg-border" style="height: calc(100% - 10px); width: 300px; padding: 0px">
      <div style="font-size: 0.8rem; padding: 10px; color: grey">
        {{ $t('settings.boardcast.onlineClient') }} [{{ clientInfos.length }}]
      </div>
      <van-field :placeholder="$t('settings.boardcast.placeholder')" v-model="broadcastMsg">
        <template #left-icon>
          <van-icon class="iconfont icon-broadcastMsg" />
        </template>
        <template #right-icon>
          <van-button plain size="small" type="primary" @click="sendBroadcastMsg">
            {{ $t('settings.boardcast.btnSend') }}
          </van-button>
        </template>
      </van-field>

      <van-grid :column-num="3" clickable style="
          max-height: calc(100vh - 91px);
          overflow-y: auto;
          overflow-x: hidden;
        ">
        <van-grid-item v-for="item in clientInfos" :key="item.key" @click="showOpMenu(item)" badge="9"
          style="max-height: 80px">
          <template #text>
            <div class="single-line">{{ item.uid }}</div>
          </template>
          <template #icon>
            <van-icon class="iconfont icon-network-data" size="30" />
          </template>
        </van-grid-item>
      </van-grid>
    </van-col>

    <van-col  style="flex: 1; min-width: 375px; padding: 0;">
      <van-form style="margin-top: 15px; width: 100%" label-align="right" colon>
        <van-cell-group inset>
          <van-field :label="$t('settings.server')" label-width="10rem" readonly>
            <template #input>
              <van-popover v-model:show="showPopover" placement="bottom-start" style="width: 300px"
                v-if="serverConfig.ips">
                <van-cell v-for="(item, idx) in serverConfig.ips" :key="idx" :title="item.name" :value="item.address"
                  clickable is-link @click="onSelectIP(item)" />
                <template #reference>
                  <div style="
                      width: 300px;
                      height: 1rem;
                      padding: 2px;
                      margin-top: -5px;
                    ">
                    {{ curServerIp?.address }}
                  </div>
                </template>
              </van-popover>
            </template>
          </van-field>

          <van-field :label="item.tooltip" label-width="10rem" v-for="(item, idx) in perferences" :key="idx"
            :model-value="serverConfig[item.key]" readonly />
        </van-cell-group>
      </van-form>
    </van-col>

    <van-popup class="bg-border" v-model:show="dialogVisible" closeable close-icon="close">
      <van-form style="width: 450px; margin: 15px">
        <van-field label="client id" :model-value="selectClient.uid" readonly />
        <van-field label="client key" :model-value="selectClient.key" readonly />
        <van-field label="client ip" :model-value="`${selectClient.ip}:${selectClient.port}`" readonly />

        <van-field placeholder="请输入内容" v-model="imMsg">
          <template #right-icon>
            <van-button plain icon="guide-o" @click="sendMsg" size="small" />
          </template>
        </van-field>
      </van-form>
    </van-popup>
  </van-row>
</template>

<script lang="ts">
import { mapActions, mapState } from 'pinia'
import { defineComponent } from 'vue'
import { IP } from '../../../common/base.models'
import { ProxyMock } from '../../../common/proxy.models'
import { useCommonStore } from '../../store'

type SettingPreference = {
  key: string
  tooltip: string
  hasStatus?: boolean
  statusKey?: string
}

class Test {
  name: string
  title: string

  constructor(name?: string, title?: string) {
    this.name = name
    this.title = title
  }
}

class Hello {
  test: string

  constructor(test: string) {
    this.test = test
  }
}

const Settings = defineComponent({
  name: 'Settings',
  data() {
    return {
      dialogVisible: false,
      selectClient: null as ProxyMock.MsgPushClient,
      broadcastMsg: null as string,
      imMsg: null as string,
      perferences: [
        { tooltip: this.$t('settings.port'), key: 'port' },
        { tooltip: this.$t('settings.proxySocketPort'), key: 'proxySocketPort' },
        { tooltip: this.$t('settings.apiDefineServer'), key: 'apiDefineServer' },
        { tooltip: this.$t('settings.statRuleServer'), key: 'statRuleServer' },
        {
          tooltip: this.$t('settings.dataProxyServer'),
          key: 'dataProxyServer',
          hasStatus: true,
          statusKey: 'dataProxyStatus',
        },
        {
          tooltip: this.$t('settings.mqttBroker'),
          key: 'mqttBroker',
        },
      ] as Array<SettingPreference>,
      curServerIp: null as IP,
      showPopover: false,
    }
  },
  computed: {
    ...mapState(useCommonStore, ['serverConfig', 'clientInfos']),
  },
  mounted() {
    if (this.serverConfig.ips) this.curServerIp = this.serverConfig.ips[0]
    let test = new Test('chris', 'xxxxx')
    let test2 = new Test('tom', 'ooooo')
    Reflect.set(Test.prototype, 'test', new Hello('test'))
    Reflect.set(Test.prototype, 'print', function () {
      console.log(this.name)
    })
    console.log(test['test'])
    test['test'].test = 'world'
    Reflect.apply(Reflect.get(Test.prototype, 'print'), test, [])
    console.log(test2['test'])
    Reflect.apply(Reflect.get(Test.prototype, 'print'), test2, [])
  },
  methods: {
    ...mapActions(useCommonStore, ['sendMessage', 'publishMessage']),
    onSelectIP(ip: IP) {
      this.curServerIp = ip
      this.showPopover = false
    },
    sendBroadcastMsg(): void {
      this.publishMessage(this.broadcastMsg)
      // let msg: PushMsg<any> = {
      //   type: PushMsgType.TXT,
      //   payload: {
      //     type: BizType.IM,
      //     content: this.broadcastMsg
      //   }
      // }
      // this.sendMessage(msg)
      // this.broadcastMsg = ''
    },
    sendMsg(): void {
      let msg: ProxyMock.PushMsg<any> = {
        to: this.selectClient.uid,
        type: ProxyMock.PushMsgType.TXT,
        payload: {
          type: ProxyMock.BizType.IM,
          content: this.imMsg,
        },
      }
      this.sendMessage(msg)
      this.imMsg = ''
    },
    showOpMenu(client: ProxyMock.ClientInfo): void {
      this.dialogVisible = true
      this.selectClient = client
    },
  },
  watch: {
    serverConfig() {
      if (this.serverConfig.ips) this.curServerIp = this.serverConfig.ips[0]
    },
  },
})

export default Settings
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