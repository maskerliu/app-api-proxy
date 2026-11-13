<template>
  <van-cell-group label-align="right" colon>
    <div ref="urlBar" class="url-bar" :style="{ top: `${stickyTop}px`, marginTop: `${stickyTop}px` }">
      <van-cell-group inset title="">
        <van-cell center>
          <template #title>
            <div class="van-ellipsis">{{ record.url }}</div>
          </template>
          <template #right-icon>
            <van-button class="btn-icon-only" style="margin: 0 10px;" plain size="small" type="success"
              @click="copyLink">
              <template #icon>
                <van-icon class="iconfont icon-copy" />
              </template>
            </van-button>
            <mock-record-panel :record="record" />
          </template>
        </van-cell>
      </van-cell-group>
    </div>

    <section v-if="mockMeta?.hit" class="mock-hit">
      <van-row tag="header" class="hit-head" align="center" :wrap="false">
        <van-icon name="passed" class="hit-icon" />
        <span class="hit-title">{{ $t('mock.hit.title') }}</span>
        <van-tag v-if="mockMeta.level" plain type="primary">
          {{ $t(`mock.match.level.${mockMeta.level}`) }}
        </van-tag>
        <van-tag v-if="mockMeta.variantId" plain type="success">{{ $t('mock.hit.variant') }}</van-tag>
      </van-row>
      <van-row class="hit-line" align="center" :wrap="false">
        <span class="hit-label">{{ $t('mock.hit.record') }}</span>
        <span class="hit-value">{{ hitRecord?.name || hitRecord?.url || mockMeta.recordId }}</span>
        <van-button size="mini" plain type="primary" @click="openHitRecord">{{ $t('mock.hit.open') }}</van-button>
      </van-row>
      <van-row v-if="hitRecord" class="hit-line" align="center" :wrap="false">
        <span class="hit-label">{{ $t('mock.hit.conditions') }}</span>
        <span class="hit-value">{{ summaryText(hitRecord, $t) }}</span>
      </van-row>
      <van-row v-if="mockMeta.ignoredKeys?.length" class="hit-line" align="center" :wrap="false">
        <span class="hit-label">{{ $t('mock.hit.ignored', { count: mockMeta.ignoredKeys.length }) }}</span>
        <span class="hit-value mono">{{ mockMeta.ignoredKeys.join(',') }}</span>
        <van-button size="mini" plain type="warning" @click="openHitRecord">{{ $t('mock.hit.tighten') }}</van-button>
      </van-row>
      <van-row class="hit-line hit-meta" align="center" :wrap="false">
        <span v-if="mockMeta.ordering">{{ $t('mock.hit.orderingValue', {
          value: $t(orderingLabelKey(mockMeta.ordering))
        })
        }}</span>
        <span v-if="mockMeta.elapsedMs != null">{{ $t('mock.hit.elapsed', { ms: mockMeta.elapsedMs }) }}</span>
      </van-row>
      <div v-if="mockMeta.degraded" class="hit-degraded">{{ $t('mock.hit.degraded') }}</div>
    </section>

    <mock-miss-panel v-else-if="mockMeta?.miss" :miss="mockMeta.miss" :degraded="mockMeta.degraded" class="detail-miss"
      @ignore-key="onMissIgnore" @loosen="onMissLoosen" @edit="openMissRecord" />

    <van-collapse v-model="expandedHeaders" :border="false" class="header-collapse" @transitionend="syncResponseFill">
      <van-collapse-item name="requestHeader" :title="$t('proxy.requestHeader')">
        <div class="header-list">
          <div v-for="(item, idx) in requestHeaders" :key="`${item.key}-${idx}`" class="header-row">
            <span class="header-key" :title="item.key"><bdi>{{ item.key }}</bdi></span>
            <span class="header-value">{{ item.value }}</span>
          </div>
        </div>
      </van-collapse-item>
      <van-collapse-item name="responseHeader" :title="$t('proxy.responseHeader')">
        <div class="header-list">
          <div v-for="(item, idx) in responseHeaders" :key="`${item.key}-${idx}`" class="header-row">
            <span class="header-key" :title="item.key"><bdi>{{ item.key }}</bdi></span>
            <span class="header-value">{{ item.value }}</span>
          </div>
        </div>
      </van-collapse-item>
      <van-collapse-item v-if="requestParams.length > 0" name="requestParams" :title="$t('proxy.requestParams')">
        <div class="header-list">
          <div v-for="(item, idx) in requestParams" :key="`${item.key}-${idx}`" class="header-row">
            <span class="header-key" :title="item.key"><bdi>{{ item.key }}</bdi></span>
            <span class="header-value">{{ item.value }}</span>
          </div>
        </div>
      </van-collapse-item>
    </van-collapse>

    <van-cell-group class="detail-content body-group" inset :title="$t('proxy.requestBody')" v-if="record.data != null">
      <van-cell class="detail-content" style="padding: 0 var(--van-padding-md);">
        <proxy-request-body :data="record.data" :headers="record.headers" />
      </van-cell>
    </van-cell-group>

    <van-cell-group ref="detailResp" class="detail-content body-group" inset :title="$t('proxy.responseBody')"
      style="margin-bottom: 5px;">
      <van-cell style="padding: 0;">
        <template #value>
          <vue-ace-editor ref="responseEditor" :fold="false" :fill="true" :fill-max-inset="stickyInset" searchable
            :data="record.responseData == null ? '{}' : JSON.stringify(record.responseData, null, '\t')" />
        </template>
      </van-cell>
    </van-cell-group>
  </van-cell-group>
