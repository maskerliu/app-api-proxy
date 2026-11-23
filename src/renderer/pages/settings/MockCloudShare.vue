<template>
  <van-cell-group inset>
    <!-- 与相邻的「数据」那一组同款：范围说明并入组标题行的右端，不另起一行（单起会把这一组的地板抬高半档） -->
    <template #title>
      <div class="share-head">
        <span class="share-title">{{ $t('settings.share.title') }}</span>
        <span class="hint share-scope truncate" v-tip="$t('settings.share.scopeNote')">
          {{ $t('settings.share.scopeNote') }}
        </span>
      </div>
    </template>

    <!-- 三档通道只有一枚下拉：目录那一格与地址那一格各自只在选中对应通道时出现，
         把两格常驻摆出来会让人以为填了地址也能备份（订阅通道是只读的） -->
    <van-field center input-align="right" :label="$t('settings.share.channelLabel')" label-width="7.5em" :readonly="true">
      <template #left-icon>
        <van-icon class="iconfont icon-link setting-cell-icon" />
      </template>
      <template #input>
        <MiniSelect :model-value="share.channel" :options="channelOptions" :disabled="busy" @change="onSelectChannel" />
      </template>
    </van-field>

    <van-field v-if="share.channel === 'dir'" center :label="$t('settings.share.dirLabel')" label-width="7.5em"
      input-align="right" :readonly="true">
      <template #input>
        <span v-if="share.dir" class="share-value truncate" v-tip="share.dir">{{ share.dir }}</span>
        <!-- 「未选择目录」是引导不是错误，走次级文字色；给它 danger 会让人以为出了故障 -->
        <span v-else class="hint share-missing">{{ $t('settings.share.noDir') }}</span>
      </template>
      <template #right-icon>
        <van-button size="small" plain :disabled="busy" @click="onPickDir">{{ $t('settings.share.pickDir') }}</van-button>
      </template>
    </van-field>

    <van-field v-else-if="share.channel === 'url'" v-model="urlDraft" :label="$t('settings.share.urlLabel')"
      label-width="7.5em" :placeholder="$t('settings.share.urlPlaceholder')"
      :error-message="urlInsecure ? $t('settings.share.urlInsecure') : ''">
      <template #right-icon>
        <van-button size="small" plain :disabled="busy || urlUnchanged" @click="onApplyUrl">
          {{ $t('settings.share.applyUrl') }}
        </van-button>
      </template>
    </van-field>

    <!-- 状态一格四说：没开、配了但残缺、上次读数、最近一次失败（需求 10 节那 8 格都落在这里） -->
    <van-field center :label="$t('settings.share.statusLabel')" label-width="7.5em" readonly>
      <template #input>
        <span class="share-value truncate" :class="{ 'is-problem': statusProblem }" v-tip="statusText">{{ statusText }}</span>
      </template>
      <template #right-icon>
        <van-button size="small" plain :disabled="busy || share.channel === 'off'" @click="onCheck">
          {{ $t('settings.share.testAction') }}
        </van-button>
      </template>
    </van-field>

    <template v-if="share.channel === 'dir'">
      <van-field center :label="$t('settings.share.estimateLabel')" label-width="7.5em" readonly>
        <template #input>
          <span class="share-value truncate" v-tip="estimateText">{{ estimateText }}</span>
        </template>
        <template #right-icon>
          <van-button size="small" plain :disabled="busy" @click="onEstimate">
            {{ $t('settings.share.estimateAction') }}
          </van-button>
        </template>
      </van-field>

      <van-field center :label="$t('settings.share.backupLabel')" label-width="7.5em" readonly>
        <template #input>
          <span class="share-value num" :class="{ truncate: !running }" v-tip="running ? '' : backupText">{{ progressText }}</span>
        </template>
        <template #right-icon>
          <van-button v-if="running" size="small" plain type="warning" @click="onCancel">
            {{ $t('settings.share.cancelAction') }}
          </van-button>
          <van-button v-else size="small" plain type="primary" :disabled="busy" @click="onBackup">
            {{ $t('settings.share.backupAction') }}
          </van-button>
        </template>
      </van-field>
    </template>

    <!-- 恢复：目录通道先读清单、勾选要落在真实存在的场景上；订阅通道没有清单，取回的就是整个包 -->
    <van-field v-if="share.channel === 'dir'" center :label="$t('settings.share.restoreLabel')" label-width="7.5em" readonly>
      <template #input>
        <span class="share-value truncate" v-tip="sceneSummary || $t('settings.share.notRead')">
          {{ sceneSummary || $t('settings.share.notRead') }}
        </span>
      </template>
      <template #right-icon>
        <van-button size="small" plain :disabled="busy" @click="onReadOverview">
          {{ overview == null ? $t('settings.share.readAction') : $t('settings.share.rereadAction') }}
        </van-button>
      </template>
    </van-field>

    <van-field v-else-if="share.channel === 'url'" center :label="$t('settings.share.restoreLabel')" label-width="7.5em" readonly>
      <template #input>
        <span class="hint share-missing">{{ $t('settings.share.readUrlHint') }}</span>
      </template>
      <template #right-icon>
        <van-button size="small" plain type="primary" :disabled="busy" @click="onRestore">
          {{ $t('settings.share.restoreUrlAction') }}
        </van-button>
      </template>
    </van-field>

    <!-- 清单读完就地展开，高度封顶、滚动留在列表内部：设置页整页也在滚，两层滚动叠起来会互相抢 -->
    <div v-if="overview != null" class="share-scenes">
      <van-checkbox-group v-model="checkedKeys">
        <van-checkbox v-for="scene in overview.scenes" :key="scene.key" :name="scene.key" shape="square" class="share-scene">
          <span class="share-scene-name truncate" v-tip="scene.name">{{ scene.name }}</span>
          <span class="hint share-scene-meta num">{{ sceneMetaText(scene) }}</span>
        </van-checkbox>
      </van-checkbox-group>
      <div v-if="overview.unavailable.length > 0" class="hint share-unavailable">
        {{ $t('settings.share.unavailableNote', { count: overview.unavailable.length }) }}
      </div>
    </div>

    <div v-if="share.channel === 'dir' && overview != null" class="share-restore">
      <van-button size="small" plain type="primary" :disabled="busy || selectedKeys.length === 0" @click="onRestore">
        {{ $t('settings.share.restoreAction', { count: selectedKeys.length }) }}
      </van-button>
      <!-- 恢复永不删本地（需求 11.3）：这句是这条通道唯一的安全承诺，不能只写在文档里 -->
      <span class="hint share-restore-note">{{ $t('settings.share.restoreNote') }}</span>
    </div>

    <mock-import-dialog v-model:show="showImport" :remote="remoteSource" :can-goto="canGoto" @goto="onGoto" />
  </van-cell-group>
