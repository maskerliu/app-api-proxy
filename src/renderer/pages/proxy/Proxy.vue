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
          v-for="key in [...records.keys()].reverse()"
          :key="key"
          :source="records.get(key)"
        />
      </van-list>
    </van-col>

    <van-col ref="resizeBar" class="resize-bar">
      <div class="division-line"></div>
      <i class="iconfont icon-division division" @mousedown.stop.prevent="resizeDown"></i>
    </van-col>

    <van-col ref="rightDom" class="right-panel">
      <proxy-request-detail
        :record="records.get(curRecordId) as ProxyRequestRecord"
        v-if="curRecordId != -1 && records.get(curRecordId).type !== 5020"
      />
      <proxy-stat-detail
        :record="records.get(curRecordId) as ProxyStatRecord"
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

<script lang="ts" >
import { mapActions, mapState, mapWritableState } from "pinia";
import QrcodeVue from "qrcode.vue";
import { Notify } from "vant";
import { defineComponent } from "vue";
import { ProxyRequestRecord, ProxyStatRecord } from "../../../common/models";
import { mockRegister, setProxyDelay } from "../../../common/remoteApis";
import { useCommonStore } from "../../store";
import { useProxyRecordStore } from "../../store/ProxyRecords";
import ProxyRecordSnap from "./ProxyRecordSnap.vue";
import ProxyRequestDetail from "./ProxyRequestDetail.vue";
import ProxyStatDetail from "./ProxyStatDetail.vue";

export default defineComponent({
  name: "Proxy",
  components: {
    QrcodeVue,
    ProxyRecordSnap,
    ProxyRequestDetail,
    ProxyStatDetail,
  },
  data() {
    return {
      active: 0 as number,
      navTitle: "" as string,
      proxyDelay: "0" as string,
      filterInput: null as string,
      activeTab: "0" as string,
      clientStartX: 0,
    };
  },
  created() {
    this.$router.beforeEach((to: any, from: any) => {
      this.navTitle = to.name;
      return true;
    });
  },
  mounted() {
  },
  computed: {
    ...mapState(useCommonStore, ["registerUrl"]),
    ...mapWritableState(useCommonStore, ["showQrCode"]),
    ...mapState(useProxyRecordStore, ["records", "isChanged"]),
    ...mapWritableState(useProxyRecordStore, [
      "proxyTypes",
      "filterKeyword",
      "curRecordId",
    ]),
  },
  methods: {
    ...mapActions(useProxyRecordStore, [
      "updateFilter",
      "clearRecords",
      "mockRecord",
    ]),
    onLeftNavBtnClicked() {
      if (this.navBar.leftAction != null) {
        this.navBar.leftAction();
      } else {
        this.$router.go(-1);
      }
    },
    resizeDown(e: MouseEvent) {
      this.clientStartX = e.clientX;
      document.onmousemove = (e) => {
        this.moveHandle(e.clientX);
        return false;
      };

      document.onmouseup = () => {
        document.onmousemove = null;
        document.onmouseup = null;
      };
      return false;
    },
    moveHandle(curWidth: any) {
      let changeWidth = curWidth - 85;
      if (changeWidth < 300) {
        changeWidth = 300;
        curWidth = 330;
      }
      let remainWidth = this.$refs.container.$el.clientWidth - changeWidth - 20;
      this.$refs.leftDom.$el.style.width = changeWidth + "px";
      this.$refs.rightDom.$el.style.width = remainWidth + "px";
    },
    onRightNavBtnClicked() {
      this.navBar.rightAction();
    },
    click2Reg() {
      mockRegister().then((resp) => {
        this.showQrCode = resp == null;
      });
    },
  },
  watch: {
    isChanged() {
      this.$refs.snaplist.$el.scrollTo({ top: 0, behavior: "smooth" });
    },
    filterKeyword() {
      this.updateFilter();
    },
    proxyTypes() {
      this.updateFilter();
    },
    async proxyDelay() {
      try {
        await setProxyDelay(Number(this.proxyDelay));
        Notify({ message: "成功设置延迟", type: "success" });
      } catch (err) {
        Notify({ message: "设置延迟失败", type: "danger" });
      }
    },
  },
});

// export default Proxy
</script>

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

.resize-bar .division:hover {
  cursor: col-resize;
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
