<template>
  <van-cell-group inset>
    <!-- 全量与单场景的区别写在组标题下那一行：两处入口的语义不同，不说明就会被读成重复入口 -->
    <template #title>
      <div>{{ $t('settings.data.title') }}</div>
      <div class="hint data-scope">{{ $t('settings.data.scopeNote') }}</div>
    </template>

    <!-- 空库不可导，禁用信号走「收起箭头 + 同栏说明」：这一档不能用置灰色，
         Vant 暗色把 gray-5 翻成更浅的一档，越「灰」在暗底上越亮，反而比可用行更抢眼。
         进行中不禁用这一行——再点一次是回到弹窗看进度，关掉弹窗不等于取消任务 -->
    <van-field :label="$t('mock.export.dialogTitle')" label-width="7.5em" input-align="right" readonly
      :is-link="!exportBlocked" :class="{ 'is-blocked': exportBlocked }" @click="onExportRow">
      <template #input>
        <span v-if="exportBlocked" class="hint data-note">{{ $t('mock.export.menuEmpty') }}</span>
        <van-loading v-else-if="exportRunning" size="var(--van-font-size-md)" />
      </template>
    </van-field>

    <!-- 导入没有「当前场景」可依附，弹窗里的合并档因为不传 ruleId 自然禁用 -->
    <van-field :label="$t('mock.import.menuTitle')" label-width="7.5em" readonly is-link
      @click="showImport = true" />
  </van-cell-group>

  <mock-export-dialog v-model:show="showExport" v-model:running="exportRunning" />
  <mock-import-dialog v-model:show="showImport" :can-goto="canGoto" @goto="onGoto" />
</template>

<script lang="ts" setup>
import { searchMockRules } from '@shared'
import { computed, inject, onMounted, ref, watch } from 'vue'
import type { MockMgrTarget } from '../proxy/mock/recording'
import MockExportDialog from '../proxy/mock/MockExportDialog.vue'
import MockImportDialog from '../proxy/mock/MockImportDialog.vue'

const showExport = ref(false)
const showImport = ref(false)
const exportRunning = ref(false)
// 空库不该导一个空包出去，而设置页没有常驻的场景总数可读，只能自己查一次
const exportRuleTotal = ref<number>(null)

const exportBlocked = computed(() => !exportRunning.value && exportRuleTotal.value === 0)

// 抽屉里的宿主（Proxy.vue）提供深链；经 /settings 直达时上层没有 provider，
// 「前往启用」无处可去，就用 canGoto 把那枚按钮藏掉，而不是留一个点了没反应的控件
const openMockRuleMgr = inject<((target: MockMgrTarget) => void) | null>('openMockRuleMgr', null)
const canGoto = computed(() => openMockRuleMgr != null)

async function refreshRuleTotal() {
  try {
    const result = await searchMockRules('')
    exportRuleTotal.value = result?.length ?? null
  } catch (err) {
    exportRuleTotal.value = null
  }
}

onMounted(refreshRuleTotal)

// 导入会新建场景，弹窗关上之后重查一次，否则空库那条置灰会一直挂着
watch(showImport, (open) => {
  if (!open) void refreshRuleTotal()
})

function onExportRow() {
  if (exportBlocked.value) return
  showExport.value = true
}

function onGoto(ruleId: string) {
  showImport.value = false
  openMockRuleMgr?.({ ruleId })
}
</script>

<style scoped>
.data-scope {
  margin-top: var(--app-sp-tight);
  line-height: var(--van-line-height-md);
}

/* 两行说明沿用 .hint 的字号档，颜色改走次级文本色：.hint 读 --van-text-color-3，Vant 暗色把它钉成字面量
   #4d4d4d，压在深色卡片上读不出——导出弹窗、导入弹窗那几处同一缺陷，本页面同一口径处理 */
.data-scope,
.data-note {
  color: var(--van-text-color-2);
}

/* 只剩光标：不可导的信号由收起的箭头和右栏说明承担，见模板里那段注释 */
.is-blocked {
  cursor: not-allowed;
}
</style>
