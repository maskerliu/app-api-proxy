<template>
  <van-row class="full-row">
    <van-row
      class="bg-border"
      style="width: calc(100% - 10px); max-height: 57px; background-color: white"
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
        <van-cell-group inset>
          <van-field
            :label="`【${curRule?.name == null ? '规则名' : curRule?.name}】`"
            clickable
            label-width="15rem"
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
        </van-cell-group>
      </van-col>
      <van-col span="2" offset="2">
        <van-button
          plain
          type="primary"
          size="small"
          :loading="isSaving"
          @click="onSave(false)"
          >保存</van-button
        >
      </van-col>
    </van-row>

    <van-row style="width: 100%; height: calc(100% - 68px); display: flex">
      <van-col class="bg-border" style="width: 320px">
        <van-list v-if="curRule != null && curRule.requests != null">
          <van-cell
            v-for="record in [...curRule.requests.values()]"
            :key="record.url"
            clickable
            is-link
            :title="record.url"
            :title-style="{
              fontSize: '0.7rem',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
              width: '270px',
              display: 'block',
            }"
            @click="curRecord = record"
          >
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
        <json-editor-vue
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

<script lang="ts" src="./MockRuleMgr.vue.ts"></script>

<style>
.search-result {
  width: 280px;
  height: 500px;
  background: white;
}

.rule-snap-item {
  width: 100%;
}

.json-editor {
  width: calc(100% - 10px);
  height: calc(100% - 10px);
  padding: 5px;
}

.jsoneditor {
  border: 0;
}
</style>
