# 轮次截止时间配置与看护规范（Turn Deadlines）

| 项 | 值 |
|---|---|
| 文档编号 | `REL-DOC-10` |
| 版本 | 1.0 |
| 状态 | 生效（随 `SPEC-02` 版本联动） |
| 角色 | SRE / 可靠性架构师 |
| 交付物 | `SPEC-02` D-2.10《轮次截止时间配置与看护规范》 |
| 上游依据 | 设计文档 v2.6 §4.4 / §4.4.1 / §4.7 / §6.2 / §6.3 / §12；`SPEC-02` v1.0 §2.8 / §2.1；`CTR-001` v1.0 §1 C-6 / §2.4 / §4.2–§4.6；`contracts/profile.schema.json` v1（`deadlines`、`x-ov-semanticChecks` `PC-001`/`PC-002`）；`PRD-017`、`PRD-012`；`ENG-043`、`ENG-046`、`ENG-062` |
| 写作用域 | `docs/reliability/turn-deadlines.md`（排他） |
| 落实需求 | `REL-102`–`REL-110`（逐条落点见 §0） |
| 参数引用 | 待回填数值一律以 `PP-xx` 引用 `REL-DOC-02` |
| ID 说明 | `TD-xx` / `CHK-xx` 是文档内条目号，不属 `SPEC-00` §4.1 需求 ID 段 |

---

## 0. 落实的 REL 清单

| REL ID | 本文件落点 |
|---|---|
| `REL-102` | §1 Profile 字段对齐与大小关系校验 |
| `REL-103` | §2.1 `T_a` 生效点与超时行为 |
| `REL-104` | §2.4 审批指标与按租户聚合 |
| `REL-105` | §2.2 `T_m` 生效点、重试声明 |
| `REL-106` | §6 工具超时协作式语义与准入审查 |
| `REL-107` | §2.3 `T_turn` 看护与取消释放 |
| `REL-108` | §3 进展事件白名单与挂死判定 |
| `REL-109` | §5 取消后释放检查点与准入预算 |
| `REL-110` | §7 注入旋钮、§8 变更重跑矩阵 |

---

## 1. Profile `deadlines` 对齐（`REL-102`）

### 1.1 字段（唯一来源：`contracts/profile.schema.json` ⇒ 本文件**不得**另立键名）

| Profile 字段 | 语义 | 约束 | 本文件使用的符号 |
|---|---|---|---|
| `deadlines.approvalSeconds` | 审批应答预算 | integer，`60 ≤ x ≤ 120`，default `90` | `T_a` |
| `deadlines.modelStreamSeconds` | 单次模型流**含重试**总预算 | integer，`≥ 1` | `T_m`（取值见 `PP-32`） |
| `deadlines.turnSeconds` | 轮次总预算 | integer，`1 ≤ x ≤ 900`（15 min） | `T_turn` |

### 1.2 校验（preventive）

| 校验 ID | 规则 | 拦截点 | 失败后果 |
|---|---|---|---|
| `TD-01` | 三字段**必填**（`deadlines` 为 Profile 必填对象） | Profile schema 校验（`ENG-062`） | 域拒绝 ready |
| `TD-02` | `T_a < T_turn` | 语义检查 `PC-001`（表驱动校验器，`ENG-025`/`ENG-045`） | 域拒绝 ready |
| `TD-03` | `T_m < T_turn` | 语义检查 `PC-002` | 域拒绝 ready |
| `TD-04` | 三组字段必须列入域启动自检项清单 | `ENG-040` 自检项清单检索 | 自检项缺失即失败 |
| `TD-05` | 删除 `deadlines` 字段（含删任一子字段） | 校验用例 | 域**拒绝 ready**（不是回落默认值） |
| `TD-06` | 运行期读取必须来自 Profile，**不得**来自本地默认或环境变量覆盖 | 代码审查 + 配置注入用例 | 出现第二来源即失败 |

---

## 2. 三层生效点与超时行为

### 2.1 `T_a` 审批应答（`REL-103` / `REL-104`）

