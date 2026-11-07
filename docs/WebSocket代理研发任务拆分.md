# WebSocket 代理研发任务拆分

> 依据：[`docs/WebSocket代理技术设计.md`](./WebSocket代理技术设计.md)、[`docs/WebSocket代理产品功能规划.md`](./WebSocket代理产品功能规划.md)
> 联调基座：[`tools/ws-lab/README.md`](../tools/ws-lab/README.md)
> 代码基线：`PorxyType.SOCKET = 5030` 已预留；`MainServer` 使用 `http.createServer` / `https.createServer` / `http2.createSecureServer({ allowHTTP1: true })`；单测基线 119 项全绿。
> 用途：任务认领、估时、联调、验收。**产品口径以产品规划为准，工程落点与验收以本文为准。**

---

## 1. 结论摘要

| 阶段 | 范围 | 工程估算 | 建议周期 | 关键前提 |
|---|---|---|---|---|
| WS-1 观测 | `WS1C-01` ~ `WS1C-19` | **35.5 人日**（P0 33.5 + P1 2） | 2 研发 × 3.5~4 周 | M0 契约冻结、`ws` 打包验证 |
| WS-2 可控 Mock | `WS2C-01` ~ `WS2C-10` | **30.5 人日** | 2 研发 × 3.5~4 周 | WS-1 记录模型与详情稳定 |
| WS-3 可复用 | `WS3C-01` ~ `WS3C-09` | **31 人日**（P2 另 5，合计 36） | 2 研发 × 5 周 | WS-2 脚本执行器、规则包 schema |
| ws-lab | `WSL-01` ~ `WSL-05` | 2.25 人日 | **已完成** | 不阻塞产品排期 |

三个必须按顺序推进的关键点：

1. **upgrade 入口 → 上游握手 → 双向中继**：任何一环未闭环，后面的记录、UI、Mock 都无法验收。
2. **协议维度（`protocol: 'ws'`）必须先于任何 WS Mock**：否则 WS 握手会误命中 HTTP 规则，属于数据正确性问题，不是体验问题。
3. **录制器必须先于回放**：回放格式、截断标记、时序基准都来自 `SocketRecord`，模型冻结前不要做回放 UI。

与产品“WS-1 2~3 周”的差异：研发估算 P0 约 3.5 周，偏差来自“连接详情 + 消息列表 + 保留策略 + 诊断”四项被产品估算压在 1 周内。建议 **v1.2 先发 P0 观测闭环（3.5 周），P1（重连聚合、导出、手动断开）随 v1.2.x 补齐**，不要为赶 3 周砍掉保留策略与诊断，否则长连接场景不可用。

---

## 2. 现状与前置条件

| 项 | 状态 | 说明 |
|---|---|---|
| `upgrade` 可行性 | 已验证 | `http.createServer` 与 `http2.createSecureServer({ allowHTTP1: true })` 在 ALPN=HTTP/1.1 时均触发 `upgrade` |
| `ws` 依赖 | 已完成 | `package.json` 已加 `ws ^8.18.0` 与 `@types/ws ^8.5.10`，与现有锁文件范围一致 |
| 5030 类型 | 已预留 | UI 已有筛选图标与 `PorxyType.SOCKET`，主进程尚未产生数据 |
| SockJS 共存 | 已验证 | SockJS 只消费自身前缀，非 `/echo`、`/notification` 的 upgrade 可安全接管 |
| 测试基线 | 已具备 | `yarn test` 119 项通过；新增单测放 `test/unit/**` |
| ws-lab | 已完成 | 服务端、客户端页、推送控制台、Node 客户端、13 项冒烟测试与浏览器验证均通过 |
| `SocketProxyService` | **缺失** | 本文 `WS1C-01` 起新建 |
| `SocketRecord` / UI | **缺失** | 本文 `WS1C-07` 起新建 |
| HTTP/2 扩展 CONNECT | 不做 | 首版只支持 HTTP/1.1 Upgrade；需在诊断中明确提示 |

