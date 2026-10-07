# 版本台账（D1）

| 项 | 值 |
|---|---|
| 文档编号 | `EVO-DOC-01` |
| 版本 | 1.0 |
| 状态 | 生效（可填写台账模板） |
| 角色 | 演进 / 反脆弱架构师 |
| 交付物 | `SPEC-05` §3 D1 |
| 上游依据 | `SPEC-05` §2.1；设计文档 v2.6 §6.2 `trainVersion`、§6.3 `/internal/kernel/attest`、§6.5 版本协商、§10.2 内核行与格式版本行、§11.1 版本策略；`contracts/profile.schema.json` 的 `trainVersion` |
| 落实的 `EVO-*` | `EVO-001`、`EVO-002`、`EVO-003`、`EVO-004`、`EVO-005`、`EVO-006` |
| 写作用域 | `docs/evolution/version-ledger.md`（排他） |

---

## 1. 台账的形态（`SPEC-05` §3 交付物形态约束）

| 项 | 规定 |
|---|---|
| 人工可读渲染 | 本文件 §3 表格；表头列名与 §2 字段名逐字一一对应 |
| 结构化真源路径 | `docs/evolution/version-ledger.jsonl`（一行一个域记录，UTF-8，键名与 §2 一致） |
| 可 diff | 记录**只增**；域退役只改 `state`，**不得**删除行 |
| CI 解析契约 | 只解析 §3 表头；列名缺失或为空即 `EVO_LEDGER_SCHEMA_MISSING_COLUMN` 阻断 |
| 生成器 / 写入器实现 | 归 `ENG-###`；本文件只定义字段、判据与校验 |
| 判据归口 | 规则与判据归本文件；实现形态归 `ENG-###` |

**关键事实（本文件的判据来源）**：`@deepseek-ai/*` 的 peer 是**无范围精确 pin**；版本**不匹配的行被静默 `disabled`，而域照常启动**——因此"域起来了"不构成版本正确的证据，`trainVersion` **必须**由 attest 逐值比对并由本台账留痕。持久化**无删除接口**、`list()` 无分页无索引 ⇒ 历史会话是**永久负债**，本台账的记录**只增不删**。

**范围边界**：本台账不定义 SLO 数值（归 `SPEC-02`），不定义 Profile 校验实现（归 `SPEC-03`）。

---

## 2. 字段定义（列定义）

| # | 字段名（列名） | 类型 / 取值域 | 必填 | 语义与判定 |
|---|---|---|---|---|
| 1 | `domainId` | string | 是 | 域标识，平台内唯一 |
| 2 | `tenantId` | string | 是 | 租户标识；用于"同一租户不得跨批"判定 |
| 3 | `isolationGroupId` | string | 是 | 隔离组标识；路由键的一半 |
| 4 | `trainVersion` | string | 是 | **恰好一个值**（`EVO-001`）；**不得**含 `^` `~` `*` `latest` 或区间写法（`EVO-002`）；取值必须 ∈ 列车号字典 |
| 5 | `formatVersion` | string | 是 | 域**冻结**的会话日志格式版本；与 `SessionHeader.version` 精确相等语义一致 |
| 6 | `firstWriteAt` | RFC3339 UTC | 是 | 该域**首次以 `formatVersion` 落盘事件**的时间；`flush` 屏障确认前不得置为已写 |
| 7 | `batchId` | string | 是 | 灰度批次归属；**同一批次只允许一个 `trainVersion`** |
| 8 | `batchTrainVersion` | string | 是 | 批次声明的列车号；必须 `== trainVersion`（`EVO-005`） |
| 9 | `state` | `provisioning` / `ready` / `active` / `draining` / `drained` / `retired` / `failed` | 是 | 附加列。`drained` 表示已退出轮转且不再接收会话 |
| 10 | `lastAttestAt` | RFC3339 UTC | 否 | 附加列。最近一次 `/internal/kernel/attest` 的 `boot` / `tools-change` / `heartbeat` 上报时间（`EVO-003`） |
| 11 | `pluginSetDigest` | string | 否 | 附加列。实际加载的插件行与版本的摘要；差异清单见 `docs/evolution/mixed-version-report.md` |
| 12 | `toolFingerprintId` | string | 否 | 附加列。工具集指纹（工具名 + schema 哈希）的登记 id；明细见 `docs/evolution/mixed-version-report.md` |
| 13 | `criticalRowDisabled` | 是 / 否 | 是 | 附加列。是否存在被 `disabled` 的**关键平台行**（白名单内）；为「是」即域不得 `ready`（`EVO-004`） |

