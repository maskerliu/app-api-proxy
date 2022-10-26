<template>
  <van-row class="full-row">
    <van-row
      class="bg-border"
      style="
        width: calc(100% - 10px);
        max-height: 57px;
        background-color: white;
      "
      gutter="20"
      justify="space-between"
      align="center"
    >
      <van-col style="margin-left: 5px; background: white; width: 320px">
        <van-popover
          :show="showSearchResult"
          placement="right-start"
          trigger="manual"
          :overlay="true"
          :close-on-click-overlay="true"
          @click-overlay="onRuleSelect(null)"
        >
          <van-list class="search-result">
            <van-cell
              class="rule-snap-item"
              is-link
              v-for="(rule, idx) in rules"
              :key="idx"
              :title="rule.name"
              :label="rule.desc"
              @click="onRuleSelect(rule)"
            >
              <template #value>
                <div style="margin-top: 0">
                  <van-icon
                    class="iconfont icon-edit"
                    size="16"
                    style="color: #3498db; padding: 5px"
                    @click="onRuleEdit(rule)"
                  />
                  <van-icon
                    class="iconfont icon-delete"
                    size="16"
                    style="color: red; padding: 5px"
                    @click="onRuleDelete(rule)"
                  />
                  <van-icon
                    class="iconfont icon-upload"
                    size="16"
                    style="color: red; padding: 5px"
                    @click="onRuleUpload(rule)"
                  />
                </div>
              </template>
            </van-cell>
          </van-list>
          <template #reference>
            <van-search
              :clearable="false"
              show-action
              v-model="keyword"
              placeholder="请输入搜索关键词"
              @focus="fetchPagedMockRules"
              style="width: 250px"
            >
              <template #action>
                <van-icon
                  plain
                  type="primary"
                  name="plus"
                  size="mini"
                  @click="onRuleEdit(null)"
                />
              </template>
            </van-search>
          </template>
        </van-popover>
      </van-col>
      <van-col span="12">
        <van-field
          :label="`【${curRule?.name == null ? '规则名' : curRule?.name}】`"
          clickable
          label-width="10rem"
          right-icon="cross"
          @click-right-icon="onRuleSelect(null)"
        >
          <template #input>
            <div style="margin-top: 0">
              <van-icon
                class="iconfont icon-edit"
                size="18"
                style="color: #3498db"
                @click="onRuleEdit(curRule)"
              />
              <van-icon
                class="iconfont icon-delete"
                size="18"
                style="color: red; margin-left: 8px"
                @click="onRuleDelete(curRule)"
              />
              <van-icon
                class="iconfont icon-upload"
                size="18"
                style="color: red; margin-left: 8px"
                @click="onRuleUpload(curRule)"
              />
              <van-switch
                size="18"
                v-model="curRule.isMock"
                style="color: red; margin-left: 15px"
                @change="onMockSwitchChanged(curRule)"
              />
            </div>
          </template>
        </van-field>
      </van-col>
      <van-col span="2" offset="2">
        <van-button
          plain
          type="primary"
          size="mini"
          :loading="isSaving"
          @click="onSave(false)"
          >保存</van-button
        >
      </van-col>
    </van-row>

    <van-row style="width: 100%; height: calc(100% - 68px); display: flex">
      <van-col class="bg-border" style="width: 300px">
        <van-list v-if="curRule != null && curRule.requests != null">
          <van-cell
            v-for="record in [...curRule.requests.values()]"
            :key="record.url"
            @click="curRecord = record"
            clickable
            is-link
          >
            <template #title>
              <div class="record-snap">{{ record.url }}</div>
            </template>
            <template #label>
              <van-tag :type="record.statusCode == 200 ? 'success' : 'danger'">
                [http]{{ record.statusCode }}
              </van-tag>
              <van-tag
                style="margin-left: 5px"
                :type="record.responseData?.code == 8000 ? 'success' : 'danger'"
              >
                [biz]{{ record.responseData?.code }}
              </van-tag>
            </template>
            <template #right-icon>
              <van-button
                plain
                type="danger"
                size="small"
                icon="delete-o"
                @click="onRecordDelete(record.url)"
              />
            </template>
          </van-cell>
        </van-list>
      </van-col>
      <van-col style="padding-top: 50px">
        <van-button
          type="primary"
          size="mini"
          icon="exchange"
          @click="addRule"
        ></van-button>
      </van-col>
      <van-col class="bg-border" style="flex: 1">
        <vue-json-editor
          class="json-editor"
          v-model="curRecord"
          :options="jeOption"
        />
      </van-col>
    </van-row>

    <van-dialog
      title="警告"
      :show="showRuleDelete"
      show-cancel-button
      @cancel="showRuleDelete = false"
      @confirm="onRuleDeleteConfirm"
      :message="`确定要删除规则[ ${curRule != null ? curRule.name : ''}]吗?`"
    />

    <van-dialog
      title="规则详情"
      :show="showRuleEdit"
      show-cancel-button
      @cancel="showRuleEdit = false"
      @confirm="onSave(true)"
    >
      <van-form ref="form" labvan-width="90px" v-if="curRule != null">
        <van-field
          label="规则组名"
          v-model="curRule.name"
          placeholder="规则组名"
        />
        <van-field
          rows="4"
          type="textarea"
          v-model="curRule.desc"
          placeholder="规则组描述"
        />
      </van-form>
    </van-dialog>

    <van-dialog
      title="警告"
      message="确认要删除这条请求数据？"
      :show="showRecordDelete"
      show-cancel-button
      @cancel="showRecordDelete = false"
      @confirm="onRecordDeleteConfirm"
    />
  </van-row>
