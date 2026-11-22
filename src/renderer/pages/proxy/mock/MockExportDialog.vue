<template>
  <van-dialog v-model:show="show" :title="$t('mock.export.dialogTitle')" :show-confirm-button="false"
    close-on-click-overlay>
    <div class="export-form">
      <van-cell :title="$t('mock.export.scopeLabel')">
        <template #right-icon>
          <van-radio-group v-model="scope" direction="horizontal" class="export-radios" :disabled="running">
            <van-radio name="rule" :disabled="ruleId == null">{{ $t('mock.export.scopeCurrent') }}</van-radio>
            <van-radio name="all">{{ $t('mock.export.scopeAll') }}</van-radio>
          </van-radio-group>
        </template>
      </van-cell>
      <van-cell :title="$t('mock.export.variants')">
        <template #right-icon>
          <van-checkbox v-model="includeVariants" shape="square" :disabled="running" />
        </template>
      </van-cell>
      <van-cell :title="$t('mock.export.source')">
        <template #right-icon>
          <van-checkbox v-model="includeSource" shape="square" :disabled="running" />
        </template>
      </van-cell>
      <van-cell :title="$t('mock.export.redact')">
        <template #right-icon>
          <van-checkbox v-model="redact" shape="square" :disabled="running" />
        </template>
      </van-cell>
      <van-field v-model="fileNameDraft" :label="$t('mock.export.fileName')" label-width="auto" :disabled="running"
        :placeholder="derivedFileName" @update:model-value="fileNameTouched = true" />
      <!-- Web 分支没有保存框，包文本要整份进浏览器内存：风险在导出前说，不等下载完再解释 -->
      <div v-if="isWeb" class="export-tip">{{ $t('mock.export.webTip') }}</div>
      <!-- 进度写在正文里：本仓库不用 toast 承载进度，也不为它再套一层对话框 -->
      <van-row v-if="running" class="export-status" align="center" :wrap="false">
        <van-loading size="var(--van-font-size-md)">{{ $t('mock.export.saving') }}</van-loading>
        <span v-if="progressText" class="export-progress mono">{{ progressText }}</span>
      </van-row>
      <van-row class="export-actions actions-bar" align="center" justify="end" :wrap="false">
        <!-- 进行中只禁用「导出」，不隐藏：关闭这一枚仍然有效，关掉对话框不等于取消任务 -->
        <van-button size="small" plain @click="onClose">
          {{ running ? $t('mock.export.keepRunning') : $t('common.cancel') }}
        </van-button>
        <van-button size="small" type="primary" :disabled="running || scopeCurrentDisabled" @click="onConfirm">
          {{ $t('mock.export.confirm') }}
        </van-button>
      </van-row>
    </div>
  </van-dialog>
</template>

<script lang="ts" setup>
import { exportMockPack } from '@shared'
import type { MockPackExportOptions, MockPackExportProgress, MockPackScope } from '@shared/mock.pack'
import { MOCK_PACK_MAX_RECORDS } from '@shared/mock.pack'
import { showConfirmDialog, showNotify } from 'vant'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isOverImportLimit, normalizeExportFileName, packFileName } from './pack.export'
import { normalizeErrorText } from './save-error'

const show = defineModel<boolean>('show', { required: true })
const running = defineModel<boolean>('running', { required: true })
const props = defineProps<{
  ruleId?: string | null
  ruleName?: string
}>()
const { t } = useI18n()
const isWeb = window.isWeb

const scope = ref<MockPackScope>('all')
const includeVariants = ref(true)
const includeSource = ref(true)
const redact = ref(true)
const fileNameDraft = ref('')
const fileNameTouched = ref(false)
const progress = ref<MockPackExportProgress>(null)

// 文件名默认由范围与脱敏算出，用户改过之后就不再覆盖：-raw 后缀是包内含明文凭证的唯一可携带标记
const derivedFileName = computed(() => packFileName({
  scope: scope.value,
  ruleName: scope.value === 'rule' ? props.ruleName : undefined,
  redact: redact.value,
}))
const scopeCurrentDisabled = computed(() => scope.value === 'rule' && props.ruleId == null)
const progressText = computed(() => {
  const p = progress.value
  return p == null ? '' : t('mock.export.progress', { done: p.rulesDone, total: p.ruleTotal, records: p.recordCount })
})

watch(derivedFileName, (name) => {
  if (!fileNameTouched.value) fileNameDraft.value = name
})

watch(show, (open) => {
  if (!open || running.value) return
  scope.value = props.ruleId == null ? 'all' : 'rule'
  includeVariants.value = true
  includeSource.value = true
  redact.value = true
  fileNameTouched.value = false
  fileNameDraft.value = derivedFileName.value
})

function onClose() {
  show.value = false
}

async function onConfirm() {
  // 关掉脱敏就是导出明文凭证，确认框必须出现在落盘之前而不是选项行里
  if (!redact.value) {
    try {
      await showConfirmDialog({
        title: t('mock.export.rawTitle'),
        message: t('mock.export.rawConfirm'),
        showCancelButton: true,
        confirmButtonText: t('common.done'),
        cancelButtonText: t('common.cancel')
      })
    } catch (err) {
      // 取消明文导出停在当前对话框，用户还能改回脱敏
      return
    }
  }
  show.value = false
  runExport()
}

