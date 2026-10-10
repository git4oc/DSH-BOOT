# 实际工时回填（`D-12`）

| 项 | 值 |
|---|---|
| 文档编号 | `D-12`（`SPEC-03`） |
| 上游依据 | `SPEC-03` `D-12`、`ENG-058`；`PLAYBOOK.md`（archive/）§3 收工动作 |
| 状态 | **按阶段回填中** |

按阶段回填实际交付情况。`ENG-058` 的量级估算（人月）是按**人工实现**口径给出的；
本仓库的实际交付由代理会话完成，人月口径不可直接比较——如实记录交付日期与会话形态，
不折算、不编数字。

| 阶段 | 门禁 | 量级估算（`ENG-058`） | 实际交付 | 说明 |
|---|---|---|---|---|
| 0a | — | 1–2 天 | 2026-10-06，单会话 | `VER-002` + `GATE-002` 条件 2（内核侧）两项实测，结论均成立 |
| 0b | — | 基础设施 | 2026-10-06，单会话 | 9 包骨架 + `tools/check-deps.mjs` + 2 个 CI job |
| P-1 | `GATE-001` | 1.5–2.5 人月 | 2026-10-07，单会话 | 反向网关桩 + 内存 attest + dev 拓扑 + 逃生门 + 8 个注入器；`pnpm gate:001` exit 0（18 项检查），证据 `evidence/GATE-001/gate001-report.json` |
| P0-A1 | — | 2–4 人月 | 2026-10-07，单会话 | `GatewayLlmAdapter`（`ENG-005`–`ENG-008` 全实现）；契约测试 `contract:llm` 10/10（字段保真 / abort 前置 / 四端点归因头 / 持续 429 在 `T_m` 内终结 / fail-closed） |
| P0-A2 | — | 2–3 人月 | 2026-10-07，单会话 | 工具强制两道防线（`ENG-001`–`ENG-004`）：`registerTool` 唯一入口 + 全局 `guard()` 纵深 + Profile 收敛 + 升权上限；契约测试 `contract:tools` 12/12（含恶意 MCP 负向用例 / `E-05` 移除式对照 / 源码检索） |
| P0-A3 | — | 2–3 人月 | 2026-10-07，单会话 | 审批应答者 + 参数送达通道 + 三层截止时间（`ENG-009`–`ENG-012`）：词表闭合 + 自持 `T_a` + 无跨 `callId` 复用 + 十字段载荷（脱敏/截断/定序/回补）；契约测试 `contract:approval` 11/11（含永不响应桩 / 无复用 / 定序 / 回补 200+403） |
| P0-A4 | — | 2–3 人月 | 2026-10-07，单会话 | Profile 校验器全量化 + 域就绪判定 + 域令牌绑定 + 版本列车（`ENG-025`/`ENG-029`/`ENG-030`/`ENG-040`/`ENG-041`/`ENG-062`）：`PC-001`…`PC-012` 全部语义检查 + RC-1…RC-7（域外事实为判定输入）+ 域外证据哈希链；契约测试 `contract:ready` 7/7（含门禁非自证负向用例 / 跨租户冒用拒绝） |
| P0-A5 | — | 1–2 人月 | 2026-10-07，单会话 | 自建契约套件 A–F（`ENG-031`：`node --test` + CI 双入口、逐项失败点名项与断言）+ 内核 .d.ts 快照门禁（`ENG-032`/`ENG-033`：`tools/snapshot` 生成 + diff + 四反转面逐面结论）+ CI `contract`/`snapshot`/`gate-006`/`upgrade-gate` jobs（`ENG-034`/`ENG-035`/`ENG-051`/`ENG-052`） |
| P0-A6 | — | 1–2 人月 | 2026-10-07，单会话 | `GATE-002` 十条逐条核 + 证据归档（`tools/gate002-evidence.mjs` → `evidence/GATE-002/`，`SEC-DOC-13` §6.2）：C1–C8、C10 pass；**C9 fail（fail-closed）**——Windows 容器内 ACL 实测未执行（探针 `tools/windows-acl-probe.mjs` 已就位，缺 Windows 容器基础设施）；**Windows 禁止参与多租户隔离**；交付物 12 三件套（`docs/security/modified-paths.md`） |
| P1 | — | 8–13 人月 | 2026-10-07，单会话 | `SessionPersistence` L1 提供方（`export default class`：create/open/flush/stat/list + 句柄 read/append/flush/close + id/header/inheritedEventCount/access；L1 禁止事项：单域/Linux-only/`compression: none`/禁止世代迁移/不落 NFS-FUSE）；8 错误类全集（7 与 8 分开：拒绝文案含"升级 harness"绝无 "corrupt"）；租约阈值**自定**（30 s/90 s，内核无基线）；kill 后续跑走人为处置入口（`REL-082`）；恢复=追加合成 closer（幂等，三类全覆盖）+ 五 span + 上界断言；副作用台账（执行前写、fail-closed、产品策略禁自动重试）；分缓冲（审计/计费独立、有界丢弃 + `reconciled:false` 墓碑、不阻断）；对账（真源=日志+水位、RPO 分层、少计/多计分列、≤ 0.01%）；迁移状态机五态 + seq 断言 + 幂等重驱动。契约 14/14（`contract:persistence-l1`）；演练 3/6（DRL-01/02/05 pass，**DRL-03/04/06 blocked：缺核内组件/多节点拓扑，D-13**）⇒ `GATE-003` 条件 5 fail（不伪造通过） |
| P2 | — | 8–13 人月 | 2026-10-07，单会话 | 多租户隔离 + 可报价（`packages/control-plane/src/pool/`）：隔离域归属（一 `(tenantId, isolationGroupId)` 一域、跨租户永不共享、域内读不隔离披露 C44）；workspace 独占租约（fencing epoch、可转移、第二域拒绝 + 审计，`REL-068`）；漂移两类事件拆分（connector 生命周期→不摘域 + 自动重载；未授权插件/工具→摘域 + 单独审批）；网络策略（默认拒绝入站 + 出站白名单）；域池三态（热/温/零：冻结 = flush + 排空缓冲 + suspend 标记；快照必含投影缓存与未上传缓冲；冷启动排队 → 等待页而非错误码）；容量模型 `N_node = min(N_mem, N_blast)` = min(102, 50) = **50**（输入/来源/敏感性逐项标注，PP 参数〔待压测回填〕，`REL-061`/`REL-063`）；成本模型 4 画像 × 3 档矩阵 12 格全数字（**假设值**口径，token 为主成本项，`PRD-043`–`PRD-049`）。契约 6/6（`contract:pool`） |
| P3-1 | — | 8–13 人月（规格） | 2026-10-07，单会话 | 身份/RBAC + 配额/公平调度 + 计费（`contract:identity-quota` 5/5）：JWT（OIDC）+ RBAC 五类控制 + 沙箱上限；workspace 授权时序（签令牌固化 + 每请求校验）；超额租户按比例限速（1 − quota/usage）不连坐；软依赖不阻断、拒绝原因码无软依赖；turnId 幂等去重 + reconciled 标记分方向差异 |
| P3-2 | — | 20–35 人月（规格） | 2026-10-07，单会话 | 四目录（`contract:registry` 5/5）：Plugin/Connector/Skill/Scenario；层级合法性域外判定（decidedBy=profile-generator-out-of-domain）；例外 connector 按域上限 + 安全评审；工具数突变告警 + 冻结可见性；P0-A4 校验器真实接受生成物 |
| P3-3 | — | 分 4 段（规格） | 2026-10-07，单会话 | Session Router/历史查询/保留删除 DSR/取证（`contract:session-ops` 5/5）：自建索引分页（C24）；域外调用方授权（C26）；最小审计集六类 fail-closed + WORM 哈希链 + 五元组键；DSR 全清单八类 + 哈希链证明 + 24h/7 天；三正交语义 |
| P3-4 | — | —（GATE-005） | 2026-10-07，单会话 | SDK 生成器（51 操作，`check:sdk-sync` 一致）+ SSO/SCIM（停用 5 min 失效，COPY-027）+ 降级阶梯（跃迁表/滞回/下发通道，`contract:lifecycle` 4/4）+ 按租户告警聚合 + 错误预算；FDM-06 RTO/RPO 示例推导值回填（矩阵 v1.1）；签约要件六项结构定稿（数值项按归属诚实〔待定〕） |
| P4 | — | 4–8 人月（规格） | 2026-10-07，单会话 | 升级流水线五道 gate（`tools/run-upgrade-pipeline.mjs` 全 PASS，evidence/UPGRADE-P5）+ P-1/P-2/P-3 复核；L2 层（世代迁移/Windows/对象存储直读解除）；实验能力适配层隔离。诚实 blocked：PP-01…PP-35 实测回填（缺目标机型压测环境，D13）；runbook 演练 100x 扩容/供应商弃用/域失陷/监管变更 blocked（缺多节点拓扑/真实依赖/容器基础设施/条款文本） |
