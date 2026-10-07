# 混版检测报告（D2）

| 项 | 值 |
|---|---|
| 文档编号 | `EVO-DOC-02` |
| 版本 | 1.0 |
| 状态 | 生效（可填写报告模板） |
| 角色 | 演进 / 反脆弱架构师 |
| 交付物 | `SPEC-05` §3 D2 |
| 上游依据 | `SPEC-05` §2.1；设计文档 v2.6 §6.3 `/internal/kernel/attest` 请求字段、§6.5 版本协商、§4.1.2 判据 5/6、§9.2 摘域与降级、§10.2 内核行 |
| 落实的 `EVO-*` | `EVO-006`（主）；引用 `EVO-003`、`EVO-004`、`EVO-005` |
| 写作用域 | `docs/evolution/mixed-version-report.md`（排他） |

---

## 1. 报告形态

| 项 | 规定 |
|---|---|
| 实例路径 | `docs/evolution/reports/mixed-version-<YYYYMMDDThhmmssZ>-<domainId>.md` |
| 索引真源 | `docs/evolution/reports/mixed-version-index.jsonl`（一行一报告：`reportId`、`domainId`、`detectedAt`、`detectionIntervalSeconds`、`verdict`） |
| 生成时机 | 周期一致性检查命中，或 attest 返回 `deny` / `drain-domain`，或 `tools-change` 指纹漂移 |
| 唯一性 | 一个域一次检出一个 `reportId`；同一域重复检出**不得**覆盖前一份报告 |
| 判定归口 | 本报告给出"合格 / 不合格"判据；检测器与排空的**实现**归 `ENG-###` |

---

## 2. 报告头（必填项，缺项即报告无效）

| # | 字段 | 取值 / 格式 | 缺失后果 |
|---|---|---|---|
| 1 | `reportId` | `mvr-<YYYYMMDDThhmmssZ>-<domainId>` | 报告无效，不得进入审计 |
| 2 | `detectedAt` | RFC3339 UTC | 报告无效 |
| 3 | `trigger` | `boot` / `tools-change` / `heartbeat` / `periodic` | 报告无效 |
| 4 | `detectionIntervalSeconds` | 整数（当前生效配置值） | 判定"是否在一个检测周期内检出"不可执行 |
| 5 | `domainId` / `tenantId` / `isolationGroupId` | string | 报告无效 |
| 6 | `profileId` 与 Profile 生成摘要 | string | 无法区分"Profile 错"与"域内漂移" |
| 7 | `expectedTrainVersion` | string（来自 Profile / 批次） | 报告无效 |
| 8 | `observedTrainVersion` | string（来自 attest 上报） | 报告无效 |
| 9 | `detectorVersion` | string | 报告不可复核 |
| 10 | `drainRequired` | 是 / 否 | 报告无效 |
| 11 | `author` / `reviewer` | 姓名 + 角色 | 报告未签署，不得作为排空依据 |

---

## 3. 三要素差异清单（`EVO-006` 硬性要求）

> **判定规则**：三项**必须**同时给出，且每一项**必须**含"期望值 / 实测值 / 差异类型"。只报"版本不一致"的报告**判不合格**。

### 3.1 要素 ① 列车号

| 项 | 内容 |
|---|---|
| 期望值（Profile / 批次） | `<expectedTrainVersion>` |
| 实测值（域 attest 上报） | `<observedTrainVersion>` |
| 差异类型 | `缺失` / `不等` / `多值` / `范围符写法` |
| 判定 | 不等 ⇒ 混版成立；`EVO_TRAIN_VERSION_AMBIGUOUS` 走 Profile 生成阻断，不在本报告范围 |

### 3.2 要素 ② 实际加载的插件行与版本清单

| 行名 | 期望版本（== `trainVersion`） | 实测版本 | 实测状态（`loaded` / `disabled`） | 是否关键行（白名单） | 差异类型 |
|---|---|---|---|---|---|
| `@deepseek-ai/dsh-tools` | `<trainVersion>` | `<ver>` | `loaded` | 是 | 无 |
| `@deepseek-ai/dsh-session-persistence` | `<trainVersion>` | `<ver>` | `loaded` | 是 | 无 |
| `@deepseek-ai/cordis` | `<trainVersion>` | `<ver>` | `loaded` | 是 | 无 |
| `<可选行名>` | `<trainVersion>` | `<ver>` | `disabled` | 否 | 版本不等 |

**判定规则**：
- 出现 `disabled` 且**属于关键行白名单** ⇒ 域**不得**进入 `ready`，且本报告必填第 4 节。
- 出现 `disabled` 且**不属于**关键行白名单 ⇒ 记录但**不**阻断 `ready`。
- 任意行的实测版本 ≠ 期望版本 ⇒ 混版成立。

### 3.3 要素 ③ 工具集指纹（工具名 + schema 哈希）

