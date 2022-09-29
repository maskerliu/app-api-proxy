<template>
  <biz-main v-if="canRender" />
</template>

<script lang="ts" src="./App.vue.ts"></script>

<style>
#app {
  font-family: "Microsoft YaHei", 微软雅黑, "MicrosoftJhengHei", 华文细黑,
    STHeiti, MingLiu, monospace;
  background: transparent;
  letter-spacing: 1px;
  -moz-user-select: none;
  -webkit-user-select: none;
  -ms-user-select: none;
  user-select: none;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.bg-border {
  margin: 5px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid #e1e1e1;
  box-shadow: 0px 12px 8px -12px #000;
}

.biz-content {
  width: 100%;
  height: calc(100% - 76px);
  margin: 24px 0 50px 0;
  background: #f1f2f6;
  overflow-y: scroll;
}

</style>
