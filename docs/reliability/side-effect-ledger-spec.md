# 副作用台账服务规格（Side-Effect Ledger Service Spec）

| 项 | 值 |
|---|---|
| 文档编号 | `REL-DOC-08` |
| 版本 | 1.0 |
| 状态 | 生效（随 `SPEC-02` 版本联动） |
| 角色 | SRE / 可靠性架构师 |
| 交付物 | `SPEC-02` D-2.8《副作用台账服务规格》 |
| 上游依据 | 设计文档 v2.6 §7.4.1 / §7.4 / §7.6 / §2.4 / §5.5 / §12；`SPEC-02` v1.0 §2.6 / §2.1；`SEC-069`、`SEC-070`、`SEC-073`；`PRD-007`；`CTR-001` v1.0 §1 C-2/C-5、§2.4、§3.1、§5.3 P-1 |
| 写作用域 | `docs/reliability/side-effect-ledger-spec.md`（排他） |
| 落实需求 | `REL-072`–`REL-075`（逐条落点见 §0） |
| 参数引用 | 待回填数值一律以 `PP-xx` 引用 `REL-DOC-02` |
| ID 说明 | `SEL-xx` / `LST-xx` 是文档内条目号，不属 `SPEC-00` §4.1 需求 ID 段 |

---

## 0. 落实的 REL 清单

| REL ID | 本文件落点 |
|---|---|
| `REL-072` | §3 写入时机（执行前）、§3.3 fail-closed |
| `REL-073` | §2 字段 schema、§4 查询接口 |
| `REL-074` | §5 恢复后阻断规则 |
| `REL-075` | §6 嵌套派发声明与注册拒绝 |

---

## 1. 定位与边界

| 项 | 内容 |
|---|---|
| 解决的问题 | 嵌套派发复用**外层持久调用**（`C43`）⇒ 恢复只能判定「外层结果未知」，无法定位内层哪几个副作用已发生；模型若重跑外层脚本，内层副作用会**整体重放** |
| 台账位置 | **域外**（不得域内自持）；域内只负责在调用前发起写入请求 |
| 等级 | **硬**：台账写入属最小审计集（`SEC-069`），写入失败即**拒绝该动作**（`SEC-070` 口径） |
| 覆盖对象 | 标记为**非幂等**的工具调用；幂等工具的调用不强制入账，但必须显式声明幂等性来源 |
| 不做 | 不做分布式事务；不做自动补偿；不替模型判断能否重试（重试判定属产品策略，见 §5） |

---

## 2. 条目字段 schema（`REL-073`）

