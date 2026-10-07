# 依赖生命周期清单（D6）

| 项 | 值 |
|---|---|
| 文档编号 | `EVO-DOC-06` |
| 版本 | 1.0 |
| 状态 | 生效（可填写清单模板 + 下架演练 SOP） |
| 角色 | 演进 / 反脆弱架构师 |
| 交付物 | `SPEC-05` §3 D6 |
| 上游依据 | `SPEC-05` §2.4；设计文档 v2.6 §5.6 Connector Registry、§4.5.1 工具强制、§4.8 MCP 接入、§9.2 单 connector 失败与重连预算耗尽、§9.4 L3 触发集、§11.1 seam 表与 §11.2 实验能力、§6.2 `connectors` / `requireApproval` / `toolAllowlist` |
| 落实的 `EVO-*` | `EVO-017`、`EVO-018`、`EVO-019`；交叉 `EVO-020`、`EVO-034` |
| 写作用域 | `docs/evolution/dependency-lifecycle.md`（排他） |

**硬性事实**：MCP 重连耗尽后工具被**永久注销**，除重载 / 重启**无回来路径**；`toolAllowlist` 缺省语义是"**无工具**"而非"全部工具"；工具不在清单内即**不可达**，其调用**必须**在**不进入审批判决**的情况下被拒。

---

## 1. 清单形态

| 项 | 规定 |
|---|---|
| 人工可读渲染 | §2 表 A（connector）、§3 表 B（工具）、§4 表 C（模型供应商） |
| 结构化真源 | `docs/evolution/connector-lifecycle.jsonl`、`docs/evolution/tool-lifecycle.jsonl`、`docs/evolution/model-provider-lifecycle.jsonl` |
| 可 diff | 每个对象一行；`state` 可改、行不可删（历史会话是永久负债） |
| CI 解析契约 | 三张表列名逐字匹配；表 B 出现 `removedFromAllowlistAtTrainVersion` 非空而 `requireApprovalRuleDisposition` 为空即 `EVO_ORPHAN_APPROVAL_RULE` |
| 实现归属 | Connector Registry、注册桥、Profile 生成器的实现归 `ENG-###`；判据归本文件 |

---

## 2. 表 A：connector 生命周期清单

| # | 列名 | 类型 / 取值域 | 必填 | 语义 |
|---|---|---|---|---|
| 1 | `serverName` | string | 是 | 同注册作用域内唯一 |
| 2 | `state` | `active` / `deprecated` / `sunset` | 是 | `sunset` = 已下架，不再下发 |
| 3 | `hosting` | `domain` / `data-plane` / `exception` | 是 | 决定凭证归属；例外须安全评审（归 `SPEC-01`） |
| 4 | `trust` | `trusted` / `untrusted` | 是 | 默认 `untrusted` |
| 5 | `required` | `是` / `否` | 是 | `是` 时不就绪即不进入 `active`（归 `SPEC-02` 就绪探针） |
| 6 | `replacementServerName` | string | 条件必填 | 下架时的替代 connector；无替代时填 `无` |
| 7 | `affectedActiveSessions` | 整数 ≥ 0 | 是 | 受影响活跃会话数（下架影响面导出） |
| 8 | `degradeMode` | `迁移到替代` / `禁用该工具并提示` / `保持只读` | 是 | 既有会话退化行为；**不得**静默 |
| 9 | `historyReplayVerificationId` | string | 是 | 历史 event 可读性验证记录 id（§5 表 D） |
| 10 | `userVisibleReasonEntry` | string | 是 | 工具缺失原因在 UI 上的入口标识（文案归 `SPEC-04`） |
| 11 | `effectiveTrainVersion` | string | 是 | 该状态生效的列车号 |
| 12 | `lastHealthCheckAt` | RFC3339 UTC | 是 | 最近健康检查（连接状态 / 工具数 / 重连次数） |

**示例行**