动工前需要产品确认的三件事（不阻塞 W0）：

1. 手动发送消息放 WS-2 还是 WS-3（影响 `WS2C-06` 的编辑器布局）。
2. 默认保留上限是否采用 40 连接 / 1000 帧 / 256KB 单帧（影响 `WS1C-08`）。
3. 是否首版就脱敏 `authorization` / `cookie` / `token`（影响记录器与导出）。

---

## 3. 角色、估算口径与完成定义

### 3.1 角色

| 角色 | 职责 |
|---|---|
| Dev A | 主进程：upgrade 路由、目标解析、握手、中继、记录器、Mock 执行器 |
| Dev B | 渲染层：store 合并、连接列表/详情、消息面板、Mock 编辑器、接入向导 |
| QA（0.5） | `ws-lab` 场景脚本、三端接入回归、性能与长稳测试、发布验收 |

### 3.2 估算口径

- 1 人日 = 6 小时有效编码 + 自测，不含评审等待与跨天联调。
- 联调人日已均摊到各卡，不单列“联调周”。
- P0 未完成不得进入 WS-2；P1 可随补丁版本发布。

### 3.3 统一完成定义（DoD）

1. 实现 + 类型通过：`yarn test`、`tsc`（项目现有检查链路）均无新增错误。
2. 新增逻辑有单测：目标解析、头过滤、截断、批量 flush、store 合并、脚本执行、消息匹配至少各 1 组。
3. 对应产品验收项有手工证据（截图/录屏/`ws-lab` 日志），不接受“口头通过”。
4. 运行期无新增 console error；长连接关闭后无残留定时器、无监听泄漏。
5. 新增文案同时补 `src/lang/zh-CN.ts` 与 `src/lang/en.ts`。
6. 不回归：HTTP 代理、HTTP Mock、SockJS 推送、`yarn test` 基线全绿。
7. 更新 `docs/使用说明.md`，删除“不解析 WebSocket 帧”的旧限制。

---

## 4. 里程碑与退出标准

| 里程碑 | 内容 | 退出标准 |
|---|---|---|
| M0 契约冻结 | 模型、推送协议、错误码、协议维度 | 前后端可并行开发；类型与常量进入 `src/shared` |
| M1 代理核心 | upgrade → 目标解析 → 握手 → 中继 → 关闭 | `ws-lab` 经代理直连、回显、二进制、关闭码全部通过 |
| M2 观测闭环 | 记录器 → 批量推送 → store → 列表/详情/消息 | 浏览器、Node、头接入三种客户端各产生一条完整记录 |
| M3 诊断与接入 | 失败阶段、错误码、向导片段、文档 | 缺头/uid 离线/TLS 失败/上游 5xx 均有可执行提示 |
| M4 WS-2 | 拒绝/伪造握手、脚本推送、录制、变体 | 20 分钟内完成“首连 → WS Mock → 命中”闭环 |
| M5 WS-3 | 消息规则、回放、规则包、Composer | 录制回放一致率 ≥ 98%，规则包往返无损 |
| M6 协议化/资产化 | 解码、持久化、共享 | 独立立项，不在本次排期 |

---

## 5. 任务卡

### 5.1 W0 契约与基座（2.5 人日）

