<template>
  <van-form style="width: 80vw; min-width: 375px; height: 100%; padding-top: 12px; overflow-y: auto; "
    label-align="right" colon>
    <sys-info />

    <van-cell-group inset title=" ">
      <van-field center :label="$t('settings.sys.theme')" label-width="10rem" :readonly="true">
        <template #right-icon>
          <van-radio-group v-model="checked" direction="horizontal" style="height: 26px;">
            <van-radio name="1">
              <van-icon class="iconfont icon-theme-sys theme-icon"
                :style="{ color: checked == '1' ? '#3498db' : 'gray' }" />
            </van-radio>
            <van-radio name="2">
              <van-icon class="iconfont icon-theme-light theme-icon"
                :style="{ color: checked == '2' ? '#3498db' : 'gray' }" />
            </van-radio>
            <van-radio name="3">
              <van-icon class="iconfont icon-theme-dark theme-icon"
                :style="{ color: checked == '3' ? '#3498db' : 'gray' }" />
            </van-radio>
          </van-radio-group>
        </template>
      </van-field>
      <van-field clickable center input-align="right" :label="$t('settings.sys.version')" label-width="10rem"
        :readonly="true" v-model="version" @click="showDownload = true">
        <template #right-icon>
          <van-tag type="danger" size="medium" round style="margin-top: -2px;">Hot</van-tag>
        </template>
      </van-field>
    </van-cell-group>

    <local-resource-mgr />
    <client-mgr style="margin-bottom: 20px;" />

    <van-popup round v-model:show="showDownload" closeable close-icon="close" teleport="#app">
      <div style="width: 450px; margin: 15px; height: 100px; background-color: antiquewhite;">
        <van-progress :percentage="50" stroke-width="8" />
      </div>
    </van-popup>
  </van-form>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import ClientMgr from './ClientMgr.vue'
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

const checked = ref<string>('1')
const version = ref<string>('1.0.1')
const showDownload = ref<boolean>(false)


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

.theme-icon {
  font-size: 1.6rem;
}
</style>