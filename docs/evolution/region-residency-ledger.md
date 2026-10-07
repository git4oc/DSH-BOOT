# 区域与驻留台账 + 驻留证明导出（D10）

| 项 | 值 |
|---|---|
| 文档编号 | `EVO-DOC-10` |
| 版本 | 1.0 |
| 状态 | 生效（可填写台账模板 + 证明导出模板） |
| 角色 | 演进 / 反脆弱架构师 |
| 交付物 | `SPEC-05` §3 D10 |
| 上游依据 | `SPEC-05` §2.7；设计文档 v2.6 §7.1 加密与驻留（区域绑定、跨区复制需显式开启并登记、证明须覆盖全部副本）、§7.5 保留与销毁（删除证明）、§8.7 区域绑定行与备份行、§6.2 Profile 字段 |
| 落实的 `EVO-*` | `EVO-026`、`EVO-031`；交叉 `EVO-029`（备份与 format 版本耦合）、`EVO-030`（密钥轮换重叠期） |
| 写作用域 | `docs/evolution/region-residency-ledger.md`（排他） |

**范围边界**：本文件只覆盖**驻留证明的完整性**（覆盖全部区域、全部副本、全部 format 版本备份）。DSR 的受理→定位→删除→证明**流程与安全口径**归 `SPEC-01`（`SEC-###`）；加密算法、密钥长度、密钥库 / HSM 选型不在规格集范围内。

---

## 1. 台账形态

| 项 | 规定 |
|---|---|
| 人工可读渲染 | §2 表 A（租户驻留绑定）、§3 表 B（副本清单）、§4 表 C（驻留证明导出物） |
| 结构化真源 | `docs/evolution/residency-binding.jsonl`、`docs/evolution/residency-replica-inventory.jsonl`、`docs/evolution/residency-proof.jsonl` |
| 可 diff | 表 A / 表 B 追加型；副本条目**不得**删除（删除/驻留的处置记录保留并置 `state`） |
| CI 解析契约 | 表 B 列名逐字匹配；出现"未登记区域"或"缺任一副本条目"即 `EVO_RESIDENCY_PROOF_INCOMPLETE` |
| 实现归属 | 证明生成器、存储层位置标签审计的实现归 `ENG-###`；判据归本文件 |

---

## 2. 表 A：租户驻留绑定

| # | 列名 | 类型 / 取值域 | 必填 | 语义 |
|---|---|---|---|---|
| 1 | `tenantId` | string | 是 | 租户标识 |
| 2 | `residencyRegion` | string | 是 | 该租户绑定的驻留区域；`Profile` 的 `residencyRegion` 必须与本值一致 |
| 3 | `isolationGroupIds` | string 列表 | 是 | 该租户的全部隔离组 |
| 4 | `domainIds` | string 列表 | 是 | 该租户的全部域（含已退役域） |
| 5 | `crossRegionReplication` | `开` / `关` | 是 | **默认关**；开启即须登记 |
| 6 | `crossRegionRegistrationId` | string | 条件必填 | `crossRegionReplication = 开` 必填 |
| 7 | `effectiveFrom` | RFC3339 UTC | 是 | 绑定生效时间 |
| 8 | `profileResidencyAssert` | `通过` / `失败` | 是 | 域启动时"Profile 区域 == 域所在区域"的断言结果；失败即拒绝 ready |
| 9 | `lastLocationAuditAt` | RFC3339 UTC | 是 | 存储层位置标签的最近一次周期性审计时间 |

**示例行**