| 卡号 | 任务 | 角色 | 人日 | 依赖 | 主要落点 | 验收要点 |
|---|---|---|---|---|---|---|
| WS0C-01 | 契约冻结：`SocketFrame` / `SocketRecord` / 推送联合类型 / 协议维度 | Dev A | 1.0 | — | `src/shared/proxy.models.ts`、`src/shared/api.const.ts` | 字段与设计文档 7.1 一致；`type` 固定 5030；`wsPhase` 三态；HTTP 现有类型零改动 |
| WS0C-02 | 依赖与打包验证：`ws` 在 Electron 主进程可用、asar 内可加载 | Dev A | 0.5 | — | `package.json`、`electron-builder.yml`、webpack main 配置 | `yarn dev` 下能 `new WebSocketServer`；`yarn pkg` 后安装包内可正常建连（至少完成一次本地产物验证） |
| WS0C-03 | 主进程骨架与路由桩：服务注册、`bindServer`、`closeAll` 空实现 | Dev A | 0.5 | WS0C-01 | `src/main/service/socket-proxy.service.ts`、`MainConst.ts`、`IocContainer.ts`、`MainServer.ts` | 不改变现有端口与启动顺序；`stop()` 能调用 `closeAll()` |
| WS0C-04 | 文案、错误码与诊断映射占位 | Dev B | 0.5 | WS0C-01 | `src/lang/zh-CN.ts`、`src/lang/en.ts`、`docs/使用说明.md` | WS-E01~WS-E12 有中英文案；文档标注 WS 支持状态 |

### 5.2 W1 代理核心（12.5 人日）

| 卡号 | 任务 | 角色 | 人日 | 依赖 | 主要落点 | 验收要点 |
|---|---|---|---|---|---|---|
| WS1C-01 | Upgrade 路由与生命周期 | Dev A | 2.0 | WS0C-03 | `socket-proxy.service.ts`、`MainServer.ts` | 只接管 `/_proxy*`；`/echo`、`/notification`、静态路由不受影响；未知路径按 404 处理；应用退出先 `closeAll(1001)` 再关 HTTP；定时器 `unref()` |
| WS1C-02 | 目标解析与身份 | Dev A | 2.0 | WS0C-01 | `socket-proxy.service.ts` | 请求头优先、`__mock_host`/`__mock_uid` 兜底；`dataServer` 覆盖并按 `http→ws`、`https→wss` 映射；剥离 `/_proxy` 与保留参数且不改变其余参数；缺 host 400、非 WS 426、非 ws 协议拒绝 |
| WS1C-03 | 上游握手与响应回写 | Dev A | 3.0 | WS1C-01/02 | `socket-proxy.service.ts` | 转发 `authorization`/`cookie`/`origin`/子协议；过滤逐跳头与 `sec-websocket-*`；15s 超时；上游 401/403/5xx 原样回写；wss 目标可用；`perMessageDeflate: false` |
| WS1C-04 | 双向消息中继与背压 | Dev A | 2.5 | WS1C-03 | `socket-proxy.service.ts` | 文本/二进制原样转发；1MB 二进制逐字节一致；不 `JSON.parse`；`bufferedAmount` 超 4MB 暂停读；50 帧/秒持续 1 分钟无堆积 |
| WS1C-05 | 关闭语义与错误映射 | Dev A | 1.5 | WS1C-04 | `socket-proxy.service.ts` | 双向 close code/reason 透传；异常断开映射 1006；连接中取消握手不泄漏；关闭后从 Map 与推送队列移除 |
| WS1C-06 | 连接状态、上限与清理 | Dev A | 1.5 | WS1C-04 | `socket-proxy.service.ts`、`push.service.ts` | 128 连接上限，超额 503；按 uid 建索引；`clearClientState(uid)` 清理队列；不误关其他 uid 连接 |

**M1 联调检查**：用 `yarn ws-lab` + 客户端页直连/代理两种模式，完成文本回显、二进制回显、关闭码 4001 透传；再用 `node tools/ws-lab/node-client.mjs --proxy ... --uid ...` 验证请求头模式。

### 5.3 W2 记录与推送（5 人日）

