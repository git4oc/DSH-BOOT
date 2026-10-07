# 事件映射台账（D9）

| 项 | 值 |
|---|---|
| 文档编号 | `EVO-DOC-09` |
| 版本 | 1.0 |
| 状态 | 生效（可填写台账模板 + 回放验证 SOP） |
| 角色 | 演进 / 反脆弱架构师 |
| 交付物 | `SPEC-05` §3 D9 |
| 上游依据 | `SPEC-05` §2.6；设计文档 v2.6 §6.4 事件模型与 SSE（映射表、传输规定、`resync` 语义、反压）、§7.4 恢复与 closer 合成、§6.5 版本协商、§10.2 永久兼容面（会话日志格式只增不改）、§6.3 流式契约 |
| 落实的 `EVO-*` | `EVO-023`、`EVO-024`、`EVO-025` |
| 写作用域 | `docs/evolution/event-mapping-ledger.md`（排他） |

**硬性规则**：映射**只增不改**（新增产品事件**必须**指向既有 DSH 事件）；**一个产品事件对多个 DSH 事件的映射必须显式登记**；产品事件名**不得**原地改名或原地改语义。

---

## 1. 台账形态

| 项 | 规定 |
|---|---|
| 人工可读渲染 | §3 表 A（映射登记）、§4 表 B（一对多显式登记）、§6 表 C（客户端回放验证） |
| 结构化真源 | `docs/evolution/event-mapping.jsonl`、`docs/evolution/event-multi-mapping.jsonl`、`docs/evolution/event-replay-verification.jsonl` |
| 可 diff | 行**只增**；`state` 可改、行不可删（删除映射行即 CI 阻断） |
| CI 解析契约 | 表 A 列名逐字匹配；出现"删除行""修改既有行的 DSH 侧""新增未登记的一对多"即 `EVO_EVENT_MAPPING_BREAK` 阻断发布 |
| 实现归属 | 事件契约门禁、SSE 投递层、客户端回放测试的实现归 `ENG-###`；判据归本文件 |

---

## 2. 表 A 列定义

| # | 列名 | 类型 / 取值域 | 必填 | 语义 |
|---|---|---|---|---|
| 1 | `mappingId` | string（`em-<nnn>`） | 是 | 映射条目唯一标识 |
| 2 | `productEvent` | string | 是 | 产品事件名（对外契约面） |
| 3 | `state` | `active` / `deprecated` | 是 | `deprecated` 表示旧名仍在解析窗口内 |
| 4 | `cardinality` | `1:1` / `1:N` / `N:1` | 是 | 基数；`1:N` **必须**在表 B 有登记 id |
| 5 | `dshEventRefs` | string 列表 | 是 | DSH 侧事件引用；`1:N` 时列出全部 |
| 6 | `explicitMultiEntryId` | string | 条件必填 | `cardinality = 1:N` 必填（表 B 的 `entryId`） |
| 7 | `introducedTrainVersion` | string | 是 | 该映射引入的列车号 |
| 8 | `deprecatedAtTrainVersion` | string | 条件必填 | 产品事件名退役时的列车号（**不是**删除时间） |
| 9 | `legacyParseWindowEndTrainVersion` | string | 条件必填 | 旧名解析窗口截止；**不得**早于一个完整列车周期 |
| 10 | `replayVerificationId` | string | 是 | 客户端回放验证记录 id（表 C） |
| 11 | `semanticsBoundary` | string | 是 | 语义边界说明（哪些字段属于该事件、哪些不属于） |

---

## 3. 表 A：映射登记（示例行）