| tenantId | residencyRegion | isolationGroupIds | domainIds | crossRegionReplication | crossRegionRegistrationId | effectiveFrom | profileResidencyAssert | lastLocationAuditAt |
|---|---|---|---|---|---|---|---|---|
| `tnt-0001` | `rgn-1` | `iso-0001`, `iso-0002` | `dom-a01`, `dom-a02` | `关` | — | `2026-01-05T00:00:00Z` | `通过` | `2026-01-05T04:00:00Z` |
| `tnt-0011` | `rgn-1` | `iso-0011` | `dom-c11` | `开` | `xrr-0007` | `2026-02-26T00:00:00Z` | `通过` | `2026-02-26T04:00:00Z` |
| `tnt-0031` | `rgn-2` | `iso-0031` | `dom-d31` | `关` | — | `2025-12-28T00:00:00Z` | `失败` | `2026-01-05T04:00:00Z` |

第 3 行示例：`profileResidencyAssert = 失败` ⇒ 该域**拒绝 ready**，且**不得**进入迁移候选集。

---

## 3. 表 B：副本清单（按租户 × 区域 × 副本类型）

| # | 列名 | 类型 / 取值域 | 必填 | 语义 |
|---|---|---|---|---|
| 1 | `tenantId` | string | 是 | 租户 |
| 2 | `region` | string | 是 | 副本所在区域 |
| 3 | `replicaKind` | `域卷` / `对象存储` / `快照` / `带外备份` / `审计 WORM` / `workspace 卷` / `attachments` / `spill` / `FTS 派生库` | 是 | 副本类型 |
| 4 | `replicaId` | string | 是 | 副本标识 |
| 5 | `formatVersion` | string | 条件必填 | `带外备份` / `快照` / `FTS 派生库` 必填；**每个 format 版本各占一行** |
| 6 | `registered` | `是` / `否` | 是 | 是否已登记；为「否」即判不合格 |
| 7 | `completedAt` | RFC3339 UTC | 是 | **完成时间**：该副本被登记为"写入 / 复制完成"的时间戳（来源为副本所在存储的域外回执） |
| 8 | `encryptedAtRest` | `是` / `否` | 是 | 静态加密标记（口径归 `SPEC-01`） |
| 9 | `active` | `是` / `否` | 是 | 是否属于当前活跃域；为「否」仍**必须**列入证明（`EVO-031`） |
| 10 | `state` | `present` / `pending-delete` / `deleted` / `held` | 是 | 副本状态；`held` = 合法扣留（审计留存） |

**示例行**

| tenantId | region | replicaKind | replicaId | formatVersion | registered | completedAt | encryptedAtRest | active | state |
|---|---|---|---|---|---|---|---|---|---|
| `tnt-0001` | `rgn-1` | `域卷` | `vol-dom-a01` | `session-v1` | 是 | `2026-01-05T02:11:07Z` | 是 | 是 | `present` |
| `tnt-0001` | `rgn-1` | `对象存储` | `obj-sessions-dom-a01` | `session-v1` | 是 | `2026-01-05T02:11:12Z` | 是 | 是 | `present` |
| `tnt-0001` | `rgn-1` | `快照` | `snap-dom-a01-20260104` | `session-v1` | 是 | `2026-01-04T02:00:00Z` | 是 | 否 | `present` |
| `tnt-0001` | `rgn-1` | `带外备份` | `bk-000001` | `session-v1` | 是 | `2026-01-04T02:00:00Z` | 是 | 否 | `present` |
| `tnt-0001` | `rgn-1` | `带外备份` | `bk-000010` | `session-v2` | 是 | `2026-02-26T02:00:00Z` | 是 | 否 | `present` |
| `tnt-0001` | `rgn-1` | `审计 WORM` | `worm-tnt-0001` | — | 是 | `2026-01-05T04:00:00Z` | 是 | 是 | `held` |
| `tnt-0001` | `rgn-1` | `workspace 卷` | `vol-ws-a01` | — | 是 | `2026-01-05T02:00:00Z` | 是 | 是 | `present` |
| `tnt-0001` | `rgn-1` | `attachments` | `att-dom-a01` | — | 是 | `2026-01-05T01:40:00Z` | 是 | 是 | `present` |
| `tnt-0001` | `rgn-1` | `spill` | `spill-dom-a01` | — | 是 | `2026-01-05T01:41:00Z` | 是 | 是 | `present` |
| `tnt-0001` | `rgn-1` | `FTS 派生库` | `fts-dom-a01` | `session-v1` | 是 | `2026-01-05T01:45:00Z` | 是 | 是 | `present` |
| `tnt-0011` | `rgn-2` | `对象存储` | `obj-sessions-dom-c11` | `session-v2` | **否** | `2026-02-26T03:00:00Z` | 是 | 是 | `present` |