| 卡号 | 任务 | 角色 | 人日 | 依赖 | 主要落点 | 验收要点 |
|---|---|---|---|---|---|---|
| WS1C-07 | `SocketRecord` 模型与 API 常量 | Dev A | 1.5 | WS0C-01 | `src/shared/proxy.models.ts`、`api.const.ts` | open/frames/close 三阶段字段完整；`frames` 仅 frames 阶段携带；推送联合类型不破坏现有 HTTP 分支 |
| WS1C-08 | 帧记录器与批量推送 | Dev A | 2.5 | WS1C-04/05/07 | `socket-proxy.service.ts`、`push.service.ts` | 100ms / 50 帧 / 256KB 提前 flush；队列 1000 帧 / 4MB 上限，溢出丢最旧并累计 `droppedFrames`；单帧 256KB 截断（二进制 128KB）且保留原始大小；open/close 立即推送 |
| WS1C-09 | 渲染层 store 合并 | Dev B | 1.0 | WS1C-07 | `src/renderer/store/ProxyRecords.ts` | open 插入、frames 只合并已存在连接、close 更新关闭码/时长/字节；淘汰时释放帧；选中项不淘汰；5030 筛选与搜索不变 |

**性能底线**：10 连接 × 1 万帧，主进程内存增量 ≤ 150MB；UI 消息追加 p95 ≤ 300ms；丢弃必须有计数，不允许静默。

### 5.4 W3 观测 UI（P0 7.5 + P1 2 人日）

| 卡号 | 任务 | 角色 | 人日 | 依赖 | 主要落点 | 验收要点 |
|---|---|---|---|---|---|---|
| WS1C-10 | 连接列表行 | Dev B | 1.5 | WS1C-09 | `ProxyRecordSnap.vue` | `5030` 显示 `[WS]`、状态、时长、消息数、↑↓字节、Mock 标记；连接中/已关闭可区分；不挤占现有 HTTP 行布局 |
| WS1C-11 | 连接详情（握手摘要） | Dev B | 2.0 | WS1C-09 | `SocketDetail.vue`、`Proxy.vue` | 展示 URL、子协议、握手请求/响应头、关闭码/原因、目标、开始时间；`5030` 路由到新组件；固定头部 + 内容区滚动 |
| WS1C-12 | 消息列表与消息详情 | Dev B | 2.5 | WS1C-11 | `SocketDetail.vue`、`ProxyRequestBody.vue` | 方向/类型/时间/大小；文本 JSON 美化、二进制 base64；复制；跟随最新/暂停跟随/清空；1 万帧下滚动可用 |
| WS1C-13 | 保留、截断、锁定与暂停 | Dev B | 1.5 | WS1C-08/12 | `SocketDetail.vue`、`ProxyRecords.ts` | 截断/丢弃 100% 有提示；锁定项不被淘汰；暂停记录只停 UI 追加、不断转发；恢复后补齐计数 |
| WS1C-14 | 重连聚合与连接导出（P1） | Dev B | 1.5 | WS1C-10 | `ProxyRecords.ts`、`ProxyRecordSnap.vue` | 同 URL 30s 内重连折叠，可展开；单连接导出 JSONL 字段完整、可被 `ws-lab` 读取 |
| WS1C-15 | 手动断开（P1） | Dev B | 0.5 | WS1C-05 | `SocketDetail.vue`、`api.const.ts` | 指定 1000/1001/1011/1013 或自定义码；二次确认；断开后列表状态与关闭原因同步 |

### 5.5 W4 诊断、接入与发布（6 人日）

| 卡号 | 任务 | 角色 | 人日 | 依赖 | 主要落点 | 验收要点 |
|---|---|---|---|---|---|---|
| WS1C-16 | 握手诊断接入诊断中心 | Dev A | 1.5 | WS1C-03/05 | `diagnostic.service.ts`、`DiagnosticService` 前端页 | 缺 host、uid 离线、DNS/TCP/TLS 失败、上游 401/403/5xx、HTTP/2 客户端均有阶段与建议；耗时可见 |
| WS1C-17 | 接入向导与文档 | Dev B | 1.5 | WS1C-02/16 | 接入向导页、`docs/使用说明.md`、`docs/使用说明.pdf` 源文件 | OkHttp 拦截器、浏览器查询参数、Node `ws` 三段代码可复制；wss 证书提示；文档移除旧限制 |
| WS1C-18 | 性能、长稳与内存验证 | QA + Dev A | 1.5 | WS1C-12 | 测试报告（仓库内 `docs/` 或任务卡回填） | 30 分钟、10 连接、1 万帧：内存增量 ≤ 150MB；无定时器泄漏；UI p95 ≤ 300ms；记录测试机配置 |
| WS1C-19 | 回归与发布 | QA + Dev A | 1.5 | 全部 P0 | 发布清单 | 119 项单测全绿；HTTP 代理/Mock/SockJS 无回归；安装包内 WS 可用；版本号与增量清单同步 |

