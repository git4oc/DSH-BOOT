# 格式版本台账与备份耦合表（D3）

| 项 | 值 |
|---|---|
| 文档编号 | `EVO-DOC-03` |
| 版本 | 1.0 |
| 状态 | 生效（可填写台账模板 + 前置验证 SOP） |
| 角色 | 演进 / 反脆弱架构师 |
| 交付物 | `SPEC-05` §3 D3 |
| 上游依据 | `SPEC-05` §2.2；设计文档 v2.6 §7.2 格式版本行、§8.7 备份行与区域绑定行、§7.5 快照与保留、§10.2 格式版本行与回滚行、§5.4.1 迁移状态机 |
| 落实的 `EVO-*` | `EVO-007`、`EVO-008`、`EVO-009`、`EVO-010`、`EVO-029` |
| 写作用域 | `docs/evolution/format-version-and-backup.md`（排他） |

---

## 1. 台账形态（`SPEC-05` §3 交付物形态约束）

| 项 | 规定 |
|---|---|
| 人工可读渲染 | §2 表 A、§3 表 B、§4 表 C |
| 结构化真源 | `docs/evolution/format-version-ledger.jsonl`、`docs/evolution/backup-inventory.jsonl`、`docs/evolution/restore-verification.jsonl` |
| 可 diff | 表 A 行**只增**（新增 format 版本）；表 B / 表 C 为追加型记录，**不得**改写历史行 |
| CI 解析契约 | 三张表列名逐字匹配；表 B 缺 `formatVersion` 或 `trainVersion` 即 `EVO_BACKUP_MANIFEST_INCOMPLETE` |
| 实现归属 | 备份服务、恢复工具、manifest schema 的实现归 `ENG-###`；判据归本文件 |

**关键事实（本文件的判据来源）**：`SessionHeader.version` 为**字面量精确相等校验**，旧版本读不了新格式；**"保留旧域"不构成回滚方案**；持久化**无删除接口**、`list()` 无分页无索引 ⇒ 历史会话是**永久负债**。

---

## 2. 表 A：按 `formatVersion` 分组的格式版本台账

| # | 列名 | 类型 / 取值域 | 必填 | 语义 |
|---|---|---|---|---|
| 1 | `formatVersion` | string | 是 | 格式版本标识；与 `SessionHeader.version` 精确相等语义对齐 |
| 2 | `introducedTrainVersion` | string | 是 | 首次引入该 format 版本的列车号（整列车单值） |
| 3 | `frozenDomainCount` | 整数 ≥ 0 | 是 | 冻结在该 format 版本的域数量（来源：`docs/evolution/version-ledger.md` 的 `byFormat` 视图） |
| 4 | `backupPolicyId` | string | 是 | **独立**保留策略 id；每个 format 版本各自一份 |
| 5 | `retentionDays` | 整数 ≥ 1 | 是 | 保留天数（策略字段；不构成对 `SPEC-04` 承诺的表述） |
| 6 | `lastVerifiedAt` | RFC3339 UTC | 是 | 最近一次恢复验证的时间（表 C 的 `verifiedAt`） |
| 7 | `verificationValidUntil` | RFC3339 UTC | 是 | 验证有效期截止；到期未复验即告警 |
| 8 | `recoverability` | `可恢复` / `条件可恢复` / `不可恢复` / `待验证` | 是 | 可恢复性判定结论（规则见 §5） |
| 9 | `verificationId` | string | 是 | 判定所依据的验证记录 id（表 C） |
| 10 | `backupCount` | 整数 ≥ 0 | 是 | 该 format 版本的带外备份条目数 |

**示例行**

