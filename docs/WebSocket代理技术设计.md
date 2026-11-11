# WebSocket 代理技术设计

> 基于当前 AppApiProxy 的注册、代理、Mock、推送与 UI 架构，设计 WebSocket（含 WSS）流量的接入、转发、观测与后续 Mock 能力。

## 1. 结论摘要

| 决策 | 结论 |
|---|---|
| 入口 | 复用同一端口与 `/_proxy` 前缀，不新增端口；`ws(s)://代理地址/_proxy{原始Path}` |
| 目标识别 | 优先 `x-mock-host` / `x-mock-uid` 请求头；为浏览器等无法设置 WS 头的客户端增加 `__mock_host` / `__mock_uid` 查询参数兜底 |
| 转发方式 | 使用 `ws` 做消息级双向中继（文本/二进制/控制帧/子协议/关闭码），不做原始字节透传 |
| 记录粒度 | 一条连接 + 双向消息列表；按连接限流、限帧数、限体积，批量推送到 UI |
| UI | 复用现有列表筛选 `5030`，新增连接详情与消息面板，列表一行代表一条连接 |
| Mock | 分阶段：先只观测；再做握手级拒绝/伪造与脚本推送；最后做消息级匹配与状态机 |
| 不建议 | 自行实现 RFC 6455 帧解析、使用 `http-proxy` 直接透传、为 WS 单独开端口 |

已用仓库证书做过验证：`http2.createSecureServer({ allowHTTP1: true })` 在客户端 ALPN 选择 `http/1.1` 时会正常触发 `upgrade`，`http.createServer` 同样正常。浏览器 `WebSocket` 与 OkHttp WebSocket 默认都走 HTTP/1.1 握手，因此现有 HTTPS 服务可以直接承载 WS 代理。HTTP/2 的扩展 CONNECT（RFC 8441）不在本次范围。

## 2. 现状与约束

### 2.1 现有链路