第 11 行示例为负例形态：未登记的跨区副本 ⇒ 判**不合格**。

---

## 4. 表 C：驻留证明导出物

| # | 列名 | 类型 | 必填 | 语义 |
|---|---|---|---|---|
| 1 | `proofId` | string | 是 | 证明唯一标识 |
| 2 | `tenantId` | string | 是 | 证明对象租户（**必须**按租户逐一出具） |
| 3 | `generatedAt` | RFC3339 UTC | 是 | 生成时间 |
| 4 | `regionCount` | 整数 ≥ 1 | 是 | 覆盖的区域数 |
| 5 | `replicaEntryCount` | 整数 ≥ 1 | 是 | 覆盖的副本条目数 |
| 6 | `coveredReplicaKinds` | string 列表 | 是 | 覆盖的副本类型（**必须**含 `带外备份`，且每个 `formatVersion` 各一行） |
| 7 | `coverageCheck` | `通过` / `失败` | 是 | 完整性校验结论（规则见 §5） |
| 8 | `missingEntries` | string 列表 | 是 | 缺失区域 / 缺失副本条目（为空才算通过） |
| 9 | `unregisteredCrossRegion` | 整数 ≥ 0 | 是 | 未登记的跨区副本数（**必须为 0**） |
| 10 | `hashChainRef` | string | 是 | 证据哈希链引用 |
| 11 | `signerRef` | string | 是 | 签署标识（签名密钥口径归 `SPEC-01`） |
| 12 | `artifactRef` | string | 是 | 导出产物引用（可验证） |
| 13 | `conclusion` | `合格` / `不合格` | 是 | 最终结论 |

**示例行**

| proofId | tenantId | generatedAt | regionCount | replicaEntryCount | coveredReplicaKinds | coverageCheck | missingEntries | unregisteredCrossRegion | hashChainRef | signerRef | artifactRef | conclusion |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `prf-0001` | `tnt-0001` | `2026-01-05T04:05:00Z` | 1 | 10 | `域卷`, `对象存储`, `快照`, `带外备份`, `审计 WORM`, `workspace 卷`, `attachments`, `spill`, `FTS 派生库` | `通过` | — | 0 | `hc://prf-0001` | `<signer>` | `artifact://prf-0001` | `合格` |
| `prf-0002` | `tnt-0011` | `2026-02-26T04:05:00Z` | 2 | 3 | `域卷`, `对象存储` | `失败` | `region=rgn-2 副本未登记`, `缺 带外备份(session-v1)` | 1 | `hc://prf-0002` | `<signer>` | `artifact://prf-0002` | `不合格` |

---

## 5. 完整性判定规则（`EVO-031`）

| # | 条件 | 不满足时的结论 | 需求 |
|---|---|---|---|
| P-1 | 覆盖该租户**全部驻留区域**内的全部数据副本 | `不合格`，并列出缺失区域 | `EVO-031` |
| P-2 | 把"**各 format 版本的带外备份副本**"纳入清单（每个 format 版本至少一行） | `不合格`，并列出缺失 format 版本 | `EVO-031` |
| P-3 | **不得**只覆盖当前活跃域的数据（`active = 否` 的副本仍必须列入） | `不合格` | `EVO-031` |
| P-4 | 每个副本条目**必须**含 `completedAt` | `不合格` | `EVO-031` |
| P-5 | `unregisteredCrossRegion == 0` | `不合格`（未登记跨区副本即判不合格） | `EVO-026` |
| P-6 | 副本集合 ⊇ 表 A 声明的区域集合 × 副本类型全集 | `不合格` | `EVO-026`、`EVO-031` |