| 项 | 内容 |
|---|---|
| 生效点 | **域外审批请求投递完成**（请求已写出到域外审批端点） |
| 为什么自持 | 内核 `ctx.approval` **无审批超时**；只有 abort 才产生 `cancelled`（`C40`、`CTR-001` §4.4）⇒ 黑洞连接必须由域外看护定时器收敛 |
| 看护者 | 域外审批看护定时器（preventive） |
| 超时行为 | 收敛为 `timeout`（域外扩展取值）且 **fail-closed**：本次调用被拒，工具**未执行** |
| 返回词表（封闭） | `allowed-once` / `rejected` / `cancelled` / `unavailable` / `timeout`；词表外取值即 CI 失败（`ENG-009`） |
| 状态机 | `pending → decided{…} → consumed`（`CTR-001` §4.6）；跨 `callId` 授权复用**禁止**（`C8`） |
| 定序 | 同 `callId` 的 `tool.call` 必须**先于** `approval.requested` 投递（`ENG-012`） |
| 对客文案 | `T_a` 超时文案与默认值以 `PRD-017` 为准（逐字），本文件不复制措辞 |
| 观测面 | `PP-07` 时钟偏差上界影响等待时长可比性；参数预览体积上限的观测面见 `PRD-012` |

### 2.2 `T_m` 模型流（`REL-105`）

| 项 | 内容 |
|---|---|
| 生效点 | **反向网关侧对上游流的看护**（域外计时；适配器遵守 `options.signal`） |
| 预算语义 | 含**重试**的总预算；重试由可选插件 `dsh-llm-retry` 执行 |
| 声明义务 | 必须显式声明该插件**是否挂载**及其 `retryableCodes` / backoff 预算（未声明即失败） |
| 超时行为 | **fail-closed** 中断本轮；abort 必须在 TTFB 前生效并取消网关侧上游连接 |
| 终止区分 | 下行必须有显式终止帧区分「正常结束 / adapter error / aborted」；**不得**把 aborted 伪装成正常结束 |
| 不可缓存回落 | `resolve-model` / `prepare-call` 失败必须 fail-closed，**不得**返回缓存或默认值 |
| 参数 | `PP-32`（含约束 `T_m < T_turn`，`TD-03`） |

### 2.3 `T_turn` 轮次总预算（`REL-107`）

| 项 | 内容 |
|---|---|
| 生效点 | **域外轮次看护**，按 `turnId` 判定进展（不看事件总数） |
| 上限 | 900 s（schema 固化，`1 ≤ T_turn ≤ 900`） |
| 超时行为 | `turn/cancel{reason=deadline}` 并**记录原因**；原因码封闭取值 `deadline` |
| 取消必须释放 | 该会话的**开放轮次**、**写句柄**、**写所有权等待** |
| 终态收敛 | 无终态 turn 必须在 `T_turn + PP-01` 内落终态；无终态 turn 计入分母并计为失败（`SLO-04b`、`REL-007`） |
| 同会话并发 | 同会话至多一个开放轮次（§4.7）；挂死轮次会永久占用该唯一槽位，故 `T_turn` 是必需机制 |

### 2.4 看护状态机与观测

| 状态 | 进入条件 | 允许动作 |
|---|---|---|
| `OPEN` | turn 被接受 | 进展事件更新 `lastProgressAt` |
| `PROGRESSING` | 收到白名单内进展事件 | 刷新 `lastProgressAt`（心跳 / `usage` **不刷新**） |
| `OVERDUE` | `now − lastProgressAt > T_turn` | 标记挂死；`turn.hung.count` +1；发起取消 |
| `CANCELLING` | 取消已发出 | 等待释放回调；超 `PP-27` 未释放 ⇒ 升级为会话级处置（`CHK-05`） |
| `TERMINAL` | 终态事件落库 | 关闭记账；写 SLO 样本 |

| 指标 | 口径 | 采集 |
|---|---|---|
| `approval.wait.p50/p95/p99` | 投递完成 → 决策 / `timeout` | 域外审批看护 |
| `approval.timeout.rate` | `timeout` 数 / 全部审批请求数，按租户聚合 | 域外审批看护 |
| `turn.hung.count{tenant,tool}` | 无进展 > `T_turn` 的轮次数，按租户与按工具聚合 | 域外轮次看护 |
| `turn.unterminated.count` | `T_turn + PP-01` 内无终态的轮次数 | 域外终态收敛看护 |
| `turn.postCancel.admitLatency` | 取消 → 同会话新 turn 被接受 | 会话准入 |

