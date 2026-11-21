<template>
  <van-dialog v-model:show="show" width="var(--app-popup-w-md)" :show-confirm-button="false">
    <!-- 统计长在标题行：这一页要放的行本来就多，五个数各占一行会把明细区挤到看不全 -->
    <template #title>
      <div class="import-head">
        <span>{{ headTitle }}</span>
        <van-tag v-for="stat in headStats" :key="stat.key" plain :type="stat.type">{{ stat.text }}</van-tag>
      </div>
    </template>

    <div class="import-body">
      <template v-if="result == null">
        <!-- 三行配置一律用 field（#input 槽放自定义控件）：标签列宽、标签色（global.css 的 .van-field__label）、
             行距与分隔线都由组件给，本页不再自写表单排版。文件名是只读值不是输入框，所以它进 #input 槽而不接 v-model。 -->
        <van-field class="import-file-cell" :label="$t('mock.import.fileLabel')">
          <template #input>
            <span class="import-file truncate" :class="{ 'is-empty': file == null }"
              v-tip="file?.name ?? $t('mock.import.noFile')">{{ file?.name ?? $t('mock.import.noFile') }}</span>
            <van-button class="import-pick" size="small" plain :disabled="busy || writing" @click="onPickFile">
              {{ $t('mock.import.pickFile') }}
            </van-button>
          </template>
        </van-field>

        <van-field :label="$t('mock.import.modeLabel')">
          <template #input>
            <van-radio-group v-model="mode" direction="horizontal" class="import-radios" :disabled="busy || writing">
              <van-radio name="new">{{ $t('mock.import.modeNew') }}</van-radio>
              <van-radio name="merge" :disabled="ruleId == null">{{ $t('mock.import.modeMerge') }}</van-radio>
            </van-radio-group>
          </template>
        </van-field>

        <!-- 冲突策略只在合并模式出现：新建模式包内每条都写进新场景，库里没有可撞的对象 -->
        <van-field v-if="mode === 'merge'" :label="$t('mock.import.conflictLabel')">
          <template #input>
            <van-radio-group v-model="conflict" direction="horizontal" class="import-radios" :disabled="busy || writing">
              <van-radio name="skip">{{ $t('mock.import.conflictSkip') }}</van-radio>
              <van-radio name="overwrite">{{ $t('mock.import.conflictOverwrite') }}</van-radio>
              <van-radio name="copy">{{ $t('mock.import.conflictCopy') }}</van-radio>
            </van-radio-group>
          </template>
        </van-field>

        <div v-if="quotaText" class="import-quota" :class="quotaReject ? 'is-reject' : 'is-warn'">{{ quotaText }}</div>
        <!-- 建议名只在新建模式给（多场景包连一个名字都代表不了），合并模式这一格用来指认「当前场景」是哪个 -->
        <div v-if="suggestedName" class="import-hint">
          {{ $t('mock.import.suggestedName', { name: suggestedName }) }}
        </div>
        <div v-else-if="mergeHint" class="import-hint truncate" v-tip="mergeHint">{{ mergeHint }}</div>

        <!-- 包级失败留在原地而不是弹 toast：用户要对着同一行改成什么才能再试一次 -->
        <div v-if="packError" class="import-error">
          <span class="import-error-title">{{ $t('mock.import.fileProblem') }}</span>
          <span>{{ packError }}</span>
        </div>
      </template>

      <!-- 结果页的三态标注：取消、部分写入、场景名追加过序号，各自说清库里现在是什么样子 -->
      <template v-else>
        <div v-if="result.aborted" class="import-note">{{ $t('mock.import.aborted') }}</div>
        <div v-else-if="result.partial" class="import-note">
          {{ $t('mock.import.partial', { count: writtenCount }) }}
        </div>
        <div v-if="result.nameCollided" class="import-note">{{ $t('mock.import.nameCollided') }}</div>
        <!-- RK6：导入的记录一律不自动启用，这句不说清用户会以为代理已经被这份包接管了 -->
        <div v-if="writtenCount > 0" class="import-enable">
          <span>{{ $t('mock.import.notEnabled', { count: writtenCount }) }}</span>
          <van-button v-if="canGoto" size="small" plain type="primary" @click="onGoto">
            {{ sceneCount > 1 ? $t('mock.import.gotoFirst') : $t('mock.import.gotoEnable') }}
          </van-button>
        </div>
      </template>

      <!-- 明细区自己滚动，弹窗高度不跟着内容长缩：这是本仓库既有的弹窗约束 -->
      <div v-if="groups.length > 0" class="import-detail">
        <div v-for="group in groups" :key="group.key" class="import-group">
          <div class="import-group-head">
            <span class="import-group-title">{{ group.title }}</span>
            <van-tag plain>{{ group.total }}</van-tag>
          </div>
          <div v-for="(row, index) in group.rows" :key="index" class="import-item">
            <span v-if="row.where" class="import-where mono">{{ row.where }}</span>
            <span class="import-item-text truncate" v-tip="row.tip">{{ row.text }}</span>
          </div>
          <div v-if="group.more > 0" class="hint import-more">
            {{ $t('mock.import.more', { count: group.more }) }}
          </div>
        </div>
      </div>
      <div v-else-if="preview != null || result != null" class="hint import-detail-empty">
        {{ $t('mock.import.noIssue') }}
      </div>

      <van-row class="import-actions actions-bar" align="center" justify="end" :wrap="false">
        <template v-if="writing">
          <van-button size="small" plain type="danger" :disabled="cancelSent" @click="onCancelImport">
            {{ cancelSent ? $t('mock.import.cancelSent') : $t('mock.import.cancelImport') }}
          </van-button>
          <van-button size="small" type="primary" loading disabled>
            {{ $t('mock.import.importing') }}
          </van-button>
        </template>
        <template v-else-if="result != null">
          <van-button size="small" plain @click="onRestart">{{ $t('mock.import.again') }}</van-button>
          <van-button size="small" type="primary" @click="show = false">{{ $t('mock.import.done') }}</van-button>
        </template>
        <template v-else>
          <van-button size="small" plain @click="show = false">{{ $t('common.cancel') }}</van-button>
          <van-button size="small" type="primary" :disabled="!canImport || busy" @click="onImport">
            {{ willImportText }}
          </van-button>
        </template>
      </van-row>
    </div>
  </van-dialog>
