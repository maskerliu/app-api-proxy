# AppApiProxy PRD v1.1 研发评审与任务拆分

> 评审对象：[PRD-v1.1-0-6周需求.md](./PRD-v1.1-0-6周需求.md)
> 评审基线：v1.0.4（当前仓库 main）
> 评审日期：2026-11-05
> 评审角色：研发（主进程 / 渲染层 / 测试）
> 文档用途：需求评审结论、技术决策、任务拆分、排期与风险登记

---

## 1. 评审结论

### 1.1 总体结论

**有条件通过。** 方向正确：R1（匹配）和 R2（结构化编辑）直接决定 Mock 的日常可用性，应作为 v1.1 的核心；R3（接入向导）解决激活；R4（导入导出）解决沉淀与分享。

但 PRD 目前存在 **6 个研发阻塞项**，不解决无法进入 W1：

| # | 阻塞项 | 影响 | 结论 |
|---|---|---|---|
| B1 | 记录 ID 方案与现有存储不变量冲突 | 需要重写 Repo/UI 的记录定位方式，且旧版本无法读取新 UUID 记录 | 先定 ADR 再动工 |
| B2 | 推送模型缺少 Mock 元数据 | 变体、模板 warning、未命中诊断无法在请求详情展示 | 扩展 `ProxyRequestRecord` |
| B3 | 二进制响应表示未定义 | `bodyType=binary` 无法发送、导出、导入 | 增加 `bodyEncoding` |
| B4 | 导入文件读取链路不存在 | `selectFile` 只允许图片且只返回路径，渲染层无法读文件 | 改为 HTML file input + multipart |
| B5 | 并发保存语义自相矛盾 | “409 重试”会静默覆盖，与“前端提示刷新”冲突 | 增加 `expectedUpdatedAt` |
| B6 | UID 不匹配诊断在现有推送模型下不可达 | AC-R3-04 无法验收 | 服务端环形缓冲 + 轮询 |

### 1.2 范围与优先级结论

| 需求 | 研发优先级 | 对北极星指标的作用 | 建议 |
|---|---|---|---|
| R1 匹配引擎 v2 | P0 | 直接提升命中率 | 必须做，且最先做 |
| R2 结构化响应编辑器 | P0 | 直接提升规则创建/维护效率 | 必须做 |
| R3 接入向导与诊断 | P1 | 提升新用户激活 | 保留向导主链路；诊断中心可降级 |
| R4 规则导入/导出 | P1 | 提升留存/团队流转 | 时间不足时优先砍 HAR 导入 |

**如果 6 周不可延期，建议按以下顺序砍范围：**

1. 先砍 R4 的 HAR 导入，只保留规则包导出/导入；
2. 再砍 R3 的“诊断中心”独立页面，只保留 `health` + 上游 `diagnose` + 请求详情内的诊断入口；
3. 最后砍 R3 的“从最近请求创建首个 Mock”，只保留示例场景。

### 1.3 排期结论

PRD 第 10 节假设“1 名 Electron/前端 + 1 名 Node/后端 + PM/QA 兼职”。按本拆分估算：

| 工作流 | 人日 |
|---|---|
| R1 匹配引擎 | 15.5 |
| R2 结构化编辑器 | 11.5 |
| R3 接入向导与诊断 | 11.0 |
| R4 导入/导出 | 8.0 |
| 基础设施（测试、类型、i18n） | 3.0 |
| 回归、文档、发布 | 6.0 |
| **合计** | **55.0** |

- 4 周? 不行。**6 周 × 2 人 = 60 人日**，名义上刚好，但没有缓冲，且 R2/R3/R4 存在共享模型依赖，不能完全并行。
- **建议官方排期 8 周（2 名研发 + 0.5 QA）**；6 周作为压缩方案，需先确认 1.2 的砍范围。
- **单人开发建议 11–13 周**，PRD 中“8–10 周”偏乐观。

### 1.4 评审维度结论

| 维度 | 结论 |
|---|---|
| 需求完整性 | 主流程完整；二进制、并发、UID 诊断、跨规则 ID 冲突有缺口 |
| 技术可行性 | 高；无必须引入的新运行时依赖 |
| 数据迁移 | 方案可行，但“旧版本可继续读取”只对迁移记录成立，对新 UUID 记录不成立 |
| 性能 | 1,000 条 p95 ≤ 5ms 可达成；5,000 条需索引/预热 |
| 安全 | 模板白名单方向正确；ReDoS、导出脱敏范围、诊断 SSRF 需补充约束 |
| 可测试性 | 当前 `yarn test` 指向不存在的 `.build-scripts/test.ts`，测试基建必须先补 |
| 可发布性 | W6 同时做 R4 + 回归 + 发布，风险过高 |

---

## 2. 现状核对（代码基线）

以下结论来自当前代码，不是 PRD 描述。

| 能力 | 现状 | 代码位置 |
|---|---|---|
| Mock 命中 | `ruleId + 完整 url` 直接查单文档；无 Method/Host/Query 语义 | `src/main/service/mock.service.ts:23`、`src/main/repository/mock.repo.ts:184` |
| 记录 ID | `rec_sha1(ruleId + url)`，URL 变则文档 ID 变 | `src/main/repository/mock.repo.ts:242` |
| 记录保存 | `recordKey` 是旧 URL；改 URL 时先写新文档再删旧文档 | `src/main/repository/mock.repo.ts:192` |
| 记录删除 | 用 `ruleId + recordKey` 反算 ID | `src/main/repository/mock.repo.ts:234` |
| Mock 响应 | 直接返回 `record.responseData` 对象，状态码非法回退 200 | `src/main/service/mock.service.ts:36` |
| 延迟 | 设备级 delay 通过 `setTimeout` 应用 | `src/main/service/proxy.service.ts:147` |
| 请求记录推送 | `REQUEST_START` 带 method/headers；`REQUEST_END` **不带 method** | `src/main/service/proxy.service.ts:123`、`:185`、`:279` |
| 渲染层合并 | `REQUEST_END` 只合并 isMock/status/headers/responseData/time；method 沿用 START | `src/renderer/store/ProxyRecords.ts:79` |
| 规则管理 UI | 记录列表以 `record.url` 为 key；编辑器是整段 JSON | `src/renderer/pages/proxy/MockRuleMgr.vue:229`、`:348` |
| 请求详情 | 已有 headers/query/body/response 展示，无 Mock 匹配区块 | `src/renderer/pages/proxy/ProxyRequestDetail.vue` |
| 启用状态 | `Map<viewerUid, ruleId>`，仅在内存；断开即清 | `src/main/service/mock.service.ts:17` |
| 路由挂载 | `/_proxy` 通过 `app.use` 挂载，router 内 `req.url` 已剥离前缀 | `src/main/MainServer.ts`、`src/main/router/proxy.router.ts:15` |
| 文件导出 | `saveFile(title, fileName, data)` 已可用 | `src/main/IPCServices.ts:83` |
| 文件选择 | `selectFile` 只过滤图片，且只返回路径 | `src/main/IPCServices.ts:50` |
| 测试 | `yarn test` 指向不存在的 `.build-scripts/test.ts` | `package.json:14` |
| Web 构建 | 存在 `build:web` 与 `src/renderer` 入口，`window.isWeb` 已用于差异 | `package.json:18`、`src/renderer/App.vue:70` |
| i18n | 已有 vue-i18n，`en.ts`/`zh-CN.ts` 各约 95 行 | `src/lang/` |