- 服务端入口：[MainServer.ts](file:///D:/Repo/app-api-proxy/src/main/MainServer.ts)
  - HTTP 与 HTTPS 共用 `http2express(express)`，HTTPS 使用 `http2.createSecureServer({ allowHTTP1: true })`（`startHttpServer`，约 186–225 行）。
  - 代理挂载在 `API_URL.Proxy`（`/_proxy`），且明确不经过任何 body parser（约 143–184 行）。
  - 推送服务把 SockJS 安装到同一个 HTTP Server（`pushService.bindServer`，约 199 行）。
- HTTP 代理：[ProxyService.ts](file:///D:/Repo/app-api-proxy/src/main/service/proxy.service.ts)
  - `handleRequest` 读取原始请求体、推送 `REQUEST_START`、命中 Mock 或转发（约 104–168 行）。
  - `resolveTarget` 解析 `x-mock-host`、`dataServer`、base path（约 375–393 行）；`buildUpstreamHeaders` 逐跳头与身份头过滤（约 395–428 行）。
  - 响应侧记录上限 1MB、整体超时 15s、请求体上限 50MB（约 21–27 行）。
- 推送：[PushService.ts](file:///D:/Repo/app-api-proxy/src/main/service/push.service.ts)
  - SockJS 前缀 `/echo`；viewer 注册得到新 uid；设备通过注册地址接入并归属 viewer（约 30–107 行）。
  - `sendProxyMessage` 目前只接受请求记录/打点记录（约 48–58 行）。
- 数据模型：[proxy.models.ts](file:///D:/Repo/app-api-proxy/src/shared/proxy.models.ts)
  - `ProxyRequestRecord`（约 31–49 行）、`ClientInfo`（约 156–172 行）、`PorxyType`（约 212–218 行）。
  - 已有 `PorxyType.SOCKET = 5030`，UI 也保留了筛选图标，但主进程从未产生该类型数据。
- UI：
  - 列表筛选与详情路由：[Proxy.vue](file:///D:/Repo/app-api-proxy/src/renderer/pages/proxy/Proxy.vue) 约 5–16、64–69 行。
  - 列表记录渲染：[ProxyRecordSnap.vue](file:///D:/Repo/app-api-proxy/src/renderer/pages/proxy/ProxyRecordSnap.vue) 约 12–61 行。
  - 内存记录与淘汰：[ProxyRecords.ts](file:///D:/Repo/app-api-proxy/src/renderer/store/ProxyRecords.ts) 约 23–40、69–99 行。
- Mock：
  - 生效规则与命中入口：[mock.service.ts](file:///D:/Repo/app-api-proxy/src/main/service/mock.service.ts) 约 59–104 行。
  - 纯函数匹配器：[mock.matcher.ts](file:///D:/Repo/app-api-proxy/src/main/service/mock.matcher.ts) 约 775–793 行。
- 文档已明确当前限制：“不解析 WebSocket 帧；HTTP Upgrade 请求不在代理能力范围内”：
  [使用说明.md](file:///D:/Repo/app-api-proxy/docs/使用说明.md) 约 761 行。

### 2.2 约束

1. 不能破坏现有 HTTP/HTTPS 代理、Mock、SockJS 推送与 UI 注册流程。
2. 客户端接入方式必须尽量与现有约定一致：`x-mock-host`、`x-mock-uid`、同一端口。
3. 移动端调试场景下，长连接可能持续数小时，必须限制内存并支持优雅关闭。
4. 现有 HTTPS 证书为自签名，WS 客户端需要与 HTTP 一样信任代理证书。
5. 产品当前定位是“研发期接口代理与 Mock”，不是通用抓包工具，首版不追求逐帧字节级保真。

## 3. 目标与非目标

### 3.1 目标

- 通过现有代理服务接入 `ws://` 与 `wss://`，支持移动端、WebView、浏览器。
- 在 UI 中看到连接列表、握手信息、双向消息（文本/二进制/控制帧）、关闭码与耗时。
- 与 HTTP 一样按 uid 路由记录到对应 viewer/device，客户端断开后不残留。
- 为后续 WS Mock 留出稳定的数据模型与匹配入口。
- 服务重启、端口切换、应用退出时能关闭全部长连接，不阻塞 `server.close()`。

### 3.2 非目标（首个版本）

- HTTP/2 扩展 CONNECT（RFC 8441）与 HTTP/3 WebTransport。
- 原始帧级展示（分片、压缩前后的字节、掩码细节）。
- 在 UI 中手动发送消息、断点、逐帧改写（可作为后续能力）。
- WS 会话持久化、HAR 导出。
- 上游自签名证书的“跳过校验”开关（与当前 HTTP 策略保持一致）。

## 4. 总体方案

### 4.1 数据流

```
App/WebView/Browser
   │  wss://proxy:8884/_proxy/chat?room=1
   │  headers: x-mock-host: wss://api.example.com
   │           x-mock-uid: <uid>
   ▼
MainServer (http/https, allowHTTP1)
   │  upgrade 事件
   ▼
SocketProxyService
   │  1. 解析目标 host/uid，剥离代理参数
   │  2. 读取 dataServer / 设备延迟 / Mock 规则
   │  3. 连接上游 wss://api.example.com/chat?room=1
   ▼
上游 WebSocket Server
   ▲
   │  消息级双向中继
   ▼
PushService ── SockJS ──▶ Renderer Store ──▶ 连接列表 / 消息面板
```

### 4.2 为什么复用同一端口

- 现有二维码、注册地址、客户端配置只需要一套地址。
- SockJS 推送与 WS 代理路径互不冲突：SockJS 使用 `/echo`、`/notification`，WS 代理使用 `/_proxy`。
- 已确认 SockJS 对不匹配前缀返回 `false`，不会消费 `/_proxy` 的 upgrade：
  `node_modules/sockjs/lib/sockjs.js` 约 144–152 行。

### 4.3 转发方式选型

| 方案 | 能力 | 成本 | 结论 |
|---|---|---|---|
| `http-proxy` / 原生 socket 双向 pipe | 原始字节透传，保真度高 | 低 | 无法看到消息、无法 Mock，不满足产品需求 |
| 自行实现 RFC 6455 帧解析 | 帧级完全可控 | 高（分片、压缩、UTF-8、关闭握手） | 首版不划算 |
| `ws` 消息级中继 | 文本/二进制/控制帧/子协议/关闭码 | 低中 | 推荐 |
| `websocket-driver` 低层驱动 | 帧级可控，仍需自管握手 | 中高 | 作为后续帧级能力的备选 |

推荐 `ws`：它已在依赖树中（8.18.3），纯 JS，Electron 打包无原生模块问题，且能覆盖子协议、关闭码、ping/pong 与最大消息限制。代价是分片会被重组、压缩不透明、握手附加响应头能力有限，这些都可以接受并在文档中说明。

## 5. 客户端接入协议

### 5.1 地址与请求头

与 HTTP 完全一致：

```
wss://<代理地址>:<端口>/_proxy<原始Path><原始Query>
x-mock-host: <原始 WS 站点，可写 https:// 或 wss://>
x-mock-uid: <在线客户端 UID>
```

示例：

```
wss://192.168.1.10:8884/_proxy/chat/room/1?token=abc
x-mock-host: wss://api.example.com
x-mock-uid: 3f2c9a7e...
```

目标协议映射：

- `x-mock-host: https://api.example.com` → 上游 `wss://api.example.com`
- `x-mock-host: http://api.example.com` → 上游 `ws://api.example.com`
- `x-mock-host: wss://api.example.com` / `ws://...` → 原样使用

### 5.2 浏览器/无法设置请求头时的兜底

浏览器 `new WebSocket(url, protocols)` 不能设置自定义请求头。增加查询参数兜底（仅对 WS 生效）：

```
wss://proxy:8884/_proxy/chat?room=1&__mock_host=wss%3A%2F%2Fapi.example.com&__mock_uid=3f2c9a7e
```

规则：

- 请求头优先，查询参数仅作为兜底；两者同时存在时以请求头为准。
- `__mock_host` / `__mock_uid` 在转发上游与 Mock 匹配前必须被剥离，且不改变其余参数的顺序与编码。
- 这两个键在 WS 代理入口视为保留键；目标业务参数如确实同名，需要改用请求头方式接入。
- 查询参数兜底同时适用于 HTTP 代理是可选的后续增强，首版只做 WS，避免影响现有 HTTP 转发语义。

OkHttp 示例（在 Interceptor 中改写 WebSocket 握手请求）：

```kotlin
val proxyWs = proxyBase.replaceFirst("http", "ws")   // http->ws, https->wss
val origin = original.url.newBuilder()
    .scheme(if (original.url.isHttps) "wss" else "ws")
    .build()

val target = (proxyWs + "/_proxy" + original.url.encodedPath +
    (original.url.encodedQuery?.let { "?$it" } ?: "")).toHttpUrl()

val request = original.newBuilder()
    .url(target)
    .header("x-mock-host", origin.toString())
    .header("x-mock-uid", mockUid)
    .build()
```

浏览器示例：

```js
const proxy = 'wss://192.168.1.10:8884'
const target = new URL(origin) // wss://api.example.com/chat?room=1
const url = `${proxy}/_proxy${target.pathname}?${target.searchParams}`
  + `&__mock_host=${encodeURIComponent(target.origin)}`
  + `&__mock_uid=${encodeURIComponent(uid)}`
const ws = new WebSocket(url)
```

### 5.3 目标解析

新增 `SocketProxyService.resolveTarget(req)`，语义对齐 HTTP 的 `resolveTarget`：

1. 从请求头/查询参数取 `x-mock-host`、`x-mock-uid`。
2. 若该 uid 的代理配置启用且配置了 `dataServer`，用 `dataServer` 覆盖目标：
   - `http://` → `ws://`
   - `https://` → `wss://`
   - `ws://` / `wss://` 原样
3. 目标 base 的 pathname 作为前缀，拼上剥掉 `/_proxy` 后的原始路径。
4. 只允许 `ws:` / `wss:`（由 `http:` / `https:` 映射而来）；拒绝 `file:`、`unix:`、`data:` 等协议。
5. 缺少 host 时返回 400；uid 缺失时与 HTTP 保持一致：仍然转发，但不推送记录，并计入诊断。

注意：`upgrade` 事件中的 `req.url` 是完整路径（包含 `/_proxy`），与 Express 挂载点内 `req.url` 已剥离前缀不同，必须自行剥离一次，避免路径重复。

## 6. 服务端实现

### 6.1 新增服务

新增 `src/main/service/socket-proxy.service.ts`，在 `IocContainer` 注册单例：

- `bindServer(server: http.Server | https.Server | http2.Http2SecureServer)`：挂载 `upgrade` 监听。
- `handleUpgrade(req, socket, head)`：路径判断、参数解析、握手与转发。
- `closeAll(code = 1001)`：应用退出、端口/协议切换时关闭所有连接。
- `clearClientState(uid)`：客户端离线后清理该 uid 的推送队列；是否关闭连接见 6.6。

`MainServer` 中：

- `bootstrap()` 注入服务。
- `startHttpServer()` 在 `pushService.bindServer` 前后挂载均可，但必须做路径判断，避免消费 `/echo` 与 `/notification`。
- `stop()` 先 `socketProxyService.closeAll()`，再执行现有 HTTP 关闭流程，避免长连接让 `server.close()` 等到超时。

### 6.2 Upgrade 路由

```ts
server.on('upgrade', (req, socket, head) => {
  if (!isProxyPath(req.url)) return          // /echo、/notification 交给 SockJS
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') {
    abort(socket, 426, 'Upgrade Required')
    return
  }
  if (req.method !== 'GET') {
    abort(socket, 405, 'Method Not Allowed')
    return
  }
  this.handleUpgrade(req, socket, head)
})
```

`isProxyPath` 判断 `/_proxy`、`/_proxy?`、`/_proxy/` 三种形态；不要用 `includes`，避免误伤。

### 6.3 上游握手

推荐“先连上游、再完成客户端握手”，这样上游拒绝时客户端能收到真实的 HTTP 状态，而不是先 101 再断开。

实现要点：

- `new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 50 * 1024 * 1024 })`。
- `verifyClient(info, cb)` 中：
  1. 解析目标与 Mock 规则（首版只做转发）。
  2. 用 `ws` 客户端连接上游，`handshakeTimeout: 15000`、`followRedirects: false`、`rejectUnauthorized: true`。
  3. 把上游实例暂存到 `req` 上，供 `handleProtocols` 与 `connection` 使用。
  4. 成功则 `cb(true)`；上游返回非 101 则把状态码、响应头、错误体回传给 `cb(false, status, message, headers)`；连接失败/超时返回 502/504。
  5. 用 `settled` 标记防止客户端提前断开与回调重复。
- `handleProtocols(protocols, req)` 返回上游实际选择的子协议；上游未选择时返回 `false`，不要凭空选一个。
- `handleUpgrade(req, socket, head, ws => ...)` 完成客户端握手后，把两端按消息级中继接起来。

### 6.4 请求头转发

上游 `ws` 客户端自动生成 `Sec-WebSocket-Key/Version`、`Connection`、`Upgrade` 和压缩扩展，因此转发时需要过滤：

- 丢弃：`host`、`connection`、`upgrade`、`keep-alive`、`proxy-*`、`te`、`trailer`、`transfer-encoding`、`content-length`、`sec-websocket-key`、`sec-websocket-version`、`sec-websocket-accept`、`sec-websocket-extensions`、`x-mock-host`、`x-mock-uid`、`__mock_host`、`__mock_uid`。
- 子协议：从 `Sec-WebSocket-Protocol` 解析成数组，作为 `new WebSocket(url, protocols, options)` 的第二个参数传入。
- 保留：`cookie`、`authorization`、`origin`、`user-agent`、业务自定义头等。`Origin` 原样转发，避免破坏依赖 Origin 校验的服务。
- 头名/头值做合法性校验，非法头直接丢弃并记录诊断，避免 Node 抛错导致整条连接失败。
- 默认不增加 `x-forwarded-for`，保持与 HTTP 代理一致；后续可配置。

### 6.5 消息中继

```ts
client.on('message', (data, isBinary) => {
  record('c2s', data, isBinary)
  upstream.send(data, { binary: isBinary })
})

upstream.on('message', (data, isBinary) => {
  record('s2c', data, isBinary)
  client.send(data, { binary: isBinary })
})
```

- 控制帧：监听两端 `ping` / `pong`，记录到消息列表，但不互相转发；`ws` 会自动回 `pong`，语义等价。
- 关闭：一端 `close(code, reason)` 时，按可发送的关闭码关闭另一端。`1005`、`1006`、`1015` 不能作为发送码，遇到时改用 `1000` 或直接 `terminate()`。
- 错误：任一端 `error` 时记录诊断并终止两端，避免半开连接。
- 背压：消息级中继无法像 socket pipe 一样暂停。对 `bufferedAmount` 设置上限（建议 8MB），超限时以 `1013`（Try Again Later）关闭并记录原因，防止内存被单个慢消费者拖垮。
- 压缩：两端均关闭 `permessage-deflate`。这样消息内容可直接记录、注入与搜索；代价是不再对调试流量做压缩，带宽上升但内容语义不变。后续如需保真，可开启压缩并依赖 `ws` 自动解压，但记录与注入会复杂化。
- 心跳：首版不主动发业务 ping，避免影响移动端后台策略；依赖 TCP 与客户端自身心跳。后续可增加“服务端 ping 探活”开关。

### 6.6 生命周期与清理

- 客户端断开 → 关闭上游；上游断开 → 关闭客户端。
- 代理服务重启/退出 → `closeAll(1001)`。
- viewer 离线：HTTP 现有行为是继续转发但停推。WS 保持同样语义——不因 viewer 掉线而断开设备长连接，只停止向 UI 推送并清理该 uid 的待发送批次。
- 设备 uid 从注册表移除后同理，避免“调试器关掉导致 App 长连接断”这种副作用。
- 每条连接注册到 `SocketProxyService` 的 Map 中，关闭时务必删除；定时器 `unref()`，防阻止进程退出。

### 6.7 失败响应

`upgrade` 事件不经过 Express，需要自行写原始 HTTP 响应：

- 缺少 `x-mock-host`：400。
- 非 WebSocket Upgrade：426。
- 方法非 GET：405。
- 上游握手失败：502；超时：504；上游返回非 101：透传状态码与错误体（有上限）。
- 并发/连接数超限：503。

所有失败都要：
- 发 `recordRequest` / `recordError` 到诊断中心（method 记为 `WS`，便于接入向导定位）。
- 推一条连接结束记录到 UI（如果 uid 有效）。
- 确保 socket 只销毁一次。

## 7. 记录与推送模型

### 7.1 数据模型

继续使用 `PorxyType.SOCKET = 5030` 作为“连接”类型，新增阶段字段，避免破坏现有筛选：

```ts
export interface SocketFrame {
  seq: number
  dir: 'c2s' | 's2c'
  opcode: 'text' | 'binary' | 'ping' | 'pong' | 'close'
  at: number                 // 相对连接开始的毫秒数
  size: number               // 原始字节数
  data: string               // 文本原样；二进制 base64；超限截断
  encoding: 'utf8' | 'base64'
  truncated?: boolean
  mock?: boolean             // 后续 Mock 注入标记
}

export interface SocketRecord extends ProxyMock.ProxyRequestRecord {
  type: ProxyMock.PorxyType.SOCKET
  wsPhase: 'open' | 'frames' | 'close'
  wsId: number
  subprotocol?: string
  closeCode?: number
  closeReason?: string
  bytesSent?: number
  bytesReceived?: number
  frameCount?: number
  droppedFrames?: number
  frames?: SocketFrame[]      // 仅 frames 阶段携带
}
```

推送协议扩展：

- `PushService.sendProxyMessage` 的入参联合类型增加 `SocketRecord`。
- 连接 open/close 立即推送；消息按批次推送，避免每帧一次 SockJS 写入。

### 7.2 批量与限流

- 每连接维护待推送队列，首次入队后启动 100ms 定时器；达到 50 帧或 256KB 提前 flush。
- 队列上限建议 1000 帧 / 4MB；溢出丢弃最旧帧并累加 `droppedFrames`，在 UI 标注“已丢弃 N 条”。
- 单帧记录上限建议 256KB；超过则截断并保留原始大小。文本原样保存，二进制转 base64（体积增加约 33%，因此二进制建议更低上限，如 128KB）。
- 每连接帧数上限建议 500–2000，按产品实际调试深度取舍；首版用 1000。
- 全局连接数上限建议 128；超过返回 503，避免恶意或异常重连耗尽内存。
- 主进程只做必要的 base64 与截断，不在热路径 `JSON.parse` 文本帧；JSON 美化放到渲染层按需执行。

### 7.3 渲染层 Store

在 [ProxyRecords.ts](file:///D:/Repo/app-api-proxy/src/renderer/store/ProxyRecords.ts) 中扩展 `updateRecord`：

- `wsPhase === 'open'`：插入新行，`frames=[]`，`timelineColor` 与 HTTP 一致。
- `wsPhase === 'frames'`：只合并到已有连接，连接不存在则忽略（已被淘汰）。
- `wsPhase === 'close'`：更新 `statusCode`（关闭码）、`time`（持续时间）、字节数、丢弃数。
- 淘汰时连同嵌套 frames 一起释放；现有“当前选中项不淘汰”的策略保留。
- `visibleRecords` 的筛选逻辑基本不变：`5030` 仍表示连接类型，搜索匹配连接 URL。

## 8. UI 设计

### 8.1 列表行

复用 [ProxyRecordSnap.vue](file:///D:/Repo/app-api-proxy/src/renderer/pages/proxy/ProxyRecordSnap.vue)，对 `type === 5030` 渲染：

- `[WS]` 标签、目标 URL（显示原始目标，不显示代理地址）。
- 状态：`101` 绿色；异常关闭码红色；连接中显示进行中标识。
- 持续时间：连接中显示实时/占位，关闭后显示总时长。
- 消息计数：`↑N ↓N`，二进制/控制帧可合并计数。
- Mock 注入时复用现有 Mock 标识。
- 搜索只匹配连接 URL，消息内容搜索放在详情内，避免列表热路径遍历大 payload。

### 8.2 详情面板

新增 `SocketDetail.vue`，由 [Proxy.vue](file:///D:/Repo/app-api-proxy/src/renderer/pages/proxy/Proxy.vue) 在 `type === 5030` 时渲染。布局遵循项目现有的“固定头部 + 内容区内部滚动”原则：

1. 吸顶摘要：URL、状态、子协议、持续时间、上下行字节、帧数、关闭码/原因。
2. 握手信息：请求头、响应头折叠区，复用现有 header-list 样式。
3. 消息工具条：方向筛选（全部/上行/下行）、类型筛选（文本/二进制/控制帧）、关键字搜索、清空、跟随最新开关。
4. 消息列表：独立滚动容器，固定行高；每行展示相对时间、方向、opcode、大小、单行预览。
5. 消息详情：点击行打开抽屉或固定下方编辑区，使用 Ace 只读展示；文本按 JSON 尝试美化，二进制显示 base64（后续可切 hex）、支持复制。

交互细节：

- 默认“跟随最新”开启；用户手动上滚时自动暂停，并显示“回到最新”按钮，避免新帧把用户正在看的内容顶走。
- 选中某帧后，新帧到达不改变选中项；连接被淘汰时清空选中。
- 关闭按钮只终止本地查看还是断开连接，需要在 UI 上明确区分；首版不提供“断开连接”，避免误操作影响 App。
- 窄窗口下消息详情改为抽屉，列表保持全宽；不把整个页面滚动交给外层。

### 8.3 文案与空态

- 现有 `5030` 筛选从“有图标无数据”变为真实能力，更新使用说明中的已知限制。
- 空态区分“还没有 WS 连接”和“当前筛选无匹配”，并提示接入方式。
- 新增 i18n key：WS 类型、连接中、已关闭、子协议、上行/下行、文本/二进制/控制帧、丢弃提示、跟随最新等。

## 9. Mock 设计（分阶段）

### 9.1 阶段划分

| 阶段 | 能力 | 说明 |
|---|---|---|
| M1 | 只观测 | 连接与消息记录，不改变流量 |
| M2 | 握手级 Mock | 拒绝握手、返回自定义状态码/头/体；不连上游直接完成 101 并按脚本推送 |
| M3 | 消息级 Mock | 按内容匹配客户端消息，回复/关闭/丢弃；录制回放 |
| M4 | 状态机/场景 | 多步骤脚本、变量、延迟序列，与产品路线图的“场景 Mock”合并 |

### 9.2 规则归属

建议在现有 Mock 规则容器下新增“WebSocket 记录”文档，而不是把 WS 脚本塞进 HTTP 的 `MockRecord.response`：

- 继续复用规则（Rule）启用状态、`activeRuleOf`、导入导出与规则管理入口。
- 传输层匹配复用现有 matcher：握手按 `GET + host + path + query + headers` 归一化，增加 `protocol: 'ws'` 维度，避免 HTTP 规则误命中 WS 连接。
- 记录与脚本单独建模，HTTP 编辑器与校验逻辑保持不动；规则管理器增加“WebSocket”页签。
- 旧规则迁移时 `protocol` 默认 `http`，不影响现有行为。

### 9.3 脚本模型（建议）

```ts
interface SocketMockRecord {
  id: string
  ruleId: string
  name: string
  match: MockMatchRule & { protocol: 'ws' }
  mode: 'reject' | 'accept' | 'passthrough'
  handshake?: {
    statusCode: number
    headers: Record<string, string | string[]>
    body?: string
    subprotocol?: string
  }
  onOpen?: SocketMockMessage[]       // 连接建立后按延迟推送
  onMessage?: SocketMockReplyRule[]  // 收到匹配消息后的动作
}

interface SocketMockMessage {
  delayMs: number
  type: 'text' | 'binary' | 'close'
  data?: string
  encoding?: 'utf8' | 'base64'
  closeCode?: number
  closeReason?: string
}

interface SocketMockReplyRule {
  match: { type: 'text' | 'binary'; op: 'equals' | 'contains' | 'regex' | 'jsonPath'; value: string; path?: string }
  once?: boolean
  actions: SocketMockMessage[]
}
```

执行语义：

- `reject`：不连上游，直接返回配置的握手失败响应。
- `accept`：不连上游，完成 101（使用配置的子协议），按 `onOpen` 定时推送；收到消息按 `onMessage` 匹配并回复。
- `passthrough`：连上游，按 `onMessage` 拦截并回复/丢弃，其余透传；适合“只 Mock 某一条下行推送”的场景。
- 延迟：设备级 `delay` 只作用于握手与 Mock 消息，不逐帧拖延真实透传，避免改变业务时序。
- 定时器在连接关闭时全部清理；脚本总时长设上限（如 5 分钟）与消息条数上限（如 200 条）。
- 回放录制：从捕获的 `s2c` 帧生成 `onOpen` 初稿，保留相对时间与截断信息，用户可编辑后启用。

### 9.4 与 HTTP Mock 的互不影响

- matcher 增加协议维度后，HTTP 请求不会进入 WS 记录，WS 握手也不会命中 HTTP 记录。
- 同一个规则可以同时包含 HTTP 与 WS 记录；启用/切换规则对两者同时生效，符合“一个场景覆盖一组接口”的产品心智。
- WS Mock 命中在连接列表显示 `[MOCK]`，注入帧标记 `mock: true`；未命中仍可按现有诊断思路给出“最相似记录”。

## 10. 影响面与改动清单

| 文件 | 改动 |
|---|---|
| `package.json` / `yarn.lock` | 增加 `ws` 直接依赖与 `@types/ws`（当前仅为传递依赖） |
| `src/main/service/socket-proxy.service.ts` | 新增：upgrade 路由、目标解析、上游握手、中继、记录、限流、关闭 |
| `src/main/MainServer.ts` | 注入服务；`startHttpServer` 挂载 upgrade；`stop` 关闭全部 WS 连接 |
| `src/main/constants.ts` / `IocContainer.ts` | 注册 `SocketProxyService` |
| `src/shared/proxy.models.ts` | `SocketRecord`、`SocketFrame`、`wsPhase`、推送联合类型 |
| `src/main/service/push.service.ts` | `sendProxyMessage` 接受 WS 记录；批量推送 |
| `src/renderer/store/ProxyRecords.ts` | 处理 open/frames/close 三个阶段与嵌套帧淘汰 |
| `src/renderer/pages/proxy/Proxy.vue` | `5030` 路由到新详情组件 |
| `src/renderer/pages/proxy/ProxyRecordSnap.vue` | WS 连接行渲染 |
| `src/renderer/pages/proxy/SocketDetail.vue` | 新增：握手、消息列表、消息详情、筛选 |
| `src/lang/zh-CN.ts` / `en.ts` | 新增文案 |
| `docs/使用说明.md` | 接入示例、限制更新、故障排查 |
| Mock 阶段另涉及 | `mock.models.ts`、`mock.validation.ts`、`mock.matcher.ts`、`mock.repo.ts`、`mock.cache.ts`、`MockRuleMgr.vue` 等 |

可选重构：把 `resolveTarget` 与逐跳头过滤抽成 HTTP/WS 共用模块，保证 `dataServer`、base path、头过滤语义一致；若担心回归，首版可先复制少量逻辑并加对角测试，后续再合并。

## 11. 测试计划

### 11.1 单元测试

- 目标解析：header/query 优先级、`http(s)` 到 `ws(s)` 映射、`dataServer` 覆盖、base path 拼接、`/_proxy` 剥离。
- 查询参数剥离：顺序、编码、重复键不受影响；保留键与业务键同名时的行为。
- 头过滤：逐跳头、身份头、WS 握手头、非法头名/值。
- 子协议选择：客户端无、单值、多值；上游未选、选了非客户端提供的值。
- 关闭码传播：可发送码、`1005/1006/1015` 映射、异常断开。
- 记录截断与批量边界：单帧上限、批次上限、队列溢出计数。

### 11.2 集成测试

使用本地 `ws` echo server 覆盖：

- 文本、二进制、1MB 以上消息、分片消息、连续高频消息。
- 自定义请求头、Cookie、Authorization、Origin、子协议。
- 上游 401/403/500、上游不可达、握手超时、上游握手后立即断开。
- 客户端主动断开、客户端网络中断、两端同时关闭。
- 代理端口/协议切换、应用退出时全部连接关闭且无定时器残留。
- SockJS 推送与 WS 代理同时工作；HTTP/2 页面请求不回归。

### 11.3 手工与压力

- OkHttp 示例 App：注册、连接、断线重连、前后台切换。
- 浏览器示例：query 参数兜底、`wss` 自签名证书信任。
- 压力：20 条连接 × 50 帧/秒 × 1KB，持续 10 分钟；观察主进程内存、UI 帧率、SockJS 延迟、记录淘汰是否符合预期。
- 异常：超大 payload、非法 UTF-8、ping 风暴、快速重连。

## 12. 风险与取舍

| 风险 | 影响 | 应对 |
|---|---|---|
| HTTP/2 客户端无法 Upgrade | 连接失败 | 明确要求 HTTP/1.1 握手；文档与错误码提示；后续评估 RFC 8441 |
| 消息级中继丢失分片/压缩细节 | 无法做字节级分析 | 首版明确“消息级”；后续可加帧级 tap 或 raw 模式 |
| `ws` 无法转发上游 101 的附加响应头（如 Set-Cookie） | 部分鉴权流程异常 | 首版记录但不转发；有强需求时改为自定义握手完成逻辑 |
| UI 被高频消息刷爆 | 卡顿、内存增长 | 批量推送、帧数/体积上限、跟随最新开关、淘汰提示 |
| 客户端自动重连产生大量连接行 | 列表被刷屏 | 连接数上限；后续增加“重连聚合” |
| 上游自签名证书 | 握手失败 | 与 HTTP 当前策略一致；后续增加按 uid 的跳过校验开关 |
| 代理本身是开放中继 | 局域网内可被滥用 | 与现有 HTTP 代理同风险；文档提示仅限可信研发网络 |
| 关闭长连接不彻底 | 端口切换卡住 | `closeAll` + 现有 `closeAllConnections` 兜底；定时器 `unref()` |

## 13. 分期与估算

| 阶段 | 内容 | 估算 |
|---|---|---|
| P0 技术验证 | 已完成 upgrade 验证；再验证 `ws` 中继、子协议、SockJS 共存 | 1–2 人日 |
| M1 观测 MVP | upgrade 路由、目标解析、中继、连接/消息记录、列表与详情、限流、清理、文档 | 4–6 人日 |
| M2 握手 Mock | WS 记录存储、拒绝/伪造握手、脚本推送、录制回放 | 4–6 人日 |
| M3 消息 Mock | 消息匹配、回复/丢弃、二进制、规则编辑器与诊断 | 6–10 人日 |
| M4 场景化 | 状态机、变量、多步骤时序 | 单独评估 |

建议先交付 M1：它能把现有“WebSocket 筛选图标无数据”的产品债一次清掉，并为 M2/M3 验证真实用户需求与消息形态。

## 14. 待确认问题

1. 首批用户主要在 OkHttp/原生还是 WebView/H5 中使用 WS？这决定 query 兜底与请求头方案哪个先做。
2. 是否需要逐帧（分片/压缩前）保真？若不需要，`ws` 消息级方案可以直接落地。
3. WS Mock 是否必须与 HTTP 共用同一个“启用规则”？当前建议共用规则、记录分文档。
4. 101 响应上的 `Set-Cookie` 等附加头是否有业务依赖？若有，需要在 M2 评估自定义握手。
5. M1 是否需要“手动断开连接”或“发送消息”作为调试手段？当前建议不做，避免误伤业务连接。