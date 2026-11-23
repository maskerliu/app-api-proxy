<template>
  <!-- 写库进行中遮罩不给关：那一段时间里唯一的有效动作是「取消导入」，而结果页（部分写入、场景名撞过号）
       只在弹窗里说明，关掉就等于把这些交代丢在后台 -->
  <van-dialog v-model:show="show" width="var(--app-popup-w-form)" :show-confirm-button="false"
    :close-on-click-overlay="!writing">
    <!-- 统计长在标题行：这一页要放的行本来就多，五个数各占一行会把明细区挤到看不全。
       常规计数排成一句弱色文本，只有需要用户处理的异常计数（非 0）才单独出一枚 tag——五枚 tag 里三枚恒亮等于没表达 -->
    <template #title>
      <div class="import-head">
        <span>{{ headTitle }}</span>
        <span v-if="headCounts.length > 0" class="import-head-counts">{{ headCounts.join(' · ') }}</span>
        <van-tag v-for="stat in headAlarms" :key="stat.key" plain :type="stat.type">{{ stat.text }}</van-tag>
      </div>
    </template>

    <div class="import-body">
      <template v-if="result == null">
        <!-- 配置行的标签列宽、标签色、行距与分隔线都由组件给，本页不再自写表单排版。文件名是只读值 + 一枚动作，
             不是输入框，所以那一格用 cell 的 #value 槽；选模式与冲突策略是真正的控件，用 field 的 #input 槽。
             带说明的行由 import-block 成组：说明压在所属行下面而不是排在整块表单尾部，分隔线也跟着挪到组底，
             所以 cell 自带的那份下留白归沟道管。配额那句留在整行宽度上而不是缩进进值列：值列比内容区窄 93px，
             它在两种语言里都会多绕一行。 -->
        <div class="import-block" :class="fileNote ? 'has-note' : ''">
          <van-cell class="import-file-cell" :title="remote == null ? $t('mock.import.fileLabel') : $t('mock.import.remoteLabel')"
            :border="false" center>
            <template #value>
              <div class="import-control-main">
                <span class="import-file truncate" :class="{ 'is-empty': sourceLabel === '' }"
                  v-tip="sourceLabel || $t('mock.import.noFile')">{{ sourceLabel || $t('mock.import.noFile') }}</span>
                <!-- 输入源在别处已经定下来的时候不再给「选择文件」：那一格换成远端的名字，
                     按钮留着等于给用户第二条路径去改他已经勾好的远端内容 -->
                <van-button v-if="remote == null" class="import-pick" size="small" plain
                  :disabled="busy || writing" @click="onPickFile">
                  {{ $t('mock.import.pickFile') }}
                </van-button>
              </div>
            </template>
          </van-cell>
          <!-- 包级失败与条数上限都只由「这个文件」决定，两者也互斥：读不出文件就没有预览数字。
               包级失败留在原地而不是弹 toast：用户要对着同一行改成什么才能再试一次 -->
          <div v-if="fileNote === 'error'" class="import-help is-error">
            <span class="import-help-title">{{ remote == null ? $t('mock.import.fileProblem') : $t('mock.import.remoteProblem') }}</span>
            <span>{{ packError }}</span>
          </div>
          <div v-else-if="fileNote === 'quota'" class="import-help" :class="{ 'is-reject': quotaReject }">{{ quotaText }}</div>
        </div>

        <van-field :label="$t('mock.import.modeLabel')">
          <template #input>
            <div class="import-control-main">
              <van-radio-group v-model="mode" direction="horizontal" class="import-radios" :disabled="busy || writing">
                <van-radio name="new">{{ $t('mock.import.modeNew') }}</van-radio>
                <van-radio name="merge" :disabled="ruleId == null">{{ $t('mock.import.modeMerge') }}</van-radio>
              </van-radio-group>
              <!-- 目标场景名顶到行尾右沟道（与「选择文件」那枚按钮的右缘落在同一条竖线上），不再紧跟 radio：
                   紧跟会被读成「radio 的附属说明」，顶到右端读起来像整行的状态标注 -->
              <span v-if="modeHint" class="import-mode-hint truncate" v-tip="modeHint">{{ modeHint }}</span>
            </div>
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
          <!-- 一批全是「覆盖」时这句没有可说的对象：那几条的启用位是库里那条自己的属性，本窗口既不报也不改 -->
          <span v-if="createdCount > 0">{{ enableSummary }}</span>
          <!-- 只启用本次新建的那几条：覆盖到的库里那条保持它落库时的样子，一次点击不该改用户自己写好的记录 -->
          <van-button v-if="enableTargets.length > 0" size="small" plain type="primary"
            :loading="enabling" @click="onEnableRecords">
            {{ $t('mock.import.enableRecords', { count: enableTargets.length }) }}
          </van-button>
          <!-- 启用记录不等于启用场景，第二枚负责把人带到场景那一页去开那个开关 -->
          <van-button v-if="canGoto && sceneCount > 0" size="small" plain @click="onGoto">
            {{ $t('mock.import.gotoScene') }}
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
import { cancelMockPackImport, enableMockRecords } from '@shared'
import type {
  MockPackConflict, MockPackImportMode, MockPackImportResult, MockPackImportOptions,
  MockPackIssue, MockPackPreviewResult, MockPackConflictStrategy,
} from '@shared/mock.pack'
import { MOCK_PACK_CODES, MOCK_SHARE_CODES } from '@shared/mock.errors'
import { showConfirmDialog, showNotify } from 'vant'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { pickPackFile } from '../../../common/pack-file'
import type { MockImportSource } from './import-source'
import { fileImportSource } from './import-source'
import { normalizeErrorText } from './save-error'