---

## 3. 需求逐条评审

### 3.1 R1 匹配引擎 v2

#### 3.1.1 结论

**通过，需先解决 B1。** 匹配维度设计合理，算法复杂度可控，关键是保持“纯函数 + 缓存”结构，不要让匹配逻辑继续长在 `MockService` 里。

#### 3.1.2 研发关注点

| 关注点 | 评审意见 | 处理建议 |
|---|---|---|
| 请求归一化 | 当前 `mock()` 只拿到 `req.url`，没有 method/host/query 结构 | 新增 `NormalizedRequest`，由 `ProxyService` 构造一次，所有记录复用 |
| Path 基准 | `/_proxy` 挂载后 `req.url` 已剥离前缀；PRD 的“`/_proxy` 之后的 pathname”正确 | 用 `new URL(req.url, 'http://x')` 解析；不要用 `req.originalUrl` |
| Query 解析 | Express 的 `req.query` 可能受 query parser 影响；多值/嵌套不可控 | 统一用 `URLSearchParams` 解析 `req.url`，保留多值数组 |
| Host 来源 | `x-mock-host` 可能带协议、端口甚至 base path；`dataServer` 覆盖时实际上游 host 会变 | 明确：匹配始终以 `x-mock-host` 的 `host` 为准，与 `dataServer` 无关；PRD 需补一句 |
| 历史记录 Method | `REQUEST_END` 不带 method；若记录只从 END 保存，迁移后只能是 `ANY` | 保存记录时把 method 写入文档；迁移时优先 `record.method` |
| 历史记录 Host | PRD 定为任意；这会保留旧行为，但多环境同名接口仍无法区分 | 接受；新记录默认从 `x-mock-host` 预填 |
| 历史记录 Query | 旧记录 key 是完整 URL；迁移后同 Path 多记录靠 query 条件区分 | 正确；`conditions` 从 URL 参数生成，`allowExtra=false` |
| 优先级 | 数值 + 上移/下移的 UI 语义容易歧义 | 上移/下移直接改数值（步长 10），列表按 priority desc / createdAt asc |
| 正则 | Node 无法给单次 regex 设超时 | 长度 ≤ 200 + 拒绝嵌套量词 + 只对 path 执行；残余 ReDoS 风险写入风险登记 |
| 缓存上限 | 5,000 条上限合理；1,000 条 p95 ≤ 5ms 用朴素循环即可 | 不要过早做 trie；先做 method/path 快表 + 线性回退，基准测试后再优化 |
| 缓存预热 | 启用场景后第一次请求才加载 5,000 条会超时 | 启用/保存/导入后异步预热，并记录 `cacheReady` |
| 未命中诊断 | 每次 miss 都计算最接近记录，5,000 条时成本可接受（仅 miss） | 但“高相似度才展示”缺少阈值定义；建议：同首段或同前缀，且失败维度 ≤ 2 |
| 诊断展示通道 | `getMockMiss` 可选接口会多一次往返 | 建议删除该接口，把 `mock` 元数据随 `REQUEST_END` 一起推送 |
| 启用状态 | 全局 meta 的 `lastActiveRuleId` 在多窗口下会互相覆盖 | 需产品确认：全局恢复 vs 每窗口独立；见 6.1 |
| 全局开关 | 现有开关在规则管理里，主界面无入口 | 主界面顶部加状态条；调用现有 `saveMockRule` 即可，无需新接口 |

#### 3.1.3 数据迁移评审

| 项 | 评审意见 |
|---|---|
| 备份 | `PouchDB.replicate` 到 `Mock.Rules.v2.bak` 可行；但大库会占双倍磁盘、启动变慢。建议备份一次并写 meta 标记，失败不阻塞启动 |
| 版本号 | 当前 `SCHEMA_VERSION=2`；v3 迁移必须是独立函数，不能复用 `migrateLegacy`（它跳过 `type=record/rule`） |
| 幂等 | 以 meta `version>=3` 为准；逐条迁移时用 `bulkDocs` 冲突忽略 |
| 计数校验 | 迁移前后按 `type` 计数；不一致只记录日志，不阻塞启动（与现有策略一致） |
| 无法解析的 URL | PRD 说“跳过并标记 `matchInvalid`”；建议保留文档、设置 `match.enabled=false`，避免数据丢失 |
| 回滚 | “旧版本可继续读取”只对**迁移记录**成立；新 UUID 记录旧版本按 `sha1(ruleId+url)` 找不到。PRD 需修正措辞 |
| 迁移耗时 | 5,000 条记录逐批 200 条可接受；建议迁移放在 `MockRepo.init()`，并在 UI 启动后提示进度 |

#### 3.1.4 R1 验收标准评审

| AC | 可测性 | 备注 |
|---|---|---|
| AC-R1-01 | 可测 | 单测 + 集成 |
| AC-R1-02 | 可测 | 需先解决记录 ID/存储模型 |
| AC-R1-03 | 可测 | 需明确 Host 取 `x-mock-host` |
| AC-R1-04 | 可测 | glob 语义按 PRD |
| AC-R1-05 | 可测 | — |
| AC-R1-06 | 可测 | 需定义“相似”阈值 |
| AC-R1-07 | 可测 | 多窗口语义待确认 |
| AC-R1-08 | 可测 | 需压测脚本；注意排除首次加载 |
| AC-R1-09 | 可测 | 旧记录 Query 顺序变为不敏感，属于行为变化，需发布说明 |

---

### 3.2 R2 结构化响应编辑器

#### 3.2.1 结论