</template>

<script lang="ts" setup>
import type { MockPackImportOptions, MockPackImportResult, MockPackPreviewResult } from '@shared/mock.pack'
import type {
  MockShareBackupEstimate, MockShareBackupProgress, MockShareBackupResult, MockShareChannel,
  MockShareCheckResult, MockShareConfig, MockShareRemoteOverview, MockShareSceneSummary,
} from '@shared/mock.share'
import type { MainCallResult } from '@shared/ipc.api'
import { MOCK_SHARE_CODES } from '@shared/mock.errors'
import { showNotify } from 'vant'
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatBytes } from '../../common/format'
import { CommonStore } from '../../store'
import MiniSelect from '../components/MiniSelect.vue'
import type { MockImportSource } from '../proxy/mock/import-source'
import type { MockMgrTarget } from '../proxy/mock/recording'
import MockImportDialog from '../proxy/mock/MockImportDialog.vue'

const { t, te } = useI18n()
const commonStore = CommonStore()

const busy = ref(false)
const running = ref(false)
const progress = ref<MockShareBackupProgress>(null)
const status = ref({ text: '', problem: false })
const estimate = ref<MockShareBackupEstimate>(null)
const backup = ref<MockShareBackupResult>(null)
const overview = ref<MockShareRemoteOverview>(null)
const checkedKeys = ref<string[]>([])
const showImport = ref(false)
const remoteSource = ref<MockImportSource>(null)
const urlDraft = ref('')

