<template>
  <van-col class="bg-border" style="height: calc(100% - 10px); width: 300px; padding: 0px">
    <div style="font-size: 0.8rem; padding: 10px; color: grey">
      {{ $t('settings.boardcast.onlineClient') }} [{{ commonStore.clientInfos.length }}]
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

    <van-grid :column-num="3" clickable style="max-height: calc(100vh - 91px); overflow-y: auto; overflow-x: hidden;">
      <van-grid-item v-for="item in commonStore.clientInfos" @click="showOpMenu(item)" badge="9"
        style="max-height: 80px">
        <template #text>
          <div class="single-line">{{ item.uid }}</div>
        </template>
        <template #icon>
          <van-icon class="iconfont icon-network-data" size="30" />
        </template>
      </van-grid-item>
    </van-grid>

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
  </van-col>
</template>
<script lang="ts" setup>
import { ref } from 'vue'
import { ProxyMock } from '../../../common/proxy.models'
import { useCommonStore } from '../../store'

const commonStore = useCommonStore()
const dialogVisible = ref(false)
const selectClient = ref<ProxyMock.ClientInfo>(null)
const broadcastMsg = ref('')
const imMsg = ref('')

function sendBroadcastMsg(): void {
  commonStore.publishMessage(this.broadcastMsg)
  // let msg: PushMsg<any> = {
  //   type: PushMsgType.TXT,
  //   payload: {
  //     type: BizType.IM,
  //     content: this.broadcastMsg
  //   }
  // }
  // this.sendMessage(msg)
  // this.broadcastMsg = ''
}

function sendMsg(): void {
  let msg: ProxyMock.PushMsg<any> = {
    to: this.selectClient.uid,
    type: ProxyMock.PushMsgType.TXT,
    payload: {
      type: ProxyMock.BizType.IM,
      content: imMsg.value,
    },
  }
  commonStore.sendMessage(msg)
  imMsg.value = null
}

function showOpMenu(client: ProxyMock.ClientInfo): void {
  dialogVisible.value = true
  selectClient.value = client
}

</script>
<style scoped>

</style>