</template>

<script lang="ts">
import { mapState } from "pinia";
import { Notify } from "vant";
import { defineComponent, PropType, ref } from "vue";
import { MockRule, ProxyRequestRecord } from "../../../common/models";
import {
  deleteMockRule,
  getMockRuleDetail,
  saveMockRule,
  searchMockRules,
} from "../../../common/remoteApis";
import { json2map, map2json } from "../../common";
import { useProxyRecordStore } from "../../store/ProxyRecords";
import VueJsonEditor from "../components/VueJsonEditor.vue";

const MockRuleMgr = defineComponent({
  components: {
    VueJsonEditor,
  },
  props: {
    isMock: { type: Boolean, require: false, default: false },
    record: {
      type: Object as PropType<ProxyRequestRecord>,
      require: false,
      default: null,
    },
  },
  computed: {
    ...mapState(useProxyRecordStore, ["records", "curRecordId"]),
  },
  data() {
    return {
      jeOption: {
        mode: "tree",
        search: false,
        navigationBar: true,
        statusBar: false,
        mainMenuBar: false,
      },
      keyword: null as string,
      showSearchResult: ref(false),
      rules: [] as Array<MockRule>,
      curRule: new MockRule(),
      curRuleMock: false,
      curRecord: ref() as ProxyRequestRecord,
      curRecordKey: null as string,
      showRuleEdit: false,
      showRuleDelete: false,
      showRecordEdit: false,
      showRecordDelete: false,
      isSaving: false,
    };
  },
  mounted() {
    this.curRecord = this.record;
    // if (this.curRecordId != null) {
    //   this.curRecord = this.records.get(this.curRecordId)
    //   this.fetchMockRuleDetail()
    // }
  },
  methods: {
    async fetchPagedMockRules() {
      try {
        this.rules = await searchMockRules(this.keyword);
        this.showSearchResult = this.rules != null && this.rules.length > 0;
      } catch (err) {
        Notify({ message: "未找到匹配的规则", type: "danger" });
      }
    },
    addRule() {
      if (this.curRecord == null) return;
      if (this.curRule == null) this.curRule = new MockRule();
      if (this.curRule.requests == null) this.curRule.requests = new Map();
      this.curRule.requests.set(this.curRecord.url, this.curRecord);
    },
    onRuleSelect(rule: MockRule) {
      this.curRule = rule == null ? new MockRule() : rule;
      this.showSearchResult = false;
      this.fetchMockRuleDetail();
    },
    async fetchMockRuleDetail() {
      if (this.curRule.name == null && this.curRule._id == null) return;

      try {
        this.curRule = await getMockRuleDetail(this.curRule._id);
        this.curRule.requests = json2map(this.curRule.jsonRequests);
      } catch (err) {
        Notify({ message: "未找到对应规则", type: "warning", duration: 500 });
      }
    },
    onRuleEdit(rule?: MockRule) {
      this.showSearchResult = false;
      this.curRule = rule == null ? new MockRule() : rule;
      this.showRuleEdit = true;
    },
    onRuleDelete(rule: MockRule) {
      if (this.curRule.name == null || this.curRule._id == null) return;
      this.curRule = rule;
      this.showRuleDelete = true;
    },
    async onRuleDeleteConfirm() {
      try {
        await deleteMockRule(this.curRule._id);
        this.curRule = new MockRule();
        this.showRuleDelete = false;
      } catch (err) {
        Notify({ message: "删除失败", type: "warning", duration: 500 });
      }
    },
    onRuleUpload(rule: MockRule) {
      this.curRule = rule;
    },
    onMockSwitchChanged(rule: MockRule) {
      this.curRule = rule;
      this.onSave(true);
    },
    async onSave(isSnap: boolean) {
      if (this.curRule == null) return;

      if (this.curRule.name == null) {
        this.showRuleEdit = true;
        return;
      }

      try {
        this.curRule.jsonRequests = map2json(this.curRule.requests);
        await saveMockRule(this.curRule, isSnap);
        await this.fetchMockRuleDetail();
        Notify({ message: "规则更新成功", type: "success", duration: 500 });
      } catch (err) {
        Notify({ message: "规则更新失败", type: "danger", duration: 500 });
      }
      if (isSnap) this.showRuleEdit = false;
    },
    onRecordDelete(key: string) {
      this.showRecordDelete = true;
      this.curRecordKey = key;
    },
    onRecordDeleteCancel() {
      this.curRecord = null;
      this.curRecordKey = null;
      this.showRecordDelete = false;
    },
    onRecordDeleteConfirm() {
      this.curRule.requests.delete(this.curRecordKey);
      this.curRecord = null;
      this.showRecordDelete = false;
    },
  },
  watch: {
    record() {
      this.curRecord = this.record;
    },
    keyword() {
      this.fetchPagedMockRules();
      // throttle(this.fetchPagedMockRules, 500)
    },
  },
});

export default MockRuleMgr;
</script>

<style>
.search-result {
  width: 280px;
  height: 500px;
  background: white;
}

.rule-snap-item {
  width: 100%;
}

.record-snap {
  border: 1px #ddd dashed;
  font-size: 0.7rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 200px;
  display: block;
  direction: rtl;
  padding: 2px 6px;
}

.json-editor {
  width: calc(100% - 6px);
  height: calc(100% - 6px);
  padding: 3px;
}

.jsoneditor {
  border: 0;
}

.ace-jsoneditor {
  font-size: 0.8rem !important;
}
</style>