| mappingId | productEvent | state | cardinality | dshEventRefs | explicitMultiEntryId | introducedTrainVersion | deprecatedAtTrainVersion | legacyParseWindowEndTrainVersion | replayVerificationId | semanticsBoundary |
|---|---|---|---|---|---|---|---|---|---|---|
| `em-001` | `turn.started` | `active` | `1:1` | `turn/start` | — | `0.2.0-rc.1` | — | — | `rp-0001` | 轮次开始；不含模型调用细节 |
| `em-002` | `message.delta` | `active` | `1:1` | `模型流 chunk（文本增量）` | — | `0.2.0-rc.1` | — | — | `rp-0002` | 仅文本增量；推理增量见 `em-003` |
| `em-003` | `reasoning.delta` | `active` | `1:1` | `模型流 chunk（推理增量）` | — | `0.2.0-rc.1` | — | — | `rp-0003` | 仅推理增量；不得计入 `message.delta` |
| `em-004` | `tool.call` | `active` | `1:1` | `tool/call` | — | `0.2.0-rc.1` | — | — | `rp-0004` | 调用发起；不含审批结果 |
| `em-005` | `tool.result` | `active` | `1:1` | `tool/result` | — | `0.2.0-rc.1` | — | — | `rp-0005` | 正常与错误结果；未知结果见 `em-006` |
| `em-006` | `tool.outcome_unknown` | `active` | `1:N` | `tool/result（closer 合成）`、`step/end（未闭合补齐）`、`turn/end{interrupted}` | `mm-001` | `0.2.0-rc.1` | — | — | `rp-0006` | 一等事件；含 `TOOL_OUTCOME_UNKNOWN` / `TOOL_NOT_STARTED` |
| `em-007` | `step.end` | `active` | `1:1` | `step/end` | — | `0.2.0-rc.1` | — | — | `rp-0007` | — |
| `em-008` | `checkpoint` | `active` | `1:N` | `policy 边界事件`、`step/end（策略边界）` | `mm-002` | `0.2.0-rc.1` | — | — | `rp-0008` | 检查点粒度：模型请求前 / 顶层工具副作用前 / 每 `agent/pre-step` |
| `em-009` | `connector.state` | `active` | `1:N` | `supervisor 事件（连接）`、`supervisor 事件（断开）`、`supervisor 事件（工具集变化）` | `mm-003` | `0.2.0-rc.1` | — | — | `rp-0009` | 含工具数突变；重连耗尽导致的工具注销**必须**可见 |
| `em-010` | `approval.requested` | `active` | `1:1` | `approval/asked` | — | `0.2.0-rc.1` | — | — | `rp-0010` | **必须**晚于同 `callId` 的 `tool.call` |
| `em-011` | `approval.decided` | `active` | `1:1` | `approval/decided` | — | `0.2.0-rc.1` | — | — | `rp-0011` | 一次性授权；不得跨 `callId` 复用 |
| `em-012` | `sandbox.mode` | `active` | `1:1` | `sandbox/mode` | — | `0.2.0-rc.1` | — | — | `rp-0012` | 只写日志事件，不进模型历史 |
| `em-013` | `usage` | `active` | `1:1` | `token meter` | — | `0.2.0-rc.1` | — | — | `rp-0013` | 令牌与成本增量；降级成本分列见 D7 |
| `em-014` | `turn.completed` | `active` | `N:1` | `turn/end` | — | `0.2.0-rc.1` | — | — | `rp-0014` | 与 `em-015` / `em-016` / `em-017` 共用一个 DSH 事件，靠终态字段区分 |
| `em-015` | `turn.failed` | `active` | `N:1` | `turn/end` | — | `0.2.0-rc.1` | — | — | `rp-0015` | 同上 |
| `em-016` | `turn.interrupted` | `active` | `N:1` | `turn/end` | — | `0.2.0-rc.1` | — | — | `rp-0016` | 同上；恢复语义务必为"追加合成"而非回滚 |
| `em-017` | `turn.cancelled` | `active` | `N:1` | `turn/end` | — | `0.2.0-rc.1` | — | — | `rp-0017` | 同上；计费分母扣除规则归 `SPEC-04` |
| `em-018` | `domain.degraded` | `active` | `1:1` | `域外判定` | — | `0.2.0-rc.1` | — | — | `rp-0018` | 降级级别变化（含 L1b）；级别定义归 `SPEC-02` |
| `em-019` | `message.delta.legacy` | `deprecated` | `1:1` | `模型流 chunk（文本增量）` | — | `0.2.0-rc.2` | `0.2.0-rc.2` | `0.2.0-rc.4` | `rp-0019` | 旧名保留解析窗口的形态示例 |

**判定**：`N:1` 条目**必须**在 `semanticsBoundary` 写明"靠哪个字段区分"，否则视为语义不可判定。

---

## 4. 表 B：一对多显式登记（`EVO-023` 硬性要求）