**通过，需补 3 个契约（B2/B3/B5）。** 编辑器是本期 UI 工作量最大的部分，建议先拆组件再实现，避免继续在 `MockRuleMgr.vue` 上堆逻辑。

#### 3.2.2 研发关注点

| 关注点 | 评审意见 | 处理建议 |
|---|---|---|
| 响应模型 | `headers: Record<string, string>` 无法表达 `set-cookie` 多值 | 改为 `Record<string, string \| string[]>`；发送端逐条 `setHeader` |
| 二进制 | `body: string` + `bodyType='binary'` 语义不明 | 增加 `bodyEncoding: 'utf8' \| 'base64'`；发送时 `Buffer.from(body, 'base64')` |
| Body 上限 | PRD 只限制模板输出 1MB，没限制编辑/存储 | 建议响应体上限 2MB（编辑 + 存储），超出只读展示 |
| 变体语义 | 变体是完整响应还是覆盖字段？PRD 字段是全量的 | 明确：变体 = 完整 `MockResponseDef`；新增变体默认复制基础响应 |
| 有效响应 | `activeVariantId` 指向不存在时回退基础响应 | 正确；同时清空无效 ID 并 warning |
| 模板转义 | 直接文本替换会让 `{{request.query.id}}` 插入 JSON 时破坏引号 | 明确“原样替换”；渲染后若 `bodyType=json` 且非法，返回 warning（不阻断） |
| 模板上下文 | `request.body.data.id` 需要解析请求体 | 只对 JSON 且 ≤ 256KB 的 body 解析；解析失败返回空并 warning |
| `seq` | PRD 说“按记录维护、内存”；多设备/多窗口会共享计数 | 可接受；文档写明重启归零、非持久化 |
| `now(format)` | 需要实现格式化子集 | 支持 `YYYY/MM/DD/HH/mm/ss/SSS`，不引入 dayjs |
| 预览 | 必须走服务端，避免前后端渲染差异 | 正确；预览不落库 |
| 并发保存 | PRD 的“409 重试 + 前端提示”矛盾 | 用 `expectedUpdatedAt` 做乐观锁；冲突返回 9409 + 当前记录，前端提示刷新/覆盖 |
| 原始 JSON | 高级逃生口 | 保留；保存前用共享校验器 normalize，未知字段丢弃 |
| 未保存保护 | 切换记录/关闭弹层需要确认 | `onBeforeRouteLeave` 不适用弹层；用组件内 `beforeClose` + `beforeunload` |
| Ace | 现有 `VueAceEditor` 已支持搜索/折叠/懒加载 | 复用；大 body 注意首次渲染耗时 |

#### 3.2.3 R2 验收标准评审

| AC | 可测性 | 备注 |
|---|---|---|
| AC-R2-01/02 | 可测 | 需先完成存储模型 |
| AC-R2-03 | 可测 | 连续两次请求，时间戳/uuid 不同 |
| AC-R2-04 | 可测 | 注意 URL 编码 |
| AC-R2-05 | 可测 | 未知变量→空串 + warning |
| AC-R2-06 | 可测 | 非法 JSON 只警告 |
| AC-R2-07 | 可测 | 2s 延迟测试较慢，可用单测验证“有效延迟选择” |
| AC-R2-08 | 可测 | 需定义“切换记录”的交互边界 |
| AC-R2-09/10 | 可测 | 共享校验器单测 |

---

### 3.3 R3 接入向导与诊断

#### 3.3.1 结论

**有条件通过。** 向导主链路可行，但“UID 不匹配”和“诊断报告”依赖服务端新增采集能力（B6），不是纯前端工作。

#### 3.3.2 研发关注点

| 关注点 | 评审意见 | 处理建议 |
|---|---|---|
| 首次启动 | `App.vue` 当前固定 `router.replace('/proxy')` | 读取 `onboarded` 后决定去 `/onboarding` 还是 `/proxy` |
| `onboarded` 持久化 | `saveServerConfig` 按字段白名单写入，未知字段会丢 | 在 `LocalServerConfig`、`CommonService` 构造/保存中显式加入 |
| 服务检查 | 端口状态已有 `portValid`；二维码已有 `registerUrl` | 直接复用；防火墙规则已在 `MainApp.addFirewallRule` 自动添加，向导展示状态即可 |
| 代码片段 | 6 种客户端模板 | 做成纯函数 `buildSnippet(client, config)`，单测覆盖；HTTPS 必须带证书提示 |
| 步骤 3 监听 | 可用 SockJS 推送或轮询 `getAllPushClients` | 建议轮询 `health`（2s），避免新增推送消息类型 |
| UID 不匹配 | 未知 UID 请求不会推给任何 viewer，现有模型下不可见 | `ProxyService` 记录 `unknownUidRequests` 环形缓冲；`health` 返回最近 20 条（UID 脱敏）；向导轮询展示 |
| 步骤 4 示例场景 | 创建规则 + 记录 + 启用 | 复用 `saveMockRule`/`saveMockRecord`；确保 record 结构是新 schema |
| `health` | 服务状态、版本、端口、客户端数、最近错误 | `process.uptime()`、`getAllPushClients()`、错误环形缓冲 |
| `diagnose` | DNS/TCP/TLS/HTTP，5s 超时，不跟随重定向 | 用 `node:dns`/`node:net`/`node:tls`/`node:http(s)`；每步独立超时；只允许 http/https |
| SSRF | 本机用户输入目标，风险低 | 仍建议拒绝 `file:`、`ftp:`，不发送任何 Authorization/Cookie |
| 诊断报告 | 含“当前选中请求摘要” | 该状态在渲染层；报告由渲染层拼装 Markdown，服务端只提供 health/errors |
| Web 模式 | `window.isWeb` 已有 | 隐藏端口/协议修改、二维码 IP；保留代码/诊断 |
| i18n | 新增文案较多 | 所有新页面必须同时补 `en.ts` / `zh-CN.ts` |

#### 3.3.3 R3 验收标准评审

| AC | 可测性 | 备注 |
|---|---|---|
| AC-R3-01 | 可测 | 需清理本地配置模拟新装 |
| AC-R3-02 | 可测 | 片段字符串断言 |
| AC-R3-03 | 可测 | 2s 内显示，依赖轮询间隔 |
| AC-R3-04 | **当前不可测** | 必须先实现 unknown UID 环形缓冲 |
| AC-R3-05 | 可测 | 示例场景 |
| AC-R3-06 | 可测 | 占用端口 |
| AC-R3-07 | 可测 | DNS 失败目标 |
| AC-R3-08 | 可测 | 脱敏断言 |
| AC-R3-09/10 | 可测 | 配置/Web 差异 |

