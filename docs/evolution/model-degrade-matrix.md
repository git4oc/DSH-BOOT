# 模型降级矩阵（D7）

| 项 | 值 |
|---|---|
| 文档编号 | `EVO-DOC-07` |
| 版本 | 1.0 |
| 状态 | 生效（可填写矩阵模板 + 下架演练 SOP） |
| 角色 | 演进 / 反脆弱架构师 |
| 交付物 | `SPEC-05` §3 D7 |
| 上游依据 | `SPEC-05` §2.4；设计文档 v2.6 §9.2 故障处理与降级、§9.4 降级阶梯与 L3 触发集、§5.2 计费归因、§6.2 Profile 字段、§6.3 反向 I/O 契约的 `resolve-model` 硬端点、§11.1 `ctx.llm` |
| 落实的 `EVO-*` | `EVO-019`；交叉 `EVO-020`（唯一模型入口 / 无供应商分支） |
| 写作用域 | `docs/evolution/model-degrade-matrix.md`（排他） |

**定义义务的边界**：本矩阵是 `EVO-019` 要求"模型降级策略必须被定义并落盘"的**落盘形态**。降级级别 L0–L3 / L1b 的定义与运行时聚合规则**不在本文件**（归 `SPEC-02`）。

---

## 1. 适用前提与不适用路径

| # | 情形 | 是否适用降级 | 处置 | 需求 |
|---|---|---|---|---|
| 1 | 某模型**不可用 / 被下架**，但 `resolve-model` 硬端点仍可用且能返回替代模型 | **适用** | 按 §4 矩阵降级 | `EVO-019` |
| 2 | `resolve-model` 端点不可用 | **不适用** | 该端点 fail-closed；按 `SPEC-02` 的 L3 处置 | `EVO-019` |
| 3 | **模型网关整体不可用** | **不适用** | L3 中断当前轮次；**不得**以"降级到某模型"替代 L3 | `EVO-019` |
| 4 | 会话类别被声明为 `no-degrade` | **禁止** | 中断并提示；**不得**换模型 | `EVO-019` |
| 5 | 产品层出现按供应商名分支的代码 | 一律拒绝 | CI 静态检查阻断 | `EVO-020` |

**硬性要求**：降级**必须**在事件流与用量归因中可见；跨模型成本**必须**可区分。

---

## 2. 会话类别枚举（矩阵行）

| 类别 id | 定义要点 | 默认是否允许降级 |
|---|---|---|
| `coding-agent` | 长轮次、工具密集的编码会话 | 允许 |
| `qa-research` | 问答 / 检索类会话 | 允许 |
| `batch-scheduled` | 定时批量任务（非交互） | 允许 |
| `compliance-audit` | 审计 / 取证 / 合规导出相关会话 | **`no-degrade`** |
| `approval-critical` | 审批链路上的会话（判定结果进入最小审计集） | **`no-degrade`** |
| `subagent-nested` | 子代理 / 嵌套派发会话 | 允许（须与外层一致，见 §6） |
| `readonly-shared` | 只读共享工作区会话 | 允许 |

---

## 3. 模型类别枚举（矩阵列）

| 类别 id | 定义要点 |
|---|---|
| `primary-reasoning` | 主推理模型 |
| `long-context` | 长上下文模型 |
| `vision-multimodal` | 多模态 / 图像模型 |
| `fast-small` | 低延迟小模型 |
| `non-conversational` | 非对话模型（不参与轮次推理） |

---

## 4. 矩阵（每格：降级目标 / `no-degrade` / `fail-closed` / `不适用`）

> 填表规则：目标**必须**是模型 id 或 `fail-closed`；**不得**留空、**不得**填"自动选择"。`no-degrade` 格**必须**在 §5 登记理由码。

| 会话类别 ＼ 模型类别 | `primary-reasoning` | `long-context` | `vision-multimodal` | `fast-small` | `non-conversational` |
|---|---|---|---|---|---|
| `coding-agent` | `<model-a2>` | `<model-a2-long>` | `fail-closed` | `<model-a2-fast>` | `不适用` |
| `qa-research` | `<model-a2>` | `<model-a2-long>` | `<model-a2-vision>` | `<model-a2-fast>` | `不适用` |
| `batch-scheduled` | `<model-a2>` | `<model-a2-long>` | `不适用` | `fail-closed` | `不适用` |
| `compliance-audit` | `no-degrade`（`ND-1`） | `no-degrade`（`ND-1`） | `不适用` | `不适用` | `不适用` |
| `approval-critical` | `no-degrade`（`ND-2`） | `不适用` | `不适用` | `不适用` | `不适用` |
| `subagent-nested` | `继承外层` | `继承外层` | `继承外层` | `继承外层` | `不适用` |
| `readonly-shared` | `<model-a2>` | `fail-closed` | `fail-closed` | `<model-a2-fast>` | `不适用` |

