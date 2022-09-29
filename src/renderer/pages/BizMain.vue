<template>
  <van-row class="full-row">
    <router-view class="biz-content"></router-view>
    <van-tabbar route v-model="active">
      <van-tabbar-item replace to="/proxy">
        <template #icon>
          <van-icon class="iconfont icon-mock" size="22" />
        </template>
      </van-tabbar-item>
      <van-tabbar-item replace to="/mockRuleMgr">
        <template #icon>
          <van-icon class="iconfont icon-lab" size="22" />
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

<script lang="ts" src="./BizMain.vue.ts"></script>

<style>
.full-row {
  width: 100%;
  height: 100%;
  background: #eee;
  overflow: hidden;
}
.drag-bar {
  width: 100%;
  padding-top: 26px;
  -webkit-app-region: drag;
  background: white;
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
</style>