---

### 3.4 R4 规则导入/导出

#### 3.4.1 结论

**通过，但导入链路需要重做文件读取方案（B4）。**

#### 3.4.2 研发关注点

| 关注点 | 评审意见 | 处理建议 |
|---|---|---|
| 导出保存 | 桌面端 `saveFile` 可用；Web 端用 Blob | 抽 `saveTextFile(fileName, text)` 兼容两端 |
| 文件选择 | `selectFile` 只允许图片，且渲染层不能读路径 | **不要改 IPC**；用 HTML `<input type="file">` + `File.text()`，天然兼容 Web |
| 文件上传 | 现有 `BaseRouter` 支持 multipart（formidable） | `importMockPack` 用 multipart 上传，避免新增 FS IPC |
| 50MB 解析 | `JSON.parse(50MB)` 会阻塞主进程/代理 | 建议上限降到 20MB；或在导入期间提示“代理可能短暂停顿” |
| 新建场景 ID | 新场景必须重新生成 `ruleId` 和 `recordId` | PRD 只写了“规则 ID 除外”，需补记录 ID |
| 合并模式 ID 冲突 | 导入记录 ID 可能已属于其他规则 | 冲突时重新生成记录 ID，或按用户策略跳过/覆盖；需明确 |
| 合并覆盖 | `bulkDocs` 需要正确 `_rev` | 先读现有文档再 `putWithRetry`；不要直接 bulk 覆盖 |
| 全部校验后再写 | 可行；5,000 条内存可接受 | 先 normalize/validate，再分批 `bulkDocs` |
| 回滚 | 新建场景失败删除已创建文档 | 尽力回滚；返回 `created/skipped/failed` 明细 |
| HAR 场景 | PRD 未定义 HAR 生成几个场景、场景名 | 建议：一个文件 = 一个场景，名称为文件名（去扩展名），可编辑 |
| HAR 二进制 | `content.encoding=base64` 需解码 | 文本类型转字符串；二进制存 base64 + `bodyEncoding='base64'` |
| HAR 上限 | 1,000 条 entry | 与规则包 5,000 条不同，需在 UI 明确 |
| 脱敏范围 | 只脱敏请求头 | 建议同时处理 `source.url` 中的敏感 query、`source.requestBody` 中的 token 字段；至少给出警告 |
| 导出进度 | 5,000 条导出 | 服务端一次性生成可接受；UI 显示 loading |
| 版本兼容 | `format` + `version` 必须匹配 | 版本过高拒绝；未知字段忽略 |

#### 3.4.3 R4 验收标准评审

| AC | 可测性 | 备注 |
|---|---|---|
| AC-R4-01 | 可测 | 新建场景会换 ID，断言应比较内容而非 ID；PRD 需修正 |
| AC-R4-02 | 可测 | 脱敏断言 |
| AC-R4-03 | 可测 | 名称追加 `(1)` |
| AC-R4-04 | 可测 | 合并跳过 |
| AC-R4-05 | 可测 | 非法 JSON |
| AC-R4-06/07 | 可测 | HAR fixture |
| AC-R4-08 | 可测 | 1,001 条 |
| AC-R4-09 | 可测 | 部分失败 |
| AC-R4-10 | 可测 | 空场景也要导出 |

---

## 4. 必须补充的技术契约

以下内容建议直接回写 PRD，作为研发与产品的共同基线。

### 4.1 模型修订

```ts
export interface MockResponseDef {
  statusCode: number
  headers: Record<string, string | string[]>   // 支持 set-cookie 等多值
  body: string
  bodyEncoding: 'utf8' | 'base64'              // 新增；binary 必为 base64
  bodyType: 'json' | 'xml' | 'text' | 'binary'
  delayMs: number
}
```

```ts
export interface MockRecordSource {
  url: string
  method: string
  headers?: Record<string, any>
  requestBody?: string
  capturedAt?: number
  host?: string          // 新增：来自 x-mock-host，便于迁移/预填
}
```

```ts
export interface ProxyMock.ProxyRequestRecord {
  // ...现有字段
  mock?: {
    recordId: string
    recordName: string
    variantId?: string | null
    variantName?: string
    warnings?: string[]
    miss?: MockMissDiagnostic
  }
}
```

### 4.2 接口修订

| 接口 | 修订 |
|---|---|
| `POST saveMockRecord` | 入参 `{ ruleId, recordId?, expectedUpdatedAt?, record }`；`recordId` 为空新建 |
| `POST deleteMockRecord` | 入参 `{ ruleId, recordId }`；不再用 URL 反算 |
| `GET getMockRecords` | 返回 `MockRecord[]`，记录含 `id/name/match/response/variants` |
| `POST previewMockRecord` | 入参 `{ record, sample }`，不落库 |
| `POST matchMockRecord` | 入参 `{ ruleId, sample }`，返回 hit/closest/failures |
| `GET health` | 增加 `unknownUidRequests`（脱敏，最近 20 条） |
| `POST diagnose` | 只接受 `http/https`，每步 3s、总 5s，不跟随重定向 |
| `GET getMockMiss` | **删除**；未命中信息随 `REQUEST_END` 推送 |
| `POST saveMockRule` | 同步写/清 meta `lastActiveRuleId` |
| `GET getActiveMockRule` | 内存无状态时从 meta 恢复 |

### 4.3 错误码

| 场景 | code | 说明 |
|---|---|---|
| 保存冲突 | `9409` | 附带当前记录，前端提示刷新/覆盖 |
| 导入格式错误 | `9410` | `msg` 直接展示 |
| 导入版本过高 | `9411` | 提示升级 App |
| 导入超限 | `9412` | 记录数/文件大小 |
| 校验失败 | `9413` | 附 `details[]` |
| 其他 | `9000` | 沿用现有 `BizFail` |

> `BizFail` 当前要求 code 在 9000–10000，以上均在范围内。

### 4.4 数据文档修订

```ts
interface MockRecordDoc {
  _id: string                 // 新记录 rec_<uuid>；历史记录 rec_<sha1>
  type: 'record'
  ruleId: string
  name: string
  match: MockMatchRule
  response: MockResponseDef
  variants: MockVariant[]
  activeVariantId: string | null
  source?: MockRecordSource
  matchInvalid?: boolean
  createdAt: number
  updatedAt: number
  record?: ProxyMock.ProxyRequestRecord   // 兼容旧版本读取
}
```

`MockMetaDoc` 增加：

```ts
interface MockMetaDoc {
  version: 3
  updatedAt: number
  lastActiveRuleId?: string | null
  backupDone?: boolean
}
```

