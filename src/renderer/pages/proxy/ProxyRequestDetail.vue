<template>
  <van-form ref="detailContainer" label-align="right" colon>
    <van-sticky :offset-top="topOffset">
      <van-cell-group inset title="">
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

    <van-cell-group inset :title="$t('proxy.requestHeader')">
      <van-cell class="detail-content">
        <template #value>
          <vue-ace-editor :fold="false" :max-lines="22"
            :data="record.headers == null ? '{}' : JSON.stringify(record.headers, null, '\t')" />
        </template>
      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.requestParams')">
      <van-cell class="detail-content">
        <vue-ace-editor :max-lines="22"
          :data="record.requestData == null ? '{}' : JSON.stringify(record.requestData, null, '\t')" />
      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.responseHeader')">
      <van-cell class="detail-content">
        <vue-ace-editor :fold="false" :max-lines="22"
          :data="record.responseHeaders == null ? '{}' : JSON.stringify(record.responseHeaders, null, '\t')" />
      </van-cell>
    </van-cell-group>

    <van-cell-group ref="detailResp" inset :title="$t('proxy.responseBody')" style="margin-bottom: 5px;"
      class="detail-content">
      <van-cell style="padding: 0;">
        <template #value>
          <vue-ace-editor :max-lines="22"
            :data="record.responseData == null ? '{}' : JSON.stringify(record.responseData, null, '\t')" />
        </template>
      </van-cell>
    </van-cell-group>
  </van-form>
</template>

<script lang="ts" setup>
import { Form, showToast } from 'vant'
import { inject, PropType, Ref, ref } from 'vue'
import { ProxyMock } from '../../../common'
import VueAceEditor from '../components/VueAceEditor.vue'

const topOffset = __IS_WEB__ ? 5 : 30

const props = defineProps({
  record: { type: Object as PropType<ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord> },
})

const detailContainer = ref<typeof Form>()
const detailResp = ref()
const apiDesc = ref<string>(null)
const showMockRuleMgr = inject<Ref<boolean>>('showMockRuleMgr')
const withCurRecord = inject<Ref<boolean>>('withCurRecord')

// watch(props.record, () => {
//   updated()
// })

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
  showMockRuleMgr.value = true
  withCurRecord.value = true
}

function updated() {
  this.$refs.inspectorPanel.scrollTop = 0
  this.$nextTick(() => {
    detailContainer.value.$el.scrollTop = detailResp.value.$el.getBoundingClientRect().top
  })
}
</script>

<style scoped>
.detail-content {
  padding: 0;
}
</style>
