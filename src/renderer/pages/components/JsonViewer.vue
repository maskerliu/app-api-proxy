<template>
  <div :class="['json-view-container', theme]" v-if="visible">
    <div
      :class="['json-view', length ? 'closeable' : '']"
      :style="{ fontSize: fontSize + 'px', lineHeight: lineHeight + 'px' }"
    >
      <!--icon-style-square-->
      <span @click="toggleClose" class="angle" v-if="length">
        <svg
          v-if="innerclosed"
          :fill="iconColors[0]"
          width="1em"
          height="1em"
          viewBox="0 0 1792 1792"
          style="
            vertical-align: middle;
            color: rgb(42, 161, 152);
            height: 1em;
            width: 1em;
          "
        >
          <path
            d="M1344 800v64q0 14-9 23t-23 9h-352v352q0 14-9 23t-23 9h-64q-14 0-23-9t-9-23v-352h-352q-14 0-23-9t-9-23v-64q0-14 9-23t23-9h352v-352q0-14 9-23t23-9h64q14 0 23 9t9 23v352h352q14 0 23 9t9 23zm128 448v-832q0-66-47-113t-113-47h-832q-66 0-113 47t-47 113v832q0 66 47 113t113 47h832q66 0 113-47t47-113zm128-832v832q0 119-84.5 203.5t-203.5 84.5h-832q-119 0-203.5-84.5t-84.5-203.5v-832q0-119 84.5-203.5t203.5-84.5h832q119 0 203.5 84.5t84.5 203.5z"
          ></path>
        </svg>
        <svg
          v-if="!innerclosed"
          :fill="iconColors[1]"
          width="1em"
          height="1em"
          viewBox="0 0 1792 1792"
          style="
            vertical-align: middle;
            color: rgb(88, 110, 117);
            height: 1em;
            width: 1em;
          "
        >
          <path
            d="M1344 800v64q0 14-9 23t-23 9h-832q-14 0-23-9t-9-23v-64q0-14 9-23t23-9h832q14 0 23 9t9 23zm128 448v-832q0-66-47-113t-113-47h-832q-66 0-113 47t-47 113v832q0 66 47 113t113 47h832q66 0 113-47t47-113zm128-832v832q0 119-84.5 203.5t-203.5 84.5h-832q-119 0-203.5-84.5t-84.5-203.5v-832q0-119 84.5-203.5t203.5-84.5h832q119 0 203.5 84.5t84.5 203.5z"
          ></path>
        </svg>
      </span>
      <div class="content-wrap">
        <p
          :class="['first-line', length > 0 ? 'pointer' : '']"
          @click="toggleClose"
        >
          <span v-if="jsonKey" class="json-key">"{{ jsonKey }}": </span>
          <span v-if="length"
            >{{ prefix }}{{ innerclosed ? "..." + subfix : "" }}
            <span class="json-note">{{
              innerclosed ? length + " items" : ""
            }}</span>
          </span>
          <span v-if="!length">{{
            `${isArray ? "[]" : "{}"}${isLast ? "" : ","}`
          }}</span>
        </p>
        <div v-if="!innerclosed && length" class="json-body">
          <template v-for="(item, index) in items">
            <json-viewer
              v-if="item.isJSON"
              :closed="isClose(templateDeep + 1)"
              :key="index"
              :data="item.value"
              :jsonKey="item.key"
              :currentDeep="templateDeep + 1"
              :deep="deep"
              :theme="theme"
              :fontSize="fontSize"
              :lineHeight="lineHeight"
              :iconColor="iconColors"
              :isLast="index === items.length - 1"
              :hasSiblings="item.hasSiblings"
            />
            <p class="json-item" v-else :key="index + ''">
              <span class="json-key">
                {{ isArray ? "" : '"' + item.key + '":' }}
              </span>
              <span :class="['json-value', getDataType(item.value)]">
                {{
                  (getDataType(item.value) === "string" ? '"' : "") +
                  item.value +
                  (getDataType(item.value) === "string" ? '"' : "") +
                  (index === items.length - 1 ? "" : ",")
                }}
              </span>
            </p>
          </template>
          <span v-if="!innerclosed" class="base-line"></span>
        </div>
        <p v-if="!innerclosed" class="last-line">
          <span>{{ subfix }}</span>
        </p>
      </div>
    </div>
  </div>
</template>
<script lang="ts">
import { defineComponent } from "vue";

