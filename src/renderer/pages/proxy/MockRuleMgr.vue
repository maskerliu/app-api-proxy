<template>
  <van-row class="mgr-content">
    <van-row class="border-bg" ref="topBar" justify="start" style="width: calc(100% - 10px);"
      :style="{ paddingTop: isWeb ? '0' : '10px' }">
      <van-col style="min-width: 348px; flex-grow: 1;">
        <van-collapse accordion v-model="activeSearchResult" :border="false">
          <van-collapse-item name="0" :disabled="true" :is-link="false" style="padding-top: 2px;">
            <template #title>
              <van-search show-action :clearable="false" v-model="keyword" style="padding: 0;"
                :placeholder="$t('common.searchPlaceholder')">
                <template #action>
                  <van-icon plain type="primary" name="plus" size="small" @click="onRuleEdit(null)"
                    style="margin-right: 35px;" />
                </template>
              </van-search>
            </template>

            <van-list class="search-result" :error="rules?.length == 0" :error-text="$t('common.searchNoMatch')">
              <van-cell center class="rule-snap-item1" is-link v-for="(rule, idx) in rules" :title="rule.name"
                :label="rule.desc" @click="onRuleSelect(rule)">
                <template #value>
                  <div>
                    <van-icon class="iconfont icon-edit" size="16" style="color: #3498db; padding: 5px"
                      @click="onRuleEdit(rule)" />
                    <van-icon class="iconfont icon-delete" size="16" style="color: red; padding: 5px"
                      @click="onRuleDelete(rule)" />
                    <van-icon class="iconfont icon-upload" size="16" style="color: red; padding: 5px" @click="onSave" />
                  </div>
                </template>
              </van-cell>
            </van-list>
          </van-collapse-item>
        </van-collapse>
      </van-col>
      <van-col style="min-width: 380px; flex-grow: 1;">
        <van-cell :clickable="false" center :title="`[${curRule?.name == null ? $t('mock.rule.name') : curRule?.name}]`"
          style="padding: 5px 10px;" :title-style="{ flexGrow: 1.2 }" value-class="rule-mgr-cell-value">
          <template #icon v-if="curRule._id != null">
            <van-icon class="iconfont icon-cancel" size="20" style="color: red; margin-right: 10px;"
              @click="onRuleSelect(null)" />
          </template>
          <template #label>
            <span style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              {{ curRule?.desc == null ? $t('mock.rule.desc') : curRule.desc }}
            </span>
          </template>
          <template #value>
            <van-button plain type="primary" size="small" @click="onRuleEdit(curRule)" :disabled="curRule._id == null">
              <van-icon class="iconfont icon-edit" size="14" />
            </van-button>
            <van-button plain type="danger" size="small" @click="onRuleDelete(curRule)" :disabled="curRule._id == null"
              style="margin-left: 10px;">
              <van-icon class="iconfont icon-delete" size="14" style="color: red;" />
            </van-button>
            <van-button plain type="primary" size="small" @click="onSave(false)" :disabled="curRule._id == null"
              style="margin-left: 10px;">
              <van-icon class="iconfont icon-cloud-sync" size="14" />
            </van-button>
          </template>
          <template #right-icon>
            <van-switch v-model="curRule.isMock" style="margin: 0 35px 0 10px;" @change="onMockSwitchChanged(curRule)"
              :disabled="curRule._id == null" />
          </template>
        </van-cell>
      </van-col>
    </van-row>
    <van-row :style="{ width: '100%', height: 'calc(100vh - 10px - ' + topBarHeight + 'px)' }">
      <van-list class="border-bg" style="width: 300px; height: calc(100% - 10px);"
        v-if="curRule != null && curRule.requests != null">
        <van-cell center v-for="record in [...curRule.requests.values()]" @click="onRecordSelected(record)" clickable
          is-link>
          <template #title>
            <div class="record-snap">{{ record.url }}</div>
          </template>
          <template #label>
            <van-tag plain mark :type="record.statusCode == 200 ? 'success' : 'danger'">
              [http]{{ record.statusCode }}
            </van-tag>
            <van-tag plain mark style="margin-left: 5px"
              :type="record.responseData?.code == 8000 ? 'success' : 'danger'">
              [biz]{{ record.responseData?.code }}
            </van-tag>
          </template>
          <template #right-icon>
            <van-button plain type="danger" size="small" icon="delete-o" @click="onRecordDelete(record.url)" />
          </template>
        </van-cell>
      </van-list>
      <van-col style="padding-top: 50px">
        <van-button type="primary" size="mini" icon="exchange" @click="addRecord" />
      </van-col>

      <van-col style="flex: 1; ">
        <vue-ace-editor :read-only="false" :data="content" />
      </van-col>
    </van-row>

    <van-dialog :title="$t('mock.rule.delete.title')" :show="showRuleDelete" show-cancel-button
      :cancel-button-text="$t('common.cancel')" @cancel="showRuleDelete = false"
      :confirm-button-text="$t('common.done')" @confirm="onRuleDeleteConfirm"
      :message="$t('mock.rule.delete.confirm', { rule: curRule != null ? curRule.name : '' })" />

    <van-dialog :title="$t('mock.rule.title')" :show="showRuleEdit" show-cancel-button
      :cancel-button-text="$t('common.cancel')" @cancel="showRuleEdit = false" :confirm-button-text="$t('common.done')"
      @confirm="onSave(true)">
      <van-form ref="form" labvan-width="90px" v-if="curRule != null">
        <van-field :label="$t('mock.rule.name')" v-model="curRule.name" :placeholder="$t('mock.rule.name')" />
        <van-field rows="4" type="textarea" v-model="curRule.desc" :placeholder="$t('mock.rule.desc')" />
      </van-form>
    </van-dialog>

    <van-dialog :title="$t('mock.record.delete.title')" :show="showRecordDelete" show-cancel-button
      :cancel-button-text="$t('common.cancel')" @cancel="showRecordDelete = false"
      :confirm-button-text="$t('common.done')" @confirm="onRecordDeleteConfirm"
      :message="$t('mock.record.delete.confirm')" />
  </van-row>