| formatVersion | introducedTrainVersion | frozenDomainCount | backupPolicyId | retentionDays | lastVerifiedAt | verificationValidUntil | recoverability | verificationId | backupCount |
|---|---|---|---|---|---|---|---|---|---|
| `session-v1` | `0.2.0-rc.1` | 128 | `bp-fv1-std` | 180 | `2026-01-04T18:00:00Z` | `2026-02-03T18:00:00Z` | `可恢复` | `rv-0001` | 412 |
| `session-v2` | `0.2.0-rc.2` | 6 | `bp-fv2-std` | 180 | `—` | `—` | `待验证` | `—` | 0 |
| `session-v0` | `0.1.9` | 0 | `bp-fv0-hold` | 365 | `2025-11-30T09:00:00Z` | `2025-12-30T09:00:00Z` | `不可恢复` | `rv-0000` | 17 |

第 3 行示例演示：域计数为 0 但备份仍存在 ⇒ 必须保留独立保留策略与验证记录，且到期未复验即告警。

---

## 3. 表 B：备份清单（按 `formatVersion` 耦合登记）

| # | 列名 | 类型 / 取值域 | 必填 | 语义 |
|---|---|---|---|---|
| 1 | `backupId` | string | 是 | 备份唯一标识；回滚入口必填项 |
| 2 | `formatVersion` | string | 是 | **manifest 必含字段 1**；缺失即不得进入可恢复集合 |
| 3 | `trainVersion` | string | 是 | **manifest 必含字段 2**；缺失即不得进入可恢复集合 |
| 4 | `tenantId` | string | 是 | 租户归属（用于驻留台账联动） |
| 5 | `domainId` | string | 是 | 被备份的域 |
| 6 | `createdAt` | RFC3339 UTC | 是 | 备份完成时间 |
| 7 | `outOfBand` | `是` / `否` | 是 | **必须为「是」**；域内自备份不构成回滚依据 |
| 8 | `manifestComplete` | `是` / `否` | 是 | `formatVersion` 与 `trainVersion` 两字段齐备且非空 |
| 9 | `region` | string | 是 | 备份副本所在区域（用于驻留证明） |
| 10 | `sizeBytes` | 整数 ≥ 0 | 是 | 体积 |
| 11 | `checksum` | string | 是 | 完整性校验值 |
| 12 | `encryptedAtRest` | `是` / `否` | 是 | 静态加密标记（密钥与密钥库口径归 `SPEC-01`） |
| 13 | `state` | `可恢复集合` / `隔离待验` / `已过期` / `已销毁` | 是 | 集合归属；缺 manifest 字段者**不得**为「可恢复集合」 |
| 14 | `restoreVerificationId` | string | 否 | 关联验证记录 id |

**示例行**

| backupId | formatVersion | trainVersion | tenantId | domainId | createdAt | outOfBand | manifestComplete | region | sizeBytes | checksum | encryptedAtRest | state | restoreVerificationId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `bk-000001` | `session-v1` | `0.2.0-rc.1` | `tnt-0001` | `dom-a01` | `2026-01-04T02:00:00Z` | 是 | 是 | `rgn-1` | 10737418240 | `sha256:aa11…` | 是 | `可恢复集合` | `rv-0001` |
| `bk-000002` | `session-v2` | `0.2.0-rc.2` | `tnt-0011` | `dom-c11` | `2026-02-26T02:00:00Z` | 是 | 是 | `rgn-1` | 2147483648 | `sha256:bb22…` | 是 | `隔离待验` | `—` |
| `bk-000003` | `（缺）` | `0.2.0-rc.1` | `tnt-0031` | `dom-d31` | `2026-01-04T02:05:00Z` | 是 | 否 | `rgn-2` | 5368709120 | `sha256:cc33…` | 是 | `隔离待验` | `—` |

第 3 行示例为**负例形态**：`manifestComplete = 否` ⇒ 恢复工具在挂载前**必须**拒绝执行。

---

## 4. 表 C：恢复验证记录

