# 升级流水线（5 gate）规格与产物（D11）

| 项 | 值 |
|---|---|
| 文档编号 | `EVO-DOC-11` |
| 版本 | 1.0 |
| 状态 | 生效（可填写流水线规格 + 产物模板） |
| 角色 | 演进 / 反脆弱架构师 |
| 交付物 | `SPEC-05` §3 D11 |
| 上游依据 | `SPEC-05` §2.8、§4；设计文档 v2.6 §10.2 升级与兼容（契约门禁行、内核行、格式版本行、回滚行）、§11.4 升级门禁与弃用流程、§11.4.1 P1 分层、§12 演练门禁 |
| 落实的 `EVO-*` | `EVO-032`（主）；依赖 `EVO-001`–`EVO-006`、`EVO-009`、`EVO-021`、`EVO-022`；门禁 `GATE-006` |
| 写作用域 | `docs/evolution/upgrade-pipeline-spec.md`（排他） |

**硬性事实**：**无发行版契约测试套件** ⇒ 契约测试套件为自建；内核 `.d.ts` 快照 diff 的范围**必须**收敛到 4 个反转面（全量包会产生噪声，致门禁失效）。

---

## 1. 流水线总览（顺序固定）

```
前置检查 → G1 契约测试 → G2 .d.ts 快照 diff → G3 列车号一致性 → G4 单批次灰度 → G5 就绪判据复验 → 收口
```

| # | 规则 | 判定 | 需求 |
|---|---|---|---|
| 1 | 五个 gate 顺序**不得**跳步 | 流水线记录每步产物与签名；跳步即拒绝执行 | `EVO-032` |
| 2 | **不得**部分推进 | 任一步未通过即整体停止 | `EVO-032` |
| 3 | 每步**必须**有产物与签名 | 产物表见 §8 | `EVO-032` |
| 4 | G2 未通过时**不得**创建或改动任何域 | 域清单前后比对为空差异 | `EVO-032` |
| 5 | 流水线的实现归 `ENG-###` | 本文件只定义判据与产物字段 | `SPEC-05` §1 判据归口 |

**前置检查不属于额外 gate**：它们是各 gate 的输入（`EVO-CP-1` → G4 前的 format 升级前置验证；`EVO-CP-2` → G4 批次推进校验；`EVO-CP-3` / `EVO-CP-4` / `EVO-CP-5` / `EVO-CP-6` → 对应变更的专属校验）。

---

## 2. 前置检查清单（输入，不是 gate）

| 检查点 | 触发 | 输入产物 | 不通过时 | 需求 |
|---|---|---|---|---|
| `EVO-CP-1` 格式升级前置验证 | 任何 `formatVersion` 变更前 | 带外备份的恢复验证记录（`docs/evolution/format-version-and-backup.md` 表 C） | **拒绝执行 format 升级** | `EVO-009` |
| `EVO-CP-2` 批次推进校验 | 每批次灰度结束时 | 批次域清单 + 列车号（`docs/evolution/version-ledger.md` 的 `byBatch`） | 拒绝推进下一批次 | `EVO-005` |
| `EVO-CP-3` preset 表合并校验 | preset registry 变更 | `docs/evolution/preset-id-registry.md` 表 A / 表 B | 阻断合并 | `EVO-011`、`EVO-012` |
| `EVO-CP-4` 事件映射 diff | 事件契约变更 | `docs/evolution/event-mapping-ledger.md` 表 A / 表 B | 阻断发布 | `EVO-023` |
| `EVO-CP-5` 故障域矩阵补全 | 容量 / 拓扑变更 | 故障域矩阵（`SPEC-02` 归口） | 拒绝发布 | `EVO-027`、`EVO-028` |
| `EVO-CP-6` 弃用执行前校验 | 每次移除弃用件 | `docs/evolution/deprecation-ledger.md` 五列 + 影响面导出 | 阻断移除 | `EVO-022`、`EVO-034` |

---

## 3. G1 契约测试

| 项 | 内容 |
|---|---|
| 输入 | 候选内核版本的 4 个反转面制品（`LlmAdapter`、工具注册桥、`ctx.approval` 应答者、`SessionPersistence` 提供方） |
| 动作 | 运行自建契约测试套件（覆盖：撕裂尾、单写者、closed handle、freshness、**format 拒绝方向**、flush 即物化空会话） |
| 产物 | 契约测试报告（§3.1） |
| 通过判据 | 全部用例通过；6 类覆盖项**必须**各有至少 1 条用例；`format 拒绝方向`须双向各 1 条 |
| 失败处置 | **阻断**；不进入 G2；**不得**改动任何域 |
| 需求 | `EVO-032` |