**`继承外层` 的判定**：内层会话的降级目标**必须**等于当前轮次外层会话的降级目标；外层为 `no-degrade` 时内层**必须**同样中断（**不得**只降内层）。

---

## 5. `no-degrade` 理由码登记

| # | 理由码 | 适用会话类别 | 理由（可判定陈述） | 登记列车号 |
|---|---|---|---|---|
| ND-1 | `AUDIT-CHAIN-INTEGRITY` | `compliance-audit` | 审计 / 取证会话的模型身份是取证链的一部分，换模型使结论不可复核 | `<trainVersion>` |
| ND-2 | `APPROVAL-DECISION-BINDING` | `approval-critical` | 审批判定结果进入最小审计集，模型身份变更使判定不可归因 | `<trainVersion>` |
| ND-3 | `<自定义理由码>` | `<会话类别>` | `<可判定陈述>` | `<trainVersion>` |

**校验**：矩阵中出现 `no-degrade` 而 §5 无对应理由码 ⇒ **拒绝产出 Profile**。

---

## 6. Profile 落盘形态（`modelDegradation`）

> **契约缺口（必须回填）**：`contracts/profile.schema.json` 当前**未定义** `modelDegradation`（不在 `required`、不在 `properties`）。`EVO-019` 的 schema 校验要求因此在契约层尚无落点。

| # | 字段（拟） | 类型 | 必填 | 语义 |
|---|---|---|---|---|
| 1 | `modelDegradation` | object | 是 | 非空；缺失即拒绝产出 Profile |
| 2 | `modelDegradation.rules[]` | array | 是 | 每类会话一条规则 |
| 3 | `rules[].sessionClass` | enum（§2） | 是 | 会话类别 |
| 4 | `rules[].modelClass` | enum（§3） | 是 | 模型类别 |
| 5 | `rules[].onUnavailable` | `{"targetModel": "<id>"}` 或 `{"failClosed": true}` 或 `{"noDegrade": {"reasonCode": "<ND-n>"}}` | 是 | 三选一，**不得**并存 |
| 6 | `modelDegradation.rulesRevision` | string | 是 | 规则版本；与列车号同源登记 |
| 7 | `modelDegradation.subagentPolicy` | `inherit-outer` | 是 | 嵌套派发策略（当前仅允许继承外层） |

**校验规则**

| # | 规则 | 违反处置 | 需求 |
|---|---|---|---|
| V-1 | `modelDegradation` 存在且非空 | 拒绝产出 Profile | `EVO-019` |
| V-2 | `noDegrade` 项**必须**带 `reasonCode`，且理由码在 §5 中存在 | 拒绝产出 Profile | `EVO-019` |
| V-3 | `targetModel` **不得**等于原模型 id（无效降级） | 拒绝产出 Profile | `EVO-019` |
| V-4 | `targetModel` **不得**指向 `state = sunset` 的模型（表 C） | 拒绝产出 Profile | `EVO-019` |
| V-5 | 矩阵无空格、无 `TBD`、无"自动选择" | 拒绝产出 Profile | `EVO-019` |
| V-6 | `rulesRevision` 与 `trainVersion` 成对登记 | 拒绝产出 Profile | `EVO-019` |

---

## 7. 降级事件与跨模型成本归因口径

### 7.1 事件（`EVO-025` 的 `seq` 语义与 D9 的映射登记）

| 字段 | 必填 | 语义 |
|---|---|---|
| `sessionId` / `turnId` / `callId` | 是 | 归因键 |
| `requestedModel` | 是 | 请求的模型 id |
| `requestedModelClass` | 是 | §3 类别 |
| `servedModel` | 是 | 实际服务的模型 id；未降级时等于 `requestedModel` |
| `degradeRuleId` | 条件必填 | 命中降级时必填 |
| `degradeReason` | 条件必填 | `model-unavailable` / `model-sunset` / `resolve-model-substituted` |
| `noDegradeReasonCode` | 条件必填 | 命中 `no-degrade` 时必填（`ND-n`） |
| `seq` | 是 | 单调持久序号；降级事件**必须**占用自身 `seq` |

