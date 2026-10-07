# preset id 注册表（D4）

| 项 | 值 |
|---|---|
| 文档编号 | `EVO-DOC-04` |
| 版本 | 1.0 |
| 状态 | 生效（可填写注册表模板） |
| 角色 | 演进 / 反脆弱架构师 |
| 交付物 | `SPEC-05` §3 D4 |
| 上游依据 | `SPEC-05` §2.3；设计文档 v2.6 §10.2 永久兼容面（preset id / 三处持久痕迹 / 平台级不变量 / 删除前扫描）、§5.4.1 迁移状态机、§11.1 preset 行；`contracts/profile.schema.json` 的 `presetId` |
| 落实的 `EVO-*` | `EVO-011`、`EVO-012`、`EVO-013`、`EVO-014`、`EVO-015`、`EVO-016` |
| 写作用域 | `docs/evolution/preset-id-registry.md`（排他） |

**本表最硬的一条**：preset id **只增不删、不得复用**；退役只能实现为"保留定义 + 标记 deprecated"。**preset 缺失则拒绝恢复**。

---

## 1. 注册表形态

| 项 | 规定 |
|---|---|
| 人工可读渲染 | §3 表 A（全量 id）、§4 表 B（别名映射）、§5 表 C（引用统计） |
| 结构化真源 | `docs/evolution/preset-registry.jsonl`、`docs/evolution/preset-alias-map.jsonl`、`docs/evolution/preset-usage-stats.jsonl` |
| 可 diff | 表 A 行**只增**；`state` 可改、行不可删（删除行即 CI 阻断） |
| CI 解析契约 | 表 A 列名逐字匹配；相邻两次提交出现"删除行"或"id 复用且定义体摘要变化"即 `EVO_PRESET_ID_REMOVED` / `EVO_PRESET_ID_REUSED` 阻断 |
| 实现归属 | registry 与其写入校验的实现归 `ENG-###`；判据归本文件 |

---

## 2. 列定义

| # | 列名 | 类型 / 取值域 | 必填 | 语义 |
|---|---|---|---|---|
| 1 | `presetId` | string（发布后不可变） | 是 | 平台级唯一 id；**不得**复用 |
| 2 | `state` | `active` / `deprecated` / `alias` | 是 | `alias` 行的 `presetId` 为旧名，`aliasOf` 指向新定义 |
| 3 | `definitionDigest` | string | 是 | 定义体的内容寻址摘要；**不得**对同一 `presetId` 原地改写摘要（`EVO-012`） |
| 4 | `toolFaceFingerprint` | string | 是 | 该 preset 的工具面指纹（工具名 + schema 哈希集合） |
| 5 | `aliasOf` | string | 条件必填 | 仅 `state = alias` 必填；必须指向一个存在的 `presetId` |
| 6 | `introducedTrainVersion` | string | 是 | 首次发布所在列车号（整列车单值） |
| 7 | `deprecatedAtTrainVersion` | string | 条件必填 | `state = deprecated` 时必填；**不得**为删除时间 |
| 8 | `replacedBy` | string | 条件必填 | 替代 id；必须存在且 `state = active` |
| 9 | `sessionRefCount` | 整数 ≥ 0 | 是 | 引用该 id 的会话数（含历史会话；历史会话是永久负债） |
| 10 | `approvalRuleRefCount` | 整数 ≥ 0 | 是 | 审批规则引用数 |
| 11 | `lastReferencedAt` | RFC3339 UTC | 是 | 最近一次被引用时间；用于"计划移除"的零调用判定 |
| 12 | `resolvableDomainScope` | string（域集合标识） | 是 | 可解析该 id 的域集合；用于 `EVO-016` 子集判定 |

---

## 3. 表 A：全量 id 清单（示例行）

| presetId | state | definitionDigest | toolFaceFingerprint | aliasOf | introducedTrainVersion | deprecatedAtTrainVersion | replacedBy | sessionRefCount | approvalRuleRefCount | lastReferencedAt | resolvableDomainScope |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `coding` | `active` | `sha256:11aa…` | `sha256:f001…` | — | `0.2.0-rc.1` | — | — | 18432 | 6 | `2026-01-05T04:00:00Z` | `scope:all-active` |
| `qa-readonly` | `active` | `sha256:22bb…` | `sha256:f002…` | — | `0.2.0-rc.1` | — | — | 1204 | 0 | `2026-01-05T03:50:00Z` | `scope:all-active` |
| `coding-v2` | `active` | `sha256:33cc…` | `sha256:f003…` | — | `0.2.0-rc.2` | — | — | 0 | 0 | `—` | `scope:fv2-only` |
| `coding-legacy` | `alias` | `sha256:11aa…` | `sha256:f001…` | `coding` | `0.2.0-rc.2` | — | `coding` | 902 | 2 | `2026-01-05T02:30:00Z` | `scope:all-active` |
| `batch-ops` | `deprecated` | `sha256:44dd…` | `sha256:f004…` | — | `0.2.0-rc.1` | `0.2.0-rc.2` | `qa-readonly` | 17 | 0 | `2025-12-19T11:00:00Z` | `scope:all-active` |