---

## 3. 进展事件白名单（`REL-108`）

### 3.1 白名单（封闭）

| 事件类别 | 是否计为进展 | 说明 |
|---|---|---|
| 模型 chunk（流式增量，含 `message.delta` / `reasoning.delta`） | **是** | 每次 chunk 刷新增量时间戳 |
| `tool.call` | **是** | — |
| `tool.result` | **是** | — |
| `step.end` | **是** | — |
| `checkpoint` | **是** | 与检查点策略同源（模型请求前 / 顶层工具副作用前 / `agent/pre-step`） |
| 心跳（keep-alive / ping） | **不得** | 心跳只维持连接，不证明进展 |
| `usage` | **不得** | 用量事件可由缓冲重放产生，与进展无因果关系 |
| 其他任何事件类型 | **不得**（默认不计） | 白名单外新增类型必须走 `REL-110` 的变更重跑 |

### 3.2 判定算法（判定式，非论证）

```
onEvent(e):
  if e.type in PROGRESS_WHITELIST and not isDuplicateCheckpoint(e):
      lastProgressAt = monoNow()
      state = PROGRESSING
  # 心跳与 usage 不进入该分支

overdue(turn):
  return (monoNow() - turn.lastProgressAt) > turn.deadline   # turn.deadline = T_turn
```

| 防护 | 规则 |
|---|---|
| `checkpoint` 去重 | 同一 `(turnId, stepIndex, checkpointKind)` 的重复 checkpoint 只刷新一次（幂等键）；重复 checkpoint 不得用于无限续命 |
| 长工具调用 | 工具执行期间无白名单事件属**正常**；此时仍以 `T_turn` 为唯一上限（`REL-106`：内核的 timeout-policy 是协作式的，不构成强制） |
| 缓冲重放 | 来自缓冲/补传的 `usage` 事件**不得**刷新（域外看护只认域内实时事件流） |
| 时钟 | 用单调钟；域内与域外时钟偏差由 `PP-07` 界定 |

### 3.3 注入判据

| 注入 | 期望 |
|---|---|
| 持续发心跳与 `usage`、不发白名单事件 | `T_turn` 后计为挂死轮次（`turn.hung.count` +1） |
| 把心跳计为进展 | **即失败**（该实现不得合入） |

---

## 4. 取消与释放检查点清单（`REL-107` / `REL-109`）

| 检查点 ID | 检查内容 | 判定式 | 观测 | 失败处置 |
|---|---|---|---|---|
| `CHK-01` | 开放轮次计数归零 | 会话 `openTurns == 0` | 会话状态接口 | 视为取消失败，升级 `CHK-05` |
| `CHK-02` | 写句柄已释放 | 持久层无本会话写句柄 | 持久层句柄计数 | 同上 |
| `CHK-03` | 写所有权等待已解除 | 无等待 `session.lock` 的排队项 | 写所有权等待时长指标 | 同上 |
| `CHK-04` | 新 turn 可被接受 | 取消后提交新 turn，接纳耗时 ≤ `PP-27`（初值 5 s） | `turn.postCancel.admitLatency` | 超预算即失败（`REL-109`） |
| `CHK-05` | 升级处置 | `CANCELLING` 持续 > `PP-27` | 告警 + 人为处置入口（锁卡死流程见 `REL-DOC-07` §4） | 无入口即失败 |
| `CHK-06` | 终态落库 | `turn/cancel` 后必须落终态事件 | 终态事件存在性 | 无终态计入分母并计为失败（`REL-007`） |

---

## 5. 工具超时语义（`REL-106`）