const share = computed(() => commonStore.serverConfig.mockShare ?? { channel: 'off' as MockShareChannel })

const channelOptions = computed(() => [
  { label: t('settings.share.channelOff'), value: 'off' },
  { label: t('settings.share.channelDir'), value: 'dir' },
  { label: t('settings.share.channelUrl'), value: 'url' },
])

const urlUnchanged = computed(() => urlDraft.value.trim() === (share.value.url ?? ''))

// 一格四种说法：没开、开了但没选位置、选好了但还没测过、测过的读数（需求 10 节那 8 格的落点）
const statusText = computed(() => {
  if (status.value.text !== '') return status.value.text
  const value = share.value
  if (value.channel === 'off') return t('settings.share.statusOff')
  const ready = value.channel === 'dir' ? value.dir != null : value.url != null
  return ready ? t('settings.share.statusIdle') : t('settings.share.statusUnconfigured')
})

const estimateText = computed(() => {
  const value = estimate.value
  if (value == null) return t('settings.share.estimateUnknown')
  const base = t('settings.share.estimateValue', {
    scenes: value.scenes,
    records: value.records,
    bytes: formatBytes(value.bytes),
    written: formatBytes(value.writtenBytes),
    skipped: value.skipped,
  })
  return value.oversize.length > 0
    ? `${base} ${t('settings.share.oversizeNote', { count: value.oversize.length })}`
    : base
})

const progressText = computed(() => {
  if (running.value) {
    const value = progress.value
    if (value == null) return t('settings.share.backupWaiting')
    return t('settings.share.backupProgress', {
      done: value.scenesDone,
      total: value.sceneTotal,
      records: value.records,
      written: formatBytes(value.writtenBytes),
    })
  }
  const value = backup.value
  if (value == null) return t('settings.share.backupUnknown')
  const base = t('settings.share.backupResult', {
    scenes: value.scenes,
    records: value.records,
    bytes: formatBytes(value.bytes),
    written: formatBytes(value.writtenBytes),
    skipped: value.skipped,
    time: timeText(value.createdAt),
  })
  return value.failed.length > 0
    ? `${base} ${t('settings.share.backupFailedNote', { count: value.failed.length })}`
    : base
})

const sceneSummary = computed(() => {
  const value = overview.value
  if (value == null) return ''
  const base = value.scenes.length === 0
    ? t('settings.share.checkEmpty')
    : t('settings.share.sceneCount', { count: value.scenes.length, records: value.records, bytes: formatBytes(value.bytes) })
  return value.unavailable.length > 0
    ? `${base} ${t('settings.share.unavailableNote', { count: value.unavailable.length })}`
    : base
})

// 只认清单上真实存在的键，顺序也按清单：勾完又重读一次的话，过期键不该被一起导进去
const selectedKeys = computed(() =>
  (overview.value?.scenes ?? []).filter(scene => checkedKeys.value.includes(scene.key)).map(scene => scene.key))

const openMockRuleMgr = inject<((target: MockMgrTarget) => void) | null>('openMockRuleMgr', null)
const canGoto = computed(() => openMockRuleMgr != null)

onMounted(() => {
  urlDraft.value = share.value.url ?? ''
  window.mainApi?.onMockShareProgress((value) => {
    if (value == null) return
    running.value = true
    progress.value = value
    // 备份一跑起来，之前那份「还没写出去」的预统计就读不到了，留着等于两个口径摆在一起
    estimate.value = null
  })
})

onBeforeUnmount(() => window.mainApi?.offMockShareProgress())

function timeText(at?: number): string {
  if (at == null || !Number.isFinite(at)) return ''
  const date = new Date(at)
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
}

function sceneMetaText(scene: MockShareSceneSummary): string {
  return t('settings.share.sceneMeta', {
    records: scene.records,
    bytes: formatBytes(scene.bytes),
    shards: scene.shards,
  })
}

