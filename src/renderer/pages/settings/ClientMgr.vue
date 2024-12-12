<template>
  <van-cell-group inset :title="$t('settings.boardcast.onlineClient') + '[' + clients.length + ']'">
    <van-field :placeholder="$t('settings.boardcast.placeholder')" v-model="broadcastMsg">
      <template #right-icon>
        <van-button plain size="small" type="primary" @click="sendBroadcastMsg">
          {{ $t('settings.boardcast.btnSend') }}
        </van-button>
      </template>
    </van-field>

    <van-grid :column-num="3" clickable style="max-height: calc(100vh - 91px); overflow-y: scroll;">
      <van-grid-item v-for="item in clients" @click="showOpMenu(item)" badge="9" style="max-height: 80px">
        <template #text>
          <span class="single-line">{{ item.uid }}</span>
        </template>
        <template #icon>
          <van-icon class="iconfont icon-network-data" size="30"
            :style="{ color: commonStore.uid == item.uid ? 'green' : 'gray' }" />
        </template>
      </van-grid-item>
    </van-grid>

    <van-popup round v-model:show="dialogVisible" closeable close-icon="close" teleport="#app">
      <van-form style="width: 450px; margin: 15px">
        <van-field label="client id" :model-value="selectClient.uid" readonly />
        <van-field label="client key" :model-value="selectClient.connId" readonly />
        <van-field label="client ip" :model-value="`${selectClient.ip}:${selectClient.port}`" readonly />

        <van-field placeholder="请输入内容" v-model="imMsg">
          <template #right-icon>
            <van-button plain icon="guide-o" @click="sendMsg" size="small" />
          </template>
        </van-field>
      </van-form>
    </van-popup>
  </van-cell-group>
</template>
<script lang="ts" setup>
import { showNotify } from 'vant'
import { onMounted, ref } from 'vue'
import { ProxyMock } from '../../../common'
import { CommonStore } from '../../store'

const commonStore = CommonStore()
const dialogVisible = ref(false)
const selectClient = ref<ProxyMock.ClientInfo>()
const broadcastMsg = ref('')
const clients = ref<ProxyMock.ClientInfo[]>([])
const imMsg = ref('')

onMounted(async () => {
  try {
    clients.value = await ProxyMock.getAllPushClients()
  } catch (error) {
    showNotify(error)
  }
})

function sendBroadcastMsg(): void {
  commonStore.publishMessage(broadcastMsg.value)
  let msg: ProxyMock.PushMsg<any> = {
    type: ProxyMock.PushMsgType.TXT,
    payload: {
      type: ProxyMock.BizType.IM,
      content: broadcastMsg.value
    }
  }
  commonStore.sendMessage(msg)
  broadcastMsg.value = ''
}

function sendMsg(): void {
  let msg: ProxyMock.PushMsg<any> = {
    to: selectClient.value.uid,
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
.single-line {
  max-width: 120px;
  font-size: 0.7rem;
  color: var(--van-text-color);
  padding: 5px;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>