| 字段 | 类型 | 必填 | 来源 | 说明 |
|---|---|---|---|---|
| `ledgerId` | string（ULID） | 是 | 台账服务生成 | 主键 |
| `tenantId` | string | 是 | 域令牌绑定值（`C51` 相邻、§4.2.1） | 分租户检索 |
| `isolationGroupId` | string | 是 | 域令牌绑定值 | 与 `SEC-073` 审计键一致 |
| `workspaceId` | string | 是 | 调用上下文 | 归属 |
| `agentId` | string | 是 | 调用上下文 | `SEC-073` 键维度（独立 Agent 作用域可复用 `serverName`） |
| `serverName` | string | 条件必填 | MCP connector（非 MCP 工具填工具插件名） | `SEC-073` 键维度 |
| `rawName` | string | 条件必填 | MCP 工具原名（非 MCP 工具同 `toolName`） | `SEC-073` 键维度 |
| `sessionId` | string | 是 | 调用上下文 | 查询键之一 |
| `turnId` | string | 是 | 调用上下文（`C-2`：域外请求必须携带 `turnId`） | **查询键之一** |
| `callId` | string | 是 | 内核工具调用标识 | **幂等键之一** |
| `toolName` | string | 是 | 最终工具名（`mcp__<serverName>__<rawName>` 为纯函数） | 按工具聚合 |
| `argsDigest` | string（SHA-256） | 是 | 参数摘要（**不落原文**；参数可见性归 `PRD-012` 的审批通道） | 重放比对 |
| `argsPreviewRef` | string | 否 | 指向审批前上报通道中已存的参数预览 | UI 显参数（`PRD-007`） |
| `targetResource` | object `{kind, id, region?}` | 是 | 工具声明（注册时提供，缺省即拒绝注册） | 冲突判定 |
| `nonIdempotent` | boolean | 是 | 工具声明 | `true` 时强制入账 |
| `nestedDispatch` | enum `inner_ledger_first` / `no_nonidempotent_effect` / `not_nested` | 是 | 工具声明（§6） | 未声明不得注册 |
| `checkpointRef` | string | 是 | 与检查点同一时机（外层副作用前已 `flush`，`CTR-001` §5.3 P-1） | 恢复折叠起点对齐 |
| `writtenAt` | 单调时间戳（域外）+ 墙钟 | 是 | 台账服务 | 时序 |
| `writeResult` | enum `ok` / `failed` | 是 | 台账服务 | `failed` ⇒ 调用被拒（§3.3） |
| `status` | enum `recorded` / `result_confirmed` / `result_unknown` / `blocked` / `released` | 是 | 见 §5.1 | 恢复后处置依据 |
| `confirmEventRef` | string | 否 | 结果落日志时的 `tool/result` 事件引用 | `result_confirmed` 的依据 |
| `epoch` | integer | 是 | 写所有权 epoch（`REL-DOC-07` §2 `MIG-06`） | 迁移后判定归属 |
| `recoveryId` | string | 否 | 恢复实例标识 | 恢复后批量扫描 |

### 2.1 键与索引

| 索引 | 键 | 用途 | 依据 |
|---|---|---|---|
| 主查询索引 | `(sessionId, turnId)` | 恢复后按会话 + 轮次取出全部未确认调用 | `REL-073` |
| 幂等索引 | `(tenantId, turnId, callId)` | 去重与重放判定（与 `REL-100` 同键口径） | `REL-072`、`REL-100` |
| 工具聚合索引 | `(tenantId, toolName, window)` | 「结果未知调用数」按租户 / 按工具计数 | `REL-071`、设计 §7.4.1 |
| 资源冲突索引 | `(tenantId, targetResource.kind, targetResource.id, status)` | 同资源未确认冲突检测 | 本文件定义（观测面） |

---

## 3. 写入时机（`REL-072`）

### 3.1 时序（不可调换）

```
工具调用被内核判定为需执行
  → [1] 判定工具 nonIdempotent
  → [2] 域外写入台账（写请求携带 tenantId/turnId/callId/toolName/argsDigest/targetResource）
  → [3] 台账 writeResult == ok ？
        否 → 拒绝该次调用（fail-closed，SEC-070 口径）+ 硬审计事件 + 硬告警
        是 → [4] 执行工具（沙箱内）
              → [5] 结果落日志（tool/result）→ status = result_confirmed
```

| 规则 | 内容 | 拦截点 |
|---|---|---|
| 前置 | 台账写入必须**先于**副作用执行 | 工具执行前的台账写入拦截点（preventive） |
| 检查点对齐 | 写入时机必须与检查点同一时机：**外层副作用前已 flush** | 检查点序列校验（`SOP` 顺序断言） |
| 禁止 | 出现「先执行后记台账」即失败 | 用例注入（§3.3） |
| 嵌套 | 内层副作用若声明 `inner_ledger_first`，则内层也必须先入账（§6） | 桥注册审查 + 运行期检查 |

### 3.2 与持久化的关系

| 项 | 规则 |
|---|---|
| 域内不落账 | 域内**不得**持久化台账副本（否则域内可被改写，违反 `D2`/`D15`） |
| 与 `append` / `flush` 的区别 | `append` 解析成功 ≠ 持久化；提交点是 `flush`（`CTR-001` §5.3 P-1）⇒ 台账检查点必须与 `flush` 屏障对齐，而非与 `append` 对齐 |
| 与恢复的关系 | 恢复**只**依据域外台账 + 会话日志；台账不可用时按 fail-closed 拒绝非幂等调用 |