**示例说明**：`coding-legacy` 是"改名 = 新增 + 保留别名"的形态；`batch-ops` 是"保留定义 + 标记 deprecated"的形态，其 `definitionDigest` 与工具面**必须**保持可解析。

---

## 4. 表 B：别名映射

| 列名 | 语义 |
|---|---|
| `aliasId` | 旧 id（对外、历史会话与历史 Profile 中出现过的名字） |
| `canonicalId` | 当前规范 id |
| `canonicalDefinitionDigest` | 规范 id 的定义体摘要；必须与表 A 同行一致 |
| `aliasAddedAtTrainVersion` | 别名登记列车号 |
| `aliasWindowEndTrainVersion` | 别名解析窗口截止列车号；**不得**早于"一个完整列车周期" |
| `resolutionOrder` | 解析序（`exact → alias → deprecated+replacedBy`） |

**示例行**

| aliasId | canonicalId | canonicalDefinitionDigest | aliasAddedAtTrainVersion | aliasWindowEndTrainVersion | resolutionOrder |
|---|---|---|---|---|---|
| `coding-legacy` | `coding` | `sha256:11aa…` | `0.2.0-rc.2` | `0.2.0-rc.4` | `exact → alias` |
| `batch-ops` | `qa-readonly` | `sha256:22bb…` | `0.2.0-rc.2` | `0.2.0-rc.4` | `exact → alias → deprecated+replacedBy` |

---

## 5. 表 C：引用统计（删除前扫描口径）

| 列名 | 语义 |
|---|---|
| `presetId` | 被统计的 id |
| `statWindowStart` / `statWindowEnd` | 统计窗口（同一窗口不得跨列车号混算） |
| `sessionsCreated` | 窗口内新建会话引用数 |
| `migrationResolutions` | 迁移路径解析次数 |
| `approvalRuleRefs` | 审批规则引用数 |
| `restoreResolutions` | 恢复路径解析次数 |
| `zeroCallDays` | 连续"零引用"天数（用于移除条件判定） |

**判定**：移除/退役动作**必须**以 `zeroCallDays` 与 `lastReferencedAt` 为输入；`sessionRefCount > 0` 的 id **不得**被移除（历史会话是永久负债）。

---

## 6. 写入校验（`EVO-CP-3` preset 表合并校验）

| # | 校验 | 判定 | 违反处置 | 需求 |
|---|---|---|---|---|
| V-1 | 无删除 | 相邻两次提交中 `presetId` 集合只能增大 | `EVO_PRESET_ID_REMOVED`；阻断合并 | `EVO-011` |
| V-2 | 无复用 | 历史上出现过的 `presetId` **不得**以不同 `definitionDigest` 重新出现 | `EVO_PRESET_ID_REUSED`；阻断合并 | `EVO-011` |
| V-3 | 改名形状 | 改名接口**只**接受 `{newId, aliasOf}`；直接修改既有 id 的定义体必须被拒 | 阻断；要求改为新增 + 别名 | `EVO-012` |
| V-4 | 别名完整 | 每个 `state = alias` 行**必须**有 `aliasOf`，且 `aliasOf` 指向存在行 | 阻断 | `EVO-012` |
| V-5 | deprecated 保留 | `state = deprecated` 行的定义体与工具面**必须**仍可解析 | 阻断 | `EVO-011` |
| V-6 | 引用一致性 | 表 C 的 `presetId` 集合 ⊇ 表 A 的 `presetId` 集合 | 阻断（统计缺失） | `EVO-016` |
| V-7 | 工具面一致 | 同名 id 的工具面指纹在相邻版本间变化时，**必须**伴随"新增 id + 别名"记录 | 阻断 | `EVO-012` |

---

## 7. 三处持久痕迹一致性断言（`EVO-013`）