// Web 分支的落盘就是浏览器的下载：文件名交给 a.download，落到哪儿由浏览器/用户决定
function downloadPack(fileName: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = fileName
  a.click()
  // 同步 revoke 会把浏览器还没接手的下载一起取消
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// 选路径与写盘分两次 IPC：包文本由主进程边拼边写进文件，渲染层经手的只有几十字节的回执和进度。
// Web 分支没有主进程，只能把整份包文本取进浏览器再交 Blob 下载——峰值与包大小同阶，
// 所以风险写在对话框里（webTip），条数超限的提示也就给不出来（回执里没有条数）。
async function runExport() {
  const options: MockPackExportOptions = {
    scope: scope.value,
    ruleId: scope.value === 'rule' ? props.ruleId : null,
    includeVariants: includeVariants.value,
    includeSource: includeSource.value,
    redact: redact.value
  }
  const fileName = normalizeExportFileName(fileNameDraft.value, derivedFileName.value)
  running.value = true
  progress.value = null
  try {
    if (isWeb) {
      // silentError：base.api 对 FAIL/ERROR 自己会弹一次提示，这里再由导出统一报「导出失败：原因」
      downloadPack(fileName, await exportMockPack(options, { silentError: true }))
      showNotify({ message: t('mock.export.savedWeb', { fileName }), type: 'success', duration: 2000 })
      return
    }
    const picked = await window.mainApi.selectSavePath(t('mock.export.saveTitle'), fileName)
    // 用户在系统保存框里取消不是失败，什么都不提示
    if (picked.status !== 'selected' || picked.filePath == null) return
    window.mainApi.onExportPackProgress((p) => { progress.value = p })
    const result = await window.mainApi.exportMockPack(picked.filePath, options)
    if (result.status === 'failed') {
      showNotify({
        message: t('mock.export.failed', { reason: normalizeErrorText(result.error) }),
        type: 'danger',
        duration: 2000
      })
      return
    }
    const ruleCount = result.ruleCount ?? 0
    const recordCount = result.recordCount ?? 0
    showNotify({ message: t('mock.export.saved', { ruleCount, recordCount }), type: 'success', duration: 1500 })
    // 导出侧只按体积放行了，导入侧还会按条数整包拒绝，落盘当场说明比事后失败便宜
    if (isOverImportLimit(recordCount)) {
      showNotify({
        message: t('mock.export.overLimit', { recordCount, limit: MOCK_PACK_MAX_RECORDS }),
        type: 'warning',
        duration: 5000
      })
    }
  } catch (err) {
    showNotify({
      message: t('mock.export.failed', { reason: normalizeErrorText(err) }),
      type: 'danger',
      duration: 2000
    })
  } finally {
    // 这一句在两种形态下都会走到，Web 形态没有 preload：不加可选链就等于让成功的导出改抛异常
    window.mainApi?.offExportPackProgress()
    running.value = false
    progress.value = null
  }
}

onBeforeUnmount(() => {
  // 任务还在跑时组件被卸载（切页/关窗）：监听器挂在 preload 的模块级变量上，不留残钩子
  window.mainApi?.offExportPackProgress()
})
</script>

<style scoped>
/* 自带内容的弹窗沿用全站弹窗沟道（见 MockRuleMgr 的 .conflict-message 注释）：
   沟道只有 --app-dialog-gutter 一条，而 cell 自带的横向内边距会把标签推到标题右边 15.6px，
   归零只能落在这里——tip/进度/按钮行不是 cell，它们必须与标签停在同一条沟道上。
   分隔线与标签读同一条 var（见 global.css 的 .van-cell:after），归零后两头正好落在沟道上。
   纵向内边距不动，行距由 cell 自己给，与全站表单同一来源。 */
.export-form {
  --van-cell-horizontal-padding: 0;
  padding: var(--van-padding-xs) var(--app-dialog-gutter) var(--van-padding-md);
}

/* cell/field 已经自带行距，再叠一档会比全站表单松 6.5px；只有非 cell 的行读本弹窗这一档 */
.export-form>*+*:not(.van-cell):not(.van-field) {
  margin-top: var(--app-sp-md);
}

/* 行标签与全站表单行标签同一档置灰（--van-text-color-2）：cell 的标题默认是主文本色，
   而下面那枚 field 的标签已被 global.css 统一成 text-2，同屏两种深浅会读出两行型。 */
.export-form :deep(.van-cell__title) {
  color: var(--van-text-color-2);
}

/* Vant 把 right-icon 那一栏钉成恒定的 16px 图标字号，radio 的选项文字跟着它就不随字号缩放了，
   改读 cell 自己的字号，与同行标题同一档 */
.export-radios {
  font-size: var(--van-cell-font-size);
}

/* 置灰的「仅当前场景」：Vant 用 --van-text-color-3，暗色下覆成 #4d4d4d 压在弹窗底色上几乎读不出，
   与时间戳同一口径改走 text-color-2（能看出比同行淡，但读得清） */
.export-radios :deep(.van-radio--disabled .van-radio__label) {
  color: var(--van-text-color-2);
}

/* Vant 给横向 radio 组里每枚都留了 12px 右间距，最后一枚那份会让选项文字比整栏右缘早收 12px */
.export-radios :deep(.van-radio:last-child) {
  margin-right: 0;
}

/* Web 分支的说明文字没有复用全局 .hint：那一档读 --van-text-color-3，Vant 暗色把它钉成字面量 #4d4d4d
   （store 的灰阶反转只覆盖 --van-gray-*，动不到它），压在弹窗底色上几乎读不出——与上面禁用态同一口径走 text-2。 */
/* 与导入弹窗的明细区同一口径：全局 body 的 user-select: none 挡的是整页拖蓝，正文里这两行是要划出去
   贴给别人看的（Web 那段的提醒、已写条数的读数），放行只写在自己的类上，不上提成 .van-dialog__content。
   文件名那一格不受影响——Vant 的 .van-field__control 自带 user-select: auto，但派生名是 placeholder，
   placeholder 划不走，只有编辑过之后进了 value 才能划。 */
.export-tip {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
  user-select: text;
}

.export-progress {
  margin-left: var(--app-sp-md);
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
  user-select: text;
}
</style>