| 工具名 | schema 哈希（期望） | schema 哈希（实测） | 在 `toolAllowlist` | `requireApproval` | 差异类型 |
|---|---|---|---|---|---|
| `mcp__<serverName>__<rawName>` | `sha256:…` | `sha256:…` | 是 | 否 | 无 |
| `mcp__<serverName>__<rawName2>` | `sha256:…` | `（缺失）` | 是 | 是 | 已注销 |
| `<新增工具名>` | `（不存在）` | `sha256:…` | 否 | — | 越清单注册 |

**判定规则**：
- 指纹集合不相等（多、少、哈希变更任一项）⇒ 混版成立。
- 出现"越清单注册"条目 ⇒ 同时触发白名单外注册的硬审计（归 `SPEC-01`）。
- 出现"已注销"条目 ⇒ 记录该 connector 的重连耗尽状态与重载需求（归 `SPEC-02`）。

---

## 4. 排空动作记录（必填）

| 步骤 | 动作 | 开始时间 | 完成时间 | 结果 | 阻塞项 | 执行人 | 审计记录 id |
|---|---|---|---|---|---|---|---|
| 1 | 停止向该域分配新会话与新 turn | | | `完成` / `部分` / `失败` | | | |
| 2 | 在途轮次收尾（closer 合成）并 `flush` | | | | | | |
| 3 | 会话迁移或声明只读（**迁移前先过 `EVO-016` 的 preset 可解析子集判定**） | | | | | | |
| 4 | 摘域 / 域重建为单一列车号 | | | | | | |
| 5 | 重建后复验三要素（重跑 §3） | | | | | | |
| 6 | 关闭报告并回填本表 | | | | | | |

**排空判定**：3 与 4 至少完成其一，且 5 的三要素全绿；否则本报告结论**必须**为「未完成排空」，并转入 Runbook（见 `docs/evolution/change-runbooks.md`）。

---

## 5. 检出周期与检测器配置（记录当前生效值）

| 配置项 | 当前生效值 | 判定规则 | 需求 |
|---|---|---|---|
| `periodicCheckIntervalSeconds` | | 每个 `ready` / `active` 域**必须**至少被覆盖一次 | `EVO-006` |
| `heartbeatIntervalSeconds` | | attest 心跳间隔；与 SSE 心跳（≤ 15 s）分列 | `EVO-006` |
| `attestBootRequired` | 是 | 域启动**必须**先 attest 后 ready | `EVO-003` |
| `alertAggregationWindowSeconds` | | 同租户多域告警**必须**聚合，避免告警风暴 | `EVO-006` |
| `drainOnDetect` | 是 | 检出即排空（preventive 处置动作），不得仅告警 | `EVO-006` |
| `criticalRowAllowlistRevision` | | 关键行白名单的版本号；与 Profile 同源登记 | `EVO-004` |

---

## 6. 结论与判定

| # | 合格条件 | 结论 |
|---|---|---|
| 1 | 三要素差异清单齐备，每项含期望值 / 实测值 / 差异类型 | 合格 / 不合格 |
| 2 | 报告在检出时刻的**一个检测周期内**产出（`detectedAt` − 首次异常 ≤ `periodicCheckIntervalSeconds`） | 合格 / 不合格 |
| 3 | 排空动作 6 步全部有起止时间与结果 | 合格 / 不合格 |
| 4 | 排空后复验三要素全绿 | 合格 / 不合格 |
| 5 | 报告已签署（`author` + `reviewer`） | 合格 / 不合格 |

**任一不合格的处置**：保留报告、不关闭；按 `docs/evolution/change-runbooks.md` 的内核升级 Runbook 第 3、5 gate 重新执行，并复核 `docs/evolution/version-ledger.md` 的 L-4 / L-5 / L-9 / L-10。

---

## 7. 负例清单（必须能被本模板检出）

| # | 负例 | 期望结果 |
|---|---|---|
| N-1 | 某域回退到旧列车号 | 一个检测周期内产出三要素差异清单 + `drainRequired = 是` |
| N-2 | 运行期替换某包的版本文件 | 下一次 `boot` / `heartbeat` attest 检出要素 ② 差异 |
| N-3 | 关键行 peer 不匹配被静默 `disabled` 而域照常启动 | 要素 ② 标出 `disabled` 且"是关键行"；报告强制 `drainRequired = 是` |
| N-4 | 域外控制的受控 MCP 推送新增工具 | 要素 ③ 出现"越清单注册"行，且新工具**不得**进入模型可见集 |
| N-5 | 只写"版本不一致"的报告 | 按 §6 条件 1 判**不合格** |

---

## 8. 不在本文件范围

| 项 | 归属 |
|---|---|
| 检测器、attest 服务、Session Router 排空动作的实现 | `ENG-###` |
| 白名单外注册尝试的审计与取证 | `SPEC-01`（`SEC-###`） |
| 排空期间的降级级别与告警阈值 | `SPEC-02`（`REL-###`） |
| 排空/只读状态下对用户可见的文案 | `SPEC-04`（`PRD-###`） |
