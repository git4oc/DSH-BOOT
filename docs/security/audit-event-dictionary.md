# 最小审计集事件字典

| 项 | 值 |
|---|---|
| 文档编号 | `SEC-DOC-07` |
| 交付物 | `SPEC-01` §3 交付物 7 |
| 版本 | 1.0 |
| 状态 | 生效 |
| 上游依据 | 设计文档 v2.6 `D2` / `D15` / `C11` / §2.4 / §5.5 / §6.3 / §7.1 / §9.2；`CTR-001` §1 C-5、§4.2、§6「审计」；`SPEC-00` §7.2、§7.4 |
| 落实的 `SEC-*` | `SEC-069`、`SEC-070`、`SEC-073`；配套 `SEC-071`、`SEC-072`、`SEC-074`、`SEC-075`、`SEC-076`、`SEC-077`、`SEC-097` |
| 实现落点（引用） | `ENG-028`、`ENG-041`、`GATE-002-C13`～`C15`、`GATE-003` 条件 2/3 |
| 边界 | 审计**容量与吞吐**参数归 `SPEC-02`（`REL-052`–`REL-059`、`REL-099`）；本文件只定义**记什么、键是什么、记不下时拒绝什么**。交付物 8（哈希链与取证导出**工具**）由 `SPEC-03` 实现，本文件给格式 |

---

## 1. 最小审计集成员（六类，封闭集）

`SEC-069` 的六类即下表六行；**不得**新增 fail-closed 事件类型。新增一类必须走 `SEC-00` §8 变更控制。

| # | 事件类型（固定字符串） | 语义 | 权威来源（`SEC-071`） | 存储 | `GATE-*` |
|---|---|---|---|---|---|
| A1 | `credential.issued` | 凭证签发（含例外令牌） | 域外凭证代理 / 数据面代理 | WORM | `GATE-002` 条件 4 |
| A2 | `egress.authorized` | 出站授权（模型、工具、MCP 出站） | 域外反向网关 / MCP 出站代理 | WORM | `GATE-002` 条件 5 |
| A3 | `security.mode_changed` | 沙箱模式、`permission/preset`、审批策略变更（同一类，`changeKind` 区分） | 域外控制面 | WORM | `GATE-002-C14` |
| A4 | `approval.decided` | 审批决策（含超时与 `unavailable` 终态） | 域外审批服务（域内上报仅补充） | WORM | `GATE-002-C15` |
| A5 | `tool.register.denied` | 白名单外注册尝试 | 域内桥产生 + **域外**落库 | WORM | `GATE-002` 条件 1 |
| A6 | `attest.failed` | attest 比对失败/服务不可用 | 域外 attest 服务 | WORM | `GATE-002` 条件 3 |

---

## 2. 公共信封字段（六类均含；缺失即拒绝写入）

| # | 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|---|
| G-01 | `eventId` | string (ULID) | 是 | 全局唯一 |
| G-02 | `eventType` | enum | 是 | 取 §1 六个固定字符串之一 |
| G-03 | `schemaVersion` | string | 是 | 形如 `1.0`；与写入路径版本一致 |
| G-04 | `occurredAt` | string | 是 | UTC ISO-8601，含毫秒；带 `clockSource` 与 `clockSkewBoundMs` |
| G-05 | `receivedAt` | string | 是 | 域外落库时间（域外时钟） |
| G-06 | `authority` | enum | 是 | 权威来源组件名（§1 第 4 列） |
| G-07 | `outcome` | enum | 是 | `allow` / `deny` / `error` |
| G-08 | `reasonCode` | string | 是 | 机器码（如 `allowlist.miss`、`token.ttl_exceeded`） |
| G-09 | `requestId` | string | 是 | 与反向通道一致 |
| G-10 | `tenantId` | string | 是 | 见 §3 键 |
| G-11 | `isolationGroupId` | string | 是 | 见 §3 键 |
| G-12 | `workspaceId` | string | 见 §3 | 该事件适用时必须存在 |
| G-13 | `turnId` / `callId` | string | 见 §3 | 适用时必须存在 |
| G-14 | `enforcement` | enum | 是 | `full` / `partial`（`SEC-097`：`!= full` 必须打标） |
| G-15 | `prevHash` / `hash` | string | 是 | 哈希链（§6） |
| G-16 | `signature` | string | 是 | 域外签名密钥签发的链段签名 |
| G-17 | `retentionClass` | const | 是 | `worm-1y`（默认 ≥ 366 天） |