---

## 5. 任务拆分

### 5.1 角色与并行策略

| 角色 | 主要职责 |
|---|---|
| Dev A（主进程） | Matcher、迁移、Repo、代理接入、模板引擎、health/diagnose、导入导出 API |
| Dev B（渲染层） | 规则/记录列表、匹配 Tab、响应编辑器、变体、预览、向导、诊断中心、导入导出 UI |
| QA（兼职） | 测试用例、迁移回归、HAR/规则包 fixture、发布验收 |

**并行原则：**

- W0 共同冻结契约；之后 A 做后端纯逻辑，B 做 UI 壳与交互，接口按 4.2 冻结。
- R1 完成后 R2/R3 可并行；R4 依赖 R2 的响应模型，W5 开始。
- 每天 15 分钟对齐共享类型变更，避免 `@shared` 双端漂移。

### 5.2 W0 前置（2.5 人日）

| ID | 任务 | 负责 | 人日 | 依赖 | 验收 |
|---|---|---|---|---|---|
| T00-1 | 冻结数据模型、ID 策略、并发语义，写 ADR | A+B | 0.5 | — | PRD 第 3/4 节修订并签字 |
| T00-2 | 建立测试基建：`node --test` + tsx，修复 `yarn test` | A | 0.5 | — | `yarn test` 可跑通一个示例测试 |
| T00-3 | 新增 `src/shared/mock.models.ts` / `mock.validation.ts` 骨架 | A | 0.5 | T00-1 | 主/渲染进程均可引用 |
| T00-4 | 扩展 `ProxyRequestRecord`：`mock` 元数据；`REQUEST_END` 补 method | A | 0.5 | T00-1 | 推送/合并/详情类型通过 tsc |
| T00-5 | 代理错误环形缓冲 + 未知 UID 采集 | A | 0.5 | T00-1 | `health` 可返回最近错误 |

> W0 是硬前置。特别是 T00-2：当前测试脚本是坏的，PRD 的单元测试计划无法执行。

### 5.3 W1 R1-a：Matcher 与迁移（8 人日）

| ID | 任务 | 负责 | 人日 | 依赖 | 验收 |
|---|---|---|---|---|---|
| T10-1 | `NormalizedRequest` + URL/Query/Header 归一化 | A | 1.0 | T00-3 | 单测覆盖多值 query、大小写、尾斜杠 |
| T10-2 | Path 匹配：exact/prefix/glob/regex + 保存校验 | A | 1.5 | T10-1 | 单测覆盖四种类型与非法正则 |
| T10-3 | Query 匹配：ignore/match、ignoreKeys、allowExtra、多值 | A | 1.0 | T10-1 | 单测覆盖顺序无关、额外参数、ignoreKeys |
| T10-4 | Method/Host/Header/priority 排序 | A | 0.5 | T10-1 | 单测覆盖 `*.example.com`、并列排序 |
| T10-5 | Matcher 表驱动单测（≥ 40 用例） | A | 1.0 | T10-2/3/4 | `yarn test` 全绿 |
| T10-6 | schema v3 迁移：备份、字段生成、幂等、计数 | A | 2.0 | T00-4 | 旧库副本迁移零丢失；重复执行无变化 |
| T10-7 | Repo 改造：`getRecordById`、`saveRecord(recordId)`、删除、旧 ID 兼容 | A | 1.0 | T00-1 | 新旧记录均可读写；URL 改变不换 ID |

### 5.4 W2 R1-b：接入与 UI（8 人日）

| ID | 任务 | 负责 | 人日 | 依赖 | 验收 |
|---|---|---|---|---|---|
| T20-1 | 场景编译缓存：加载、失效、预热、5,000 上限 | A | 1.0 | T10-7 | 保存后下一次请求立即生效 |
| T20-2 | ProxyService 接入：归一化请求、mock 调用签名、有效延迟 | A | 1.0 | T20-1 | Mock/转发路径回归通过 |
| T20-3 | 未命中诊断 + 随 `REQUEST_END` 推送 `mock` 元数据 | A | 1.0 | T20-2 | 详情可拿到 failures |
| T20-4 | `lastActiveRuleId` 持久化 + 恢复 + 全局开关 | A+B | 1.0 | T00-1 | 重启恢复；多窗口语义按 ADR |
| T20-5 | 规则/记录列表：名称、Method、Host、优先级、变体数、搜索排序 | B | 1.5 | T10-7 | 同 Path 多方法不合并 |
| T20-6 | 匹配 Tab：Method/Host/Path/Query/Header/优先级 + 测试匹配 | B | 1.5 | T10-2/3/4 | 保存校验与 AC 一致 |
| T20-7 | 未命中面板 + 列表灰标 + 一键编辑 | B | 0.5 | T20-3 | 高相似度才展示 |
| T20-8 | 性能基准：1,000 条 p95 ≤ 5ms | A | 0.5 | T20-2 | 产出基准脚本与结果 |

### 5.5 W3 R2-a：响应编辑器基础（6.5 人日）

| ID | 任务 | 负责 | 人日 | 依赖 | 验收 |
|---|---|---|---|---|---|
| T30-1 | 响应模型：多值 headers、`bodyEncoding`、2MB 上限 | A | 0.5 | T00-1 | 类型/发送/存储一致 |
| T30-2 | 共享校验器：status/header/CRLF/path/regex/变体数 | A | 0.5 | T00-3 | 主/渲染共用，单测 |
| T30-3 | Repo 全量保存 + `expectedUpdatedAt` 乐观锁 | A | 1.0 | T30-1 | 并发冲突返回 9409 |
| T30-4 | 编辑器壳：Tab、草稿、离开确认、Ctrl+S、保存态 | B | 1.5 | T30-1 | 切换记录有确认 |
| T30-5 | 响应 Tab：状态码、响应头表格、Body、延迟 | B | 1.5 | T30-3/4 | 可结构化编辑并保存 |
| T30-6 | 变体：新增/复制/重命名/删除/设为当前 | B | 1.5 | T30-5 | 上限 20；删除当前回退 |

### 5.6 W4 R2-b：模板与预览（5.5 人日）