/** 换通道、换目录、换地址之后，之前那份远端读数就不属于现在这个位置了 */
function reset() {
  status.value = { text: '', problem: false }
  estimate.value = null
  backup.value = null
  overview.value = null
  checkedKeys.value = []
  progress.value = null
  running.value = false
}

async function save(next: MockShareConfig) {
  try {
    const config = await window.mainApi?.updateBizConfig(JSON.stringify({ ...commonStore.serverConfig, mockShare: next }))
    if (config) commonStore.updateServerConfig(config)
  } catch (err: any) {
    showNotify({ type: 'warning', message: t('settings.sys.saveConfigFailed', { reason: err?.message ?? err }) })
  }
}

function onSelectChannel(value: string) {
  const channel = value as MockShareChannel
  reset()
  if (channel === 'url') urlDraft.value = share.value.url ?? ''
  void save({ channel, dir: share.value.dir, url: share.value.url })
}

async function onPickDir() {
  const picked = await window.mainApi?.selectFolder()
  // 取消目录选择不是失败，这一格什么都不改
  if (picked == null || picked === '') return
  reset()
  await save({ ...share.value, channel: 'dir', dir: picked })
}

async function onApplyUrl() {
  const url = urlDraft.value.trim()
  if (url === '') return
  reset()
  await save({ ...share.value, channel: 'url', url })
}

function setStatus(text: string, problem: boolean) {
  status.value = { text, problem }
}

/** 主进程把错误码带回来而不是抛异常（结构化克隆会丢掉 MockError.code），这里统一拆信封 */
async function call<T>(run: () => Promise<MainCallResult<T>>): Promise<T | null> {
  busy.value = true
  try {
    const result = await run()
    if (result.status === 'ok') return result.data ?? null
    if (result.status === 'canceled') {
      setStatus(t('settings.share.canceled'), false)
      return null
    }
    setStatus(problemText(result), true)
    return null
  } finally {
    busy.value = false
  }
}

/** 码表里的码按 mock.share 的文案说话，表外的（例如原始异常消息）照原文显示 */
function problemText(result: MainCallResult<unknown>): string {
  const code = result.code
  if (code == null || !(MOCK_SHARE_CODES as readonly string[]).includes(code) || !te(`mock.share.${code}`)) {
    return result.detail ?? t('settings.share.failed')
  }
  const text = t(`mock.share.${code}`)
  return result.detail == null || result.detail === '' ? text : `${text}（${result.detail}）`
}

async function onCheck() {
  const value = await call(() => window.mainApi.mockShareCheck())
  if (value == null) return
  setStatus(checkText(value), false)
}

function checkText(value: MockShareCheckResult): string {
  const parts = [t('settings.share.checkOk')]
  if (value.channel === 'url') {
    parts.push(t('settings.share.checkUrl', { bytes: formatBytes(value.bytes) }))
  } else {
    parts.push(value.scenes > 0
      ? t('settings.share.checkDir', { scenes: value.scenes ?? 0, records: value.records ?? 0, bytes: formatBytes(value.bytes) })
      : t('settings.share.checkEmpty'))
  }
  if (value.createdAt != null) parts.push(t('settings.share.checkAt', { time: timeText(value.createdAt) }))
  if (value.device != null && value.device !== '') parts.push(t('settings.share.checkDevice', { device: value.device }))
  return parts.join(' · ')
}

async function onEstimate() {
  const value = await call(() => window.mainApi.mockShareEstimate())
  if (value != null) estimate.value = value
}

async function onBackup() {
  running.value = true
  progress.value = null
  const value = await call(() => window.mainApi.mockShareBackup())
  running.value = false
  progress.value = null
  if (value == null) return
  backup.value = value
  // 远端内容刚被这次备份改掉，之前那份清单和预统计同时过期
  overview.value = null
  checkedKeys.value = []
  estimate.value = null
  const base = t('settings.share.backupDone', { scenes: value.scenes, records: value.records })
  setStatus(value.failed.length > 0
    ? `${base} ${t('settings.share.backupFailedNote', { count: value.failed.length })}`
    : base, value.failed.length > 0)
}