### 5.6 WS-2 可控 Mock（30.5 人日）

| 卡号 | 任务 | 角色 | 人日 | 依赖 | 主要落点 | 验收要点 |
|---|---|---|---|---|---|---|
| WS2C-01 | 规则协议维度与匹配隔离 | Dev A | 2.0 | WS1C-19 | `mock.matcher.ts`、`mock.service.ts`、`mock.migration.ts` | 旧规则迁移默认 `http`；WS 握手不命中 HTTP 规则，反之亦然；同规则可同时含两类记录；启用切换同时生效 |
| WS2C-02 | 握手拦截：拒绝与伪造 | Dev A | 5.0 | WS2C-01 | `socket-proxy.service.ts`、`mock.service.ts` | reject 返回配置状态码/头/体；accept 不连上游完成 101 并回显子协议；触发条件可解释 |
| WS2C-03 | 脚本模型与执行器 | Dev A | 5.0 | WS2C-02 | 新增 `socket.mock.ts`（或 `mock.socket.ts`）、`shared` 类型 | onOpen 按 delayMs 推送文本/二进制/close；连接关闭清理全部定时器；总时长 5 分钟、200 条上限；不阻塞真实透传 |
| WS2C-04 | 录制生成脚本 | Dev A | 3.0 | WS1C-08 | 录制服务、`SocketRecord` | 从 s2c 帧生成 onOpen 初稿；保留相对时间、截断与丢弃信息；用户可删改；回放一致率 ≥ 98%（±100ms） |
| WS2C-05 | 命中/未命中诊断 | Dev A | 2.0 | WS2C-01 | `mock.matcher.ts`、`MockMissPanel.vue` | 命中规则、相似规则、失败维度可见；未命中回退真实上游并记录原因 |
| WS2C-06 | WS Mock 编辑器 | Dev B | 5.0 | WS2C-03 | `MockRuleMgr.vue`、新增 WS 页签组件 | 模式（拒绝/伪造/透传）、握手、脚本编辑、变体；校验行号与错误定位；与 HTTP 编辑器互不影响 |
| WS2C-07 | 变体与断线模拟 | Dev B | 2.0 | WS2C-06 | WS 编辑器、规则模型 | 正常/空态/错误/断线/慢速一键切换；断线支持立即/延迟与关闭码；二次确认 |
| WS2C-08 | 延迟注入 | Dev A | 1.5 | WS2C-02 | `socket-proxy.service.ts` | 只作用于握手与 Mock 消息；真实透传不逐帧延迟；可一键关闭 |
| WS2C-09 | 连接详情录制入口 | Dev B | 2.0 | WS1C-11、WS2C-04 | `SocketDetail.vue`、录制面板 | “Mock 这条连接”复用录制面板；选择规则/模式；成功后连接行显示 `[MOCK]`，注入帧标记 |
| WS2C-10 | WS-2 测试与发布 | QA + Dev | 3.0 | WS2C-01~09 | 测试报告、发布清单 | 20 分钟闭环；HTTP/WS 规则隔离；录制回放一致率；断线码正确；无回归 |

### 5.7 WS-3 消息级 Mock 与回放（31 人日，P2 另 5）