</template>

<script lang="ts" setup>
import {
  getMockRecord, ProxyMock, saveMockRecord
} from '@shared'
import type { MockHitMeta, MockMissFailure } from '@shared/mock.models'
import { showNotify, showToast } from 'vant'
import { computed, inject, nextTick, onMounted, onUnmounted, PropType, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { copyToClipboard } from '../../common/clipboard'
import { toKeyValueEntries } from '../../common/headerUtil'
import VueAceEditor from '../components/VueAceEditor.vue'
import { ensureRecordMatch, orderingLabelKey, previewLevel, summaryText } from './mock/match'
import MockMissPanel from './mock/MockMissPanel.vue'
import MockRecordPanel from './mock/MockRecordPanel.vue'
import { MockMgrTarget } from './mock/recording'
import { describeMockSaveError } from './mock/save-error'
import ProxyRequestBody from './ProxyRequestBody.vue'

// 吸顶位置相对右侧滚动容器计算：electron 标题栏拖拽区 32px，容器顶部距窗口 5px，
// 留 25px 使卡片上沿稳定停在拖拽区下方。margin-top 同步加同样距离，
// 让卡片原位就等于吸顶位置，否则吸顶后会压住下方请求头，破坏与其它区块一致的间距
const stickyTop = window.isWeb ? 0 : 25

const props = defineProps({
  record: { type: Object as PropType<ProxyMock.ProxyRequestRecord | ProxyMock.ProxyStatRecord> },
})

const { t } = useI18n()

const detailResp = ref()
const urlBar = ref<HTMLElement>()
const responseEditor = ref<InstanceType<typeof VueAceEditor>>()
// 吸顶区块占据的高度：响应体编辑器的最大高度 = 父容器高度 - 该值
const stickyInset = ref(stickyTop)
const openMockRuleMgr = inject<(target?: MockMgrTarget) => void>('openMockRuleMgr')

const hitRecord = ref<ProxyMock.MockRecord>(null)
const mockMeta = computed<MockHitMeta>(() => (props.record as ProxyMock.ProxyRequestRecord)?.mock ?? null)

const expandedHeaders = ref<string[]>([])

const requestHeaders = computed(() => toKeyValueEntries(props.record?.headers))
const responseHeaders = computed(() => toKeyValueEntries(props.record?.responseHeaders))
const requestParams = computed(() => toKeyValueEntries(props.record?.requestData))

function syncResponseFill() {
  // 展开折叠块时保留响应体当前高度，让页面滚动高度随内容增长；收起时再补足剩余空间
  responseEditor.value?.syncFillHeight(false)
}

// 请求体区块随记录有没有而增减，responseBody 的顶部位置会变，需要重新贴合父容器底部
watch(() => props.record, () => nextTick(() => responseEditor.value?.syncFillHeight()))

// 命中元数据只带 recordId，详情区按 id 补名称并支持跳转编辑
watch(() => mockMeta.value?.recordId, async (recordId) => {
  hitRecord.value = null
  if (recordId == null) return
  try {
    hitRecord.value = await getMockRecord(recordId, { silentError: true })
  } catch (err) {
    // 记录可能已被删除，保留 id 展示即可
  }
}, { immediate: true })

function openHitRecord() {
  const record = hitRecord.value
  if (record?.ruleId != null) {
    openMockRuleMgr?.({ ruleId: record.ruleId, record })
    return
  }
  showToast(t('mock.record.missing'))
}

async function openMissRecord() {
  const miss = mockMeta.value?.miss
  if (miss == null) return
  try {
    const record = await getMockRecord(miss.recordId, { silentError: true })
    if (record?.ruleId == null) {
      showToast(t('mock.record.missing'))
      return
    }
    openMockRuleMgr?.({ ruleId: record.ruleId, record })
  } catch (err) {
    showToast(t('mock.record.missing'))
  }
}

// 未命中动作直接写回记录：先取最新版本，避免覆盖其他窗口的修改
async function saveMatch(recordId: string, mutate: (record: ProxyMock.MockRecord) => void): Promise<boolean> {
  if (recordId == null) return false
  try {
    const latest = await getMockRecord(recordId, { silentError: true })
    if (latest == null) {
      showNotify({ message: t('mock.record.missing'), type: 'warning', duration: 1200 })
      return false
    }
    ensureRecordMatch(latest)
    mutate(latest)
    await saveMockRecord(latest, latest.updatedAt, { silentError: true })
    return true
  } catch (err) {
    const info = describeMockSaveError(err)
    const message = info.kind === 'conflict'
      ? t('mock.recordPanel.conflictMessage')
      : t('mock.miss.applyFailed')
    showNotify({ message, type: 'warning', duration: 1500 })
    return false
  }
}

async function onMissIgnore(failure: MockMissFailure) {
  const recordId = mockMeta.value?.miss?.recordId
  if (recordId == null || failure?.key == null) return
  const saved = await saveMatch(recordId, (record) => {
    if (record.match == null) return
    const target = failure.dimension === 'header'
      ? record.match.headers.ignoreKeys
      : record.match.query.ignoreKeys
    if (target.indexOf(failure.key) === -1) target.push(failure.key)
    if (record.match.level !== 'custom') record.match.level = 'custom'
  })
  if (saved) showNotify({ message: t('mock.miss.ignoreSaved', { key: failure.key }), type: 'success', duration: 1200 })
}

async function onMissLoosen() {
  const recordId = mockMeta.value?.miss?.recordId
  if (recordId == null) return
  const saved = await saveMatch(recordId, (record) => {
    record.match = previewLevel('loose', record).match
  })
  if (saved) showNotify({ message: t('mock.miss.loosenSaved'), type: 'success', duration: 1200 })
}

function measureStickyInset() {
  stickyInset.value = stickyTop + (urlBar.value?.offsetHeight ?? 0)
}

// 吸顶卡片高度随内容/主题变化，同步更新响应体可用的最大高度
let urlBarObserver: ResizeObserver

onMounted(() => {
  measureStickyInset()
  urlBarObserver = new ResizeObserver(measureStickyInset)
  if (urlBar.value) urlBarObserver.observe(urlBar.value)
})

onUnmounted(() => {
  urlBarObserver?.disconnect()
})

async function copyLink() {
  const url = props.record?.url
  if (url == null) {
    showToast(t('mock.recordPanel.selectRecordFirst'))
    return
  }

  try {
    await copyToClipboard(url)
    showToast(`[ ${url} ] ${t('mock.recordPanel.copied')}`)
  } catch (err) {
    showToast(t('common.copyFailed'))
  }
}
</script>

<style scoped>
.url-bar {
  position: sticky;
  z-index: 99;
}

/* 长 URL 不换行时标题项默认不收缩，会把右侧录制按钮挤出 van-cell（其 overflow:hidden 会直接裁掉） */
.url-bar :deep(.van-cell__title) {
  min-width: 0;
}

/* 内容区块与折叠头部同宽：抵消 cell-group inset 的默认边距，使标题与 van-collapse 标题对齐 */
.body-group {
  margin-left: 0;
  margin-right: 0;
}

/* inset 模式下标题的左边距需与 van-collapse-item 标题对齐 */
:deep(.van-cell-group__title--inset) {
  margin-top: calc(var(--van-padding-md));
  padding-left: var(--van-padding-md);
}

/* 命中解释：命中记录、忽略键、排序依据与耗时同属一个区块 */
.mock-hit {
  margin: var(--van-padding-md) var(--van-padding-md) 0;
  padding: var(--app-sp-lg) var(--app-sp-2xl);
  border: 1px solid var(--van-success-color);
  border-radius: var(--van-radius-lg);
  background: color-mix(in srgb, var(--van-success-color) 8%, transparent);
}

.hit-head {
  gap: var(--app-sp-md);
}

.hit-icon {
  color: var(--van-success-color);
}

.hit-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--van-font-size-md);
  font-weight: 600;
}

.hit-line {
  gap: var(--app-sp-lg);
  margin-top: var(--app-sp-md);
}

.hit-label {
  flex: none;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.hit-value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--van-font-size-sm);
}

.hit-value.mono {
  font-family: var(--app-mono-font);
}

.hit-meta {
  gap: var(--app-sp-3xl);
  color: var(--van-text-color-3);
  font-size: var(--van-font-size-xs);
}

.hit-degraded {
  margin-top: var(--app-sp-md);
  color: var(--van-warning-color);
  font-size: var(--van-font-size-xs);
}

.detail-miss {
  margin: var(--van-padding-md) var(--van-padding-md) 0;
}
</style>