### 3.3 fail-closed 判据

| 注入 | 期望 |
|---|---|
| 令台账写入失败（端点 5xx / 超时 / 拒绝） | 该工具调用被**拒绝**（工具未执行）；产生硬审计事件；`ledger.write.failed.count` +1 |
| 令台账写入慢（超过调用前置预算） | 同上（拒绝，不得「先执行后补写」） |
| 注入「先执行后记台账」的对照实现 | 即失败（不得合入） |

---

## 4. 查询接口（`REL-073`）

| 接口 | 入参 | 出参 | 用途 | 鉴权 |
|---|---|---|---|---|
| `GET /v1/internal/ledger` | `sessionId`（必填）、`turnId`（必填）、`status[]`（可选，默认全部未确认） | 条目数组（§2 字段全量 + `argsPreviewRef`） | 恢复后处置（§5）、UI 展示（`PRD-007`） | 域外服务间 mTLS + 域令牌校验租户一致 |
| `GET /v1/internal/ledger/summary` | `tenantId`、`window`、`groupBy ∈ {tool, turn, workspace}` | 计数聚合（`result_unknown` 数、`blocked` 数、`released` 数） | 指标 `turn.outcome_unknown.count{tenant,tool}` | 同上 |
| `POST /v1/internal/ledger/{ledgerId}/release` | `actor`、`confirmToken`（用户显式确认产物） | 更新后的条目（`status=released`） | 解除阻断（§5.3） | 产品侧用户身份 + 显式确认（`PRD-007`） |
| `POST /v1/internal/ledger/{ledgerId}/confirm` | `confirmEventRef` | `status=result_confirmed` | 结果落日志后关闭条目 | 域内上报 + 域外校验 |

| 约束 | 内容 |
|---|---|
| 分页 | 必须分页（`pageSize` 上限 500）；不得返回无界结果 |
| 不落原文 | 查询**不得**返回参数原文，仅摘要 + 预览引用（参数可见性口径见 `PRD-012`） |
| 审计 | 每次查询与解除阻断都必须写审计（含操作者） |
| 键口径 | 查询返回必须含 `SEC-073` 的全部键维度；缺维度即 schema 校验失败 |

---

## 5. 恢复后阻断规则（`REL-074`）

### 5.1 状态定义

| 状态 | 进入条件 | 允许的动作 |
|---|---|---|
| `recorded` | 台账写入成功，工具尚未执行 | 正常执行 |
| `result_confirmed` | `tool/result` 事件落日志 | 关闭 |
| `result_unknown` | 恢复时条目仍为 `recorded`（结果未落日志） | **禁止自动重试**；进入阻断（§5.2） |
| `blocked` | 阻断判定命中 | 仅允许用户显式确认后转 `released` |
| `released` | 用户显式确认（`PRD-007`） | 允许再次执行一次；执行后按正常路径转 `result_confirmed` |

### 5.2 阻断判定（由**产品策略**执行，不得由模型判断）

| 项 | 规则 | 拦截点 |
|---|---|---|
| 判定者 | 产品策略（域外），**不得**由模型自行决定是否重试 | 重驱动路径的台账前置查询（preventive） |
| 判定时机 | **在发出调用之前**命中台账（不是执行后补救） | 同上 |
| 判定式 | `blocked ⇔ exists(ledger entry where (tenantId,turnId,callId) matches AND status ∈ {recorded, result_unknown, blocked})` | 计算式 |
| 阻断率 | 对台账中「结果未确认」的调用，阻断率必须 = **100%** | 用例判据 |
| 例外 | 幂等且只读的操作不进入阻断；例外必须由工具声明 + 注册审查确认 | 桥注册审查 |
| 模型可见提示 | 内核只提供「结果未知…只重试只读或幂等操作…不要盲重试」的提示文本；该文本**不构成**强制 ⇒ 强制必须来自 §5.2 的判定 | 代码审查（不得以提示文本替代阻断） |

### 5.3 解除与重放