**副本类型全集**（证明**必须**逐类覆盖）：`域卷`、`对象存储`、`快照`、`带外备份`（按 format 版本分行）、`审计 WORM`、`workspace 卷`、`attachments`、`spill`、`FTS 派生库`。

---

## 6. 区域绑定与断言（`EVO-026`）

| # | 规定 | 判定点 | 失败处置 | 需求 |
|---|---|---|---|---|
| B-1 | 每个租户**必须**绑定一个驻留区域 | Profile 生成 | 拒绝产出 Profile | `EVO-026` |
| B-2 | 会话日志、workspace、快照、审计记录**不得**离开该区域 | 存储层位置标签周期审计（detective） | 告警 + 摘域 | `EVO-026` |
| B-3 | 跨区复制**必须**显式开启并登记 | `crossRegionReplication` + `crossRegionRegistrationId` | 未登记即判不合格 | `EVO-026` |
| B-4 | Profile 的 `residencyRegion` **必须**与本域所在区域一致 | 域启动断言 | 拒绝 ready | `EVO-026` |
| B-5 | 区域分布报表**必须**能按租户列出所有数据副本所在区域 | 报表可导出 | 报表缺失即不合格 | `EVO-026` |

---

## 7. 完成时间的定义与取证

| # | 项 | 规定 |
|---|---|---|
| 1 | `completedAt` 语义 | 该副本被登记为"写入 / 复制完成"的时间戳；**来源**为副本所在存储的**域外回执**，不得使用域内自报时间 |
| 2 | 时钟偏差 | 域外回执时间与副本存储时间不一致时，取**较晚**者登记 |
| 3 | 不可省略 | 任一副本条目缺 `completedAt` ⇒ 证明判不合格 |
| 4 | 快照与缓冲 | 温/零态切换产生的快照**必须**含投影缓存与未上传缓冲，其 `completedAt` 以快照写完成回执为准 |
| 5 | 审核 | 证明导出物**必须**带哈希链引用与签署标识，可被第三方复算 |

---

## 8. 周期性审计与告警

| # | 条件 | 处置 | 需求 |
|---|---|---|---|
| A-1 | 出现未登记的跨区副本 | 最高级告警 + 摘域评审 | `EVO-026` |
| A-2 | 证明缺任一区域或任一副本条目 | 判不合格并阻断合规报表发布 | `EVO-031` |
| A-3 | 表 B 出现 `registered = 否` | 告警并阻断证明出具 | `EVO-031` |
| A-4 | `域卷` / `对象存储` 副本的 `completedAt` 落后于会话日志 `flush` 水位 | 告警（RPO 相关数值口径归 `SPEC-02`） | `EVO-026` |
| A-5 | 某 format 版本的带外备份副本未列入证明 | 告警；联动 `docs/evolution/format-version-and-backup.md` 表 A | `EVO-029`、`EVO-031` |

---

## 9. 不在本文件范围

| 项 | 归属 |
|---|---|
| DSR 受理→定位→删除→证明的流程与安全口径、披露义务 | `SPEC-01`（`SEC-###`） |
| 加密算法、密钥长度、密钥库 / HSM 选型、证书体系 | `SPEC-01`（`SEC-###`）；`EVO-030` 的轮换预演验收项见 `docs/evolution/change-runbooks.md` |
| 故障域矩阵的跨 AZ 单列与 RTO/RPO 数值 | `SPEC-02`（`REL-###`）；`EVO-027`、`EVO-028` 归其判据 |
| 数据驻留的对外承诺与合同条款 | `SPEC-04`（`PRD-###`） |
| 证明生成器、报表与审计入库的实现 | `ENG-###` |