| ID | 任务 | 负责 | 人日 | 依赖 | 验收 |
|---|---|---|---|---|---|
| T40-1 | 模板引擎：解析、白名单变量/函数、请求上下文 | A | 1.5 | T30-1 | 无 eval；单测覆盖 |
| T40-2 | 模板接入发送路径：warning、1MB 截断、seq | A | 0.5 | T40-1/T20-2 | 异常不导致代理崩溃 |
| T40-3 | `previewMockRecord` 接口 | A | 1.0 | T40-1 | 不落库；返回 warnings |
| T40-4 | 预览 UI + 插入变量菜单 + warning 列表 | B | 1.0 | T40-3 | 与真实 Mock 一致 |
| T40-5 | 原始 JSON Tab：格式化/压缩/校验 | B | 0.5 | T30-4 | 非法 JSON 警告不阻断 |
| T40-6 | 模板单测：注入、未知变量、超大输出、请求上下文 | A | 1.0 | T40-2 | 全绿 |

### 5.7 W5 R3：接入向导与诊断（8.5 人日）

| ID | 任务 | 负责 | 人日 | 依赖 | 验收 |
|---|---|---|---|---|---|
| T50-1 | `onboarded` 配置 + 启动路由 + 再次进入 | A+B | 0.5 | T00-1 | 新装进向导，跳过不再弹 |
| T50-2 | 向导壳：4 步、进度、跳过、完成 | B | 1.0 | T50-1 | 响应式/窄屏可用 |
| T50-3 | 步骤 1：服务状态、二维码、复制、防火墙提示 | B | 0.5 | T50-2 | 端口异常可跳设置 |
| T50-4 | 代码片段生成：OkHttp/URLSession/dio/axios/requests/cURL | B | 1.0 | T50-2 | 片段含 `/_proxy`、`x-mock-host`、`x-mock-uid` |
| T50-5 | 步骤 3：监听、UID 匹配、未知 UID 环形缓冲展示 | A+B | 1.0 | T00-5 | AC-R3-04 可验收 |
| T50-6 | 步骤 4：示例场景 + 从最近请求创建 | B | 1.0 | T20-5 | 一键启用并返回示例 JSON |
| T50-7 | `health` 接口：版本/端口/协议/uptime/clients/errors/unknownUid | A | 0.5 | T00-5 | 返回结构符合 5.2.4 |
| T50-8 | `diagnose` 接口：DNS/TCP/TLS/HTTP + 超时/脱敏 | A | 1.5 | — | 每步独立超时，不跟随重定向 |
| T50-9 | 诊断中心 UI + 复制 Markdown 报告 + 脱敏 | B | 1.5 | T50-7/8 | 报告不含 Authorization/Cookie/Token |

### 5.8 W6 R4 + 发布（8.5 人日）

| ID | 任务 | 负责 | 人日 | 依赖 | 验收 |
|---|---|---|---|---|---|
| T60-1 | Mock pack 序列化/反序列化 + 脱敏策略 | A | 1.0 | T30-1 | 往返一致；脱敏可开关 |
| T60-2 | `exportMockPack` + 桌面/Web 保存 | A+B | 0.5 | T60-1 | 文件名合法；空场景也导出 |
| T60-3 | `importMockPack`：multipart、校验、批量写、回滚、明细 | A | 1.5 | T60-1/T30-2 | 部分失败有明细 |
| T60-4 | 导入 UI：文件选择、预览、模式、冲突策略、结果 | B | 1.0 | T60-3 | 新建/合并/跳过/覆盖可用 |
| T60-5 | HAR 解析：entry→记录、base64、mime、上限、场景命名 | A | 1.5 | T60-1 | AC-R4-06/07/08 |
| T60-6 | 导入导出单测 + fixture | A | 1.0 | T60-3/5 | 全绿 |
| T60-7 | 回归矩阵、使用说明、版本文件、增量/全量包验证 | A+B+QA | 2.0 | 全部 | M4 退出标准 |

### 5.9 任务依赖图（关键路径）

```
T00-1/T00-3
   └─ T10-1 → T10-2/3/4 → T10-5
   └─ T10-6（迁移）
   └─ T10-7（Repo）
        └─ T20-1 → T20-2 → T20-3
        └─ T20-5/6/7（UI）
             └─ T30-1 → T30-3 → T30-4/5 → T30-6
                  └─ T40-1 → T40-2/3 → T40-4/5
                       └─ T60-1 → T60-2/3/4/5 → T60-6
T00-5 → T50-5/7 → T50-9
T50-1/2/3/4/6 可与 R2 并行
T60-7 依赖全部
```

**关键路径：T00 → T10-7 → T20-2 → T30-3 → T40-3 → T60-3 → T60-7。** 这条链上任何一环延期 1 天，发布就延期 1 天。

---

## 6. 需要产品/研发共同确认的决策

### 6.1 P0 决策（动工前必须定）

| # | 问题 | 选项 | 研发建议 |
|---|---|---|---|
| D1 | 新记录 UUID 后，是否仍要求旧版本能读取新记录？ | A. 不要求，接受回滚只覆盖迁移记录；B. 保留 `sha1(ruleId+url)` 别名双写 | 选 A；在发布说明写清回滚边界。双写会长期增加复杂度 |
| D2 | 启用场景是全局恢复还是每窗口独立？ | A. 全局 `lastActiveRuleId`，所有 viewer 恢复；B. 每个 viewer 独立（需持久化多份） | 选 A，但第二个窗口启动时要提示“当前场景已启用”，避免误解 |
| D3 | 二进制响应本期做到什么程度？ | A. 只读展示 + base64 存储/发送；B. 支持替换文件 | 选 A；替换文件放 Next |
| D4 | 导入“新建场景”是否重新生成记录 ID？ | A. 是；B. 保持原 ID（可能跨规则冲突） | 选 A；否则规则文档的 `_id` 与记录 ID 会冲突 |
| D5 | 并发保存冲突如何处理？ | A. 乐观锁 9409，前端二选一；B. 静默覆盖 | 选 A；B 会丢用户编辑 |
| D6 | 6 周范围是否允许按 1.2 砍？ | A. 允许；B. 全部必须 | 选 A；否则 W6 无法同时完成 R4 + 回归 + 发布 |

### 6.2 P1 决策（W2 前定）

| # | 问题 | 建议 |
|---|---|---|
| D7 | 导出脱敏是否覆盖 query/body 中的 token？ | 至少覆盖 `source.url` 的敏感 query 键，并在 UI 提示“源快照可能含敏感信息” |
| D8 | HAR 导入生成几个场景？ | 一个文件 = 一个场景，名称取文件名 |
| D9 | 未命中“高相似度”阈值？ | 同首段或同前缀，且失败维度 ≤ 2 |
| D10 | 响应体大小上限？ | 2MB；超出只读 |
| D11 | 正则 ReDoS 的残余风险是否接受？ | 接受，写入发布说明；只对 path 执行，长度 ≤ 200 |
| D12 | 模板渲染后 JSON 非法是否阻断？ | 不阻断，warning |