---

## 3. 审计键：六字段集合（沿用"五元组"这一名称）

**字段集合（封闭）**：`(tenantId, isolationGroupId, workspaceId, agentId, serverName, rawName)`。名称沿用设计 §5.5 与 `CTR-001` C-5 的「五元组」，实际为**六字段**。

| 事件类 | `tenantId` | `isolationGroupId` | `workspaceId` | `agentId` | `serverName` | `rawName` |
|---|---|---|---|---|---|---|
| A1 `credential.issued` | 必 | 必 | 不适用 | 不适用（若例外子进程随会话，则必填） | 例外时必填 | 不适用 |
| A2 `egress.authorized` | 必 | 必 | 必（工具出站）/ 不适用（模型出站，用 `sessionId` 替代位） | 适用时必填 | MCP 出站必填 | MCP 出站必填 |
| A3 `security.mode_changed` | 必 | 必 | 必 | 不适用 | 不适用 | 不适用 |
| A4 `approval.decided` | 必 | 必 | 必 | 必 | 必（MCP 工具） | 必（MCP 工具） |
| A5 `tool.register.denied` | 必 | 必 | 必 | 必（scoped 注册时） | 必（MCP 来源时） | 必 |
| A6 `attest.failed` | 必 | 必 | 不适用 | 不适用 | 不适用 | 不适用 |

**校验规则**：事件类要求"必"的维度缺失 ⇒ **schema 校验拒绝写入**，并回以 `audit.schema.invalid`；该记录不得落库（不产生"不合规记录"）。「不适用」的维度**不得**以空串或 `null` 之外的占位填充。

---

## 4. 逐类字段字典

### A1 `credential.issued`

| 字段 | 类型 | 必填 | 判定 |
|---|---|---|---|
| `credentialRef` | string | 是 | 仅引用；**不得**出现凭证值 |
| `connectorName` | string | 例外时必填 | 匹配 `^[A-Za-z0-9_-]{1,32}$` |
| `tokenKind` | enum | 是 | `session-lease` / `exception-token` / `domain-token` |
| `tokenBinding` | string[] | 是 | 会话租约：`(tenantId, isolationGroupId)`；例外：**六元组** `(tenantId, isolationGroupId, sessionId, turnId, callId, connectorName)` |
| `ttlSeconds` | integer | 是 | `≤ 300` |
| `audience` | string | 是 | 数据面代理标识（例外）/ 网关标识 |
| `exceptionId` | string | 例外时必填 | 须存在于 `SEC-DOC-05` §3.2 登记表 |
| `complianceListRef` | string | 例外时必填 | 合规清单条目引用 |
| `issueCapRemaining` | integer | 例外时必填 | ≥ 0；为 0 时本次签发必须已被拒 |

### A2 `egress.authorized`

| 字段 | 类型 | 必填 | 判定 |
|---|---|---|---|
| `channel` | enum | 是 | `llm` / `tool` / `mcp` |
| `destination` | string | 是 | 网关/代理标识（**不得**记录上游凭证或完整 URL 含凭据） |
| `mcpServerName` / `mcpRawName` | string | `channel=mcp` 时必填 | 键维度 |
| `toolName` | string | `channel=tool` 时必填 | 与 `toolAllowlist` 精确匹配 |
| `allowlistHit` | boolean | `channel=tool` 时必填 | 值必须为 `true`（为 `false` 时该次出站必须已被拒） |
| `policyDecision` | enum | 是 | `allow` / `deny` |

### A3 `security.mode_changed`

| 字段 | 类型 | 必填 | 判定 |
|---|---|---|---|
| `changeKind` | enum | 是 | `sandbox-mode` / `permission-preset` / `approval-policy` |
| `oldValue` / `newValue` | string | 是 | 逐字取值；`enforcement` 一并记入 |
| `requestSource` | enum | 是 | `domain-external-approval` / `control-plane` / `domain-internal` |
| `authorized` | boolean | 是 | `requestSource = domain-internal` 时**必须**为 `false`，且必须已触发漂移判定 |
| `driftDetectedAt` | string | `authorized=false` 时必填 | 60 s 内判漂移并进入摘域流程 |