</template>

<script lang="ts" setup>
import { Row, showNotify } from 'vant'
import { inject, onMounted, Ref, ref, watch } from 'vue'
import { ProxyMock } from '../../../common'
import { json2map, map2json } from '../../common'
import { ProxyRecordStore } from '../../store'
import VueAceEditor from '../components/VueAceEditor.vue'

const recordStore = ProxyRecordStore()
const topBar = ref<typeof Row>()
const keyword = ref<string>('')
const activeSearchResult = ref<string>('-1')
const rules = ref<Array<ProxyMock.MockRule>>(null)
const curRecordKey = ref<string>(null)
const showRuleEdit = ref(false)
const showRuleDelete = ref(false)
const showRecordDelete = ref(false)
const curRule = ref<ProxyMock.MockRule>(new ProxyMock.MockRule())
const content = ref<string>(null)
const windowHeight = ref<number>(0)
const topBarHeight = ref<number>(0)
const maxLines = ref<number>(0)

const showMockRuleMgr = inject<Ref<boolean>>('showMockRuleMgr')
const withCurRecord = inject<Ref<boolean>>('withCurRecord')

const isWeb = __IS_WEB__

onMounted(() => {
  window.onresize = () => {
    windowHeight.value = document.body.clientHeight
    topBarHeight.value = topBar.value.$el.offsetHeight
  }
  windowHeight.value = document.body.clientHeight
  topBarHeight.value = topBar.value.$el.offsetHeight

  curRule.value = new ProxyMock.MockRule()
  content.value = JSON.stringify(recordStore.curRecord(), null, '\t')
})

watch(showMockRuleMgr, (_new, _old) => {
  if (_new && withCurRecord.value) {
    content.value = JSON.stringify(recordStore.curRecord(), null, '\t')
  } else {
    content.value = null
  }
})