const show = defineModel<boolean>('show', { required: true })
const props = withDefaults(defineProps<{
  /** 合并模式的目标场景就是当前选中的场景，没有它「合并」这一档不可选 */
  ruleId?: string | null
  ruleName?: string
  /** 「查看场景」要有宿主接得住（切到规则管理器并选中那条场景）；接不住的宿主把它关掉 */
  canGoto?: boolean
  /**
   * 给了这一项就等于「输入源已经在别处选好」：文件名那一行不再给「选择文件」的按钮，
   * 剩下的两态、冲突三档、写库与取消全走同一条链。云共享的恢复就是这一格的第一个使用方。
   */
  remote?: MockImportSource | null
}>(), { ruleId: null, ruleName: '', canGoto: true, remote: null })
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
// 这一次点「启用这 N 条」实际翻开过的 id：结果页要按它把那句说明换成「已启用几条」，也让按钮只数还没开的
const enabledIds = ref<Set<string>>(new Set())
const enabling = ref(false)

const headTitle = computed(() => t(result.value == null ? 'mock.import.previewTitle' : 'mock.import.resultTitle'))
const suggestedName = computed(() => preview.value?.suggestedRuleName ?? '')
// 场景名不进 radio 标签：标签长度由库里那条规则决定，弹窗压到地板宽时它会把同组另一枚顶出描边
const mergeHint = computed(() => mode.value === 'merge' && props.ruleName
  ? t('mock.import.mergeTarget', { name: props.ruleName }) : '')
// 建议名只在新建模式给（多场景包连一个名字都代表不了），合并模式那一格换成指认「当前场景」是哪个
const modeHint = computed(() => suggestedName.value === '' ? mergeHint.value
  : t('mock.import.suggestedName', { name: suggestedName.value }))

// 「将导入 N 条」= 包内条数减去条目级不通过的那几条，两个数在预览响应体里本就分得很清楚
const willImportCount = computed(() => {
  const p = preview.value
  return p == null ? 0 : Math.max(0, p.recordCount - p.invalidCount)
})
const willImportText = computed(() => preview.value == null
  ? t('mock.import.confirmPlain')
  : t('mock.import.confirm', { count: willImportCount.value }))

/**
 * 输入源只这一个读法：给了远端就用远端，否则用刚选中的文件。
 * 后面的预览与写库都从这里取，不在两处各写一遍「是文件还是远端」的判断。
 */
const activeSource = computed(() => props.remote ?? (file.value == null ? null : fileImportSource(file.value)))
const sourceLabel = computed(() => activeSource.value?.label ?? '')

const canImport = computed(() => activeSource.value != null && preview.value != null && preview.value.quota?.reject !== true)