---

## 7. 工程风险登记

| # | 风险 | 触发条件 | 影响 | 应对 | 负责 |
|---|---|---|---|---|---|
| E1 | 迁移损坏/丢数据 | v3 迁移逻辑错误 | 高 | 备份 + 幂等 + 旧库副本测试 + 计数校验 | A |
| E2 | 迁移启动过慢 | 记录数大、磁盘慢 | 中 | 后台迁移 + 进度提示 + 超时日志 | A |
| E3 | 旧版本回滚后看不到新记录 | D1 选 A | 中 | 发布说明；保留 `record` 字段 | PM |
| E4 | 记录 ID 改造遗漏 UI 的 URL key 假设 | 列表/删除/选择仍按 URL | 高 | 全量搜索 `record.url` 作为 key 的位置；加集成测试 | B |
| E5 | 推送模型缺字段导致详情不显示 | 忘记扩展 `ProxyRequestRecord` | 中 | T00-4 前置 + 类型检查 | A |
| E6 | 二进制响应发送失败 | `resp.send(string)` 当 base64 | 高 | `Buffer.from` + 单测 | A |
| E7 | 并发保存静默覆盖 | 沿用 `putWithRetry` | 高 | `expectedUpdatedAt` + 9409 | A |
| E8 | 未知 UID 诊断不可见 | 沿用现有推送 | 中 | 环形缓冲 + health 轮询 | A |
| E9 | 50MB 导入阻塞代理 | 主进程 `JSON.parse` | 中 | 限制 20MB + 提示 + 分批 | A |
| E10 | 模板 ReDoS / 注入 | 用户写恶意模板 | 中 | 白名单、无 eval、输出上限、单测 | A |
| E11 | 正则 ReDoS | 用户写灾难性正则 | 中 | 长度限制 + 启发式拒绝；残余风险接受 | A |
| E12 | Ace 大 body 卡顿 | 2MB+ 响应体 | 中 | 只读模式 + 虚拟滚动/折叠；必要时限制编辑 | B |
| E13 | 多窗口启用状态互相覆盖 | D2 选 A | 中 | 启动提示；必要时后续做 per-window | PM |
| E14 | HAR/规则包 fixture 不足 | 测试数据单一 | 中 | 从真实 Charles/浏览器导出样本脱敏后入库 | QA |
| E15 | Web 端文件能力缺失 | `saveFile` 不存在 | 低 | Blob 下载；`<input type=file>` 上传 | B |
| E16 | i18n 漏翻 | 新页面只写中文 | 低 | PR 检查 `en.ts`/`zh-CN.ts` 同步 | B |
| E17 | 发布文件不同步 | 忘记 `version-<platform>-<arch>.json` | 中 | 沿用现有发布 checklist | A |

---

## 8. 测试策略

### 8.1 测试分层

| 层 | 范围 | 工具 | 说明 |
|---|---|---|---|
| 单元 | Matcher、Template、Validation、HAR 解析、迁移字段映射 | `node --test` + tsx | 不依赖 Electron/PouchDB |
| 仓储 | Repo CRUD、ID 策略、迁移幂等 | PouchDB memory adapter 或临时目录 | 需要可注入 `USER_DATA_DIR` 或 Repo 构造参数 |
| 集成 | `/_proxy` 请求 → Mock/转发、推送记录 | 启动本地 server（随机端口） | 复用现有 `MainServer` 或轻量 Express |
| 手工 | 平台/主题/语言/协议/异常矩阵 | 手工 | 发布前执行 |

> 当前 `USER_DATA_DIR` 直接取 `app.getPath('userData')`，单测无法在 Electron 外运行。建议给 `MockRepo` 构造函数增加可选 `dbPath`，或在测试中 mock `MockRepo`。这是 T00-2 的一部分。

### 8.2 必测清单

| 模块 | 必测 |
|---|---|
| Matcher | Method/Host/Path 四种/Query 条件/ignoreKeys/allowExtra/优先级/多值/大小写/尾斜杠 |
| Template | 所有内置变量/函数、请求上下文、未知变量、异常、超大输出、注入字符 |
| Migration | v2→v3 字段完整、幂等、无效 URL、计数一致、备份存在 |
| Repo | UUID 新建、URL 修改不换 ID、删除、并发 409、旧 ID 读取 |
| Import/Export | 往返、脱敏、版本过高、非法 JSON、超限、部分失败、空场景 |
| HAR | 文本/base64/mime/无 response/1,001 条 |
| Diagnostics | DNS/TCP/TLS/HTTP 失败、超时、脱敏、未知 UID |
| UI | 未保存确认、快捷键、窄屏、深色、中英文 |

### 8.3 性能测试

| 项 | 方法 | 目标 |
|---|---|---|
| 匹配 | 1,000/5,000 条，预热后连续 1,000 次 | p95 ≤ 5ms（1,000 条） |
| 模板 | 1KB body，连续 1,000 次 | 单次 ≤ 2ms |
| 列表 | 1,000 条首屏 | ≤ 1s |
| 导入 | 1,000 条规则包 | ≤ 10s |
| 导出 | 1,000 条 | ≤ 5s |

---

## 9. 排期方案

### 9.1 方案 A（推荐）：8 周 / 2 研发 + 0.5 QA

| 周 | Dev A | Dev B | QA |
|---|---|---|---|
| W1 | 模型/迁移/Matcher | 测试基建/共享类型/列表壳 | 用例设计 |
| W2 | 缓存/代理接入/诊断数据 | 匹配 Tab/未命中面板 | Matcher 用例 |
| W3 | Repo 乐观锁/保存接口 | 编辑器壳/响应 Tab | 迁移回归 |
| W4 | 模板引擎/预览接口 | 变体/预览 UI/原始 JSON | 模板用例 |
| W5 | health/diagnose | 向导 4 步 | 向导走查 |
| W6 | 导入导出 API/HAR | 导入导出 UI/诊断中心 | 导入导出用例 |
| W7 | 性能/兼容/修复 | 性能/兼容/修复 | 全量回归 |
| W8 | 文档/发布/灰度 | 文档/发布/灰度 | 发布验收 |

### 9.2 方案 B：6 周 / 2 研发 + 1 QA（压缩）

前提：按 1.2 砍掉 HAR 导入 + 诊断中心独立页 + “从最近请求创建首个 Mock”。

