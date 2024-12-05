<template>
  <van-form ref="container" label-align="right" colon>
    <van-sticky :offset-top="5">
      <van-cell-group inset title="" class="content" style="margin-top: 5px;">
        <van-cell center>
          <template #title>
            <span class="van-ellipsis">{{ record.url }}</span>
          </template>
          <template #right-icon>
            <van-button style="margin: 0 10px;" plain size="small" type="success" icon="description"
              @click="copyLink" />
            <van-button plain size="small" type="primary" icon="bookmark-o" @click="addToMockRule" />
          </template>
        </van-cell>
      </van-cell-group>
    </van-sticky>

    <van-cell-group inset :title="$t('proxy.requestHeader')" class="content">
      <van-cell>
        <template #value>
          <vue-ace-editor :fold="false" :max-lines="22"
            :data="record.headers == null ? '{}' : JSON.stringify(record.headers, null, '\t')" />
        </template>
      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.requestParams')" class="content">
      <van-cell>
        <vue-ace-editor :max-lines="22"
          :data="record.requestData == null ? '{}' : JSON.stringify(record.requestData, null, '\t')" />
      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.responseHeader')" class="content">
      <van-cell>
        <vue-ace-editor :fold="false" :max-lines="22"
          :data="record.responseHeaders == null ? '{}' : JSON.stringify(record.responseHeaders, null, '\t')" />
      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.responseBody')" style="margin-bottom: 5px;" class="content">
      <van-cell>
        <template #value>
          <vue-ace-editor :max-lines="22"
            :data="record.responseData == null ? '{}' : JSON.stringify(record.responseData, null, '\t')" />
        </template>
      </van-cell>
    </van-cell-group>
  </van-form>
</template>

<script lang="ts" setup>
import { showToast } from 'vant'
import { PropType, ref } from 'vue'
import { ProxyMock } from '../../../common'
import { CommonStore } from '../../store'
import VueAceEditor from '../components/VueAceEditor.vue'


const props = defineProps({
  record: { type: Object as PropType<ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord> },
})

const commonStore = CommonStore()
const container = ref(null)
const apiDesc = ref<string>(null)

function copyLink() {
  // var input = document.createElement('input')
  // input.value = props.record.url
  // document.body.appendChild(input)
  // input.select()
  // document.execCommand("copy")
  showToast(`[ ${props.record.url} ] has copyed!`)
  // clipboard.writeText(this.record.url)
}

function addToMockRule() {
  commonStore.showMockRuleMgr = true
}

function updated() {
  this.$refs.inspectorPanel.scrollTop = 0
  this.$nextTick(() => {
    this.$refs.inspectorPanel.scrollTop =
      this.$refs.respDataDiv.getBoundingClientRect().top
  })
}
</script>

<style>
a {
  color: rgb(31, 187, 166);
  text-decoration: underline;
}

.content {
  font-size: 0.7rem;
  padding: 0;
}
</style>