| 卡号 | 任务 | 角色 | 人日 | 依赖 | 主要落点 | 验收要点 |
|---|---|---|---|---|---|---|
| WS3C-01 | 消息匹配引擎 | Dev A | 5.0 | WS2C-03 | 新增 WS 消息匹配器 + 单测 | 文本/二进制；equals/contains/regex/jsonPath；once/持续；非法正则与坏 JSON 不崩溃 |
| WS3C-02 | 回复动作执行 | Dev A | 3.0 | WS3C-01 | `socket.mock.ts` | 回复/关闭/忽略；延迟与顺序可配；与真实上行透传的优先级明确 |
| WS3C-03 | 录制回放 | Dev A | 4.0 | WS2C-04 | 回放执行器 | 原时序/压缩时序；循环/单次；暂停/继续；关闭清理；与截断信息一致 |
| WS3C-04 | 规则包扩展 | Dev A | 3.0 | WS2C-10 | 规则导入导出模块、schema | 包含 WS 记录/脚本/变体；旧包仍可导入；往返无损；版本号升级 |
| WS3C-05 | 手动发送 Composer | Dev B | 4.0 | WS1C-12 | `SocketDetail.vue` | 文本/JSON/二进制；历史与重复发送；发送结果与失败原因可见 |
| WS3C-06 | 场景/状态机对接 | Dev A | 7.0 | WS3C-01/02 | 现有场景模块 + WS 状态机适配 | 多步骤、重连连续性、变量；与 HTTP 场景共用规则时不串扰 |
| WS3C-07 | 弱网模板 | Dev B | 2.0 | WS2C-07 | 模板库 | 慢速/抖动/断线模板可一键套用；参数可调 |
| WS3C-08 | 断点/改写（P2，可选） | Dev A | 5.0 | WS3C-01 | 中继拦截点 | 命中后可暂停、编辑、放行；超时自动放行；不阻塞其他连接 |
| WS3C-09 | WS-3 测试与发布 | QA + Dev | 3.0 | WS3C-01~07 | 测试报告、发布清单 | 规则包往返、回放一致率、状态机连续性、无回归 |

### 5.8 ws-lab 测试应用（2.25 人日，已完成）

| 卡号 | 任务 | 状态 | 人日 | 落点 | 验证证据 |
|---|---|---|---|---|---|
| WSL-01 | 本地 WS 服务与推送 REST API | 已完成 | 0.5 | `tools/ws-lab/server.mjs` | `/api/health`、`/api/clients`、`/api/logs`、`/api/push`、`/api/close`；welcome 回显上游可见 path/query |
| WSL-02 | 客户端页面（直连/代理、收发、重连、筛选） | 已完成 | 0.5 | `tools/ws-lab/public/index.html`、`client.js` | 浏览器实测连接、文本/二进制回显、筛选、断开、代理 URL 生成 |
| WSL-03 | 推送控制台（列表、单发、定时、关闭、日志） | 已完成 | 0.5 | `tools/ws-lab/public/admin.html`、`admin.js` | 浏览器实测选目标推送、定时推送、close code 4002 透传、日志刷新 |
| WSL-04 | Node 客户端与冒烟测试 | 已完成 | 0.5 | `tools/ws-lab/node-client.mjs`、`smoke.mjs` | `node-client` 收推送并输出 close 4002；`smoke` 13 项全过 |
| WSL-05 | README 与手工验证步骤 | 已完成 | 0.25 | `tools/ws-lab/README.md` | 启动、两种模式、代码片段、API、冒烟命令齐全 |

> ws-lab 不参与产品打包；主进程与渲染层开发均以它为联调上游，后续 WS Mock 场景也复用它。

---

## 6. 依赖关系与关键路径

