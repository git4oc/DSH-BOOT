# 恢复 span 规范（Recovery Span Spec）

| 项 | 值 |
|---|---|
| 文档编号 | `REL-DOC-03` |
| 版本 | 1.0 |
| 状态 | 生效（随 `SPEC-02` 版本联动） |
| 角色 | SRE / 可靠性架构师 |
| 交付物 | `SPEC-02` D-2.3《恢复 span 规范》 |
| 上游依据 | 设计文档 v2.6 §9.1「RTO 的分 span 要求」/ §7.4 / §10.1 / §4.1.2 / §12；`SPEC-02` v1.0 §2.2 / §2.1；`CTR-001` v1.0 §5.3（P-1…P-7 提交点与单写者）；`SPEC-03` v1.1 `ENG-059`–`ENG-061` |
| 写作用域 | `docs/reliability/recovery-span-spec.md`（排他） |
| 落实需求 | `REL-028`–`REL-036`（逐条落点见 §0）；外溢承接 `REL-069`–`REL-076` 的恢复语义落点（见 §10） |
| 参数引用 | 待回填数值一律以 `PP-xx` 引用 `REL-DOC-02` |
| ID 说明 | `SPAN-xx` / `FLD-xx` 是文档内条目号，不属 `SPEC-00` §4.1 需求 ID 段 |

---

## 0. 落实的 REL 清单

| REL ID | 本文件落点 |
|---|---|
| `REL-028` | §1 五 span 定义、§3 时间线完整性 |
| `REL-029` | §4 预算分摊表（含 `PP-09`） |
| `REL-030` | §5 事件量上界与两支处置 |
| `REL-031` | §5.2 事件数 / 字节数增长速率告警输入 |
| `REL-032` | §6 投影缓存必挂与水位同口径 |
| `REL-033` | §6.2 缓存非权威、清缓存等价性用例 |
| `REL-034` | §1.2 `toolset_ready` 与 `connector_ready` 的边界 |
| `REL-035` | §7 冷启动与恢复样本分列 |
| `REL-036` | §8 单 span 放大注入口 |
| `REL-069` | §10.1 追加合成 closer（不是回滚） |
| `REL-070` | §10.2 三类 closer 与幂等键 |
| `REL-071` | §10.3 一等事件与指标 |
| `REL-072`–`REL-075` | §10.4 台账落点（正文归 `REL-DOC-08`） |
| `REL-076` | §10.5 `recovery.lost_state` 四类标志位 |

> **承接说明**：`SPEC-02` §3 的交付物 D-2.3–D-2.12 未给 `REL-069`–`REL-076` 命名单一交付物（D-2.7 从 `REL-077` 起，D-2.8 为 `REL-072`–`REL-075`）。本文件作为**恢复**主题的落点承接该段，其中 `REL-072`–`REL-075` 的正文归 `REL-DOC-08`（§10.4 只做索引，不复制正文，遵循 `GATE-009`）。

---

## 1. 五个 span 的定义（`REL-028` / `REL-034`）

| ID | span 名 | 起点 | 终点 | 判定式 | 埋点位置 | 测量面 |
|---|---|---|---|---|---|---|
| `SPAN-01` | `restore.acquire_lock` | 恢复流程入口（进程启动后首次调用持久层之前） | `persistence.open(id,'write')` 返回写句柄 | 语句级：`open` 的 `resolve` 时刻 | 域内持久化提供方；事件由 `ENG-059` 埋点 | 域内埋点 + 域外采集 |
| `SPAN-02` | `restore.read_and_closers` | 写句柄取得后首次 `read()` | 全部需要收尾的轮次已判定且 closer 集合已算出 | 语句级：读完全量前缀（撕裂尾部截断）且 `openTurnClosers` 扫描结束 | 域内持久化提供方 + closer 计算点 | 域内埋点 + 域外采集 |
| `SPAN-03` | `restore.fold` | closer 集合确定后 | 模型历史前缀折叠完成（含投影缓存读取与一致性处理） | 语句级：折叠结果哈希产出 | 域内折叠路径 | 域内埋点 + 域外采集 |
| `SPAN-04` | `restore.connector_ready` | 折叠完成后 | 全部**必需** connector 就绪且 **MCP 工具**在可见集中 | 集合判定：`required=true` 的 connector 全部就绪 | Connector 控制器 + 工具注册桥 | 域内埋点 + 域外采集 |
| `SPAN-05` | `restore.toolset_ready` | connector 就绪后 | 注册桥装载完成且**非 MCP 工具集 == Profile `toolAllowlist`**（集合相等） | 集合相等：`registeredNonMcp == toolAllowlist \ mcp__*` | 工具注册桥（`ctx.tools.register` 入口） | 域内埋点 + 域外采集 |