watch(keyword, async () => {
  if (keyword.value == '') {
    activeSearchResult.value = '-1'
    return
  }

  try {
    rules.value = await ProxyMock.searchMockRules(keyword.value)
  } catch (err) {
    showNotify({ message: '未找到匹配的规则', type: 'danger', duration: 800 })
  }
  activeSearchResult.value = '0'
})

watch(() => windowHeight.value, (_new) => {
  maxLines.value = Math.floor((_new - topBarHeight.value - 12) / 15)
})

watch(() => topBarHeight.value, (_new) => {
  maxLines.value = Math.floor((windowHeight.value - _new - 12) / 15)
})

function addRecord() {
  if (curRule.value == null) curRule.value = new ProxyMock.MockRule()
  if (curRule.value.requests == null) curRule.value.requests = new Map()

  try {
    let record = JSON.parse(content.value)
    curRule.value.requests.set(record.url, record)
  } catch (err) {
    showNotify({ message: '数据格式错误', type: 'danger', duration: 800 })
  }
}

function onRuleSelect(rule: ProxyMock.MockRule) {
  if (rule != null) {
    curRule.value = rule
    fetchMockRuleDetail()
  } else {
    curRule.value = new ProxyMock.MockRule()
  }
  content.value = null
  keyword.value = ''
  activeSearchResult.value = '-1'
}

async function fetchMockRuleDetail() {
  if (curRule.value.name == null && curRule.value._id == null) return

  try {
    curRule.value = await ProxyMock.getMockRuleDetail(curRule.value._id)
    curRule.value.requests = json2map(curRule.value.jsonRequests)
  } catch (err) {
    showNotify({ message: '未找到对应规则', type: 'warning', duration: 1000 })
  }
}

function onRuleEdit(rule?: ProxyMock.MockRule) {
  curRule.value = rule == null ? new ProxyMock.MockRule() : rule
  showRuleEdit.value = true
}

function onRuleDelete(rule: ProxyMock.MockRule) {
  if (curRule.value.name == null || curRule.value._id == null) return
  curRule.value = rule
  showRuleDelete.value = true
}

async function onRuleDeleteConfirm() {
  try {
    await ProxyMock.deleteMockRule(curRule.value._id)
    curRule.value = new ProxyMock.MockRule()
    content.value = null
    showRuleDelete.value = false
  } catch (err) {
    showNotify({ message: '删除失败', type: 'warning', duration: 1000 })
  }
}

function onMockSwitchChanged(rule: ProxyMock.MockRule) {
  curRule.value = rule
  onSave(true)
}

async function onSave(onlySnap: boolean = false) {
  if (curRule.value == null || curRule.value.name == null) return

  try {
    curRule.value.jsonRequests = map2json(curRule.value.requests)
    curRule.value._id = await ProxyMock.saveMockRule(curRule.value, onlySnap)
    await fetchMockRuleDetail()
    showNotify({ message: '规则更新成功', type: 'success', duration: 500 })
  } catch (err) {
    showNotify({ message: '规则更新失败', type: 'danger', duration: 1200 })
  }
  if (onlySnap) showRuleEdit.value = false
}

function onRecordSelected(record: ProxyMock.ProxyRequestRecord) {
  content.value = JSON.stringify(record, null, '\t')
}

function onRecordDelete(key: string) {
  showRecordDelete.value = true
  curRecordKey.value = key
}

function onRecordDeleteConfirm() {
  curRule.value.requests.delete(curRecordKey.value)
  content.value = null
  showRecordDelete.value = false
}
</script>

<style scoped>
.mgr-content {
  width: 80vw;
  min-width: 375px;
  height: 100vh;
  overflow: hidden;
  /* background: var(--van-gray-1); */
}

.search-result {
  min-width: 200px;
  height: 50vh;
  overflow-y: scroll;
}

.rule-snap-item {
  width: 100%;
}

.record-snap {
  border-radius: 4px;
  border: 2px #ddd dashed;
  font-size: 0.7rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 220px;
  display: block;
  direction: rtl;
  margin-bottom: 5px;
}
</style>