### 3.1 契约测试报告字段

| # | 字段 | 必填 | 语义 |
|---|---|---|---|
| 1 | `reportId` | 是 | 报告标识 |
| 2 | `candidateTrainVersion` | 是 | 候选列车号（整列车单值） |
| 3 | `artifactId` + `artifactDigest` | 是 | 被测试制品与其摘要（哈希 + 签名校验） |
| 4 | `adapterSurface` | 是 | 被测反转面（**必须** ∈ 4 个反转面） |
| 5 | `cases[]` | 是 | 用例：`caseId`、`coverageItem`（撕裂尾 / 单写者 / closed handle / freshness / format 拒绝方向 / flush 即物化空会话）、`expected`、`observed`、`verdict` |
| 6 | `formatRejectDirection` | 是 | `v_old→v_new` 与 `v_new→v_old` 各一条，且结论为"拒绝" |
| 7 | `summary` | 是 | 通过 / 失败计数 |
| 8 | `verdict` | 是 | `通过` / `失败` |
| 9 | `signature` | 是 | 产物签名 |
| 10 | `generatedAt` / `generatedBy` | 是 | 生成信息 |

---

## 4. G2 内核 `.d.ts` API 快照 diff

| 项 | 内容 |
|---|---|
| 输入 | pin 版本处的内核类型声明快照 与 候选版本的快照 |
| 动作 | 在**4 个反转面范围内**做快照 diff（**不得**全量扫描全部包） |
| 产物 | 快照 diff 报告（§4.1） |
| 通过判据 | **diff 条目数 == 0** |
| 失败处置 | **在第 ② 步阻断**；**不得**创建或改动任何域；**不得**进入 G3 |
| 需求 | `EVO-032`；`GATE-006` 条件 2 |

### 4.1 快照 diff 报告字段

| # | 字段 | 必填 | 语义 |
|---|---|---|---|
| 1 | `reportId` | 是 | 报告标识 |
| 2 | `scopeSurfaces` | 是 | 扫描范围（**必须**恰为 4 个反转面；出现第 5 个面即报告无效） |
| 3 | `baselineRef` | 是 | pin 版本的快照引用 |
| 4 | `candidateRef` | 是 | 候选版本的快照引用 |
| 5 | `diff[]` | 是 | 差异条目：`surface`、`symbol`、`kind`（新增 / 删除 / 签名变更 / 语义注释变更）、`breaking`（是 / 否） |
| 6 | `diffCount` | 是 | **必须为 0** |
| 7 | `domainListBefore` / `domainListAfter` | 是 | 阻断时的域清单快照（**必须**完全一致，证明"零改动"） |
| 8 | `verdict` | 是 | `通过` / `失败` |
| 9 | `signature` / `generatedAt` / `generatedBy` | 是 | 生成信息 |

**负例要求**：用"快照 diff 非空"的负例 ⇒ **必须**在 G2 阻断，且**不得**创建或改动任何域（用第 7 项证明）。

---

## 5. G3 列车号一致性校验

| 项 | 内容 |
|---|---|
| 输入 | Profile 集合、锁文件、插件行清单、格式版本字典 |
| 动作 | 按 `EVO-001`–`EVO-005` 逐条校验 |
| 产物 | 列车一致性报告（§5.1） |
| 通过判据 | `EVO-001`–`EVO-005` 全绿；`EVO-006` 的检测器已就位且配置生效 |
| 失败处置 | **阻断**；不进入 G4 |
| 需求 | `EVO-032`；`GATE-006` 条件 3 |

### 5.1 列车一致性报告字段