</template>

<script lang="ts" setup>
import { cancelMockPackImport, importMockPack, previewMockPack } from '@shared'
import type {
  MockPackConflict, MockPackImportMode, MockPackImportResult, MockPackImportOptions,
  MockPackIssue, MockPackPreviewResult, MockPackConflictStrategy,
} from '@shared/mock.pack'
import { MOCK_PACK_CODES } from '@shared/mock.errors'
import { showNotify } from 'vant'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { pickPackFile } from '../../../common/pack-file'
import { normalizeErrorText } from './save-error'

const show = defineModel<boolean>('show', { required: true })
const props = withDefaults(defineProps<{
  /** 合并模式的目标场景就是当前选中的场景，没有它「合并」这一档不可选 */
  ruleId?: string | null
  ruleName?: string
  /** 「前往启用」要有宿主接得住（切到规则管理器并选中那条场景）；接不住的宿主把它关掉 */
  canGoto?: boolean
}>(), { ruleId: null, ruleName: '', canGoto: true })
const emit = defineEmits<{
  (e: 'goto', ruleId: string): void
  (e: 'imported', ruleIds: string[]): void
}>()
const { t } = useI18n()

const mode = ref<MockPackImportMode>('new')
const conflict = ref<MockPackConflictStrategy>('skip')
const file = ref<File>(null)
const preview = ref<MockPackPreviewResult>(null)
const result = ref<MockPackImportResult>(null)
const packError = ref('')
const busy = ref(false)
const writing = ref(false)
const cancelSent = ref(false)

const headTitle = computed(() => t(result.value == null ? 'mock.import.previewTitle' : 'mock.import.resultTitle'))
const suggestedName = computed(() => preview.value?.suggestedRuleName ?? '')
// 场景名不进 radio 标签：标签长度由库里那条规则决定，弹窗压到地板宽时它会把同组另一枚顶出描边
const mergeHint = computed(() => mode.value === 'merge' && props.ruleName
  ? t('mock.import.mergeTarget', { name: props.ruleName }) : '')

// 「将导入 N 条」= 包内条数减去条目级不通过的那几条，两个数在预览响应体里本就分得很清楚
const willImportCount = computed(() => {
  const p = preview.value
  return p == null ? 0 : Math.max(0, p.recordCount - p.invalidCount)
})
const willImportText = computed(() => preview.value == null
  ? t('mock.import.confirmPlain')
  : t('mock.import.confirm', { count: willImportCount.value }))