### 1.1 边界规则

| 规则 | 内容 | 依据 |
|---|---|---|
| 归属 | MCP 工具就绪**必须**归 `SPAN-04`；非 MCP 工具就绪**必须**归 `SPAN-05` | `REL-034`：若 MCP 就绪被计入工具集 span，connector 故障会被「工具集就绪」掩盖，即失败 |
| 集合语义 | `SPAN-05` 的判定是**集合相等**（不是包含）；`toolAllowlist` 缺省或空数组 = 空集 | `CTR-001` §3.4 |
| 时间戳 | 所有 span 使用**单调时钟**；跨域比较必须带 `PP-07` 时钟偏差上界 | `CTR-001` §1 C-8 |
| 归属唯一 | 任一时刻必须恰好属于一个 span；重叠即失败 | `REL-028` |

### 1.2 span 事件 schema

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionId` | string | 是 | 会话标识 |
| `spanName` | enum | 是 | `SPAN-01`…`SPAN-05` 的 `span 名` 取值 |
| `phase` | enum `start` / `end` | 是 | 同一 `(sessionId, spanName, occurrence)` 必须成对 |
| `tsMono` | integer（μs，单调） | 是 | 单调时间戳 |
| `origin` | enum `boot` / `restore` | 是 | 冷启动 / 恢复（`REL-035`） |
| `eventsRead` | integer | 否 | 仅 `SPAN-02`：本次读取的事件数（用于 `PP-10` 比对） |
| `closerCount` | object `{toolResult, stepEnd, turnEnd}` | 否 | 仅 `SPAN-02`：三类 closer 待合成数 |
| `foldHash` | string | 否 | 仅 `SPAN-03`：折叠结果哈希（缓存路径 vs 纯日志路径比对用） |
| `cacheHit` | boolean | 否 | 仅 `SPAN-03`：是否使用投影缓存 |
| `connectorSet` | string[] | 否 | 仅 `SPAN-04`：就绪 connector 名 |
| `toolsetHash` | string | 否 | 仅 `SPAN-05`：非 MCP 工具集指纹 |
| `allowlistMatches` | boolean | 否 | 仅 `SPAN-05`：集合相等判定结果 |
| `enlargedBy` | string | 否 | 仅注入时：放大来源（§8） |

---

## 2. 恢复流程与 span 顺序（固定）

```
进程启动
  └─ SPAN-01 restore.acquire_lock          取写所有权（session.lock 无过期 ⇒ 只能显式释放/重取）
       └─ SPAN-02 restore.read_and_closers 全前缀读（撕裂尾部截断）+ openTurnClosers 全日志线性扫描
            └─ SPAN-03 restore.fold        折叠前缀得模型历史（投影缓存为 shortcut，非权威）
                 └─ SPAN-04 restore.connector_ready 必需 connector 就绪（含 MCP 工具可见）
                      └─ SPAN-05 restore.toolset_ready 非 MCP 工具集 == toolAllowlist
                           └─ 会话可再次接受 turn（= 用户可见 RTO 终点，PP-05）