| 周 | 内容 |
|---|---|
| W1 | T00 + Matcher + 迁移 |
| W2 | R1 接入 + UI |
| W3 | R2 基础 |
| W4 | R2 模板 + R3 向导（并行） |
| W5 | R4 规则包 + R3 诊断接口 |
| W6 | 回归 + 发布 |

> W6 仍然很挤。若任何一项延期，直接顺延到 W7，不要压测/回归时间。

### 9.3 方案 C：单人开发

| 阶段 | 周 |
|---|---|
| 契约 + 测试基建 + Matcher + 迁移 | 3 |
| R1 接入 + UI | 3 |
| R2 编辑器 + 模板 | 3 |
| R3 向导 + 诊断 | 2 |
| R4 导入导出 | 1.5 |
| 回归 + 发布 | 1.5 |
| **合计** | **14 周**（含缓冲） |

---

## 10. 研发验收清单（Definition of Done）

### 10.1 每个任务

- [ ] 代码通过 `tsc`（主/渲染/共享）
- [ ] 新增逻辑有单测，`yarn test` 全绿
- [ ] 新增文案同时更新 `zh-CN.ts` / `en.ts`
- [ ] 窄屏（≤640px）与深色主题可用
- [ ] 错误路径有可读提示，不吞异常
- [ ] 不破坏旧数据读取

### 10.2 发布前

- [ ] v2 库副本迁移零丢失；备份文件存在
- [ ] 旧版本可读取迁移记录（新 UUID 记录按 D1 结论处理）
- [ ] Matcher 基准达标
- [ ] 模板注入/超大输出/未知变量测试通过
- [ ] 未知 UID 诊断可复现
- [ ] 规则包往返/HAR/脱敏测试通过
- [ ] `docs/使用说明.md` 更新
- [ ] `version.json` 与各平台 `version-<platform>-<arch>.json` 同步
- [ ] 增量/全量更新包验证

---

## 11. 对 PRD 的具体修订建议

| PRD 位置 | 问题 | 建议 |
|---|---|---|
| 3.3 `MockResponseDef.headers` | 只支持 string | 改为 `Record<string, string \| string[]>` |
| 3.3 `MockResponseDef.body` | 二进制语义不明 | 增加 `bodyEncoding` |
| 4.1.3⑥ `lastActiveRuleId` | 多窗口语义未定义 | 明确全局恢复 + 启动提示 |
| 4.1.6 `getMockMiss` | 可选接口增加往返 | 删除，改为随 `REQUEST_END` 推送 |
| 4.2.7 并发保存 | “409 重试 + 提示”矛盾 | 改为 `expectedUpdatedAt` + 9409 |
| 4.3.3 步骤 3 UID 不匹配 | 现有推送模型不可达 | 补充 unknown UID 环形缓冲 + health 轮询 |
| 4.4.4 新建场景 | 未说明记录 ID 处理 | 明确重新生成 `recordId` |
| 4.4.4 合并模式 | 跨规则 ID 冲突未定义 | 冲突时重新生成或跳过 |
| 4.4.5 HAR | 未定义场景名/分组 | 一个文件一个场景，名称取文件名 |
| 6.5 回滚 | “旧版本可继续读取”过度承诺 | 只对迁移记录成立；新 UUID 记录需说明 |
| 7.1 性能 | 缺少测量方法 | 增加预热、记录数、测试脚本说明 |
| 9.1 单测 | 无测试基建 | 增加“测试基建”前置任务 |
| 10 排期 | 6 周过于乐观 | 改为 8 周；6 周作为压缩方案并列出砍范围 |
| 12.2 待确认 | 缺 D1–D6 | 补充阻塞决策 |

---

## 12. 附录：建议的文件落点

| 新文件 | 说明 |
|---|---|
| `src/shared/mock.models.ts` | `MockRecord`/`MockMatchRule`/`MockResponseDef`/`MockVariant` |
| `src/shared/mock.validation.ts` | 主/渲染共用的保存校验与 normalize |
| `src/shared/mock.pack.ts` | pack 格式、HAR 类型、脱敏常量 |
| `src/main/service/mock.matcher.ts` | 纯匹配逻辑（无 IO） |
| `src/main/service/mock.template.ts` | 模板解析与渲染（无 eval） |
| `src/main/service/mock.diagnostic.ts` | health/diagnose/错误环形缓冲 |
| `src/main/service/mock.pack.service.ts` | 导入/导出/HAR 编排 |
| `src/main/service/mock.cache.ts` | 场景编译缓存与失效 |
| `src/renderer/pages/proxy/MockRecordEditor.vue` | 编辑器壳 + Tab |
| `src/renderer/pages/proxy/MockResponseTab.vue` | 响应编辑 |
| `src/renderer/pages/proxy/MockVariantTab.vue` | 变体 |
| `src/renderer/pages/proxy/MockMatchTab.vue` | 匹配条件 |
| `src/renderer/pages/onboarding/Onboarding.vue` | 接入向导 |
| `src/renderer/pages/diagnostic/Diagnostic.vue` | 诊断中心 |
| `src/renderer/pages/proxy/MockMissPanel.vue` | 未命中诊断面板 |

**建议改造的现有文件：**

- `src/main/service/mock.service.ts`：只保留编排，匹配/渲染下沉。
- `src/main/repository/mock.repo.ts`：ID/CRUD/迁移。
- `src/main/service/proxy.service.ts`：归一化请求、有效延迟、错误采集。
- `src/main/router/appmock.router.ts`：新接口注册；删除死路由 `/upload`。
- `src/main/IPCServices.ts`：如需文件路径读取再改；优先不改。
- `src/renderer/pages/proxy/MockRuleMgr.vue`：拆分为列表 + 编辑器。
- `src/renderer/pages/proxy/ProxyRequestDetail.vue`：增加 Mock 匹配区块。
- `src/renderer/store/ProxyRecords.ts`：合并 `mock` 元数据。
- `src/shared/proxy.models.ts`：请求记录扩展。
- `src/lang/zh-CN.ts` / `src/lang/en.ts`：新增文案。

---

## 13. 评审签署

| 角色 | 结论 | 待办 |
|---|---|---|
| 研发负责人 | 有条件通过 | 完成 D1–D6 决策；确认 8 周排期 |
| 产品负责人 | 待确认 | 回写第 11 节修订；确认砍范围 |
| 测试负责人 | 待确认 | 准备迁移/HAR/规则包 fixture |
| 发布负责人 | 待确认 | 确认版本文件与更新包流程 |

> 建议在 W0 结束前完成 D1–D6 决策，否则 W1 的迁移和 Repo 改造无法开始。