### 7.2 跨模型成本归因口径表

| 口径 id | 名称 | 定义 | 分列输出 |
|---|---|---|---|
| `CAB-1` | 请求基线 vs 实际服务 | 同时记录"按 `requestedModel` 单价计算的基线成本"与"按 `servedModel` 计算的实收成本" | `baselineCost`、`servedCost`、`costDelta` |
| `CAB-2` | 非对话模型计量 | 按调用次数与单位价格计；不与对话 token 混算 | `unitCalls`、`unitCost` |
| `CAB-3` | 降级归因 | 降级产生的成本差异归入"平台降级"而非"租户用量" | `attributedTo = platform-degradation` |

**硬性要求**

| # | 要求 | 判定 |
|---|---|---|
| R-1 | 同一 `callId` 的基线成本与实收成本**不得**合并为一条不可分的记录 | 合并即不合格 |
| R-2 | 降级事件**必须**出现在事件流（客户端可见）**与**用量归因（计费可见）两处 | 任一缺失即不合格 |
| R-3 | 对账时"少计 / 多计"**必须**分方向列出，且跨模型差异单列一行 | 未分列即不合格 |
| R-4 | 归因键**必须**含 `(tenantId, isolationGroupId, sessionId, turnId, callId)` | 缺键即不合格 |

---

## 8. "某模型下架"演练 SOP

| 步骤 | 动作 | 判定 | 失败处置（回退） |
|---|---|---|---|
| 1 | 在表 C 将该模型置 `deprecated` / `sunset`，登记生效列车号 | 表 C 已更新 | 停止演练 |
| 2 | 校验 Profile 的 `modelDegradation` 覆盖该模型所属类别（V-1 … V-6） | 校验通过 | 拒绝下发 Profile；演练不通过 |
| 3 | 对 `no-degrade` 会话发起一次轮次 | **必须**中断并提示；**不得**换模型 | 出现换模型即不合格 |
| 4 | 对其余会话发起一次轮次 | **必须**按 §4 声明目标降级 | 未降级或降级到未声明目标即不合格 |
| 5 | 检查事件流与用量归因 | 降级事件两处可见；`baselineCost` / `servedCost` / `costDelta` 可分列 | 缺失即不合格 |
| 6 | 检查重新解析路径 | 仅 `resolve-model` 可用路径生效；网关整体不可用时按 L3 中断 | 以降级替代 L3 即不合格 |
| 7 | 回填表 C 的 `degradeMatrixRef` 与演练记录 id | 记录齐备 | 演练未收口 |

---

## 9. 负例清单

| # | 负例 | 期望结果 |
|---|---|---|
| N-1 | Profile 缺 `modelDegradation` | 拒绝产出 Profile |
| N-2 | `no-degrade` 无理由码 | 拒绝产出 Profile |
| N-3 | `targetModel == requestedModel` | 拒绝产出 Profile |
| N-4 | `targetModel` 指向 `sunset` 模型 | 拒绝产出 Profile |
| N-5 | 矩阵留空 / `TBD` | 拒绝产出 Profile |
| N-6 | `no-degrade` 会话被换模型 | 演练不合格 |
| N-7 | 降级事件只出现在用量侧、不在事件流 | 不合格 |
| N-8 | 基线成本与实收成本合并 | 不合格 |
| N-9 | 外层 `no-degrade` 而内层降级 | 不合格 |

---

## 10. 不在本文件范围

| 项 | 归属 |
|---|---|
| 降级级别 L0–L3 / L1b 的定义、滞回与跨作用域聚合规则 | `SPEC-02`（`REL-###`）；`EVO-019` 只要求"策略被定义并落盘" |
| 模型网关、反向网关、`resolve-model` 的实现 | `ENG-###` |
| 供应商分支静态检查与适配器契约测试 | `ENG-###`；判据见 `EVO-020` |
| 计费展示、用量提示与降级提示的用户文案 | `SPEC-04`（`PRD-###`） |
| 供应商状态机与既有会话退化清单 | `docs/evolution/dependency-lifecycle.md` 表 C |
| 降级事件的产品事件名登记 | `docs/evolution/event-mapping-ledger.md` |