```

顺序**不得**变更：`connector_ready` 早于 `toolset_ready` 的判定依赖桥的集合比较；若实现为并行，必须仍能分别读出任一时间点的归属（`REL-034`）。

---

## 3. 时间线完整性（`REL-028`）

| 校验 | 判定式 | 失败处置 |
|---|---|---|
| 五 span 齐备 | 每次恢复必须产出 `SPAN-01`…`SPAN-05` 各一对 `start/end` | 缺失任一 ⇒ CI 失败 |
| 相邻接续 | `span[i].end ≤ span[i+1].start` 且 `gap[i] = span[i+1].start − span[i].end` | `gap < 0`（重叠）即失败 |
| 空隙上界 | `Σgap + 未埋点区段 ≤ 5% × R_target`（`R_target = PP-05`） | 超差须给出未归因区间的 span 名 |
| 端到端对账 | `|Σspan + Σgap − (slo.restore.rto.user_visible)| / 后者 ≤ 10%` | 超差 ⇒ 指标不可判定，须补埋点（`REL-012` 判据） |
| `origin` 分列 | `origin=boot` 与 `origin=restore` 样本集交集必须为空（`REL-035`） | 交集非空即失败 |

---

## 4. 预算分摊（`REL-029` / `PP-09`）

### 4.1 初始分摊（`REL-029` 给定，实测后按 `PP-09` 重分配）

| span | 预算比例 | 符号式（`R_target = PP-05`） | 示例值（`R_target = 30 s`，**示例值，非承诺值**） |
|---|---|---|---|
| `SPAN-01` 拿锁 | ≤ 5% | `≤ 0.05 × R_target` | ≤ 1.5 s |
| `SPAN-02` 读+closer | ≤ 40% | `≤ 0.40 × R_target` | ≤ 12 s |
| `SPAN-03` 折叠 | ≤ 30% | `≤ 0.30 × R_target` | ≤ 9 s |
| `SPAN-04` connector 就绪 | ≤ 20% | `≤ 0.20 × R_target` | ≤ 6 s |
| `SPAN-05` 工具集就绪 | ≤ 5% | `≤ 0.05 × R_target` | ≤ 1.5 s |
| **合计** | **100%** | `Σ = 1.00 × R_target` | 30 s |

### 4.2 校验

| 校验 | 判据 |
|---|---|
| 无空预算 | 任一 span 缺预算即 CI 失败 |
| 不得超 100% | `Σ预算 > 100%` 即 CI 失败 |
| 与实测对比 | 每次恢复产出五 span 实测分布（≥30 次）；实测 P95 与预算偏差 > 25% 即触发 `PP-09` 重分配评审 |
| 与用户可见 RTO 一致 | 预算之和必须 ≤ `R_target`；`REL-012` 要求 `用户可见 RTO = 日志恢复 + connector 就绪`，差额需解释 |

---

## 5. 事件量上界与增长告警（`REL-030` / `REL-031`）

### 5.1 `restore.read_and_closers` 的上界

| 项 | 内容 |
|---|---|
| 事实约束 | `openTurnClosers` 是**全日志线性扫描**；持久化层**无压缩无轮转** ⇒ 事件数与耗时为线性关系 |
| 上界参数 | `PP-10`（可接受的最大事件数） |
| 实时暴露 | 恢复过程中必须实时产出 `restore.read_and_closers.events`（每 N 万事件一次上报，N 由 `PP-10` 的 1/10 取整） |
| 超限处置（二选一，必须至少一支生效） | ① **准入拒绝**：域外准入层拒绝该会话进入 ready，并告警（级别 = L3，原因码 `TRG-L3-(h)` 的持久层分支）② **先归档**：触发归档（合成快照或派生新会话）后再恢复 |
| 无动作 | 超限而无动作即失败（`REL-030` 判据） |

### 5.2 事件数与字节数的增长速率告警（`REL-031`）

| 指标 | 采集 | 告警条件 | 告警必须早于 |
|---|---|---|---|
| `session.events.count` | 域外会话索引 | 增长速率 > 基线速率 × k（k 由 `PP-04` 与保留窗口反推） | 事件数到达 `PP-04` **之前** |
| `session.bytes` | 域外会话索引 | 同上（按字节） | 同上 |

判据：以 10× 正常速率写入，告警必须在到达上界前触发；滞后到超界之后即失败。

---

## 6. 投影缓存（`REL-032` / `REL-033`）

### 6.1 必挂与参数

| 项 | 要求 |
|---|---|
| 组件 | `dsh-session-projection-cache` 为**必挂组件**；未挂载 ⇒ 域拒绝 ready |
| 参数 | `PP-11`（`writeEveryEvents`）、`PP-12`（`writeIntervalMs`），两者**先到者**触发落盘 |
| Profile 落点 | 当前 `contracts/profile.schema.json` **无**对应字段（`bufferConfig` 与顶层均 `additionalProperties: false`）⇒ 落点属**待裁定项**，见 `REL-DOC-02` §4.1 #2 |
| 复制 | 缓存行**必须**随域复制，且复制水位与日志复制水位**同一口径**（同一 `seq` 语义） |

### 6.2 非权威与等价性（`REL-033`）

| 项 | 判定 |
|---|---|
| 权威性 | 自述为「fold shortcut, never an authority」⇒ 恢复**必须**以日志为准 |
| 缺失容忍 | 清空投影缓存后 SIGKILL 并恢复：恢复必须成功 |
| 等价性 | 缓存路径与「纯日志折叠」的 `foldHash` 必须一致；不一致即失败 |
| 水位同口径 | 恢复后比对缓存行水位与日志水位；出现两套水位口径即失败（`REL-032`） |

---

## 7. 冷启动与恢复分列（`REL-035`）

| 维度 | `origin=boot` | `origin=restore` |
|---|---|---|
| 计时起点 | 域创建请求 | 崩溃 / 迁移后恢复开始 |
| 计时终点 | 域 ready（含 Windows ACL 传播，`PP-29`） | 会话可再次接受 turn |
| 指标名 | `domain.boot.duration{origin=boot}` | `slo.restore.rto.user_visible{origin=restore}` |
| 样本集 | 与恢复样本**交集必须为空** | 同左 |
| 归口 SLO | `SLO-21` | `SLO-05` / `SLO-06` / `SLO-07` |

冷启动样本混入恢复 RTO 统计即失败；Windows ACL 传播耗时**必须**计入 `origin=boot`（量级「数十秒」，C30）。

---

## 8. 单 span 放大注入口（`REL-036` / `ENG-060`）

| 项 | 要求 |
|---|---|
| 不改被测代码 | 注入口必须由夹具提供（`ENG-046` 夹具集的一员），**不得**要求修改恢复路径源码 |
| 粒度 | 五个 span **各自**可单独放大 |
| 注入量 | 逐 span 注入延迟 3×（基准 = 该 span 的实测 P95） |
| 断言 1 | 被注入 span 时长上升 ≈ 注入量（误差 ≤ 10%） |
| 断言 2 | 其余四个 span 时长不变（相对基线偏差 ≤ 5%） |
| 断言 3 | 端到端用户可见 RTO 增量 ≈ 注入量（误差 ≤ 10%） |
| 无法单独放大 | 即失败（`REL-036` 判据） |
| 覆盖 | 支撑 `REL-DOC-11` 的扩展用例 `DRL-E12`（五 span 单独放大） |

---

## 9. 与 SLO、演练的映射

| span / 机制 | SLO（`REL-DOC-01`） | 参数 | 演练用例（`REL-DOC-11`） |
|---|---|---|---|
| `SPAN-01`–`SPAN-05` 全体 | `SLO-07` | `PP-05`、`PP-09` | `DRL-01`、`DRL-E12` |
| `SPAN-02` | `SLO-05` | `PP-02`、`PP-10` | `DRL-01`、`DRL-E13`（10⁶ 事件） |
| `SPAN-03` | `SLO-07` | `PP-11`、`PP-12` | `DRL-E14`（缓存清空） |
| `SPAN-04` | `SLO-06`、`SLO-17`、`SLO-18` | — | `DRL-03` |
| `SPAN-05` | `SLO-05` | `PP-02` | `DRL-01` |
| 增长速率告警 | `SLO-05b` | `PP-04` | `DRL-E13` |
| `origin=boot` | `SLO-21` | `PP-29` | `DRL-E15`（冷启动基线） |

---

## 10. 恢复语义与不可恢复清单（`REL-069`–`REL-076`）

### 10.1 追加合成 closer，不是回滚（`REL-069`）

| 项 | 要求 | 拦截点 / 判据 |
|---|---|---|
| 语义 | 中断轮次的事件**永久保留**在历史中；恢复通过**追加**合成 closer 收尾 | 恢复路径代码审查（不存在回滚 / 删除中断轮次的路径） |
| 禁止 | **不得**实现删除或回滚中断轮次的路径 | 代码审查 + 用例 `DRL-01` |
| 不变量 | 历史事件数**单调不减** | 恢复前后事件数比对；减少即失败 |
| 模型侧 | 内核只提供「给模型看的一句提示文本」；该文本**不构成**强制 ⇒ 强制来自 `REL-DOC-08` §5.2 的台账阻断 | 代码审查 |

### 10.2 三类 closer 与幂等（`REL-070`）

| 序 | 合成事件 | 触发条件 | 幂等键 |
|---|---|---|---|
| 1 | 未闭合 `tool/result`（合成错误结果） | 存在 `tool.call` 而无对应 `tool/result` | `(turnId, callId)` |
| 2 | 未闭合 `step/end` | 存在未闭合 step 边界 | `(turnId, stepIndex)` |
| 3 | `turn/end{interrupted}` | 轮次无终态 | `(turnId)` |

| 校验 | 判据 |
|---|---|
| 三覆盖 | 三类事件必须全部合成；缺一类即失败 |
| 幂等 | 在 closer 追加**中途** SIGKILL 后再次恢复：按上述幂等键去重后计数与单次恢复一致；出现重复 closer 即失败 |
| 顺序 | closer 追加必须在 `flush` 屏障内提交（`CTR-001` §5.3 P-1），不得依赖 `append` 解析成功 |

### 10.3 一等事件与指标（`REL-071`）

| 项 | 要求 |
|---|---|
| 事件 | `TOOL_OUTCOME_UNKNOWN` 与 `TOOL_NOT_STARTED` 必须是一等**产品事件**（SSE 可见），**不得**只进模型历史 |
| 指标 | `turn.outcome_unknown.count{tenant,tool}` 必须可按租户与按工具聚合 |
| 判据 | 工具执行中 SIGKILL ⇒ SSE 收到 `tool.outcome_unknown` 事件 + 指标可查 |
| 关联 | 阻断与放行口径见 `REL-DOC-08` §5；演练判据见 `DRL-01` 判据 (d) |

### 10.4 副作用台账的索引（正文归 `REL-DOC-08`）

| REL ID | 正文落点 |
|---|---|
| `REL-072` | `REL-DOC-08` §3（写入时机 / fail-closed） |
| `REL-073` | `REL-DOC-08` §2（字段）、§4（查询接口） |
| `REL-074` | `REL-DOC-08` §5（恢复后阻断） |
| `REL-075` | `REL-DOC-08` §6（嵌套派发声明与注册拒绝） |

### 10.5 `recovery.lost_state` 四类标志位（`REL-076`）

| # | 不可恢复项 | 标志位字段 | 判定依据 | 渲染归属 |
|---|---|---|---|---|
| 1 | 持久 shell 的 cwd / 导出变量 / 后台任务 | `persistentShell` | 恢复后持久 shell 会话状态不可继承 | `PRD-006`（恢复横幅） |
| 2 | 在跑的 MCP 子进程 | `mcpSubprocesses` | 域进程被杀 ⇒ 托管 stdio 子进程一并消失 | `PRD-006`、`PRD-009` |
| 3 | `run_code` 中间值 | `runCodeIntermediates` | 进程内变量不落日志 | `PRD-006` |
| 4 | 嵌套派发的内层副作用 | `nestedInnerEffects` | 持久化粒度是外层调用（`C43`）⇒ 内层不可定位 | `PRD-006`、`REL-DOC-08` §6 |

| 校验 | 判据 |
|---|---|
| 四类齐备 | 事件必须含四个标志位；缺任一即失败 |
| 不得虚报 | 标志位必须与实测丢失一致；虚报「无丢失」即失败 |
| 产出时机 | 必须在恢复收尾阶段产出（早于会话可再次接受 turn） |
| 持久化 | 事件必须落域外并在域重启后可查 |

---

## 11. 本文件不覆盖的部分

| # | 内容 | 归属 |
|---|---|---|
| 1 | 会话日志的压缩 / 轮转策略（本文件只处理其**缺失**带来的上界义务） | 无（持久化层无此能力，故本文件以 `PP-04` 归档替代） |
| 2 | closer 合成的三类事件语义与幂等实现 | `REL-DOC-08` 与 `REL-069`/`REL-070`（语义归 `SPEC-02` §2.6） |
| 3 | 迁移路径的 RTO（与恢复共用 span，但状态机归口不同） | `REL-DOC-07` |
| 4 | 域启动自检项的逐项实现 | `ENG-040`、`ENG-059`–`ENG-061` |
| 5 | 具体数值实测 | `REL-DOC-02`（`PP-02`、`PP-04`、`PP-05`、`PP-09`–`PP-12`、`PP-29`） |
| 6 | 冷启动等待页与对客文案 | `PRD-###`（由 `SPEC-04` 分配） |