```
W0 契约/基座
   │
   ├─ WS1C-01 路由 ─ WS1C-03 握手 ─ WS1C-04 中继 ─ WS1C-05 关闭
   │        │              │             │
   │        └ WS1C-02 目标 ┘             ├─ WS1C-07 模型 ─ WS1C-08 记录器 ─ WS1C-09 store
   │                                                    │                  │
   │                                                    │                  ├─ WS1C-10 列表
   │                                                    │                  ├─ WS1C-11 详情 ─ WS1C-12 消息
   │                                                    │                  └─ WS1C-13 保留/锁定
   │                                                    │
   └─ WS1C-16 诊断 ─ WS1C-17 向导                             WS1C-18 性能 ─ WS1C-19 发布
                                                                  ▲
WS2C-01 协议维度 ─ WS2C-02 握手 Mock ─ WS2C-03 执行器 ─ WS2C-04 录制 ─ WS2C-05 诊断
                                                        └─ WS2C-06 编辑器 ─ WS2C-07 变体
WS3C-01 消息匹配 ─ WS3C-02 回复 ─ WS3C-03 回放 ─ WS3C-06 状态机
```

**关键路径**：`WS0C-01 → WS1C-01 → WS1C-03 → WS1C-04 → WS1C-08 → WS1C-09 → WS1C-11/12 → WS1C-19`。

可并行的三组：

- Dev A 做 `WS1C-01/02` 时，Dev B 按冻结契约先搭 `WS1C-07` 类型与 `SocketDetail.vue` 空壳。
- `WS1C-16/17` 依赖握手与关闭语义，但文案与代码片段可在 M1 期间先写。
- WS-1 发布后，`WS2C-01`（协议维度）与 `WS2C-03`（执行器）并行，Dev B 同时做编辑器骨架。

---

## 7. 测试矩阵

| 层 | 覆盖 | 用例 / 工具 | 准出 |
|---|---|---|---|
| 单测 | 目标解析、头过滤、截断、批量 flush、store 合并、脚本执行、消息匹配 | `test/unit/**/*.test.ts`、`yarn test` | 新增用例全过，基线 119 不回归 |
| 集成 | 头接入、查询参数接入、wss、子协议、二进制、关闭码 | `ws-lab` + 代理 | 双向逐字节一致；关闭码/原因一致 |
| 集成 | 拒绝握手、伪造连接、脚本推送、消息回复、回放 | `ws-lab` + WS Mock | 时序误差 ≤ 100ms；未命中回退真实上游 |
| E2E | 浏览器（查询参数）、Node（请求头）、OkHttp（请求头） | 三端各一条连接 | 连接 1s 内出现在列表；消息延迟 p95 ≤ 300ms |
| 性能 | 10 连接 × 1 万帧、50 帧/秒、1MB 二进制 | 压测脚本 + 任务管理器 | 内存增量 ≤ 150MB；UI p95 ≤ 300ms；无持续增长 |
| 回归 | HTTP 代理、HTTP Mock、SockJS、v3 迁移 | 现有单测 + 手工 | 全部通过；无端口/路由变化 |

必测异常路径：

1. 缺 `x-mock-host` / `__mock_host`：400，提示可执行。
2. uid 不在线：仍转发但不推送记录，诊断可见。
3. 上游 401/403/500：握手失败原样回显，UI 显示状态码。
4. TLS 证书错误：wss 失败阶段为 TLS，不误报为 TCP。
5. 浏览器无法设置请求头：查询参数兜底生效，且 `__mock_*` 不出现在上游 query。
6. 上游中途断开：客户端收到 1006/对应码，列表原因正确。
7. 高频消息：丢弃计数出现，UI 仍可操作。
8. 应用退出：所有连接收到 1001，HTTP 服务正常关闭，无挂起。

---

## 8. 排期方案

### 8.1 推荐方案（2 研发 + 0.5 QA）

