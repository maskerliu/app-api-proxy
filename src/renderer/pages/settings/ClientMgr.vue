<template>
  <van-cell-group inset :title="$t('settings.broadcast.onlineClient') + '[' + clients.length + ']'">
    <van-field :placeholder="$t('settings.broadcast.placeholder')" v-model="broadcastMsg">
      <template #right-icon>
        <van-button plain size="small" type="primary" @click="sendBroadcastMsg">
          {{ $t('settings.broadcast.btnSend') }}
        </van-button>
      </template>
    </van-field>

    <OverlayScrollbarsComponent class="client-grid" :options="scrollOptions" defer>
      <van-grid :column-num="3" clickable>
        <van-grid-item v-for="item in clients" :key="item.uid" class="client-item" @click="showOpMenu(item)">
          <template #text>
            <span class="single-line">{{ item.uid }}</span>
          </template>
          <template #icon>
            <van-icon class="iconfont icon-network-data"
              :style="{ color: commonStore.uid == item.uid ? 'var(--van-success-color)' : 'var(--van-gray-5)' }" />
          </template>
        </van-grid-item>
      </van-grid>
    </OverlayScrollbarsComponent>

    <van-popup round v-model:show="dialogVisible" closeable close-icon="close" teleport="#app">
      <van-cell-group inset style="width: min(450px, calc(100vw - 60px)); margin: 15px">
        <van-field label="client id" :model-value="selectClient.uid" readonly />
        <van-field label="client key" :model-value="selectClient.connId" readonly />
        <van-field label="client ip" :model-value="`${selectClient.ip}:${selectClient.port}`" readonly />

        <van-field placeholder="请输入内容" v-model="imMsg">
          <template #right-icon>
            <van-button class="btn-icon-only" plain icon="guide-o" @click="sendMsg" size="small" />
          </template>
        </van-field>
      </van-cell-group>
    </van-popup>
  </van-cell-group>
</template>
<script lang="ts" setup>
import { showNotify } from 'vant'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { computed, onMounted, ref } from 'vue'
import { ProxyMock, getAllPushClients } from '@shared'
import { scrollOptions } from '../../common/scroll'
import { CommonStore } from '../../store'

const commonStore = CommonStore()
const dialogVisible = ref(false)
const selectClient = ref<ProxyMock.ClientInfo>()
const broadcastMsg = ref('')
const imMsg = ref('')

// 在线列表以下发推送为准，避免本地快照与真实连接状态不一致
const clients = computed(() => commonStore.clientInfos)

onMounted(async () => {
  try {
    const list = await getAllPushClients()
    if (commonStore.clientInfos.length === 0) commonStore.updateClientInfos(list ?? [])
  } catch (error) {
    showNotify(error)
  }
})

function sendBroadcastMsg(): void {
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
.client-grid {
  /* 客户端网格内滚动，避免大数量时把 Settings 页拉得过长；用视口比例替代魔法数字 */
  max-height: 50vh;
}

/* 卡片高度与图标尺寸改为随字号缩放：原先 80px + 30px 图标 + 120px 文本轨三重冻结，
   字号 10 时一张卡片里只剩几十像素留给 UID */
.client-item {
  max-height: calc(var(--van-font-size-md) * 6.2);
}

.client-item :deep(.van-icon) {
  font-size: calc(var(--van-font-size-md) * 2.3);
}

.single-line {
  max-width: calc(var(--van-font-size-md) * 9.2);
  font-size: var(--van-font-size-sm);
  color: var(--van-text-color);
  padding: var(--sp-tight);
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>