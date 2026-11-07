# ws-lab

最小化的 WebSocket 端到端测试应用，用来验证 AppApiProxy 的长连接代理链路，也可以脱离代理单独运行。

- 客户端页：发起 WS 连接、接收推送、发送文本/二进制
- 控制台页：查看在线连接、选择目标、手动/定时推送、按 close code 断开
- 服务端：`ws` 实现的 WS echo + 推送 REST API，不依赖 Electron

## 启动

```bash
yarn ws-lab
# 等价于 node tools/ws-lab/server.mjs
```

默认监听 `127.0.0.1:8890`，可用环境变量覆盖：

```bash
PORT=9000 HOST=0.0.0.0 node tools/ws-lab/server.mjs
```

页面：

- 客户端：http://127.0.0.1:8890/
- 控制台：http://127.0.0.1:8890/admin
- WS 端点：`ws://127.0.0.1:8890/ws`

## 两种连接模式

### 直接连接

客户端页选择「直接连接」，目标地址填 `127.0.0.1:8890`，路径 `/ws`。

### 经 AppApiProxy

先启动 AppApiProxy，并确保客户端页右上角已连接（`__mock_uid` 对应的客户端在线）。
客户端页选择「经 AppApiProxy」：

| 字段 | 值 |
| --- | --- |
| 目标地址 | `127.0.0.1:8890`（上游 WS 服务） |
| 代理地址 | `127.0.0.1:8884`（AppApiProxy 为 http）或 `wss://127.0.0.1:8884`（AppApiProxy 为 https） |
| Mock UID | 当前在线客户端 UID |

生成的地址形如：

```
ws://127.0.0.1:8884/_proxy/ws?name=demo&echo=1&__mock_host=127.0.0.1%3A8890&__mock_uid=<uid>
```

连接成功后，welcome 消息里的 `path` / `query` 就是上游实际收到的路径与参数，可用于确认 `/_proxy` 前缀和 `__mock_*` 参数已按预期剥离。

## Node 客户端（模拟 OkHttp 设置请求头）

```bash
# 直连
node tools/ws-lab/node-client.mjs --target 127.0.0.1:8890 --name node-a

# 经代理，使用 x-mock-host / x-mock-uid 请求头
node tools/ws-lab/node-client.mjs \
  --target 127.0.0.1:8890 \
  --proxy 127.0.0.1:8884 \
  --uid <uid> \
  --name node-a \
  --heartbeat 15000

# AppApiProxy 为 https 时：代理地址写 wss://，并跳过自签名证书校验
node tools/ws-lab/node-client.mjs \
  --target 127.0.0.1:8890 \
  --proxy wss://127.0.0.1:8884 \
  --uid <uid> \
  --insecure
```

stdin 交互：

- 普通行：发送文本
- `/bin <base64>`：发送二进制
- `/quit`：退出

默认断线自动重连（指数退避，上限 10s），`--no-reconnect` 可关闭。

## REST API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, uptime, clients, now }` |
| GET | `/api/clients` | 在线连接列表 |
| GET | `/api/logs?limit=50` | 服务端最近日志（最多 200 条） |
| POST | `/api/push` | `{ target: 'all' \| clientId, type: 'text' \| 'binary', data }` |
| POST | `/api/close` | `{ target, code, reason }` |

文本推送会包一层信封：

```json
{ "kind": "push", "id": "<uuid>", "ts": 1700000000000, "payload": "<原始文本>" }
```

二进制推送把 `data` 按 Base64 解码后原样发送；客户端的二进制也按原样回显。

## 冒烟测试

```bash
yarn ws-lab:smoke
# 等价于 node tools/ws-lab/smoke.mjs
```

覆盖：健康检查、静态页、未知 upgrade 404、welcome 回显、连接列表、文本/二进制回显、全体/单目标推送、`echo=0`、close code/reason 透传、日志记录。

## 快速手工验证

1. `yarn ws-lab`
2. 打开 http://127.0.0.1:8890/，保持默认配置，点「连接」
3. 新开 http://127.0.0.1:8890/admin
4. 在「在线连接」中点击该连接（或直接选择全部），输入内容后点「发送一次」
5. 客户端页应收到 `kind: "push"` 消息；在控制台点「关闭连接」可验证关闭码

## 验证 AppApiProxy WS 代理功能

下面按功能点给出可复现的验证步骤。默认 AppApiProxy 运行在 `http://127.0.0.1:8884`（`yarn dev`），
ws-lab 运行在 `127.0.0.1:8890`（`yarn ws-lab`）。

> 协议说明：客户端页和 Node 客户端会按地址里写的前缀选择协议——`wss://` / `https://` 生成 `wss://`，
> 其余情况默认 `ws://`。AppApiProxy 在设置里切到 https 后，代理地址要写成 `wss://127.0.0.1:8884`；
> 浏览器第一次连接前需要先打开 `https://127.0.0.1:8884` 并信任自签名证书，否则会报「连接出错」。

### 0. 准备

1. 启动 AppApiProxy，在左侧勾选 **5030** 图标（WS 的唯一入口）。
2. 启动 ws-lab。
3. 需要按客户端套用延迟配置时，先取当前窗口的 UID：
   浏览器打开 `http://127.0.0.1:8884/_appmock/getAllPushClients`，取返回数组里的 `uid`。
   不传 UID 也能建链，只是不会命中该客户端的代理配置。

### 1. 建链、5030 入口与快照