| # | 列名 | 语义 |
|---|---|---|
| 1 | `entryId` | 登记 id（表 A 的 `explicitMultiEntryId`） |
| 2 | `productEvent` | 产品事件名 |
| 3 | `dshEventList` | DSH 侧事件清单（逐项列出，**不得**用"等"省略） |
| 4 | `cardinality` | `1:N` |
| 5 | `synthesisSource` | 合成来源（如 `closer 合成` / `policy 边界` / `supervisor 事件`） |
| 6 | `orderGuarantee` | 输出顺序保证（按 `seq` 单调） |
| 7 | `introducedTrainVersion` | 引入列车号 |
| 8 | `registeredBy` / `registeredAt` | 登记人与时间 |

**示例行**

| entryId | productEvent | dshEventList | cardinality | synthesisSource | orderGuarantee | introducedTrainVersion | registeredBy | registeredAt |
|---|---|---|---|---|---|---|---|---|
| `mm-001` | `tool.outcome_unknown` | `tool/result`、`step/end`、`turn/end{interrupted}` | `1:N` | `closer 合成` | 按 `seq` 单调 | `0.2.0-rc.1` | `<name>` | `2026-01-05T00:00:00Z` |
| `mm-002` | `checkpoint` | `policy 边界`、`step/end` | `1:N` | `policy 边界` | 按 `seq` 单调 | `0.2.0-rc.1` | `<name>` | `2026-01-05T00:00:00Z` |
| `mm-003` | `connector.state` | `supervisor（连接）`、`supervisor（断开）`、`supervisor（工具集变化）` | `1:N` | `supervisor 事件` | 按 `seq` 单调 | `0.2.0-rc.1` | `<name>` | `2026-01-05T00:00:00Z` |

---

## 5. `EVO-CP-4` 事件映射 diff 门禁

| # | 校验 | 判定 | 违反处置 | 需求 |
|---|---|---|---|---|
| E-1 | 无删除行 | 相邻两次提交中 `mappingId` 与 `productEvent` 集合只能增大 | `EVO_EVENT_MAPPING_BREAK`；阻断发布 | `EVO-023` |
| E-2 | DSH 侧不可变 | 既有行的 `dshEventRefs` **不得**变更 | 阻断发布 | `EVO-023` |
| E-3 | 一对多已登记 | 出现 `cardinality = 1:N` 时**必须**有表 B 行 | 阻断发布 | `EVO-023` |
| E-4 | 新增产品事件指向既有 DSH 事件 | 不得为新增产品事件引入未登记的新 DSH 事件 | 阻断发布 | `EVO-023` |
| E-5 | 语义边界非空 | `semanticsBoundary` 为空即阻断 | 阻断发布 | `EVO-023` |
| E-6 | 回放记录存在 | 每行 `replayVerificationId` 可解析到表 C | 阻断发布 | `EVO-024` |

---

## 6. `EVO-024` 改名 / 改语义窗口与客户端回放验证

| # | 规定 | 判定 | 需求 |
|---|---|---|---|
| R-1 | 产品事件名**不得**原地改名或原地改语义 | 出现同名不同语义即阻断 | `EVO-024` |
| R-2 | 改名**必须**新增名字并保留旧名**至少一个完整列车周期**的解析窗口 | `legacyParseWindowEndTrainVersion` 满足 | `EVO-024` |
| R-3 | 窗口期内服务端**必须**能同时发出或兼容解析新旧名 | 双发或兼容解析验证通过 | `EVO-024` |
| R-4 | 移除旧名解析前**必须**记录旧名调用计数为 0 | 计数证据存在 | `EVO-024` |
| R-5 | 用历史事件流（旧名）做客户端回放 | 无解析错误、无事件丢失、无重复渲染 | `EVO-024` |

**表 C：客户端回放验证记录**

| # | 列名 | 语义 |
|---|---|---|
| 1 | `verificationId` | 记录 id |
| 2 | `legacyEventName` | 旧名 |
| 3 | `canonicalEventName` | 新名 |
| 4 | `replaySourceRef` | 历史事件流来源标识（含列车号与时间窗） |
| 5 | `replayEvents` | 回放事件数 |
| 6 | `parseErrors` | **必须为 0** |
| 7 | `eventLoss` | **必须为 0** |
| 8 | `duplicateRender` | **必须为 0** |
| 9 | `serverDualEmit` | `是` / `否`（窗口期内必须为「是」） |
| 10 | `conclusion` / `executedBy` / `verifiedAt` | 结论与执行信息 |