const quotaText = computed(() => {
  const q = preview.value?.quota
  if (q == null) return ''
  return q.reject
    ? t('mock.import.quotaReject', { total: q.totalRecordCount, incoming: q.incomingRecordCount, existing: q.existingRecordCount })
    : q.warn ? t('mock.import.quotaWarn', { total: q.totalRecordCount, incoming: q.incomingRecordCount, existing: q.existingRecordCount }) : ''
})
const quotaReject = computed(() => preview.value?.quota?.reject === true)
// 文件那一行的说明只有一个格子：包级失败优先，它成立时根本没有预览数字
const fileNote = computed(() => packError.value !== '' ? 'error' : (quotaText.value !== '' ? 'quota' : ''))

interface Stat { key: string, text: string, type: 'warning' | 'danger' }

/** 常规计数：标题行里排成一句弱色文本，不需要单独占位就能读完 */
const headCounts = computed<string[]>(() => {
  const r = result.value
  if (r != null)
    return [
      t('mock.import.statRules', { count: r.ruleIds.length }),
      t('mock.import.statCreated', { count: r.created.length }),
      t('mock.import.statUpdated', { count: r.updated.length }),
    ]
  const p = preview.value
  if (p == null) return []
  return [
    t('mock.import.statRules', { count: p.ruleCount }),
    t('mock.import.statRecords', { count: p.recordCount }),
    t('mock.import.statVariants', { count: p.variantCount }),
  ]
})

/** 异常计数：预览看条目级不通过与库内冲突，结果看跳过与写失败；为 0 就整枚不出现 */
const headAlarms = computed<Stat[]>(() => {
  const r = result.value
  if (r != null) {
    const failed = r.invalidTotal + r.failed.length
    return [
      r.skipped.length > 0 ? { key: 'skipped', text: t('mock.import.statSkipped', { count: r.skipped.length }), type: 'warning' } : null,
      failed > 0 ? { key: 'failed', text: t('mock.import.statFailed', { count: failed }), type: 'danger' } : null,
    ].filter((stat): stat is Stat => stat != null)
  }
  const p = preview.value
  if (p == null) return []
  return [
    p.invalidCount > 0 ? { key: 'invalid', text: t('mock.import.statInvalid', { count: p.invalidCount }), type: 'warning' } : null,
    p.conflictCount > 0 ? { key: 'conflicts', text: t('mock.import.statConflicts', { count: p.conflictCount }), type: 'warning' } : null,
  ].filter((stat): stat is Stat => stat != null)
})

const writtenCount = computed(() => {
  const r = result.value
  return r == null ? 0 : r.created.length + r.updated.length
})
const sceneCount = computed(() => result.value?.ruleIds.length ?? 0)

/**
 * 那句「均未启用」说得起的只有本次新建的那几条：「覆盖」换掉的那几条沿用库里原本的启用位，
 * 而界面既读不到库里那条是开着还是停着，那枚按钮也不碰它们——按 `created + updated` 计会在覆盖档把话说满。
 */
const createdCount = computed(() => result.value?.created.length ?? 0)

/** 只有新建的那几条是这次导入「带进来」的，覆盖那批的启用位属于库里原有那条记录，不在这次点击的范围里 */
const enableTargets = computed<string[]>(() => {
  const created = result.value?.created ?? []
  return created.filter(id => !enabledIds.value.has(id))
})

/** 那句话必须跟着点击变：点了之后还说「均未启用」，用户会以为按钮没生效 */
const enableSummary = computed(() => {
  const opened = enabledIds.value.size
  if (opened === 0) return t('mock.import.notEnabled', { count: createdCount.value })
  const rest = createdCount.value - opened
  return rest > 0
    ? t('mock.import.enabledSome', { count: opened, rest })
    : t('mock.import.enabledAll', { count: opened })
})

interface DetailRow { where: string, text: string, tip: string }
interface DetailGroup { key: string, title: string, total: number, rows: DetailRow[], more: number }

/** 码表里的码走文案块（包内的走 mock.pack，远端取回那批走 mock.share），其余（例如服务端给的原始消息）照原文显示 */
function codeText(code?: string, detail?: string): string {
  const pack = code != null && (MOCK_PACK_CODES as readonly string[]).includes(code)
  const share = code != null && (MOCK_SHARE_CODES as readonly string[]).includes(code)
  const text = pack ? t(`mock.pack.${code}`) : share ? t(`mock.share.${code}`) : (code ?? '')
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
  // 远端内容在别处已经勾好，没有「选文件」那一步来触发预览：弹窗一开就地算一次
  if (props.remote != null) void runPreview()
})