| 步 | 动作 | 断言 |
|---|---|---|
| 1 | UI 展示该次调用的参数（`argsPreviewRef`）并要求显式确认 | 未确认时后续**无任何自动重放**（后端日志无重试记录） |
| 2 | 用户确认 → `POST …/release` | 审计含操作者与时刻 |
| 3 | 允许再次执行（`status=released`） | 执行后必须有 `tool/result`；再次失败按 §5.2 重新阻断 |
| 4 | 参数不一致检测 | 重放时 `argsDigest` 与台账不一致 ⇒ 必须拒绝并提示（防止「以相同名义执行不同操作」） |

### 5.4 注入判据

| 注入 | 期望 |
|---|---|
| 工具已执行但结果未落日志时 SIGKILL，恢复后重新触发同调用 | 被策略阻断（阻断率 100%）且 UI 要求确认参数（`DRL-01` 判据 (c)） |
| 由模型自行决定重试的实现 | 即失败 |

---

## 6. 嵌套派发声明（`REL-075`）

| 项 | 规则 |
|---|---|
| 背景 | 嵌套派发**复用外层持久调用**（`C43`）⇒ 持久化粒度是外层调用，恢复无法定位内层副作用 |
| 强制声明 | 每个此类工具必须显式声明**二选一**：(a) `inner_ledger_first`（内层副作用先落台账）；(b) `no_nonidempotent_effect`（禁止执行非幂等副作用） |
| 未声明 | 注册桥**拒绝注册** + 硬告警 |
| 拦截点 | `ctx.tools.register` 入口（唯一注册入口，`C49`） |
| 校验用例 | 提交一个未声明的嵌套非幂等工具注册请求 ⇒ 被拒 + 硬告警（`DRL-X01` 变体） |
| 运行期校验 | 声明 (b) 的工具若实际产生非幂等副作用（按 `targetResource` 写操作探测）⇒ 摘域（单独审批）+ 硬审计 |
| 纵深 | 全局 `guard()` 只作纵深防御，**不**替代本声明审查（`CTR-001` §3.3） |

---

## 7. 指标与告警

| 指标 | 口径 | 级别 |
|---|---|---|
| `turn.outcome_unknown.count{tenant,tool}` | `status=result_unknown` 的条目数 | 硬告警条件的输入（`REL-071`） |
| `ledger.write.failed.count` | 台账写入失败次数 | 硬告警（属最小审计集不可用，`REL-124`） |
| `ledger.blocked.count{tenant,tool}` | 被阻断的调用数 | 通知 + 面板 |
| `ledger.released.count` | 用户显式确认后放行数 | 面板（审计报表输入） |
| `ledger.nested.undeclared.count` | 未声明嵌套工具的注册尝试数 | **硬告警**（不得降级） |

---

## 8. 与 SLO、演练的映射

| 机制 | 关联 | 演练 |
|---|---|---|
| 结果未知调用 | `REL-071` 事件 + 指标；与 `SLO-16` 面板并列 | `DRL-01` |
| 台账写入 fail-closed | 最小审计集可用性 `SLO-13` | `DRL-E05` |
| 阻断率 100% | `GATE-003` 条件 2 的验收输入 | `DRL-01` |
| 嵌套声明拒绝 | `REL-075` | `DRL-X01` |

---

## 9. 本文件不覆盖的部分

| # | 内容 | 归属 |
|---|---|---|
| 1 | 最小审计集成员定义与 fail-closed 行为本体 | `SEC-069`、`SEC-070` |
| 2 | 审计键五元组 / 六元组的定义 | `SEC-073` |
| 3 | 恢复横幅、参数确认 UI、自动化重试禁令的用户可见实现 | `PRD-006`、`PRD-007` |
| 4 | 工具注册桥的工程实现与 `guard()` 覆盖面结论 | `ENG-001`–`ENG-004`、`VER-002`（`CTR-001` §8 #1） |
| 5 | 检查点策略本体（模型请求前 / 顶层工具副作用前 / `agent/pre-step`） | 内核 `dsh-session-checkpoint-policy`（`C21`） |
| 6 | 台账服务的容量与存储选型 | 平台容量模型（`REL-DOC-06` §5） |