**列语义约束**：第 4–8 列是 `SPEC-05` §3 D1 点名的最小集合，**不得**删列、**不得**改名；第 9–13 列为附加列，可扩展但**不得**替换最小集合。

---

## 3. 示例行（格式示范，不构成判据）

| domainId | tenantId | isolationGroupId | trainVersion | formatVersion | firstWriteAt | batchId | batchTrainVersion | state | lastAttestAt | pluginSetDigest | toolFingerprintId | criticalRowDisabled |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `dom-a01` | `tnt-0001` | `iso-0001` | `0.2.0-rc.1` | `session-v1` | `2026-01-05T02:11:07Z` | `bt-2026w02-a` | `0.2.0-rc.1` | `active` | `2026-01-05T02:41:00Z` | `sha256:9f1c…` | `tf-0001` | 否 |
| `dom-a02` | `tnt-0001` | `iso-0002` | `0.2.0-rc.1` | `session-v1` | `2026-01-05T02:13:44Z` | `bt-2026w02-a` | `0.2.0-rc.1` | `active` | `2026-01-05T02:41:00Z` | `sha256:9f1c…` | `tf-0001` | 否 |
| `dom-b07` | `tnt-0007` | `iso-0007` | `0.2.0-rc.1` | `session-v1` | `2026-01-05T03:02:19Z` | `bt-2026w02-a` | `0.2.0-rc.1` | `ready` | `2026-01-05T03:31:00Z` | `sha256:9f1c…` | `tf-0001` | 否 |
| `dom-c11` | `tnt-0011` | `iso-0011` | `0.2.0-rc.2` | `session-v2` | `—` | `bt-2026w09-b` | `0.2.0-rc.2` | `provisioning` | `—` | `—` | `—` | 否 |
| `dom-d31` | `tnt-0031` | `iso-0031` | `0.2.0-rc.1` | `session-v1` | `2025-12-28T22:40:00Z` | `bt-2026w09-a` | `0.2.0-rc.1` | `draining` | `2026-01-05T04:00:00Z` | `sha256:9f1c…` | `tf-0001` | 是 |

第 5 行示例用于演示"关键行 `disabled` ⇒ 不得 `ready` ⇒ 进入 `draining`"的记录形态。

---

## 4. CI 不变量（逐条对应需求与门禁）

| # | 不变量 | 判定 | 违反处置 | 需求 |
|---|---|---|---|---|
| L-1 | `trainVersion` 存在且唯一 | 列缺失、为空、或出现两个值时，Profile 生成返回 `EVO_TRAIN_VERSION_AMBIGUOUS` 并拒绝落盘 | 阻断产出 | `EVO-001` |
| L-2 | 无范围符 | `trainVersion` / `batchTrainVersion` 匹配 `^[~^*]` 或含比较运算符即失败 | 阻断镜像产出 | `EVO-002` |
| L-3 | 域内全部 `@deepseek-ai/*` 行版本 `== trainVersion` | 与 `pluginSet` / 锁文件逐条比对，任一不等即失败 | 阻断镜像产出 | `EVO-002` |
| L-4 | 批次内单列车号 | 同一 `batchId` 出现 ≥2 个 `trainVersion` 即失败（`EVO-CP-2`） | 拒绝推进下一批次 | `EVO-005` |
| L-5 | 租户不跨批 | 同一 `tenantId` 的任意两域 `batchId` 落在不同列车号的批次即失败 | 拒绝推进并告警 | `EVO-005` |
| L-6 | 批次列车号与域列车号一致 | 逐行 `batchTrainVersion == trainVersion` | 阻断 | `EVO-005` |
| L-7 | 无未知 `formatVersion` | 取值必须 ∈ format 版本字典（`docs/evolution/format-version-and-backup.md` §2） | 阻断；标记域不可迁移 | `EVO-008` |
| L-8 | 一域一格式 | 同一 `domainId` 在任一时间窗内**不得**出现两个 `formatVersion` 的写入记录 | 阻断；进入 `failed` 并摘域 | `EVO-007` |
| L-9 | 关键行断言 | `criticalRowDisabled` 为「是」时 `state` **不得**为 `ready` / `active` | 拒绝 ready 并告警 | `EVO-003`、`EVO-004` |
| L-10 | 检测覆盖 | 每个 `state ∈ {ready, active}` 的域，`lastAttestAt` 距今**不得**超过一个检测周期 | 触发混版检测报告 | `EVO-006` |
| L-11 | 记录只增 | 相邻两次提交中 `domainId` 集合只能增大；`state` 可改、行不可删 | 阻断合并 | `EVO-006` |