// 预览的口径跟着模式与目标场景变（quota、冲突数、建议名都是），换了就重算一次；
// 冲突策略不改预览数字，所以它不在这里的依赖里
watch([mode, () => props.ruleId], () => {
  if (show.value && activeSource.value != null) runPreview()
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
  const source = activeSource.value
  if (source == null) return
  busy.value = true
  preview.value = null
  packError.value = ''
  try {
    preview.value = await source.preview(options())
  } catch (err) {
    packError.value = failureText(err)
  } finally {
    busy.value = false
  }
}

async function onImport() {
  const source = activeSource.value
  if (source == null) return
  writing.value = true
  cancelSent.value = false
  try {
    const imported = await source.import(options())
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

/**
 * 二次确认里就要把「这只开记录、不开场景」写完：点完才发现代理还没走这个场景，
 * 用户只会当成按钮坏了，而那实际上是另一枚开关。
 */
async function onEnableRecords() {
  const ids = enableTargets.value
  try {
    await showConfirmDialog({
      title: t('mock.import.enableTitle'),
      message: t('mock.import.enableConfirm', { count: ids.length }),
      showCancelButton: true,
      confirmButtonText: t('common.done'),
      cancelButtonText: t('common.cancel')
    })
  } catch (err) {
    return
  }
  enabling.value = true
  try {
    const res = await enableMockRecords(ids)
    enabledIds.value = new Set([...enabledIds.value, ...res.enabled])
    // 打不开的那几条不改变句子结构，只补一声：本次新建的计数（createdCount）里它们仍然算「停用」
    if (res.unavailable > 0) {
      showNotify({
        message: t('mock.import.enableFailed', { count: res.unavailable }),
        type: 'warning', duration: 2000,
      })
    }
  } catch (err) {
    showNotify({ message: normalizeErrorText(err), type: 'warning', duration: 2000 })
  } finally {
    enabling.value = false
  }
}

function onRestart() {
  result.value = null
  preview.value = null
  file.value = null
  packError.value = ''
  enabledIds.value = new Set()
}
</script>

<style scoped>
/* 标题行落在 Vant 的 .van-dialog__header 里，那一格只有文字排版：要拿沟道与「放不下就整体换行」得自己起 flex。
   flex-wrap 让异常 tag 挤不下时整枚掉到第二行，而不是把计数串劈成两截（计数串 flex: none 是这条的前提）。 */
.import-head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--app-sp-sm);
  justify-content: center;
}

.import-head-counts {
  color: var(--van-text-color-2);
  flex: none;
  font-size: var(--van-font-size-sm);
}

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
     24/55 是补回这一档：同一场景实测明细区 78.6px，最坏那档（字号 14、窗口 640 以下顶到 vh 上限）也还有 58.9px。
     说明归到所属行之后配置块又收回约 10px（72 档实测明细区中位 92.3 → 104.8、地板 48.9 → 54.5），
     但把这一档退回 20/45 仍会在字号 14 的窄窗把明细区压到 0，所以留着。
     目标场景名并进 radio 那一行、明细行降到次级字号后再测：960 宽弹窗的明细区 99 / 109 / 119px
     （字号 12 / 13 / 14），地板宽 448 那档 102px（radio 换行把配置块顶高 6.5px），这一档不用再动。
     2026-11-22 弹窗宽度从 md 档（960）改到表单档（--app-popup-w-form，600）后这一档没重测：宽度是按
     分段读数推的（见 global.css 那条），600 那版配置块仍单行的话明细区只会比 960 少 0（横向不占高度），
     真嫌挤再动这一档。 */
  height: min(calc(var(--van-font-size-md) * 24), 55vh);
  padding: var(--van-padding-xs) var(--app-dialog-gutter) var(--van-padding-md);
}

/* field 已经自带行距，再叠一档会比全站表单松；只有成组的行、明细区与按钮行读这一档 */
.import-body>*+* {
  margin-top: var(--app-sp-md);
}

