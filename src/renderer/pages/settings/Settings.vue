<template>
  <van-row class="full-row" justify="space-around" style="overflow-y: auto">
    <client-mgr />

    <van-col style="flex: 1; min-width: 375px; padding: 15px 0; height: 100%; overflow-y: auto;">
      <van-form style="margin-top: 15px; width: 100%" label-align="right" colon>
        <sys-info />
        <game-bundle-mgr />
        <local-resource-mgr />
      </van-form>
    </van-col>
  </van-row>
</template>

<script lang="ts" setup>
import { onMounted } from 'vue'

import ClientMgr from './ClientMgr.vue'
import GameBundleMgr from './GameBundleMgr.vue'
import LocalResourceMgr from './LocalResourceMgr.vue'
import SysInfo from './SysInfo.vue'

class Test {
  name: string
  title: string

  constructor(name?: string, title?: string) {
    this.name = name
    this.title = title
  }
}

class Hello {
  test: string

  constructor(test: string) {
    this.test = test
  }
}

onMounted(() => {
  let test = new Test('chris', 'xxxxx')
  let test2 = new Test('tom', 'ooooo')
  Reflect.set(Test.prototype, 'test', new Hello('test'))
  Reflect.set(Test.prototype, 'print', function () {
    console.log(this.name)
  })
  console.log(test['test'])
  test['test'].test = 'world'
  Reflect.apply(Reflect.get(Test.prototype, 'print'), test, [])
  console.log(test2['test'])
  Reflect.apply(Reflect.get(Test.prototype, 'print'), test2, [])
})

</script>
<style>
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