| # | 字段 | 必填 | 语义 |
|---|---|---|---|
| 1 | `reportId` / `generatedAt` / `generatedBy` | 是 | 报告标识 |
| 2 | `trainVersionDictionaryRevision` | 是 | 列车号字典版本 |
| 3 | `checks[]` | 是 | 逐条检查：`checkId`（`EVO-001` … `EVO-006`）、`expected`、`observed`、`verdict` |
| 4 | `profileCount` | 是 | 受检 Profile 数 |
| 5 | `rangeCharHits` | 是 | 命中范围符（`^` `~` `*` `latest` / 区间）的条目数（**必须为 0**） |
| 6 | `ambiguousTrainVersionCount` | 是 | `trainVersion` 缺失 / 为数组 / 多值的 Profile 数（**必须为 0**） |
| 7 | `criticalRowDisabledDomains` | 是 | 存在 `disabled` 关键行的域清单（**必须为空**） |
| 8 | `mixedVersionDetectorConfig` | 是 | 检测周期、心跳、聚集窗口、关键行白名单版本（`docs/evolution/mixed-version-report.md` §5） |
| 9 | `verdict` / `signature` | 是 | 结论与签名 |

---

## 6. G4 单批次灰度

| 项 | 内容 |
|---|---|
| 输入 | G1–G3 产物 + 批次划分方案 |
| 动作 | 按域批次灰度；每批次内单列车号；批次推进前过 `EVO-CP-2` |
| 产物 | 灰度记录（§6.1） |
| 通过判据 | 批次内单列车号、同一 `tenantId` 不跨批、每批次有一致性结论 |
| 失败处置 | 拒绝推进下一批次并告警；定位到的域进入排空（`docs/evolution/mixed-version-report.md`） |
| 需求 | `EVO-005`、`EVO-032` |

### 6.1 灰度记录字段

| # | 字段 | 必填 | 语义 |
|---|---|---|---|
| 1 | `rolloutId` | 是 | 灰度标识 |
| 2 | `batchId` / `batchSeq` | 是 | 批次标识与序号 |
| 3 | `batchTrainVersion` | 是 | 批次列车号（**单值**） |
| 4 | `domains[]` | 是 | 域清单：`domainId`、`tenantId`、`isolationGroupId`、`trainVersion`、`formatVersion` |
| 5 | `tenantBatchReport` | 是 | 同租户是否跨批的判定结果（**必须**为"无跨批"） |
| 6 | `cp2Conclusion` | 是 | `EVO-CP-2` 结论（`通过` / `拒绝推进`） |
| 7 | `drainedDomains[]` | 是 | 本批次内被排空的域与原因 |
| 8 | `startedAt` / `endedAt` | 是 | 起止时间 |
| 9 | `verdict` / `signature` | 是 | 结论与签名 |

---

## 7. G5 就绪判据复验

| 项 | 内容 |
|---|---|
| 输入 | 灰度后处于 `ready` / `active` 的域清单 + 域外证据（镜像摘要、挂载摘要、运行时配置快照、Profile 生成摘要） |
| 动作 | 对**复验域集合**逐域复验就绪判据；并检出"灰度后新增域" |
| 产物 | 就绪复验记录（§7.1） |
| 通过判据 | 复验域全部就绪；**无**灰度后新增且未复验的域；关键行无 `disabled`；工具面 == `toolAllowlist` |
| 失败处置 | **阻断后续批次**；新增域**必须**纳入下一批复验或摘域 |
| 需求 | `EVO-032`；`EVO-003`、`EVO-004` |

### 7.1 就绪复验记录字段

| # | 字段 | 必填 | 语义 |
|---|---|---|---|
| 1 | `recordId` / `reverifiedAt` / `reverifiedBy` | 是 | 记录标识 |
| 2 | `domainSetBaseline` | 是 | G4 结束时刻的域清单（基线） |
| 3 | `domainSetObserved` | 是 | 复验时刻的域清单（实测） |
| 4 | `newDomainsAfterBatch` | 是 | 灰度后新增域（**必须为空**，否则阻断后续批次） |
| 5 | `readinessEvidence[]` | 是 | 逐域域外证据：`imageDigest`、`mountDigest`、`runtimeConfigDigest`、`profileGenerationDigest` |
| 6 | `criticalRowDisabled` | 是 | 逐域关键行断言结果 |
| 7 | `toolFaceEqualsAllowlist` | 是 | 逐域工具面断言结果（域外判定） |
| 8 | `attestCrossCheck` | 是 | 域内上报指纹与域外推定的交叉核验结果（不一致 ⇒ 摘域） |
| 9 | `verdict` / `signature` | 是 | 结论与签名 |

**负例要求**：用"第 ④ 步后新增一个域"的负例 ⇒ G5 **必须**检出并阻断后续批次。

---

## 8. 产物通用要求