| # | 列名 | 类型 / 取值域 | 必填 | 语义 |
|---|---|---|---|---|
| 1 | `verificationId` | string | 是 | 验证记录唯一标识 |
| 2 | `backupId` | string | 是 | 被验证的备份 |
| 3 | `formatVersion` | string | 是 | 验证时的目标 format 版本；**必须**与备份的 `formatVersion` 相等 |
| 4 | `isolatedEnvId` | string | 是 | 隔离环境标识（不得使用生产域） |
| 5 | `restoredSessionCount` | 整数 ≥ 0 | 是 | 恢复出的会话数 |
| 6 | `sourceEventCount` | 整数 ≥ 0 | 是 | 源侧事件数（备份时刻） |
| 7 | `restoredEventCount` | 整数 ≥ 0 | 是 | 恢复后事件数 |
| 8 | `eventCountEqual` | `是` / `否` | 是 | **必须为「是」**；不等即验证失败 |
| 9 | `closerAppended` | 整数 ≥ 0 | 是 | 追加合成的 closer 事件数（恢复语义为"追加"而非回滚） |
| 10 | `conclusion` | `通过` / `失败` / `不适用` | 是 | 验证结论 |
| 11 | `executedBy` | string | 是 | 执行人 |
| 12 | `verifiedAt` | RFC3339 UTC | 是 | 完成时间 |
| 13 | `validUntil` | RFC3339 UTC | 是 | 有效期截止 |
| 14 | `artifactRef` | string | 是 | 报告产物引用（含签名） |

**示例行**

| verificationId | backupId | formatVersion | isolatedEnvId | restoredSessionCount | sourceEventCount | restoredEventCount | eventCountEqual | closerAppended | conclusion | executedBy | verifiedAt | validUntil | artifactRef |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `rv-0001` | `bk-000001` | `session-v1` | `env-iso-01` | 42 | 918234 | 918234 | 是 | 3 | `通过` | `<name>` | `2026-01-04T18:00:00Z` | `2026-02-03T18:00:00Z` | `artifact://rv-0001` |
| `rv-0000` | `bk-000000` | `session-v0` | `env-iso-00` | 0 | 12 | 9 | 否 | 0 | `失败` | `<name>` | `2025-11-30T09:00:00Z` | `2025-12-30T09:00:00Z` | `artifact://rv-0000` |

---

## 5. 可恢复性判定规则

| # | 必要条件 | 不满足时的结论 | 需求 |
|---|---|---|---|
| R-1 | manifest 同时含非空 `formatVersion` 与 `trainVersion` | `不可恢复`；恢复工具**不得**执行 | `EVO-008` |
| R-2 | 备份 `formatVersion` **精确相等**于目标域 `formatVersion` | `不可恢复`；返回 `EVO_FORMAT_INCOMPATIBLE` 且**零写入** | `EVO-010` |
| R-3 | 该 format 版本的最近一次 `conclusion = 通过` 的验证在 `validUntil` 内 | `待验证`；超期即告警 | `EVO-029` |
| R-4 | `eventCountEqual = 是` | `不可恢复` | `EVO-009` |
| R-5 | `outOfBand = 是` | `不可恢复`（域内备份不构成回滚依据） | `EVO-009` |
| R-6 | `checksum` 复算一致 | `不可恢复` | `EVO-029` |
| R-7 | 密钥可用且静态加密可解（密钥口径归 `SPEC-01`） | `不可恢复`；不做降级读取 | `EVO-029` |

**判定值域**
| 结论 | 含义 |
|---|---|
| `可恢复` | R-1 … R-7 全满足 |
| `条件可恢复` | 仅 R-3 不满足（超期待复验），且其余满足；恢复前**必须**先做一次验证 |
| `待验证` | 该 format 版本尚无通过的验证记录 |
| `不可恢复` | R-1 / R-2 / R-4 / R-5 / R-6 / R-7 任一不满足 |

---

## 6. 拦截点与禁止项（拒绝文案要求）