| serverName | state | hosting | trust | required | replacementServerName | affectedActiveSessions | degradeMode | historyReplayVerificationId | userVisibleReasonEntry | effectiveTrainVersion | lastHealthCheckAt |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `corp-jira` | `active` | `data-plane` | `trusted` | 是 | — | — | — | — | — | `0.2.0-rc.1` | `2026-01-05T04:00:00Z` |
| `corp-legacy-wiki` | `deprecated` | `data-plane` | `untrusted` | 否 | `corp-wiki` | 37 | `迁移到替代` | `hrv-0002` | `ui://connector-degraded/corp-legacy-wiki` | `0.2.0-rc.2` | `2026-02-26T04:00:00Z` |
| `corp-wiki` | `active` | `data-plane` | `trusted` | 否 | — | — | — | — | — | `0.2.0-rc.2` | `2026-02-26T04:00:00Z` |
| `corp-batch-ops` | `sunset` | `domain` | `untrusted` | 否 | `无` | 4 | `保持只读` | `hrv-0003` | `ui://connector-degraded/corp-batch-ops` | `0.2.0-rc.2` | `2026-02-26T04:00:00Z` |

---

## 3. 表 B：工具生命周期清单

| # | 列名 | 类型 / 取值域 | 必填 | 语义 |
|---|---|---|---|---|
| 1 | `toolName` | string | 是 | 规范工具名（MCP 形态为 `mcp__<serverName>__<rawName>`） |
| 2 | `ownerKind` | `connector` / `plugin` | 是 | 归属类型 |
| 3 | `ownerName` | string | 是 | `serverName` 或插件行名 |
| 4 | `state` | `active` / `deprecated` / `removed` | 是 | `removed` = 已从 `toolAllowlist` 移除 |
| 5 | `removedFromAllowlistAtTrainVersion` | string | 条件必填 | `state = removed` 必填 |
| 6 | `requireApprovalRuleDisposition` | `removed` / `orphan` / `不适用` | 是 | **不得**留空、**不得**悬挂、**不得**自动升级为"允许" |
| 7 | `orphanRecordId` | string | 条件必填 | `disposition = orphan` 必填；关联审计记录 |
| 8 | `approvalRuleRefCount` | 整数 ≥ 0 | 是 | 移除前引用的审批规则条数 |
| 9 | `replacementToolName` | string | 条件必填 | 替代工具名；无替代时填 `无` |
| 10 | `unreachableBeforeApproval` | `是` / `否` | 是 | **必须为「是」**：不可达的调用在进入审批判决前被拒 |
| 11 | `auditRef` | string | 是 | 处置审计记录引用 |

**示例行**

| toolName | ownerKind | ownerName | state | removedFromAllowlistAtTrainVersion | requireApprovalRuleDisposition | orphanRecordId | approvalRuleRefCount | replacementToolName | unreachableBeforeApproval | auditRef |
|---|---|---|---|---|---|---|---|---|---|---|
| `mcp__corp-jira__get_issue` | `connector` | `corp-jira` | `active` | — | `不适用` | — | 0 | — | 是 | — |
| `mcp__corp-legacy-wiki__search` | `connector` | `corp-legacy-wiki` | `removed` | `0.2.0-rc.2` | `removed` | — | 0 | `mcp__corp-wiki__search` | 是 | `audit://tlc-0002` |
| `mcp__corp-legacy-wiki__edit` | `connector` | `corp-legacy-wiki` | `removed` | `0.2.0-rc.2` | `orphan` | `orp-0001` | 2 | `无` | 是 | `audit://tlc-0003` |
| `mcp__corp-batch-ops__submit` | `connector` | `corp-batch-ops` | `removed` | `0.2.0-rc.2` | `orphan` | `orp-0002` | 1 | `无` | 是 | `audit://tlc-0004` |

---

## 4. 表 C：模型供应商生命周期清单

| # | 列名 | 类型 / 取值域 | 必填 | 语义 |
|---|---|---|---|---|
| 1 | `providerId` | string | 是 | 供应商标识；**不得**在产品层以供应商名做分支（`EVO-020`） |
| 2 | `modelIds` | string 列表 | 是 | 该供应商下的模型 id |
| 3 | `state` | `active` / `deprecated` / `sunset` | 是 | 生命周期状态 |
| 4 | `degradeMatrixRef` | string | 是 | 对应 `docs/evolution/model-degrade-matrix.md` 的行 / 列标识 |
| 5 | `noDegradeSessionClasses` | string 列表 | 是 | 禁止降级的会话类别（`no-degrade`） |
| 6 | `costAttributionBasis` | string | 是 | 跨模型成本归因口径标识（口径明细见 D7 §5） |
| 7 | `sunsetEffectiveTrainVersion` | string | 条件必填 | `state = sunset` 必填 |
| 8 | `resolveModelAvailable` | `是` / `否` | 是 | `resolve-model` 硬端点是否仍可用（降级适用前提之一） |