const canImport = computed(() => file.value != null && preview.value != null && preview.value.quota?.reject !== true)

const quotaText = computed(() => {
  const q = preview.value?.quota
  if (q == null) return ''
  return q.reject
    ? t('mock.import.quotaReject', { total: q.totalRecordCount, incoming: q.incomingRecordCount, existing: q.existingRecordCount })
    : q.warn ? t('mock.import.quotaWarn', { total: q.totalRecordCount, incoming: q.incomingRecordCount, existing: q.existingRecordCount }) : ''
})
const quotaReject = computed(() => preview.value?.quota?.reject === true)

interface Stat { key: string, text: string, type: 'primary' | 'success' | 'warning' | 'danger' }

const headStats = computed<Stat[]>(() => {
  if (result.value != null) {
    const r = result.value
    return [
      { key: 'rules', text: t('mock.import.statRules', { count: r.ruleIds.length }), type: 'primary' },
      { key: 'created', text: t('mock.import.statCreated', { count: r.created.length }), type: 'success' },
      { key: 'updated', text: t('mock.import.statUpdated', { count: r.updated.length }), type: 'primary' },
      { key: 'skipped', text: t('mock.import.statSkipped', { count: r.skipped.length }), type: 'warning' },
      { key: 'failed', text: t('mock.import.statFailed', { count: r.invalidTotal + r.failed.length }), type: 'danger' },
    ]
  }
  const p = preview.value
  if (p == null) return []
  return [
    { key: 'rules', text: t('mock.import.statRules', { count: p.ruleCount }), type: 'primary' },
    { key: 'records', text: t('mock.import.statRecords', { count: p.recordCount }), type: 'primary' },
    { key: 'variants', text: t('mock.import.statVariants', { count: p.variantCount }), type: 'primary' },
    { key: 'invalid', text: t('mock.import.statInvalid', { count: p.invalidCount }), type: p.invalidCount > 0 ? 'warning' : 'primary' },
    { key: 'conflicts', text: t('mock.import.statConflicts', { count: p.conflictCount }), type: p.conflictCount > 0 ? 'warning' : 'primary' },
  ]
})

const writtenCount = computed(() => {
  const r = result.value
  return r == null ? 0 : r.created.length + r.updated.length
})
const sceneCount = computed(() => result.value?.ruleIds.length ?? 0)

interface DetailRow { where: string, text: string, tip: string }
interface DetailGroup { key: string, title: string, total: number, rows: DetailRow[], more: number }

/** 码表里的码走 mock.pack 那块文案，其余（例如服务端给的原始消息）照原文显示 */
function codeText(code?: string, detail?: string): string {
  const known = code != null && (MOCK_PACK_CODES as readonly string[]).includes(code)
  const text = known ? t(`mock.pack.${code}`) : (code ?? '')
  return detail == null || detail === '' ? text : `${text}（${detail}）`
}

function locationOf(item: { ruleIndex?: number, recordIndex?: number }): string {
  if (item.ruleIndex == null || item.recordIndex == null) return ''
  return t('mock.import.location', { rule: item.ruleIndex + 1, record: item.recordIndex + 1 })
}

function fieldOf(item: MockPackIssue): string {
  return item.field == null || item.field === '' ? '' : ` ${item.field}:`
}

function rowsOf<T extends { ruleIndex?: number, recordIndex?: number }>(items: T[],
  text: (item: T) => string): DetailRow[] {
  return items.map((item) => {
    const body = text(item)
    const where = locationOf(item)
    return { where, text: body, tip: where === '' ? body : `${where} ${body}` }
  })
}

/**
 * 三类失败分开措辞（技术设计 §8「失败文案」）：包级是文件问题、条目级是数据问题、
 * 冲突与跳过是库内状态问题——同一句「失败」指向三种完全不同的修法。
 * 明细只回传前 MOCK_PACK_ISSUE_PAGE_LIMIT 条，总数另读响应体里的计数字段。
 */