| # | 拦截点 | 动作 | 需求 |
|---|---|---|---|
| B-1 | 迁移状态机步骤 3 / 4 与快照导入接口，**任何写入之前** | 比对 `SessionHeader.version`；不等即拒绝并将迁移置 `FAILED`，**不得**部分写入（目标域事件数不增） | `EVO-007` |
| B-2 | 备份服务 manifest 校验 | 缺 `formatVersion` / `trainVersion` 的备份**不得**进入「可恢复集合」 | `EVO-008` |
| B-3 | 恢复工具入口（挂载前） | 先做 format 版本相等判定；不等即拒绝挂载且目标卷零写入 | `EVO-010` |
| B-4 | 运维编排器的回滚入口 | 必填 `backupId` 与 `formatVersion`；缺任一项即拒绝执行 | `EVO-009` |
| B-5 | 备份服务 | 按 `formatVersion` 分组台账；跨 format 版本互读的表述与实现一律拦截 | `EVO-029` |

**拒绝文案硬性要求**：格式不受支持 **≠** 损坏。拒绝文案**必须**让用户看到"**升级 harness**"这一动作指向，**不得**以"数据损坏 / 无法读取"作为对外措辞。

**禁止项**
| # | 禁止 | 需求 |
|---|---|---|
| X-1 | 把"保留旧域"作为回滚方案 | `EVO-009` |
| X-2 | 跨 format 版本的备份互读 | `EVO-010`、`EVO-029` |
| X-3 | 任何 Runbook 或文档中出现"跨 format 版本可互读"的表述 | `EVO-029` |
| X-4 | format 版本未知的备份进入可恢复集合 | `EVO-008` |
| X-5 | 无独立保留策略 / 无独立验证记录的 format 版本 | `EVO-029` |

---

## 7. `EVO-CP-1` 格式升级前置验证 SOP

| 步骤 | 动作 | 判定 | 失败处置（回退） |
|---|---|---|---|
| 1 | 冻结目标 format 版本与目标列车号，登记到表 A（`recoverability = 待验证`） | 表 A 新行已落盘 | 停止；不进入步骤 2 |
| 2 | 对**升级前**的域做带外备份，登记表 B（`manifestComplete` 必须为「是」） | 表 B 行 `state = 隔离待验` | 停止；重做备份 |
| 3 | 在隔离环境从该备份恢复一个会话，比对事件数，登记表 C | `eventCountEqual = 是` 且 `conclusion = 通过` | **拒绝执行 format 升级** |
| 4 | 回填表 A 的 `lastVerifiedAt` / `verificationValidUntil` / `recoverability` | `recoverability ∈ {可恢复, 条件可恢复}` | 拒绝升级 |
| 5 | 执行 format 升级；升级后域**只**以新 format 版本写盘 | 表 A `frozenDomainCount` 更新；旧 format 域计数不减 | 走带外备份回滚（须填 `backupId` + `formatVersion`） |
| 6 | 记录"旧域不可读"的显式承认：在表 A 备注列登记旧 format 版本的读能力状态 | 有记录 | 升级未收口 |

**回退路径唯一性**：回退**只能**走 §7 步骤 2 的带外备份；"保留旧域"**不得**作为回退路径。

---

## 8. 告警条件

| # | 条件 | 告警等级 | 需求 |
|---|---|---|---|
| A-1 | 任一 `formatVersion` 的最近一次恢复验证超过 `verificationValidUntil` | 高 | `EVO-029` |
| A-2 | 表 B 出现 `manifestComplete = 否` | 高 | `EVO-008` |
| A-3 | 表 A 出现 `recoverability = 不可恢复` 且 `frozenDomainCount > 0` | 最高 | `EVO-009` |
| A-4 | 恢复工具发生拒绝后目标卷发生任何写入 | 最高（安全事件） | `EVO-010` |
| A-5 | 出现未登记的跨区备份副本 | 高（联动驻留台账） | `EVO-031` |

---

## 9. 不在本文件范围

| 项 | 归属 |
|---|---|
| 恢复工具、备份服务、manifest schema 的实现 | `ENG-###` |
| 加密算法与密钥长度、密钥库 / HSM 选型、证书体系 | `SPEC-01`（`SEC-###`） |
| RTO / RPO 的具体数值与故障域矩阵逐格补全 | `SPEC-02`（`REL-###`）；`EVO-027`、`EVO-028` 归其判据 |
| 保留期与删除承诺的对外表述 | `SPEC-04`（`PRD-###`） |