const JsonViewer = defineComponent({
  props: {
    fontSize: { type: Number, require: false, default: 12 },
    lineHeight: { type: Number, require: false, default: 24 },
    deep: { type: Number, require: false, default: 3 },
    currentDeep: { type: Number, require: false, default: 1 },
    theme: { type: String, require: false, default: "" },
    hasSiblings: { type: Boolean, requir: false, defalut: true },
    data: { type: Object, require: true, default: {} },
    jsonKey: { type: String, require: false, default: "" },
    closed: { type: Boolean, required: false, default: false },
    isLast: { type: Boolean, required: false, default: true },
  },
  computed: {
    isArray(): boolean {
      return this.getDataType(this.data) === "array";
    },
    length(): number {
      if (this.data == null) {
        return 0;
      } else {
        return this.isArray ? this.data.length : Object.keys(this.data).length;
      }
    },
    subfix(): string {
      const data = this.data;
      if (this.isEmptyArrayOrObject(data)) {
        return "";
      } else {
        return (this.isArray ? "]" : "}") + (this.isLast ? "" : ",");
      }
    },
    prefix(): string {
      return this.isArray ? "[" : "{";
    },
    items() {
      const json = this.data;
      if (this.isArray) {
        return json.map((item) => {
          const isJSON = this.isObjectOrArray(item);
          return { value: item, isJSON, key: "" };
        });
      }

      return Object.keys(json).map((key) => {
        const item = json[key];
        const isJSON = this.isObjectOrArray(item);
        return { value: item, isJSON, key };
      });
    },
    iconColors() {
      return ["#747983", "#747983"];
    },
  },
  data() {
    return {
      innerclosed: true as boolean,
      templateDeep: 1 as number,
      visible: false as boolean,
    };
  },
  mounted() {
    this.innerclosed = this.closed;
    this.templateDeep = this.currentDeep;
    setTimeout(() => {
      this.visible = true;
    }, 0);
  },
  methods: {
    getDataType(data: any) {
      return Object.prototype.toString.call(data).slice(8, -1).toLowerCase();
    },

    isObjectOrArray(source: any) {
      return ["array", "object"].includes(this.getDataType(source));
    },

    toggleClose() {
      if (this.length === 0) {
        return;
      }
      if (this.innerclosed) {
        this.innerclosed = false;
      } else {
        this.innerclosed = true;
      }
    },
    isClose(curDeep: number) {
      return curDeep > this.deep;
    },

    isEmptyArrayOrObject(data: any) {
      // 空数组或者空对象
      return [{}, []]
        .map((item) => JSON.stringify(item))
        .includes(JSON.stringify(data));
    },
  },
  watch: {
    closed() {
      this.innerclosed = this.closed;
    },
  },
});

export default JsonViewer;
</script>

<style scoped>
.json-view-container {
  background-color: #fff;
}
.json-view-container .json-view {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  white-space: nowrap;
  padding-left: 2rem;
  box-sizing: border-box;
  font-family: Consolas !important;
  cursor: default;
}
.json-view-container .json-view .json-note {
  color: #909399;
  font-size: 12px;
  font-style: italic;
}
.json-view-container .json-view .json-key {
  color: #8c6325;
}
.json-view-container .json-view .json-value {
  word-break: break-all;
  display: inline-block;
  /*max-width: 40vw;*/
  white-space: normal;
  color: #57b73b;
}
.json-view-container .json-view .json-value.number {
  color: #2d8cf0;
}
.json-view-container .json-view .json-value.string {
  color: #57b73b;
}
.json-view-container .json-view .json-value.boolean {
  color: #eb3324;
}
.json-view-container .json-view .json-value.null {
  color: #eb3324;
}
.json-view-container .json-view .json-item {
  margin: 0;
  padding-left: 2rem;
  display: flex;
}
.json-view-container .json-view .first-line {
  padding: 0;
  margin: 0;
}
.json-view-container .json-view .first-line.pointer {
  cursor: pointer !important;
}
.json-view-container .json-view .json-body {
  position: relative;
  padding: 0;
  margin: 0;
}
.json-view-container .json-view .json-body .base-line {
  position: absolute;
  height: 100%;
  border-left: 1px dashed #bbb;
  top: 0;
  left: 2px;
}
.json-view-container .json-view .last-line {
  padding: 0;
  margin: 0;
}
.json-view-container .json-view .angle {
  position: absolute;
  display: block;
  cursor: pointer;
  float: left;
  width: 20px;
  text-align: center;
  /*left: ~"calc(2rem - 18px)";*/
  left: 12px;
}

.json-view-container.one-dark {
  background-color: #292c33;
}
.json-view-container.one-dark .json-view {
  font-family: Menlo, Consolas, "Courier New", Courier, FreeMono, monospace !important;
}
.json-view-container.one-dark .json-view .json-note {
  color: #909399;
  font-size: 12px;
  font-style: italic;
}
.json-view-container.one-dark .json-view .json-key {
  color: #d27277;
}
.json-view-container.one-dark .json-view .json-value {
  color: #c6937c;
}
.json-view-container.one-dark .json-view .json-value.number {
  color: #bacdab;
}
.json-view-container.one-dark .json-view .json-value.string {
  color: #c6937c;
}
.json-view-container.one-dark .json-view .json-value.boolean {
  color: #659bd1;
}
.json-view-container.one-dark .json-view .json-value.null {
  color: #659bd1;
}
.json-view-container.one-dark .json-view .first-line {
  color: #acb2be;
}
.json-view-container.one-dark .json-view .json-body .base-line {
  border-left: 1px solid #3c4047;
}
.json-view-container.one-dark .json-view .last-line {
  color: #acb2be;
}
.json-view-container.one-dark .json-view .json-item {
  color: #acb2be;
}
</style>