| 周 | Dev A | Dev B | QA |
|---|---|---|---|
| W1 | W0 + `WS1C-01/02/03` | W0 文案 + 模型空壳 + 详情布局 | ws-lab 场景脚本、三端接入样例 |
| W2 | `WS1C-04/05/06` | `WS1C-07/09/10` | 代理链路集成、异常路径 |
| W3 | `WS1C-08` + `WS1C-16` | `WS1C-11/12/13` | 消息面板与长连接测试 |
| W4 | `WS1C-17/18` | `WS1C-14/15` + 发布前修缺陷 | 性能、回归、发布验收 |
| W5–W8 | `WS2C-01/02/03/04/05/08` | `WS2C-06/07/09` | WS-2 场景与回放一致性 |
| W9–W13 | `WS3C-01/02/03/04/06` | `WS3C-05/07` | 规则包、状态机、回放长稳 |

### 8.2 可裁剪项（若必须压缩 WS-1 到 3 周）

按顺序砍：

1. `WS1C-14` 重连聚合与导出（P1）→ 顺延。
2. `WS1C-15` 手动断开（P1）→ 顺延。
3. `WS1C-13` 中的“锁定”保留，“暂停记录”顺延（但丢弃提示不可砍）。

不可砍：`WS1C-08` 批量/上限、`WS1C-11/12` 详情与消息、`WS1C-16` 诊断。缺少任一项，长连接观测在生产环境不可用。

---

## 9. 风险与决策登记

| 风险/决策 | 影响 | 处理 |
|---|---|---|
| `ws` 在 Electron 打包后加载失败 | 安装包内 WS 不可用，属于发布阻塞 | `WS0C-02` 必须做一次 `yarn pkg` 产物验证；必要时在 webpack main 中 `externals` 并确认 `node_modules/ws` 入包 |
| 压缩扩展未协商 | 少数依赖 permessage-deflate 的上游流量变大 | 首版明确不协商；在诊断与文档说明；有强需求再加兼容开关 |
| 101 响应附加头不保真 | 个别鉴权/路由场景失败 | 只回写 `sec-websocket-protocol` 与必要头；记录原始握手供排查 |
| HTTP/2 客户端 | 连接失败且用户不知原因 | 握手失败阶段明确提示“需 HTTP/1.1 Upgrade”；不做 RFC 8441 |
| 高频消息压垮 UI | 卡顿、内存增长 | 批量推送 + 上限 + 丢弃提示 + 暂停记录；性能卡 `WS1C-18` 为发布门禁 |
| 协议维度迁移影响现有 HTTP 规则 | 误命中或规则失效 | `WS2C-01` 单独迁移与回滚用例；旧规则默认 `http`；先冻结 v1.1 规则 schema |
| 录制回放时序漂移 | 与真实序列不一致 | 以相对时间 + 单调时钟回放；验收允许 ±100ms；截断帧不计入一致率分母 |
| 规则编辑器复杂度膨胀 | 学习成本高、字段冲突 | 模式模板化（正常/空态/错误/断线/慢速）；HTTP 与 WS 编辑器分离；命中诊断兜底 |

待确认（不阻塞 W0，但需在对应卡前定）：

1. 手动发送消息是否前移到 WS-2（影响 `WS2C-06`）。
2. 默认保留上限是否按 40/1000/256KB 执行。
3. 是否首版脱敏敏感头与消息字段。
4. WS-1 是否提供“导出连接”，还是随 WS-3 规则包一起做。
5. 首批用户以 OkHttp、WebView 还是 Socket.IO/STOMP 为主（影响向导与协议解码优先级）。

---

## 10. 立即可开工清单

1. 产品确认第 9 节 3 个默认值，`WS0C-01` 当天冻结类型。
2. Dev A 按 `WS1C-01` 建 `SocketProxyService`，用 `yarn ws-lab` 验证 `upgrade` 只接管 `/_proxy`。
3. Dev B 按冻结类型搭 `SocketDetail.vue` 空壳与 `Proxy.vue` 的 5030 路由，先用假数据联调布局。
4. QA 用 `tools/ws-lab` 写三端接入脚本（浏览器查询参数、Node 请求头、OkHttp 请求头）。
5. 发布负责人确认 `ws` 打包路径，`WS0C-02` 未通过前不进入 M2。