**示例行**

| providerId | modelIds | state | degradeMatrixRef | noDegradeSessionClasses | costAttributionBasis | sunsetEffectiveTrainVersion | resolveModelAvailable |
|---|---|---|---|---|---|---|---|
| `<provider-a>` | `<model-a1>`, `<model-a2>` | `active` | `MDM:primary` | `compliance-audit` | `CAB-1` | — | 是 |
| `<provider-b>` | `<model-b1>` | `deprecated` | `MDM:primary` | `compliance-audit` | `CAB-1` | `0.2.0-rc.4` | 是 |
| `<provider-c>` | `<model-c1>` | `sunset` | `MDM:vision` | `compliance-audit` | `CAB-2` | `0.2.0-rc.2` | 否 |

第 3 行示例：`resolveModelAvailable = 否` ⇒ 该模型的不可用**不**走降级，按 `SPEC-02` 的 L3 处置。

---

## 5. 表 D：`EVO-017` 退化三条件检查（逐 connector）

| # | 条件 | 判定方法（证据来源必须域外） | 通过标准 | 需求 |
|---|---|---|---|---|
| C-1 | **历史 event 仍可读** | 抽样回放该 connector 相关的历史会话事件 | 无解析错误、无事件丢失、无重复渲染 | `EVO-017` |
| C-2 | **新 turn 中被下架工具不可达** | 域外判定的工具清单 + 一次新 turn 的负向调用 | 工具不在模型可见集；调用被拒且不进入审批判决 | `EVO-017` |
| C-3 | **用户可见缺失原因** | UI 入口标识 `userVisibleReasonEntry` 可达性检查 | 入口存在且能说明缺失原因（文案归 `SPEC-04`） | `EVO-017` |
| C-4 | 退化**不得**静默 | 审计中存在退化记录（会话清单 + 处置类型 + 生效列车号） | 记录齐备 | `EVO-017` |
| C-5 | 处置路径逐条存在 | 每条受影响活跃会话有处置：`迁移到替代` / `禁用该工具并提示` / `保持只读` | **无处置路径的条目阻断下架执行** | `EVO-017`、`EVO-034` |

**验证记录字段（`historyReplayVerificationId` 指向）**：`verificationId`、`serverName`、`sampleSessions`（≥10）、`replayErrors`、`eventLoss`、`unreachableConfirmed`、`userReasonEntryConfirmed`、`conclusion`、`executedBy`、`verifiedAt`。

---

## 6. MCP 重连耗尽的处置（永久注销路径）

| # | 环节 | 规定 | 判定 | 回退 / 恢复 |
|---|---|---|---|---|
| M-1 | 检测 | 以重连次数与工具数突变告警（工具数突变必须告警） | 命中即进入 M-2 | — |
| M-2 | 状态登记 | 在表 B 记为"工具不可达"，**不得**登记为 `removed` 或改名 | 登记口径正确 | 口径错误 ⇒ 拒绝发布（`EVO-015` P-8） |
| M-3 | 调用处置 | 调用因工具不可达在**审批判决之前**被拒 | `unreachableBeforeApproval = 是` | — |
| M-4 | 恢复动作 | 唯一恢复路径是**重载 / 重启**（工具由 Connector 控制器自动重载） | 重载后工具面复验通过 | 重载失败 ⇒ 保持不可达并在 UI 显示原因 |
| M-5 | 工具面断言点 | 域启动与域重载时断言工具面 == `toolAllowlist` | 断言失败即拒绝 ready | 走 `docs/evolution/mixed-version-report.md` 排空 |

**禁止**：把"重连耗尽导致不可达"表述为"临时抖动可自愈"；依赖域内自报作为工具面证据。

---

## 7. `EVO-018` 悬挂审批规则处置

| # | 情形 | 处置动作 | 记录 | 判定顺序 |
|---|---|---|---|---|
| O-1 | 工具仍可达且仍在 `toolAllowlist` | 规则保留 | 表 B `不适用` | 正常审批流程 |
| O-2 | 工具从 `toolAllowlist` 消失 | 规则**移除**并审计 | 表 B `removed` | 先判可达性 |
| O-3 | 工具消失但规则被保留（负例） | 标记 `orphan` 并审计 | 表 B `orphan` + `orphanRecordId` | 先判可达性 |
| O-4 | 工具不可达（重连耗尽 / 未下发） | **不得**进入审批判决；调用直接因不可达被拒 | 域内注册桥入口拦截记录 | 可达性判定**先于**审批判决 |

