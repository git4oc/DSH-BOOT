# dsh-boot 工程手册（原 README）

> **版本说明**：开源整理时原 README.md 改写为面向外部的仓库首页，本手册承接其内容。⚠️ 原 README 的 §1（权威顺序精确原文）与 §2（文档地图）在改写中遗失且仓库无 git 历史，**待恢复**；其余各节按会话已知内容重建。

| 项 | 值 |
|---|---|
| 文档编号 | `GOV-DOC-01` |
| 用途 | 工程纪律、门禁速查、缺口台账、变更记录（内部开发用） |
| 上游依据 | [spec/00-规格总纲.md](../spec/00-规格总纲.md) §7（门禁定义） |

---

## 1. 权威顺序（冲突时）

⚠️ **原文遗失，待恢复。** 已知结论（从纪律块与规格集校验器行为反推）：

- `spec/` 是开发约束；冲突时按权威顺序处理，不得自行选择。
- 不得自造需求 ID；发现缺条款先走 `SPEC-00` §8 变更控制。
- 判据以目标架构为准，不以本机现状为准（D13）。

**精确的裁定顺序列表需项目所有者提供原文后补录。**

## 2. 文档地图

⚠️ **原文遗失，待恢复。** 已知结构：设计文档（DSH企业级技术方案设计.md）→ `spec/`（00 总纲 / 01 安全 / 02 可靠性 / 03 实现 / 04 产品 / 05 演进）→ `docs/`（交付物，50 份，由 `lint-docs.mjs` 校验）→ `contracts/`（机器可读契约）→ `evidence/`（门禁证据）。

## 3. 开发者入口（按你要做的事）

各阶段任务的最小必读集见 [PLAYBOOK.md](../PLAYBOOK.md)（16 个阶段的开工提示词，每个含"先读"清单）。

## 4. 门禁速查

| 门禁 | runner | 证据 |
|---|---|---|
| `GATE-001` | `pnpm gate:001`（dev/gate.mjs） | `evidence/GATE-001/` |
| `GATE-002` | `node tools/gate002-evidence.mjs` + `node tools/windows-acl-probe.mjs` | `evidence/GATE-002/` |
| `GATE-003` | `node tools/run-drills.mjs`（3/6，DRL-03/04/06 如实 blocked） | `evidence/GATE-003/drills/drill-report.json` |
| `GATE-004` | `pnpm contract:pool`（6/6） | 契约输出 |
| `GATE-005` | `pnpm contract:session-ops` + `pnpm contract:lifecycle` | 契约输出 |
| `GATE-006` | `pnpm gate:006` + `node tools/run-upgrade-pipeline.mjs` | `evidence/UPGRADE-P5/` |

## 5. 校验

```bash
node tools/lint-specs.mjs && node tools/check-gates.mjs && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
```

四个全过才收工；另有 `pnpm check-deps`（层依赖）、`pnpm check:id-format`（需求 ID 格式）、`pnpm typecheck`、`pnpm check:sdk-sync`（SDK 与 OpenAPI 一致）。

## 6. 缺口台账（运行期验证项，诚实登记）

| # | 项 | 状态 | 缺什么 |
|---|---|---|---|
| 1 | GATE-002 条件 9（Windows 容器内 ACL 实测） | **fail**（Windows 禁入多租户隔离） | Windows 容器运行时 |
| 2 | GATE-003 演练 3/6（DRL-03/04/06） | **blocked** | 核内连接器控制器 / 降级阶梯桩 / 多节点拓扑 |
| 3 | PP-01…PP-35 实测回填 | **blocked** | 目标机型压测环境（D13）；全部以示例推导值 + 待压测回填标注 |
| 4 | Runbook 演练（100x 扩容/供应商弃用/域失陷/监管变更） | **blocked** | 多节点拓扑 / 真实依赖 / 容器基础设施 / 条款文本 |

## 7. 常用命令之外的一条纪律

做不到就说"做不到 + 缺什么"，不要猜、不要编数字。

## 8. 变更记录

| 版本 | 变更 |
|---|---|
| **1.10** | **阶段 P3–P4（GATE-005/006）**：身份/RBAC/配额/公平调度/计费（`packages/control-plane/src/identity-quota/`：JWT+RBAC、workspace 授权时序、超额租户按比例限速、turnId 幂等去重）；四目录（`registry/`：Plugin/Connector/Skill/Scenario，层级合法性域外判定、例外 connector 按域上限）；Session Router/历史查询/保留删除 DSR/取证（`session-ops/`：自建索引、WORM 哈希链、DSR 全清单八类）；SDK 生成器（`tools/gen-sdk.mjs`，51 操作，`check:sdk-sync`）+ SSO/SCIM（停用 5 min 失效）+ 降级阶梯（跃迁表/滞回/下发通道）；升级流水线五道 gate（`tools/run-upgrade-pipeline.mjs` + P-1/P-2/P-3 复核，evidence/UPGRADE-P5）；L2 层（L1 禁止事项解除）+ 实验能力适配层隔离。诚实 fail 维持：GATE-002 C9（Windows 容器 ACL 实测）、GATE-003 演练 3/6（DRL-03/04/06 blocked）；PP-01…PP-35 实测回填 blocked（缺目标机型压测环境，D13） |
| **1.9** | **阶段 P2：多租户隔离 + 可报价**：`packages/control-plane/src/pool/`（隔离域归属：一 `(tenantId, isolationGroupId)` 一域、跨租户永不共享；workspace 独占租约 fencing epoch 可转移；漂移两类事件拆分：connector 生命周期→不摘域 + 自动重载，未授权插件/工具→摘域 + 单独审批；网络策略默认拒绝入站 + 出站白名单；域池三态热/温/零：冻结 = flush + 排空缓冲 + suspend 标记、快照必含投影缓存与未上传缓冲；冷启动排队 → **等待页而非错误码**）；容量模型 `N_node = min(N_mem, N_blast)`（示例推导 102/50 → **50**，输入/来源/敏感性逐项标注，PP 参数〔待压测回填〕，`REL-061`）；成本模型 4 画像 × 3 档矩阵 12 格全数字（**假设值**口径，`PRD-044` 判据③，token 为主成本项）。契约 6/6（`contract:pool`） |
| **1.8** | **阶段 P1：SessionPersistence L1 + 恢复/台账/分缓冲/对账/迁移**：`packages/domain-bridge/src/persistence/`（`export default class` L1 提供方 + 8 错误类全集 + 恢复 closer 合成 + 副作用台账 + 分缓冲与墓碑 + 对账 + 迁移状态机）；语义级契约 14/14（`contract:persistence-l1`）；演练 runner `tools/run-drills.mjs`：DRL-01/02/05 pass，**DRL-03/04/06 blocked**（缺核内连接器控制器/降级阶梯/多节点拓扑，D-13）⇒ `GATE-003` 条件 5 = **fail**（3/6，不伪造通过） |
