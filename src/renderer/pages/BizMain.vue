<template>
  <van-row class="full-row">
    <div class="drag-bar"></div>
    <router-view class="biz-content" v-slot="{ Component, route }">
      <transition name="fade">
        <component :is="Component" :key="route.path" />
      </transition>
    </router-view>
    <van-tabbar route v-model="active">
      <van-tabbar-item replace to="/proxy">
        <template #icon>
          <van-icon class="iconfont icon-mock" size="22" />
        </template>
      </van-tabbar-item>
      <van-tabbar-item replace to="/mockRuleMgr">
        <template #icon>
          <van-icon class="iconfont icon-rule" size="22" />
        </template>
      </van-tabbar-item>
      <van-tabbar-item replace to="/lab" dot>
        <template #icon>
          <van-icon class="iconfont icon-lab" size="22" />
        </template>
      </van-tabbar-item>
      <van-tabbar-item replace to="/message" badge="5">
        <template #icon>
          <van-icon class="iconfont icon-msg-read" size="22" />
        </template>
      </van-tabbar-item>
      <van-tabbar-item replace to="/settings">
        <template #icon>
          <van-icon class="iconfont icon-setting" size="22" />
        </template>
      </van-tabbar-item>
    </van-tabbar>
    <debug-panel />
  </van-row>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import DebugPanel from './components/DebugPanel.vue'

export default defineComponent({
  name: "BizMain",
  components: {
    DebugPanel
  },
  setup() {

  },
  data() {
    return {
      active: 0,
      navTitle: "",
    }
  },
  created() {
    this.$router.beforeEach((to: any, from: any) => {
      this.navTitle = to.name
      return true
    })
  },
  mounted() {
    this.$router.replace("/lab")
    this.active = 1
  },
})

</script>

<style>
.full-row {
  width: 100%;
  height: 100%;
  background: #eee;
  overflow: hidden;
}

::-webkit-scrollbar {
  width: 4px;
  height: 4px;
  scrollbar-arrow-color: red;
}
::-webkit-scrollbar-thumb {
  border-radius: 5px;
  box-shadow: inset 0 0 5px rgba(125, 125, 125, 0.1);
  -webkit-box-shadow: inset 0 0 5px rgba(125, 125, 125, 0.1);
  background: rgba(0, 0, 0, 0.2);
  scrollbar-arrow-color: red;
}
::-webkit-scrollbar-track {
  box-shadow: inset 0 0 5px rgba(125, 125, 125, 0.2);
  -webkit-box-shadow: inset 0 0 5px rgba(125, 125, 125, 0.2);
  border-radius: 0;
  background: rgba(0, 0, 0, 0.1);
}

.fade-enter-active {
  animation: bounce-in 0.5s ease-in;
}

.fade-leave-active {
  animation: bounce-out 0.5s ease-out;
}

@keyframes bounce-in {
  0% {
    opacity: 0.0;
  }
  100% {
    opacity: 1.;
  }
}

@keyframes bounce-out {
  0% {
    opacity: 1.0;
  }
  100% {
    opacity: 0.0;
  }
}

</style>