---

## 5. 导出视图（按租户 / 按批次）

| 视图 | 键 | 输出列 | 用途 |
|---|---|---|---|
| `byTenant` | `tenantId` | `domainId`、`isolationGroupId`、`trainVersion`、`batchId`、`state` | 判定租户是否整体处于单一列车；支持"同一租户两域分处两批"的负例复核 |
| `byBatch` | `batchId` | `domainId`、`tenantId`、`trainVersion`、`formatVersion`、`firstWriteAt` | `EVO-CP-2` 批次推进校验输入 |
| `byTrain` | `trainVersion` | 域计数、租户计数、`formatVersion` 分布 | 灰度进度与混版风险面 |
| `byFormat` | `formatVersion` | 域清单、最早 `firstWriteAt`、最近 `firstWriteAt` | 备份耦合分组的输入（见 `docs/evolution/format-version-and-backup.md`） |
| `drainCandidates` | — | `state ∈ {draining, failed}` 或 `criticalRowDisabled = 是` 的域 | 排空动作队列；明细记录见 `docs/evolution/mixed-version-report.md` |

**导出要求**：任一视图**必须**为机器可读（JSONL / CSV），且**必须**携带导出时刻与该时刻的列车号字典版本，供事后复核。

---

## 6. 记录时机与责任

| 时机 | 必须写入 / 更新 | 需求 |
|---|---|---|
| Profile 生成成功且域创建请求落库 | 新增行，`state = provisioning`，填入 `trainVersion` / `formatVersion`（`firstWriteAt` 留空） | `EVO-001`、`EVO-002` |
| 域首次 `flush` 后 | 回填 `firstWriteAt` | `EVO-008` |
| 域进入 `ready` | 置 `state = ready`，写 `lastAttestAt`、`pluginSetDigest`、`toolFingerprintId`、`criticalRowDisabled` | `EVO-003`、`EVO-004` |
| 每次 `boot` / `tools-change` / `heartbeat` attest | 更新 `lastAttestAt` 与两项摘要 | `EVO-003`、`EVO-006` |
| 检出混版 | 置 `state = draining` 并链接检测报告 id | `EVO-006` |
| 域退役 | 置 `state = retired`，**保留行**（历史会话为永久负债，删除无接口） | `EVO-006` |

---

## 7. 错误码登记（本台账相关）

| 错误码 | 触发点 | 语义 |
|---|---|---|
| `EVO_TRAIN_VERSION_AMBIGUOUS` | Profile 生成 | `trainVersion` 缺失 / 为数组 / 含两个值 |
| `EVO_LEDGER_SCHEMA_MISSING_COLUMN` | CI 解析本台账 | 点名列缺失或为空 |
| `EVO_MIXED_VERSION_DETECTED` | 周期一致性检查 | 三要素差异命中；报告见 `docs/evolution/mixed-version-report.md` |
| `EVO_CRITICAL_ROW_DISABLED` | 域启动断言 | 关键平台行被 `disabled` ⇒ 拒绝 `ready` |

---

## 8. 填写检查清单（提交前逐项签字）

| # | 检查项 | 结论 |
|---|---|---|
| 1 | 本次变更是否新增了域行（而非改写历史行） | 是 / 否 |
| 2 | 新增域的 `trainVersion` 是否与所属批次一致 | 是 / 否 |
| 3 | 新增域是否引入了新的 `formatVersion` | 是 / 否（若「是」⇒ 必须先过 `EVO-CP-1`） |
| 4 | `trainVersion` 字典是否同步更新 | 是 / 否 |
| 5 | `byTenant` / `byBatch` 两个视图是否导出并附时刻戳 | 是 / 否 |
| 6 | L-1 … L-11 是否全部通过 | 是 / 否 |
