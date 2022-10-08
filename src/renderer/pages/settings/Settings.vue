<template>
  <van-row class="full-row" gutter="24" justify="space-around">
    <van-col
      span="7"
      class="bg-border"
      style="height: calc(100% - 10px); padding: 0px"
    >
      <div style="font-size: 0.8rem; padding: 10px; color: grey">
        在线Client [{{ clientInfos.length }}]
      </div>
      <van-field placeholder="请输入内容" v-model="broadcastMsg">
        <template #left-icon>
          <van-icon class="iconfont icon-broadcastMsg" />
        </template>
        <template #right-icon>
          <van-button
            plain
            size="small"
            type="primary"
            @click="sendBroadcastMsg"
            >发送</van-button
          >
        </template>
      </van-field>

      <van-grid
        :column-num="3"
        clickable
        style="
          max-height: calc(100% - 91px);
          overflow-y: auto;
          overflow-x: hidden;
        "
      >
        <van-grid-item
          v-for="item in clientInfos"
          :key="item.key"
          @click="showOpMenu(item)"
          badge="9"
          style="max-height: 80px"
        >
          <template #text>
            <div class="single-line">{{ item.uid }}</div>
          </template>
          <template #icon>
            <van-icon class="iconfont icon-network-data" size="30" />
          </template>
        </van-grid-item>
      </van-grid>
    </van-col>

    <van-col span="16" class="bg-border">
      <van-form style="margin-top: 15px; width: 100%" label-align="right" colon>
        <van-cell-group inset>
          <van-field label="网卡选择" label-width="10rem" readonly>
            <template #input>
              <van-popover
                v-model:show="showPopover"
                placement="bottom-start"
                style="width: 300px"
              >
                <van-cell
                  v-for="(item, idx) in serverConfig.ips"
                  :key="idx"
                  :title="item.name"
                  :value="item.address"
                  clickable
                  is-link
                  @click="onSelectIP(item)"
                />
                <template #reference>
                  <div style="width: 300px; height: 1rem; padding: 2px; margin-top: -5px;">
                    {{ curServerIp?.address }}
                  </div>
                </template>
              </van-popover>
            </template>
          </van-field>

          <van-field
            :label="item.tooltip"
            label-width="10rem"
            v-for="(item, idx) in perferences"
            :key="idx"
            :model-value="serverConfig[item.key]"
            readonly
          />
        </van-cell-group>
        <div style="margin: 16px">
          <van-button block plain type="primary" native-type="submit">
            提交
          </van-button>
        </div>
      </van-form>
    </van-col>

    <van-popup
      class="bg-border"
      v-model:show="dialogVisible"
      closeable
      close-icon="close"
    >
      <van-form style="width: 450px; margin: 15px">
        <van-field label="client id" :model-value="selectClient.uid" readonly />
        <van-field
          label="client key"
          :model-value="selectClient.key"
          readonly
        />
        <van-field
          label="client ip"
          :model-value="`${selectClient.ip}:${selectClient.port}`"
          readonly
        />

        <van-field placeholder="请输入内容" v-model="imMsg">
          <template #right-icon>
            <van-button plain icon="guide-o" @click="sendMsg" size="small" />
          </template>
        </van-field>
      </van-form>
    </van-popup>
  </van-row>
</template>

<script lang="ts" src="./Settings.vue.ts"></script>
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