const groups = computed<DetailGroup[]>(() => {
  const p = preview.value
  if (result.value == null) {
    if (p == null) return []
    return [
      {
        key: 'issues', title: t('mock.import.dataProblem'), total: p.issueTotal, more: p.issueTotal - p.issues.length,
        rows: rowsOf(p.issues, (item) => `${codeText(item.code)}${fieldOf(item)} ${item.detail ?? ''}`.trim()),
      },
      {
        key: 'conflicts', title: t('mock.import.stateProblem'), total: p.conflictCount,
        more: p.conflictCount - p.conflicts.length, rows: rowsOf(p.conflicts, conflictText),
      },
      {
        key: 'notes', title: t('mock.import.defaulted'), total: p.noteTotal, more: p.noteTotal - p.notes.length,
        rows: rowsOf(p.notes, (item) => `${codeText(item.code)}${fieldOf(item)}`),
      },
    ].filter((group) => group.total > 0)
  }

  const r = result.value
  return [
    {
      key: 'skipped', title: t('mock.import.stateProblem'), total: r.skipped.length, more: 0,
      rows: rowsOf(r.skipped, (item) => codeText(item.reason, item.detail)),
    },
    {
      key: 'invalid', title: t('mock.import.dataProblem'), total: r.invalidTotal, more: r.invalidTotal - r.invalid.length,
      rows: rowsOf(r.invalid, (item) => `${codeText(item.code)}${fieldOf(item)}`),
    },
    {
      key: 'failed', title: t('mock.import.writeProblem'), total: r.failed.length, more: 0,
      rows: rowsOf(r.failed, (item) => codeText(item.code, item.detail)),
    },
  ].filter((group) => group.total > 0)
})

function conflictText(item: MockPackConflict): string {
  const kind = t(item.kind === 'id' ? 'mock.import.conflictId' : 'mock.import.conflictFingerprint')
  const target = item.existingName ?? item.existingRecordId
  const enabled = item.existingEnabled === true ? ` · ${t('mock.import.conflictEnabled')}` : ''
  return `${kind} · ${t('mock.import.conflictWith', { name: target })}${enabled}`
}

watch(show, (open) => {
  if (!open || writing.value) return
  file.value = null
  preview.value = null
  result.value = null
  packError.value = ''
  cancelSent.value = false
})

// 预览的口径跟着模式与目标场景变（quota、冲突数、建议名都是），换了就重算一次；
// 冲突策略不改预览数字，所以它不在这里的依赖里
watch([mode, () => props.ruleId], () => {
  if (show.value && file.value != null) runPreview()
})

async function onPickFile() {
  const picked = await pickPackFile('pack')
  // 取消与超限都在通道里给了交代，这里只当「什么都没发生」
  if (picked == null) return
  file.value = picked
  result.value = null
  packError.value = ''
  await runPreview()
}

function options(): MockPackImportOptions {
  return {
    mode: mode.value,
    targetRuleId: mode.value === 'merge' ? props.ruleId ?? null : null,
    conflict: conflict.value,
  }
}

/**
 * 上传一次就是一次完整的读包 + 校验 + 统计，改一个选项等于重来一遍——通道没有可复用的服务端缓存，
 * 这里不假装「切个模式只是改个显示」。silentError：失败由 packError 就地说明，不弹 toast。
 */
async function runPreview() {
  busy.value = true
  preview.value = null
  packError.value = ''
  try {
    preview.value = await previewMockPack(file.value, options(), { silentError: true })
  } catch (err) {
    packError.value = failureText(err)
  } finally {
    busy.value = false
  }
}

async function onImport() {
  writing.value = true
  cancelSent.value = false
  try {
    const imported = await importMockPack(file.value, options(), { silentError: true })
    result.value = imported
    emit('imported', imported.ruleIds)
  } catch (err) {
    // 写库那一步的包级失败（recordTooMany、迁移闸门、并发导入）同样就地说明，库里没动过
    packError.value = failureText(err)
  } finally {
    writing.value = false
    // 预览是写库之前算的，写完之后条数与冲突都变了，不重算就等于让用户照着过期的数字再点一次
    if (result.value != null) preview.value = null
  }
}

/** 包级失败优先按码表说话（那些文案是「这份文件怎么改」），只有码不在表里才退回服务端原文 */
function failureText(err: unknown): string {
  const extra = err as any
  const detail = typeof extra?.detail === 'string' ? extra.detail : undefined
  const text = codeText(extra?.errorCode ?? extra?.code, detail)
  return text !== '' ? text : (normalizeErrorText(err) || t('mock.import.failed'))
}

/** 取消只发信号，剩下的条目由服务层写进 failed 里；这一次点击不结束那次请求 */
async function onCancelImport() {
  cancelSent.value = true
  try {
    await cancelMockPackImport({ silentError: true })
  } catch (err) {
    showNotify({ message: normalizeErrorText(err), type: 'warning', duration: 1500 })
    cancelSent.value = false
  }
}