### A4 `approval.decided`

| 字段 | 类型 | 必填 | 判定 |
|---|---|---|---|
| `approvalId` | string | 是 | 每次调用**新的** ID（不得跨 `callId` 复用） |
| `callId` | string | 是 | 与 `tool.call` 一致 |
| `toolName` | string | 是 | 与内核载荷逐字相同 |
| `decision` | enum | 是 | `allowed-once` / `rejected` / `cancelled` / `unavailable` / `timeout`（**闭合词表**） |
| `decidedBy` | string | 决策人为人时必填 | 角色或主体标识（**不得**写入 `displayReason`） |
| `waitedMs` | integer | 是 | 审批等待时长 |
| `argsDigest` | string | 是 | 与 `SEC-DOC-06` §1 上报值逐字节相同 |
| `argsPreviewPresent` | boolean | 是 | 参数通道是否送达 |
| `sandboxPermissionsRequested` | string | 请求升权时必填 | 解析不到该字段时**必须**为 `unavailable` 或 `rejected` |
| `justificationPresent` | boolean | 请求升权时必填 | 同上 |

**禁止字段**：`displayReason`（`CTR-001` §4.2：仅本地化展示，**绝不**写入审批审计事件）；原始参数全文；凭证值。

### A5 `tool.register.denied`

| 字段 | 类型 | 必填 | 判定 |
|---|---|---|---|
| `rawName` | string | 是 | 被拒的注册名（原始名） |
| `fullToolName` | string | 是 | 最终工具名（`mcp__<serverName>__<rawName>` 或插件工具名） |
| `source` | enum | 是 | `mcp-discovery` / `scoped-registration` / `dynamic-registration` / `plugin-load` |
| `allowlistDigest` | string | 是 | 判定所用的只读 Profile 白名单摘要（证明判定源来自域外下发） |
| `counterAfter` | integer | 是 | `bridge_register_denied_total` 自增后的值 |

### A6 `attest.failed`

| 字段 | 类型 | 必填 | 判定 |
|---|---|---|---|
| `trigger` | enum | 是 | `boot` / `tools-change` / `heartbeat` |
| `expectedDigest` / `actualDigest` | string | 是 | 域外已知摘要 vs 域上报摘要 |
| `mismatchFields` | string[] | 是 | 如 `rows[]`、`tools[].schemaHash`；为空时 `outcome` 必须为 `error`（服务不可用） |
| `response` | enum | 是 | `deny` / `resync-profile` / `drain-domain` |
| `crossCheckOnly` | const | 是 | 固定 `true`（`D15`：域内自报不防篡改，不得作唯一依据） |

---

## 5. fail-closed 行为表（`SEC-070`）

**判定规则**：审计写入失败 ⇒ **该动作本身不发生**。不得"先执行后补记"。

| 事件类 | 审计不可用时的动作结果 | 拒绝码 | 用户/调用方可见 | 降级级别 | 注入用例断言 |
|---|---|---|---|---|---|
| A1 `credential.issued` | **凭证不签发** | `audit.unavailable:credential` | 401/403 语义的失败 | **L3**（`REL-044`(c)） | 无凭证返回；无上游连接；告警产生 |
| A2 `egress.authorized` | **出站不放行** | `audit.unavailable:egress` | 503 语义的失败 | **L3** | 无出站连接建立；请求被拒 |
| A3 `security.mode_changed` | **模式与 preset 变更不生效** | `audit.unavailable:mode` | 变更请求失败 | **L3** | 生效模式不变；无 `sandbox/mode` 事件落库 |
| A4 `approval.decided` | **审批不成立** | `audit.unavailable:approval` | 参数上下文缺失用 `COPY-006`；其余结论用 `COPY-028`（三种场景共用词干「本次调用未执行」） | **L3** | 返回 `unavailable`；工具未执行 |
| A5 `tool.register.denied` | **工具不注册** | `audit.unavailable:register` | 工具不出现在可见集 | **L3** | 工具名不在 `GET /v1/sessions/{id}/tools` |
| A6 `attest.failed` | **拒绝 ready** | `audit.unavailable:attest` | 域不 ready | **L3** | 域不接收任何会话 |

