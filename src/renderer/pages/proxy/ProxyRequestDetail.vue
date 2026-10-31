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
          <vue-ace-editor :fold="true" :max-lines="22"
            :data="record.headers == null ? '{}' : JSON.stringify(record.headers, null, '\t')" />
        </template>
      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.requestParams')">
      <van-cell class="detail-content">
        <vue-ace-editor :fold="false" :max-lines="22"
          :data="record.requestData == null ? '{}' : JSON.stringify(record.requestData, null, '\t')" />
      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.requestBody')" v-if="record.data != null">
      <van-cell class="detail-content">
        <proxy-request-body :data="record.data" :headers="record.headers" />
      </van-cell>
    </van-cell-group>

    <van-cell-group inset :title="$t('proxy.responseHeader')">
      <van-cell class="detail-content">
        <vue-ace-editor :fold="true" :max-lines="22"
          :data="record.responseHeaders == null ? '{}' : JSON.stringify(record.responseHeaders, null, '\t')" />
      </van-cell>
    </van-cell-group>

    <van-cell-group ref="detailResp" inset :title="$t('proxy.responseBody')" style="margin-bottom: 5px;"
      class="detail-content">
      <van-cell style="padding: 0;">
        <template #value>
          <vue-ace-editor :fold="false" :max-lines="22"
            :data="record.responseData == null ? '{}' : JSON.stringify(record.responseData, null, '\t')" />
        </template>
      </van-cell>
    </van-cell-group>
  </van-form>
</template>

<script lang="ts" setup>
import { Form, showToast } from 'vant'
import { inject, PropType, ref } from 'vue'
import { ProxyMock } from '@shared'
import VueAceEditor from '../components/VueAceEditor.vue'
import ProxyRequestBody from './ProxyRequestBody.vue'

const topOffset = window.isWeb ? 5 : 30

const props = defineProps({
  record: { type: Object as PropType<ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord> },
})

const detailContainer = ref<typeof Form>()
const detailResp = ref()
const apiDesc = ref<string>(null)
const openMockRuleMgr = inject<(withRecord: boolean) => void>('openMockRuleMgr')

// watch(props.record, () => {
//   updated()
// })

async function copyLink() {
  const url = props.record?.url
  if (url == null) {
    showToast('请先选择一条请求记录')
    return
  }

  try {
    if (window.mainApi) {
      await window.mainApi.writeClipboard(url)
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
    } else {
      fallbackCopy(url)
    }
    showToast(`[ ${url} ] 已复制到剪贴板`)
  } catch (err) {
    showToast('复制失败，请手动复制')
  }
}

function fallbackCopy(text: string) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) throw new Error('copy failed')
}

function addToMockRule() {
  if (props.record == null) {
    showToast('请先选择一条请求记录')
    return
  }
  openMockRuleMgr(true)
}

function updated() {
  this.$refs.inspectorPanel.scrollTop = 0
  this.$nextTick(() => {
    // detailContainer.value.$el.scrollTop = detailResp.value.$el.getBoundingClientRect().top
  })
}
</script>

<style scoped>
.detail-content {
  padding: 0;
}
</style>