| 项 | 要求 |
|---|---|
| 事实 | `dsh-tool-call-timeout-policy` 是**协作式**：依赖工具遵守 `exec.signal`；`timeoutMs` 仅声明 |
| 禁止声称 | **不得**在任何文档或 UI 中声称「timeout-policy 已中止工具」 |
| 准入审查 | 对不遵守 `exec.signal` 的工具必须建立准入审查；**未通过者不得注册**（拦截点在 `ctx.tools.register` 入口） |
| 审查表字段 | `{toolName, 声明遵守 signal, 实测响应取消耗时 P95, 是否注册, 审查人, 日期}` |
| 兜底 | 忽略 `signal` 的工具在 `T_turn` 到达时**随轮次取消**（进程/会话级处置），而不是靠 timeout-policy |
| 用例 | 提交一个「声明遵守但实测忽略 signal」的测试工具：断言审查标记该工具，且 `T_turn` 到达时随轮次取消；出现「声称 timeout-policy 已中止工具」的实现即失败 |

---

## 6. 注入旋钮、夹具与逐层单独触发（`REL-110`）

| 层 | 注入旋钮 | 归属 | 夹具 | 断言 |
|---|---|---|---|---|
| `T_a` | 审批端点接受连接后不响应（blackhole） | `ENG-043` | `ENG-046` | 在 `T_a` 内收敛为 `timeout`、该调用被拒；出现无限等待即失败 |
| `T_m` | 上游流每 N 秒发一 chunk 但永不结束 / 固定 TTFB 延迟 | `ENG-043` | `ENG-046` | `T_m` 到达后本轮 fail-closed 中断；未声明重试预算即失败 |
| `T_turn` | 工具 promise 永不 resolve 且不遵守 `exec.signal` | `ENG-043` | `ENG-046` | `T_turn` 到期产生 `turn/cancel{reason=deadline}`，开放轮次计数回落为 0 |
| 逐层隔离 | 每次只触发一层 | — | — | 其他两层的样本分布不受影响（无串扰）；串扰即失败 |

---

## 7. 参数与配置变更 → 演练重跑矩阵（`REL-110`）

| 变更项 | 必须重跑的判据 | 必须重跑的用例（`REL-DOC-11`） | 门禁 |
|---|---|---|---|
| `T_a`（`deadlines.approvalSeconds`） | `REL-102`、`REL-103`、`REL-104` | `DRL-E04` | 未重跑即门禁失败 |
| `T_m`（`deadlines.modelStreamSeconds`）或重试声明 | `REL-102`、`REL-105` | `DRL-E16` | 同上 |
| `T_turn`（`deadlines.turnSeconds`） | `REL-102`、`REL-107`、`REL-108`、`REL-109` | `DRL-E17` | 同上 |
| 进展事件白名单 | `REL-108` | `DRL-E17` | 同上 |
| 终态收敛宽限 `PP-01` | `REL-007`（`SLO-04b`） | `DRL-E17` | 同上 |
| 取消后准入预算 `PP-27` | `REL-109` | `DRL-E17` | 同上 |
| 工具准入审查表 | `REL-106` | `DRL-X01`（受控恶意 MCP 推送新工具） | 同上 |
| 看护进程版本 | `REL-103`、`REL-105`、`REL-107` | `DRL-04`、`DRL-E04`、`DRL-E16`、`DRL-E17` | 同上 |

---

## 8. 与 SLO 的映射

| 机制 | SLO（`REL-DOC-01`） | 参数 |
|---|---|---|
| `T_turn` 取消与终态收敛 | `SLO-04`、`SLO-04b`、`SLO-16` | `PP-01` |
| `T_a` 超时率 | `SLO-20` | `T_a`（Profile） |
| `T_m` | `SLO-03`（不消耗平台预算；模型归因） | `PP-32` |
| 取消后准入 | `SLO-16`（同会话可继续服务） | `PP-27` |
| 挂死轮次 | `SLO-16` | — |

---

## 9. 本文件不覆盖的部分

| # | 内容 | 归属 |
|---|---|---|
| 1 | 审批载荷字段、决策词表语义、参数通道 | `SEC-063`、`CTR-001` §4、`ENG-012` |
| 2 | 审批 / 超时 / 限速的对客逐字文案 | `PRD-017`、`PRD-039` |
| 3 | 模型降级策略的适用边界 | `EVO-019` |
| 4 | 迁移期间的轮次静默与等待上界 | `REL-DOC-07` §3 |
| 5 | 注入器与夹具的工程实现 | `ENG-043`、`ENG-046` |
| 6 | `T_m` 具体取值实测 | `REL-DOC-02`（`PP-32`） |
