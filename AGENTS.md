# AppApiProxy 作业约定

本仓库（Electron + Vue3 的 HTTP/WebSocket 代理与 Mock 工具）的持久约定。开工前先看这里，再看 `.qoder/skills/` 下对应主题的 skill。

## 提交信息（硬规则，不需要用户再重复交代）

1. **不带需求标号**：`R1`–`R5`、`R4C-01`–`R4C-34`、里程碑 `N0`–`N5`、评审阻塞项 `B1`–`B6` 一律**不写进提交信息**，标题和正文都不写。这些编号只在 `docs/` 的需求三件套与任务卡里存在；提交信息要能被一个从没读过需求文档的人看懂。同理，不写「本卡」「卡片字面」这类只有配合任务卡才成立的指代，要说清是「上一批」「任务卡」还是「设计文档」就直接写出来。
2. **1–2 句、约 100–200 字**。不分条列举，不套括号插语（能自然入句就入句）。
3. **只写两类内容**：这次改动的**核心功能**，或**重点解决的问题**——包括决定这样做而不是那样做的那一句取舍理由。
4. **不写**：闸门读数（单测/迁移条数、`tsc`、`check:strict`、`build:web`/`build` 结果）、方案对照表、变异测试的逐条过程、未做/未验清单。这些进 `docs/` 对应文档的**变更记录行**，那里才是过程细节的存放处。
5. **引用位置用符号名**（`mock.pack.ts` 的 `mockPackQuotaOf`），不写行号。确实要引用提交时，写当场能解析、且在 `main` 上的号。

## 改写历史提交信息时照此规程执行

本仓库已多次整段重写提交信息（`refs/backup/main-prerewrite`、`refs/backup/main-before-dd5c96b-reword`、`refs/backup/main-before-label-reword`）。规程：

- **备份 ref 先行**：`git update-ref refs/backup/<本轮用途> "$(git rev-parse main)"`。
- 用 `git commit-tree` 逐笔重建（本环境不用 `git rebase -i`），**只换 message**：树对象、作者与提交者身份、作者/提交时间必须逐条相同；本轮未改写的那几笔要求提交对象正文**逐字节**一致。
- 收尾用 `git update-ref refs/heads/main <新链顶> <旧链顶>`——第三个参数是 **old-value 守卫**（防覆盖并行提交），不是说明文字。
- 改完必查：`git diff --name-only <旧链顶> <新链顶>` 必须为空；`git range-diff` 逐笔复核；扫描 `docs/`、`.qoder/skills/`、`README.md`、`src/`、`test/` 里落在改写区间内的 SHA 引用并逐条分类——任务卡与正文处**改指新号**，带日期的变更记录行保留当时读数不动，并在新增行里给出 old→new 映射。
- 每重写一次，落在新链上的 SHA 都要重新过一次引用审计；旧号只在备份 ref 上可达，不再在 `main` 上。

## 相关约定

- 需求文档口径、文档落点与交付对账：`.qoder/skills/app-api-proxy-prd/SKILL.md`
- UI 尺寸单源、已裁决边界与校验闸门：`.qoder/skills/app-api-proxy-ui/SKILL.md`