| 操作 | 期望 |
| --- | --- |
| 客户端页切到「经 AppApiProxy」：目标 `127.0.0.1:8890`、路径 `/ws`、代理 `127.0.0.1:8884`、填 Mock UID，点「连接」 | 客户端页变为「已连接」；welcome 中 `path=/ws`，`query` 只剩业务参数（`__mock_host` / `__mock_uid` 已剥离），`handshake.host=127.0.0.1:8890` |
| 观察 App 左侧 | 5030 徽标为 1 且图标变绿；列表新增 WS 记录；取消勾选 5030 后该记录不显示 |
| 点击该记录 | 详情显示地址、状态「已连接」、时长、上行/下行字节、帧数、握手请求/响应头 |
| 刷新页面或新开窗口 | 徽标仍为 1（快照恢复），不会归零 |

### 2. 双向消息与详情工具栏

1. 客户端页发送文本，或发送二进制 Base64（如 `AQIDBA==`）。ws-lab 默认回显，因此详情里会同时出现 ↑ 和 ↓。
2. 打开 `http://127.0.0.1:8890/admin`，点击该连接选中目标，用「发送一次」推送文本/二进制，
   或用「开始定时推送」按间隔推送。
3. 期望：详情消息区实时追加帧（seq、方向、opcode、大小、相对时间），上方 `n / m` 计数同步；
   `跟随最新` 默认开启，关闭后可点「回到最新」。
4. 用工具栏验证过滤：全部/上行/下行、全部/文本/二进制/控制帧、关键词搜索；
   点击某帧可查看完整内容并复制。

### 3. 关闭码与关闭方

1. 控制台把 Close code 改为 `4001`、原因填 `lab closed`，点「关闭连接」。
2. 期望：客户端页断开；详情状态「已关闭」，显示关闭码 4001、原因和关闭方「上游关闭」；
   列表行显示「关闭 4001」；5030 徽标减 1，全部断开后徽标隐藏并恢复空态。

### 4. 子协议透传

客户端页「子协议」填 `graphql-ws` 后连接：

- ws-lab welcome 的 `handshake.protocol` 为 `graphql-ws`；
- App 详情状态旁显示子协议 `graphql-ws`。

### 5. 延迟配置

1. App 左侧客户端下拉选中目标客户端，延迟(ms) 填 `500`，点保存。
2. 再让该 UID 经代理建立连接。
3. 期望：上游握手成功后约 500ms 才向客户端回 101，客户端页从点击「连接」到「已连接」明显变慢。

### 6. 失败场景与错误码

失败连接也会进入列表（可用搜索框旁的清空按钮清理），详情顶部红色横幅显示错误码与中文解释：

| 操作 | 期望 |
| --- | --- |
| 代理模式清空「目标地址」后连接 | HTTP 400，`WS-E01` 目标缺失 |
| 目标改成 `127.0.0.1:1` | HTTP 502，`WS-E04` 上游连接失败 |
| 路径改成 `/not-ws`（ws-lab 对非 `/ws` 的 upgrade 返回 404） | HTTP 502，`WS-E06` 上游拒绝握手 |
| 目标改成 `ftp://127.0.0.1:8890` | HTTP 400，`WS-E03` 协议不支持 |
| 目标改成 `https://127.0.0.1:8890`（对端是明文 HTTP） | 通常为 `WS-E05` TLS 失败；若错误信息不含 TLS 关键字，可能归为 `WS-E04`，可展开原始错误确认 |

> `WS-E10`（>128 并发）、`WS-E11`（单帧 >50MB）属于防护上限，手工验证成本高，已由单测/集成测试覆盖。

### 7. 帧截断

连接建立后，在客户端页控制台发送超过 256KB 的文本（或超过 128KB 的二进制）：

```js
// 客户端页 DevTools 中执行
document.querySelector('#sendText').value = 'a'.repeat(300 * 1024)
document.querySelector('#sendTextBtn').click()
```

期望：App 详情中该帧带「已截断」标签，显示原始大小，内容只保留前 256KB（文本）/ 128KB（二进制）；
ws-lab 仍收到完整数据，说明代理只截断记录、不影响转发。

### 8. 自动化回归

```bash
yarn ws-lab:smoke   # ws-lab 自身 13 项契约检查
npm test            # 含契约、store、服务集成测试
```

`socket-proxy.integration.test.ts` 会直接 `startLabServer()` 后走真实握手、帧推送、关闭码、
`WS-E01` / `WS-E04` 等链路，不需要启动 Electron 或手动开 ws-lab。

### 故障排查

- 页面提示「连接出错」且 App 侧没有任何记录：多为协议不匹配。AppApiProxy 是 https 时，代理地址必须写
  `wss://127.0.0.1:8884`，用 `ws://` 会被 TLS 端口直接断开（Node 侧报 `ECONNRESET`，浏览器只显示「连接出错」）。
- wss 仍连不上：浏览器不会跳过证书错误。先把 `cert/server.crt` 装入系统「受信任的根证书」
  （`certutil -user -addstore Root cert\server.crt`），再完全重启浏览器；仍失败时改用
  `node-client.mjs --insecure`，或在 App 设置里把协议切到 http。
- 用局域网 IP 访问时证书仍报主机名错误：内置证书的 SAN 只覆盖 `localhost` / `127.0.0.1` / `::1`，
  需要为该 IP 单独签一张证书，或改用 http。
- 连接被代理拒绝并返回 400：检查目标地址是否填写，`x-mock-host` / `__mock_host` 不能为空。
- 列表没有记录：确认已勾选 5030，并检查搜索关键词是否把记录过滤掉了。
- 端口冲突：`PORT=9000 HOST=0.0.0.0 yarn ws-lab`，同时把目标地址改成 `127.0.0.1:9000`。
- 结束时 Ctrl+C 停止 ws-lab，并在 App 中清空调试记录。

## 说明

- 仅用于本地联调，没有鉴权；不要暴露到公网。
- HTTP 请求体上限 2MB，服务端日志保留 500 条。
- 心跳由服务端每 30s ping 一次，无响应连接会被终止。