function onCancel() {
  void window.mainApi?.mockShareCancel()
}

async function onReadOverview() {
  const value = await call(() => window.mainApi.mockShareOverview())
  if (value == null) return
  overview.value = value
  checkedKeys.value = []
  setStatus(sceneSummary.value, false)
}

function unwrap<T>(run: Promise<MainCallResult<T> | undefined>): Promise<T> {
  return run.then((result) => {
    if (result == null) throw new Error(t('settings.share.failed'))
    if (result.status === 'ok' && result.data != null) return result.data
    // 带上 code：导入弹窗那一行按码表说话（那些文案讲的是「这个包为什么读不出来」）
    const error: any = new Error(problemText(result))
    error.errorCode = result.code
    error.detail = result.detail
    throw error
  })
}

function onRestore() {
  const isUrl = share.value.channel === 'url'
  const keys = isUrl ? [] : selectedKeys.value
  if (!isUrl && keys.length === 0) return
  const preview = (options: MockPackImportOptions): Promise<MockPackPreviewResult> =>
    unwrap(window.mainApi?.mockSharePreview(keys, options))
  const importPack = (options: MockPackImportOptions): Promise<MockPackImportResult> =>
    unwrap(window.mainApi?.mockShareImport(keys, options))
  remoteSource.value = {
    label: isUrl ? (share.value.url ?? '') : t('settings.share.remoteScenes', { count: keys.length }),
    preview,
    import: importPack,
  }
  showImport.value = true
}

function onGoto(ruleId: string) {
  showImport.value = false
  openMockRuleMgr?.({ ruleId })
}
</script>

<style scoped>
/* 与 .data-head 同款：说明吃剩余宽度并右对齐，标题不参与收缩，行盒与组标题带垫平 */
.share-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--app-sp-lg);
}

.share-title,
.share-scope {
  line-height: var(--van-line-height-md);
}

.share-title {
  flex: none;
}

.share-scope {
  min-width: 0;
}

/* 次级说明一律改读 -2：global .hint 用的 --van-text-color-3 在暗色被 Vant 钉成 #4d4d4d，压在深色卡片上读不出 */
.share-scope,
.share-missing,
.share-scene-meta,
.share-restore-note,
.share-unavailable {
  color: var(--van-text-color-2);
}

/* 读数那一格是正文档，不是说明档：它讲的是「远端现在有什么」，不是辅助提示。
   flex:1 + min-width:0 才让 truncate 生效——.van-field__body 是 flex 容器，不给这两条会撑破行 */
.share-value {
  flex: 1;
  min-width: 0;
  color: var(--van-text-color);
}

/* 失败与「配了但残缺」共用这一档，比正文弱、比说明强（暗色下不用灰阶） */
.is-problem {
  color: var(--van-warning-color);
}

/* 清单高度封顶、滚动留在列表内部：设置页整页也在滚，两层滚动叠在一起会互相抢 */
.share-scenes {
  max-height: 190px;
  overflow-y: auto;
  margin: var(--app-sp-sm) var(--van-cell-horizontal-padding) var(--app-sp-md);
  padding: var(--app-sp-sm) 0;
}

.share-scene {
  margin: var(--app-sp-tight) 0;
}

/* 勾选框标签那一格自己是场景名 + 读数两段：名称吃剩余宽度并截断，读数靠右不收缩 */
.share-scene :deep(.van-checkbox__label) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--app-sp-lg);
  min-width: 0;
}

.share-scene-name {
  min-width: 0;
}

.share-scene-meta {
  flex: none;
}

.share-unavailable {
  margin-top: var(--app-sp-sm);
}

.share-restore {
  display: flex;
  align-items: center;
  gap: var(--app-sp-lg);
  padding: 0 var(--van-cell-horizontal-padding) var(--app-sp-md);
}

/* 那句安全承诺比按钮长，允许换行；按钮不参与收缩，否则会被挤成竖排 */
.share-restore-note {
  min-width: 0;
}

.share-restore .van-button {
  flex: none;
}
</style>