**硬性判定链**：`注册桥入口（工具名 ∈ toolAllowlist？） → 工具可达性 → 审批判决`。任一前置判定失败即拒绝，**不得**落到审批环节。

**负例**：删工具但留规则 ⇒ **必须**产出 `orphan` 记录；该工具调用**必须**在不进入审批判决的情况下被拒。

---

## 8. `EVO-019` 定义义务与 D7 交接

| # | 义务 | 落点 | 判定 |
|---|---|---|---|
| D-1 | Profile **必须**为每类会话显式给出"模型不可用 / 被下架时的降级目标（模型 id 或 `fail-closed`）" | Profile 的 `modelDegradation` | 字段缺失或为空 ⇒ **拒绝产出 Profile** |
| D-2 | Profile **必须**声明"哪些会话类型禁止降级（`no-degrade`）"并给出**理由码** | Profile 的 `modelDegradation` | 缺理由码 ⇒ 拒绝产出 |
| D-3 | 降级**仅**适用于 `resolve-model` 仍可用且能返回替代模型的情形 | 反向网关模型解析点 | 不满足 ⇒ 不走降级 |
| D-4 | **模型网关整体不可用不适用降级** | 按 `SPEC-02` 的 L3 处置 | 不得以"降级"替代 L3 |
| D-5 | 降级事件**必须**出现在事件流与用量归因中，且跨模型成本**必须**可区分 | 事件映射台账（D9）+ 归因口径（D7 §5） | 事件缺失 ⇒ 不合格 |
| D-6 | 无按供应商分支的产品层代码 | CI 静态检查 | 命中即阻断（`EVO-020`） |

**接口缺口登记**

| # | 缺口 | 现状 | 需要谁补 |
|---|---|---|---|
| G-1 | `contracts/profile.schema.json` 的 `required` 列表**不含** `modelDegradation`，`properties` 也**未定义**该字段 | `EVO-019` 要求的"schema 校验要求 `modelDegradation` 存在且非空"在契约层无可落点 | 契约维护者 + `ENG-###`（引 `ENG-025` / `ENG-045` / `ENG-062` 的字段校验落点） |
| G-2 | 模型降级矩阵的行列枚举与 `modelDegradation` 的字段名对应关系 | 需与 D7 定稿一致 | 本角色（D7）+ `ENG-###` |

---

## 9. 下架演练 SOP（`EVO-017` 验收）

| 步骤 | 动作 | 判定 | 失败处置 |
|---|---|---|---|
| 1 | 导出该 connector 影响的**活跃会话清单**（表 A `affectedActiveSessions` + 会话明细） | 清单可导出且逐条有处置字段 | 阻断下架执行 |
| 2 | 逐条给出处置（迁移到替代 / 禁用并提示 / 保持只读）；无替代者**不得**执行下架 | 无未处置条目 | 阻断下架执行 |
| 3 | 历史 event 回放验证（表 D `C-1`），抽样 ≥ 10 条会话 | 无解析错误 | 阻断 |
| 4 | 负向调用验证（表 D `C-2`） | 工具不可达且不进入审批判决 | 阻断 |
| 5 | UI 缺失原因抽查（表 D `C-3`），抽样 ≥ 10 条 | 10/10 可见缺失原因 | 阻断 |
| 6 | 落库：表 A / 表 B / 表 D 全部更新并附审计引用 | 记录齐备 | 演练未通过 |

---

## 10. 不在本文件范围

| 项 | 归属 |
|---|---|
| Connector Registry、注册桥、Profile 生成器、静态检查的实现 | `ENG-###` |
| 凭证归属、例外评审、吊销与轮换的授权边界 | `SPEC-01`（`SEC-###`） |
| required connector 就绪探针与 L3 触发集、单 connector 失败的可靠性判定 | `SPEC-02`（`REL-###`） |
| 工具缺失原因、降级提示的用户文案与合同条款 | `SPEC-04`（`PRD-###`） |
| 每类会话 × 每类模型不可用的完整矩阵 | `docs/evolution/model-degrade-matrix.md` |
| 弃用件的垫片与移除排期 | `docs/evolution/deprecation-ledger.md` |
