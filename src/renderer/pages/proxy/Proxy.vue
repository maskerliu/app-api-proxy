<template>
  <van-row ref="container" class="full-row">
    <van-col ref="leftDom" class="bg-border left-panel">
      <van-checkbox-group
        size="mini"
        v-model="proxyTypes"
        direction="horizontal"
        style="width: 100%; padding: 5px 5px; boder: 1px solid grey"
      >
        <van-checkbox shape="square" name="5010" style="padding: 5px 10px">
          <i class="iconfont icon-api" style="font-weight: blod" />
        </van-checkbox>
        <van-checkbox shape="square" name="5020" style="padding: 5px 10px">
          <van-icon class="iconfont icon-maidian" style="font-weight: blod" />
        </van-checkbox>
        <van-checkbox shape="square" name="5030" style="padding: 5px 10px">
          <van-icon class="iconfont icon-shuiguan" style="font-weight: blod" />
        </van-checkbox>
        <van-icon
          class="iconfont icon-qrcode"
          style="font-size: 1.9rem; margin: 6px"
          @click="showQrCode = true"
        />
      </van-checkbox-group>

      <van-field
        v-model="proxyDelay"
        label="延时时长"
        type="number"
        right-icon="warning-o"
      />

      <van-field
        left-icon="filter-o"
        v-model="filterKeyword"
        placeholder="筛选关键字"
        clearable
        center
        style="margin-top: 10px"
      >
        <template #button>
          <van-button
            plain
            size="small"
            type="primary"
            @click="mockRecord"
            icon="delete-o"
          ></van-button>
        </template>
      </van-field>

      <van-list class="record-snap-panel" ref="snaplist">
        <proxy-record-snap
          :source="records.get(key)"
          v-for="key in [...records.keys()].reverse()"
          :key="key"
        />
      </van-list>
    </van-col>

    <van-col ref="resizeBar" class="resize-bar">
      <div class="division-line"></div>
      <i class="iconfont icon-division division"></i>
    </van-col>

    <van-col ref="rightDom" class="right-panel">
      <proxy-request-detail
        :record="records.get(curRecordId)"
        v-if="curRecordId != -1 && records.get(curRecordId).type !== 5020"
      />
      <proxy-stat-detail
        :record="records.get(curRecordId)"
        v-if="curRecordId != -1 && records.get(curRecordId).type == 5020"
      />
    </van-col>

    <van-popup
      title="扫描二维码访问："
      v-model:show="showQrCode"
      :show-confirm-button="false"
      :show-cancel-button="false"
    >
      <qrcode-vue :value="registerUrl" :size="300" center style="margin: 5px" />
      <div class="register-url" @click="click2Reg">
        {{ registerUrl }}
      </div>
    </van-popup>
  </van-row>
</template>

<script lang="ts" src="./Proxy.vue.ts"></script>

<style scoped>
.left-panel {
  margin: 5px;
  width: 300px;
  height: calc(100% - 10px);
}
.record-snap-panel {
  height: calc(100% - 165px);
  overflow-y: auto;
  overflow-x: hidden;
  margin: 15px 0 10px;
}

.resize-bar {
  position: relative;
  width: 10px;
  height: calc(100% - 10px);
  margin-top: 5px;
  text-align: center;
}

.resize-bar:hover {
  cursor: col-resize;
}
.right-panel {
  flex: 1;
  padding: 0;
  height: 100%;
}

.resize-bar .division-line {
  width: 1px;
  height: 100%;
  position: absolute;
  left: 4px;
  z-index: 0;
  border-left: 2px dotted #d6d6d6;
}

.resize-bar .division {
  font-size: 0.7rem;
  font-weight: bold;
  color: grey;
  position: relative;
  top: 50%;
  transform: translateY(-50%);
}

.register-url {
  width: 300px;
  color: #777;
  padding: 5px;
  font-size: 0.8rem;
  user-select: text;
  word-break: break-all;
}
</style>