| # | 痕迹 | 载体 | 断言 |
|---|---|---|---|
| T-1 | `SessionHeader.agentPreset` | 会话头（不可变） | 值 ∈ 表 A 的 `presetId` 与表 B 的 `aliasId` 并集 |
| T-2 | `agent-preset/selected` 事件 | 会话事件日志 | 与 T-1 解析到同一规范 id |
| T-3 | `agentPreset` 会话投影 | 投影缓存 | 与 T-1 / T-2 **一致**；重建**必须**读投影（或三处并读并断言） |

**恢复流水线断言表**

| # | 断言 | 不满足时 | 需求 |
|---|---|---|---|
| A-1 | T-1 / T-2 / T-3 三处解析到同一规范 id | 报 `EVO_PRESET_TRACE_INCONSISTENT`，**拒绝继续恢复** | `EVO-013` |
| A-2 | 任一处缺失（含"删投影保留 header"） | **必须**被检出；只读 header 的实现判**不合格** | `EVO-013` |
| A-3 | 规范 id 在目标域可解析 | 目标域**不得**作为迁移目标 | `EVO-016` |
| A-4 | 规范 id 的 `definitionDigest` 与创建时一致 | 拒绝恢复（preset 缺失则拒绝恢复） | `EVO-011` |

**负例**：删掉 T-3 投影、保留 T-1 header ⇒ 恢复**必须**失败并给出 `EVO_PRESET_TRACE_INCONSISTENT`。

---

## 8. 会话创建后 preset 不可变（`EVO-014`）

| # | 规定 | 判定 | 需求 |
|---|---|---|---|
| I-1 | 会话创建后 preset **不得**变更 | 注册桥在运行期拒绝任何 preset 重写请求并记入最小审计集 | `EVO-014` |
| I-2 | 域内**不得**执行 `select` / `recompose` 写路径 | 域内触发 `recompose` 的负例**必须**被拒 + 一条硬审计记录 | `EVO-014` |
| I-3 | 子集例外（若实现选择保留） | **必须**在 Profile 中显式声明；工具面**非子集**的换 preset 负例**必须**被拒 | `EVO-014` |

**Profile 声明字段（示例形态）**

| 字段 | 取值 | 语义 |
|---|---|---|
| `presetImmutability` | `strict` / `create-window-subset` | `strict` = 创建后完全不可变；`create-window-subset` = 仅创建窗口内且新工具面为原集合子集 |
| `presetImmutabilityReason` | string | 选择非 `strict` 时的理由码 |

---

## 9. 迁移目标子集判定（`EVO-016`）

| 步骤 | 动作 | 判定 | 失败处置 |
|---|---|---|---|
| 1 | 域外维护"preset 引用全集" = 全平台历史会话引用过的全部 preset id（含别名解析后的规范 id） | 全集非空且带版本戳 | 暂停迁移（判定不可执行） |
| 2 | 取候选目标域的可解析集合（表 A 的 `resolvableDomainScope` ∖ `不可解析清单`） | 集合可导出 | 排除该候选 |
| 3 | 子集判定：目标域可解析集合 ⊇ 全集 | 成立 | 不成立即从候选集排除并记审计，**必须**给出缺失 id 清单 |
| 4 | 落库判定结果 | 迁移目标已定 | 无法定目标 ⇒ 迁移不发起 |

**负例**：某域缺一个历史 preset ⇒ **必须**拒绝该目标域并输出缺失 id。

---

## 10. 引用计数与"删除前扫描"报告

| 报表 | 键 | 输出 | 用途 |
|---|---|---|---|
| `presetUsageByTenant` | `tenantId` × `presetId` | `sessionRefCount`、`lastReferencedAt` | 退役影响面评估 |
| `presetResolvability` | `domainId` | 缺失 id 清单 | `EVO-016` 子集判定输入 |
| `aliasWindowStatus` | `aliasId` | `aliasWindowEndTrainVersion`、剩余窗口 | 别名窗口到期告警 |

**告警**：`aliasWindowEndTrainVersion` 已过而旧名仍被解析，或窗口结束前出现"零引用即可移除"的提议，**必须**告警并阻断。

---

## 11. 不在本文件范围

| 项 | 归属 |
|---|---|
| registry、别名接口、注册桥拦截、投影重建工具的实现 | `ENG-###` |
| 硬审计记录的内容与 WORM 保全 | `SPEC-01`（`SEC-###`） |
| 换 preset 请求对用户的可见文案 | `SPEC-04`（`PRD-###`） |
| 工具名历史与改名记录 | `docs/evolution/tool-name-history.md`（同目录另一交付物） |