/* 固定高度 + flex:1 的明细区之间，行不能被压缩：Vant 给 cell 的 overflow: hidden 会把压扁后的控件裁掉 */
.import-block,
.import-body>.van-cell {
  flex: none;
}

/* 这一组的分隔线由 import-block 自己画，两种状态同源。交给 cell 画不出来：Vant 有一条
   `.van-cell:last-child:after,.van-cell--borderless:after{display:none}`，没有副说明时这枚 cell 正好是组的
   最后一个子元素，线被静默吃掉（2026-11-22 实拍发现「选择文件」底下没有线）；有说明时线又必须压在说明下面，
   而不是夹在行与说明之间。几何照 global.css 的 `.van-cell:after`：左右读同一条 --van-cell-horizontal-padding、
   颜色读 --van-cell-border-color，才和上下 field 行的线落在同一对沟道上。不用 van-hairline--bottom，
   那条是四边 -50% + scale(.5) 的满宽线，两头不吃沟道。position: relative 是给这条伪元素找锚点，
   没有它线会按弹窗定位。 */
.import-block {
  position: relative;
}

.import-block:after {
  border-bottom: 1px solid var(--van-cell-border-color);
  bottom: 0;
  box-sizing: border-box;
  content: " ";
  left: var(--van-cell-horizontal-padding);
  pointer-events: none;
  position: absolute;
  right: var(--van-cell-horizontal-padding);
  transform: scaleY(0.5);
}

/* 带说明的那一行自己成一组：说明紧贴所属行（紧邻即从属，比行与行之间紧一档），分隔线在组底，
   cell 自带的那份下留白就不再重复计一次——不收掉的话整组比说明散在表单尾部那版还高 13px。
   display 必须是 flex 列：gap 只在 flex/grid 上生效，默认 block 时那档 sp-tight 是条死声明
   （实测说明贴所属行 0px，行底留白又收成 0，两句之间只剩行高自带的余量）。 */
.import-block.has-note {
  display: flex;
  flex-direction: column;
  gap: var(--app-sp-tight);
}

.import-block.has-note>.van-cell {
  padding-bottom: 0;
}

/* 「文件」那一格里文件名与按钮并排：这档 flex 容器同时服务 cell 的值列与 field 的自定义控件槽，
   两边都只差一枚行内沟道（field 那层容器本就 flex + 垂直居中，cell 的值列不是）。
   flex:1 在 field 的 body 里让容器吃满剩余宽度，这样末尾那枚「当前场景」hint 的 margin-left:auto
   才真的能把 hint 顶到右沟道；在 cell 的值列里容器是 block 子元素，flex:1 不生效、无害。 */
.import-control-main {
  align-items: center;
  display: flex;
  flex: 1;
  gap: var(--app-sp-lg);
  min-width: 0;
}

/* 文件那一格改用 cell（只读值 + 动作，不是输入框）之后的两条补偿：
   1) cell 的标题列默认与值列各 flex:1（各占一半），会和上下两行 field 那 6.2em 的固定标签列错开，
      所以照 field 的同一份 token 对齐，标签右缘与上下两行落在同一条竖线上；
   2) 标题色：field 的标签由 global.css 统一成 text-2，cell 标题仍是主文本色，同屏会读出两档深浅。 */
.import-file-cell :deep(.van-cell__title) {
  color: var(--van-text-color-2);
  flex: none;
  margin-right: var(--van-padding-sm);
  width: var(--van-field-label-width);
}

/* 值列默认右对齐 + 次级灰，那是给「值文本」定的；这一格放的是控件，
   由文件名自己吃满剩余宽度把按钮顶到右沟道上。min-width:0 让窄弹窗里先让文件名截断，而不是把按钮挤出描边。 */
.import-file-cell :deep(.van-cell__value) {
  min-width: 0;
  text-align: left;
}

/* 文件名是主文本色（值列那条灰色是给值文本的），只有「未选择文件」那一档占位才走灰 */
.import-file {
  color: var(--van-text-color);
  flex: 1;
  min-width: 0;
}

.import-file.is-empty {
  color: var(--van-text-color-2);
}

.import-pick {
  flex: none;
}