function onGoto() {
  const ids = result.value?.ruleIds ?? []
  if (ids.length > 0) emit('goto', ids[0])
}

function onRestart() {
  result.value = null
  preview.value = null
  file.value = null
  packError.value = ''
}
</script>

<style scoped>
/* 自带内容的弹窗：沟道与按钮区都读全站那一份（见 global.css 的弹窗一节）。
   横向内边距归零后 field 的标签正好落在标题那一条沟道上，分隔线两头也同步收进来——与 MockExportDialog 的
   .export-form 同形。这两条同形的补丁暂时留在各自 scoped：上提要同时动导出弹窗，而它不属本批范围。 */
.import-body {
  --van-cell-horizontal-padding: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  /* 高度在「按字号放得下明细」与「不把矮窗口顶出屏幕」之间取小：弹窗高度恒定，明细区自己滚动。
     20/45 是 van-row 自写行那档（每行约 28px）；换成 field 之后行高由 cell 给（约 40px，按钮那行 48px），
     三行配置块实测 124.8px（字号 13、合并模式），比原先高出 33.2px，明细区会被压到 26.6px 而只剩滚动条。
     24/55 是补回这一档：同一场景实测明细区 78.6px，最坏那档（字号 14、窗口 640 以下顶到 vh 上限）也还有 58.9px。 */
  height: min(calc(var(--van-font-size-md) * 24), 55vh);
  padding: var(--van-padding-xs) var(--app-dialog-gutter) var(--van-padding-md);
}

/* field 已经自带行距，再叠一档会比全站表单松；只有非 field 的行（散段说明、明细区、按钮行）读这一档 */
.import-body>*+*:not(.van-cell) {
  margin-top: var(--app-sp-md);
}

/* 固定高度 + flex:1 的明细区之间，行不能被压缩：Vant 给 cell 的 overflow: hidden 会把压扁后的控件裁掉 */
.import-body>.van-cell {
  flex: none;
}

.import-file {
  flex: 1;
  min-width: 0;
}

.import-file.is-empty {
  color: var(--van-text-color-2);
}

.import-pick {
  flex: none;
}

/* 「文件」那一格的 #input 里同时放文件名与按钮：Vant 给自定义控件的容器已经是 flex + 垂直居中，
   只差一枚行内沟道（与本页其它行的控件沟道同档） */
.import-file-cell :deep(.van-field__control) {
  gap: var(--app-sp-lg);
}

/* Vant 的 radio 组是 flex-wrap: wrap：不收缩它就一直保持单行的固有宽，弹窗压到地板宽时整组顶穿
   .van-dialog 的 overflow: hidden，最后一枚连圆点都点不着。放开收缩（min-width: 0）让折行只发生在
   枚与枚之间；white-space: nowrap 管的是另一头——不许在「复制为新记录」这种词里断行。 */
.import-radios {
  min-width: 0;
  white-space: nowrap;
}

/* 禁用态的标签：Vant 用 --van-text-color-3，暗色下覆成 #4d4d4d 压在弹窗底色上几乎读不出，
   与导出弹窗、时间戳同一口径改走 text-color-2（淡一档但读得清） */
.import-body :deep(.van-radio--disabled .van-radio__label) {
  color: var(--van-text-color-2);
}

.import-quota,
.import-hint,
.import-note {
  flex: none;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.import-quota.is-reject {
  color: var(--van-danger-color);
}

.import-error {
  flex: none;
  display: flex;
  gap: var(--app-sp-sm);
  color: var(--van-danger-color);
  font-size: var(--van-font-size-sm);
}

.import-error-title {
  flex: none;
  font-weight: 500;
}

.import-enable {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--app-sp-lg);
  color: var(--van-text-color);
}

.import-detail {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.import-detail-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.import-group+.import-group {
  margin-top: var(--app-sp-lg);
}

.import-group-head {
  display: flex;
  align-items: center;
  gap: var(--app-sp-md);
}

.import-group-title {
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.import-item {
  display: flex;
  align-items: center;
  gap: var(--app-sp-md);
  min-width: 0;
}

.import-where {
  flex: none;
  color: var(--van-text-color-2);
}

.import-item-text {
  flex: 1;
  min-width: 0;
}

.import-actions {
  flex: none;
}
</style>