| # | 列名 | 必填 | 语义 |
|---|---|---|---|
| 1 | `artifactId` | 是 | 产物标识 |
| 2 | `gate` | 是 | `G1` / `G2` / `G3` / `G4` / `G5` |
| 3 | `path` | 是 | 产物存放位置（可寻址） |
| 4 | `inputDigest` | 是 | 输入摘要（制品 / 快照 / Profile 集合） |
| 5 | `conclusion` | 是 | 通过 / 失败 |
| 6 | `signature` | 是 | 签名（**每步必须签名**） |
| 7 | `generatedAt` / `generatedBy` | 是 | 生成信息 |
| 8 | `supersedes` | 否 | 被本产物取代的旧产物 id（重跑时必填） |

**产物表（填写用）**

| artifactId | gate | path | inputDigest | conclusion | signature | generatedAt | generatedBy | supersedes |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

---

## 9. 失败处置与回滚入口

| # | 情形 | 处置 | 需求 |
|---|---|---|---|
| F-1 | G1 失败 | 阻断；修复后从 G1 重跑 | `EVO-032` |
| F-2 | G2 失败（diff 非空） | 阻断；**不得**创建或改动任何域；进入适配层改造或垫片评估 | `EVO-032`、`EVO-021` |
| F-3 | G3 失败 | 阻断；修正 Profile 与锁文件 | `EVO-032` |
| F-4 | G4 失败（租户跨批 / 批次内多列车号） | 拒绝推进；批次重划 | `EVO-005` |
| F-5 | G5 失败（新增域未复验 / 关键行 `disabled`） | 阻断后续批次；相关域排空 | `EVO-032`、`EVO-004` |
| F-6 | 需要回滚 | 运维编排器**必填** `backupId` 与 `formatVersion`；缺任一项即拒绝执行 | `EVO-009` |
| F-7 | 回滚前提 | 该备份**必须**在升级前完成可恢复性验证；"保留旧域"**不得**作为回滚方案 | `EVO-009` |

---

## 10. `GATE-006` 通过条件对照

| # | `GATE-006` 条件 | 本流水线的落点 | 产物 |
|---|---|---|---|
| 1 | 契约测试通过 | G1 | 契约测试报告（§3.1） |
| 2 | 内核 `.d.ts` API 快照 diff 为空 | G2 | 快照 diff 报告（§4.1） |
| 3 | 无混版（`EVO-001`–`EVO-006` 全绿） | G3 + 周期检测 | 列车一致性报告（§5.1）+ 混版检测报告 |
| 4 | `EVO-032` 的 5 个 gate 全部有产物 | G1–G5 | 产物表（§8） |
| 5 | `EVO-021` 垫片状态已登记 | 前置 + 收口 | 弃用台账（`docs/evolution/deprecation-ledger.md`） |

---

## 11. 负例清单

| # | 负例 | 期望结果 |
|---|---|---|
| N-1 | 快照 diff 非空 | 在 G2 阻断，且域清单前后一致（零改动） |
| N-2 | 第 ④ 步后新增一个域 | G5 检出并阻断后续批次 |
| N-3 | 跳步执行（跳过 G3 直接 G4） | 流水线拒绝执行 |
| N-4 | 批次内出现两个列车号 | `EVO-CP-2` 拒绝推进 |
| N-5 | 同一租户两域分处两批 | `EVO-CP-2` 拒绝推进 |
| N-6 | 某 Product 的 `trainVersion` 写成 `^0.2.0-rc.1` | 镜像构建失败 |
| N-7 | 回滚入口未填 `formatVersion` | 拒绝执行回滚 |
| N-8 | 快照 diff 范围扩到全部包 | 报告无效（scope 不合法） |

---

## 12. 不在本文件范围

| 项 | 归属 |
|---|---|
| 流水线、CI 门禁、契约测试套件、快照 diff 工具的实现 | `ENG-###` |
| 内核自身路线图（哪些端点会被弃用） | 上游（DSH 发行方）；本文件只规定"弃用发生时我方必须怎么做" |
| RTO / RPO 数值、演练门禁判定 | `SPEC-02`（`REL-###`） |
| 维护窗口、SLA 与赔偿的对外表述 | `SPEC-04`（`PRD-###`） |
| 各变化场景的逐步 Runbook 与必填项 | `docs/evolution/change-runbooks.md` |