**注入方式（门禁证据）**：停掉审计写入后逐类触发一次；六类动作全部**未发生**，且产生告警（`SEC-070` 判据）。

---

## 6. 只追加存储、哈希链与签名（`SEC-072`、`SEC-074`）

| 项 | 规定 |
|---|---|
| 存储模型 | 只追加（WORM）；**不得**提供就地修改或删除接口（应用侧） |
| 链算法 | `hash = SHA-256( prevHash ‖ canonicalJSON(event \ {hash, signature}) )`，`canonicalJSON` = JCS（RFC 8785） |
| 链起点 | 每个 `(tenantId, retentionClass)` 一条独立链；链首 `prevHash = "GENESIS"` |
| 签名 | 链段由**域外**密钥签名；密钥不落域 |
| 生命周期 | 默认留存 ≥ 366 天（`SEC-076`）；只能按合规流程处置；与 DSR 冲突按 `SEC-085` 假名化 |
| 导出 | 可按 `(tenantId, 时间窗)` 导出取证包；导出物含 `{recordCount, chainHead, chainTail, signatureRef, verifyInstructions}` |
| 独立校验 | 校验器在**无域访问权限**的主机上运行；未篡改通过、改动 1 byte 失败 |
| 校验输出（固定字段） | `{ok, recordCount, chainHeadHash, chainTailHash, firstBrokenAt}` |

---

## 6.1 时钟偏差上界（`SEC-009`）

| 项 | 规定 |
|---|---|
| 必须交付的值 | 域内与域外时间源的偏差 **P99 上界**（毫秒），及测量方法（NTP/chrony 实测）与采样窗口 |
| 登记位置 | 平台配置项 `clockSkewBoundMs`，随证据记录与审计事件一并落库 |
| 未定义时的判定 | 任何依赖域内时间戳的判定（审计时延、租约 TTL 到期）**必须**标为 `不可判定`（`undeterminable`），**不得**静默计入通过 |
| 超界行为 | 域内时钟偏差超过该上界 ⇒ 该域样本标记 `clock_skew_exceeded`，单列统计，不计入时延 SLO 分子 |
| 验收 | 注入"域内时钟快 10 s"：样本被标记 `clock_skew_exceeded` 并单列；`clockSkewBoundMs` 有数字且已登记 |
| 接口 | 上界值与测量点口径由 `SPEC-02`（`REL-017`）承载；本文件只要求该值**必须存在**并在事件字段 G-04 中携带 |

---

## 7. 非最小集事件（可缓冲，**不得** fail-closed）

| 类别 | 处置 | 墓碑 |
|---|---|---|
| 一般审计（会话/轮次、模型调用、MCP 连接与调用、注入过滤、沙箱执行、平台事件） | 本地缓冲 + 域外异步消费；压力下有界丢弃 | `reconciled:false` 墓碑，字段见 `REL-056` |
| 计费与用量 | 与审计**各自独立缓冲**（独立水位、独立告警、独立丢弃计数） | 同上；`reconciled:false` 必须在用量导出中可见 |
| 副作用台账（`REL-072`） | **硬**（属最小审计集）：写入失败 ⇒ 该工具调用被拒 | — |

**边界声明（对外必须逐字包含）**：「对账可以发现**不一致**，**不能发现伪造**。」逐字文本与载体见 `SEC-DOC-10` §2。

---

## 8. 本文件不覆盖

| # | 内容 | 去向 |
|---|---|---|
| 1 | 缓冲容量、吞吐、SLO、补传令牌桶参数 | `SPEC-02`（`REL-052`–`REL-059`、`REL-099`） |
| 2 | 哈希链与取证导出**工具**的实现（交付物 8） | `SPEC-03`（`ENG-048` 相邻）；本文件给格式 |
| 3 | 历史查询服务的 RBAC 实现（`SEC-077`） | `SPEC-03` / `SPEC-04` |