/* Vant 的 radio 组是 flex-wrap: wrap：不收缩它就一直保持单行的固有宽，弹窗压到地板宽时整组顶穿
   .van-dialog 的 overflow: hidden，最后一枚连圆点都点不着。放开收缩（min-width: 0）让折行只发生在
   枚与枚之间；white-space: nowrap 管的是另一头——不许在「复制为新记录」这种词里断行。 */
.import-radios {
  min-width: 0;
  white-space: nowrap;
}

/* 目标场景名 / 建议名并入 radio 那一行（单起一行会被读成下一行「冲突处理」的说明）：
/* 目标场景名 / 建议名都贴到行尾右沟道：hint 在 flex 容器里用 margin-left:auto 顶到最右，
   与同弹窗「选择文件」那枚按钮的右缘落在同一条竖线上。字号取次级一档，与它说明的对象区分开，
   也与弹窗里其余说明文字同档。flex 显式写成 0 1 auto——不放大（不抢 radio 组的固有宽）、可收缩
   （放不下时先让自己省略号 + v-tip）；radio 组那头保持可收缩可换行，弹窗压到地板宽时不许裁掉半枚圆点。 */
.import-mode-hint {
  color: var(--van-text-color-2);
  flex: 0 1 auto;
  font-size: var(--van-font-size-sm);
  margin-left: auto;
  min-width: 0;
}

/* 禁用态的标签：Vant 用 --van-text-color-3，暗色下覆成 #4d4d4d 压在弹窗底色上几乎读不出，
   与导出弹窗、时间戳同一口径改走 text-color-2（淡一档但读得清） */
.import-body :deep(.van-radio--disabled .van-radio__label) {
  color: var(--van-text-color-2);
}

.import-help,
.import-note {
  flex: none;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-sm);
}

.import-help.is-reject {
  color: var(--van-danger-color);
}

.import-help.is-error {
  color: var(--van-danger-color);
  display: flex;
  gap: var(--app-sp-sm);
}

.import-help-title {
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

/* 明细区是数据面：全局 body 的 user-select: none 挡的是整页拖蓝，但包内 URL、字段名、错误 detail 要能
   划出去贴给别人。放行只写在这块自己的类上，不上提成 .van-dialog__content 那条（全站共享面，见 R4 14.2 Q8）。
   被省略号截断的那行也划得到全文——DOM 里存的是完整值，截断只是视觉。 */
.import-detail {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  user-select: text;
}

.import-detail-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 明细行原先一行贴一行（组内 0 沟道），缩一档字号后补上同行沟道：行距取行内密排档里偏松的一档，
   组与组之间再走区块级留白，否则「哪几行属于这一组」只能靠标题颜色认。 */
.import-group {
  display: flex;
  flex-direction: column;
  gap: var(--app-sp-lg);
}

.import-group+.import-group {
  margin-top: var(--app-sp-2xl);
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

/* 明细是逐行核对的数据，不是正文：字号降到次级一档（设置值 +2，与上面三行配置那档 +4 同一来源缩放，
   不写死 px），整页只降这一档就够拉开——明细行原本与配置行同字号，读起来像同一组控件 */
.import-item {
  display: flex;
  align-items: center;
  font-size: var(--van-font-size-sm);
  gap: var(--app-sp-md);
  min-width: 0;
}

.import-where {
  flex: none;
  color: var(--van-text-color-2);
}

.import-item-text {
  /* 明细的状态句是这一区的主文本：Vant 的 cell 自己不带 color 规则，而这些行不是 cell，
     不显式上色就一路继承 UA 黑色（暗色实测 rgb(0,0,0) 压在弹窗底色 rgb(28,28,30) 上读不出）。
     定位那一格是次级信息，走 text-2，两档的分工与全站键值行同一口径。 */
  color: var(--van-text-color);
  flex: 1;
  min-width: 0;
}

/* 按钮行始终贴在 body 底边：没选文件那一档既没有明细区也没有空态占位（两者各自 flex:1），
   body 里没人吃剩余高度，按钮就浮在配置块下面。margin-top:auto 把这一档的剩余空间全给它；
   有 flex:1 兄弟时剩余空间已被吃掉，这条自动失效，两种状态同源。
   选择器带上 .import-body> 是为了压过上面那条 .import-body>*+* 的 sp-md（同特异度要靠文件顺序，别赌）。 */
.import-body>.import-actions {
  flex: none;
  margin-top: auto;
}
</style>
