<template>
  <div class="container" :class="{ 'full-screen-container': isFullScreen }">
    <div ref="jsonEditorVue" class="json-editor-vue" />
    <div
      class="full-screen"
      :class="{
        show: showFullScreen,
        right: !hasLogo,
      }"
      @click="toggleFullScreen"
    />
  </div>
</template>

<script lang="ts" src="./VueJsonEditor.vue.ts"></script>

<style scoped>
.container {
  position: relative;
}
.full-screen-container {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999999999999;
  width: auto !important;
  height: auto !important;
}
.json-editor-vue {
  width: 100%;
  height: 100%;
}
code {
  background-color: #f5f5f5;
}
.full-screen {
  position: absolute;
  display: none;
  top: 8px;
  right: 110px;
  width: 22px;
  height: 22px;
  border-radius: 2px;
  cursor: pointer;
  background-size: cover;
  background-image: url("data:image/svg+xml,%3Csvg t='1635416254060' viewBox='0 0 1024 1024' version='1.1' xmlns='http://www.w3.org/2000/svg' p-id='42247' width='128' height='128'%3E%3Cpath d='M240.8 196l178.4 178.4-45.6 45.6-177.6-179.2-68 68V128h180.8l-68 68z m133.6 408.8L196 783.2 128 715.2V896h180.8l-68-68 178.4-178.4-44.8-44.8zM715.2 128l68 68-178.4 178.4 45.6 45.6 178.4-178.4 68 68V128H715.2z m-65.6 476.8l-45.6 45.6 178.4 178.4-68 68H896V715.2l-68 68-178.4-178.4z' p-id='42248' fill='%23ffffff'%3E%3C/path%3E%3C/svg%3E");
}
.full-screen-container .full-screen {
  background-image: url("data:image/svg+xml,%3Csvg t='1635416420969' viewBox='0 0 1024 1024' version='1.1' xmlns='http://www.w3.org/2000/svg' p-id='42490' width='128' height='128'%3E%3Cpath d='M142.4 96.8l-44.8 44.8 173.6 174.4-68 68H384V203.2l-67.2 67.2zM752.8 316l173.6-174.4-44.8-44.8-174.4 173.6-67.2-67.2V384h180.8zM270.4 707.2l-169.6 170.4 44.8 49.6 170.4-174.4 68 68V640H203.2zM820.8 640H640v180.8l68-68 170.4 174.4 44.8-49.6-169.6-170.4z' p-id='42491' fill='%23ffffff'%3E%3C/path%3E%3C/svg%3E");
}
.show {
  display: block;
}
.right {
  right: 15px;
}
.full-screen:hover {
  border: 1px solid #d7e6fe;
}
</style>