**示例行**

| verificationId | legacyEventName | canonicalEventName | replaySourceRef | replayEvents | parseErrors | eventLoss | duplicateRender | serverDualEmit | conclusion | executedBy | verifiedAt |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `rp-0019` | `message.delta.legacy` | `message.delta` | `session-log://tnt-0001/dom-a01@0.2.0-rc.1` | 120483 | 0 | 0 | 0 | 是 | `通过` | `<name>` | `2026-02-27T02:00:00Z` |

---

## 7. `EVO-025` SSE 序号、重连与 `resync` 三要素

### 7.1 传输配置项（记录当前生效值）

| 配置项 | 当前生效值 | 判定规则 | 需求 |
|---|---|---|---|
| `seq` 单调性 | — | **必须**单调且持久；作为 SSE `id` | `EVO-025` |
| 重连续传点 | — | **必须**从 `Last-Event-ID` 的下一个 `seq` 续传 | `EVO-025` |
| `retentionWindowSeconds` | — | **必须** ≥ 最长常见重连间隔；为可取配置值 | `EVO-025` |
| `heartbeatSeconds` | — | **必须** ≤ 15 s（同时满足"空闲超时必须大于客户端心跳"） | `EVO-025` |
| `backpressurePolicy` | — | 慢消费者丢弃并 `resync`；**不得**无界缓冲 | `EVO-025` |

### 7.2 `resync` 帧三要素（缺一即不合格）

| # | 要素 | 字段 | 必填 | 内容要求 |
|---|---|---|---|---|
| 1 | **已丢失区间** | `lostFromSeq` / `lostToSeq` | 是 | 明确区间端点；**不得**用"部分事件"表述 |
| 2 | **期间结论** | `inFlightTurnDisposition` | 是 | 在途轮次处置（继续 / 中断 / 收尾） |
| 2 | **期间结论** | `renderedContentReconciliation` | 是 | 已渲染内容对账方式 |
| 2 | **期间结论** | `tokenDoubleBilling` | 是 | token 是否重复计费（是 / 否及依据） |
| 3 | **静默缺口的用户提示** | `silentGapNotice` | 是 | **必须**为「存在静默缺口」的用户可见提示 |

**判定**：断连时长超过保留窗口后重连，客户端**必须**收到含上述三要素的 `resync` 帧，且**必须**出现"存在静默缺口"的用户提示；三要素任一缺失即不合格（文案归 `SPEC-04`，帧结构归 `ENG-###`）。

---

## 8. 负例清单

| # | 负例 | 期望结果 |
|---|---|---|
| N-1 | 删除一条映射行 | `EVO-CP-4` 阻断发布 |
| N-2 | 修改既有行的 DSH 侧 | 阻断发布 |
| N-3 | 新增未登记的一对多映射 | 阻断发布 |
| N-4 | 产品事件原地改名 | 阻断发布 |
| N-5 | 窗口期 < 一个完整列车周期 | 阻断发布 |
| N-6 | 历史事件流（旧名）客户端回放出现解析错误 / 丢事件 / 重复渲染 | 阻断发布 |
| N-7 | 超窗重连返回的 `resync` 缺"期间结论" | 不合格 |
| N-8 | 无"存在静默缺口"用户提示 | 不合格 |
| N-9 | `heartbeatSeconds > 15` | 不合格 |

---

## 9. 不在本文件范围

| 项 | 归属 |
|---|---|
| SSE 投递层、事件契约门禁、回放测试的实现 | `ENG-###` |
| 降级级别与 `domain.degraded` 的级别取值 | `SPEC-02`（`REL-###`） |
| `resync` 与静默缺口的用户文案、状态页规则 | `SPEC-04`（`PRD-###`） |
| 计费口径（重复计费判定规则的计费侧） | `SPEC-04`（`PRD-###`）；跨模型成本归因见 `docs/evolution/model-degrade-matrix.md` |
| 会话日志格式版本边界 | `docs/evolution/format-version-and-backup.md` |
