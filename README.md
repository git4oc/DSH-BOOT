# DSH-BOOT

> **在 DSH 内核之上构建企业级 AI Agent 业务系统的平台。**
> 你只写业务逻辑。多租户隔离、安全审计、审批、配额计费、会话持久化、演进兼容——这些由平台实现，契约测试钉死，不需要你自己写。

**成熟度口径（诚实）**：以上能力均已实现并通过 60+ 契约测试（模型级实现，进程内可运行、可验证）；生产级基础设施接线（真实容器运行时、企业 IdP、对象存储、多节点拓扑）尚未完成——每处未完成项在文档中如实标注。

## DSH-BOOT 与 DSH 的关系：三层边界，只缺最外层

DSH 内核给了单个 Agent 的完整运行时：模型调用（`ctx.llm`）、工具注册（`ctx.tools`）、审批瀑布（`ctx.approval`）、沙箱（`dsh-sandbox*`）、预设（`dsh-agent-preset`）。但**三层边界它只给了两层**——缺的恰好是多租户最需要的外层：

| 层 | 边界性质 | DSH 内核 | DSH-BOOT 做了什么 |
|---|---|---|---|
| **内层：能力边界** | 该 Agent 有哪些工具/插件 | ✅ `dsh-agent-preset` + scope | **钉死 + 域外治理**：工具注册桥唯一入口拦截（不在 toolAllowlist 内一律不注册）；单一预设 + 升权上限；Plugin/Connector/Skill/Scenario 四目录，层级合法性在域外 Profile 生成时判定——**租户自定义插件进不了平台锁定层** |
| **中层：调用边界** | 单次调用的文件写策略 + 审批瀑布 | ⚠️ 有，但 Windows 档 partial | **补全 + 实测**：审批应答者 + 十字段参数通道（脱敏/截断/定序）+ 三层截止时间（`T_a`/`T_m`/`T_turn`）；Windows 容器内 ACL 实测后**如实判定不通过 → Windows 禁入多租户隔离** |
| **外层：租户/资源隔离** | 内核级多租户 | ❌ 无 | **自建（本次工程的主体）**：隔离域池三态（热/温/零）、域令牌绑定 `(tenantId, isolationGroupId)`、workspace 独占租约、身份/RBAC/配额/公平调度/计费、SessionPersistence L1/L2 + 迁移状态机、审计 fail-closed + WORM 哈希链、DSR 删除证明、降级阶梯 |

**三层齐全，多租户才成立。** 只在共享 Worker 上用 Context 做隔离 = 用能力边界冒充安全边界——这是本项目一切架构决策的起点，也是 DSH-BOOT 存在的理由：**DSH 是单 Agent 运行时，DSH-BOOT 是让它成为多租户企业平台的那一层。**

对应关系一句话：**DSH 之于 DSH-BOOT，约等于 JVM 之于 Spring Boot**——内核管单实例运行时，平台管多租户的企业级语义。

## 你不用再自己解决这些

| 企业级难题 | DSH-BOOT 给你的 |
|---|---|
| 多租户隔离 | 一 `(tenantId, isolationGroupId)` 一隔离域，跨租户永不共享；workspace 独占租约（fencing epoch 可转移）；域内读不隔离的边界诚实披露，need-to-know 客户走团队/用户级隔离组 |
| 谁能干什么 | JWT（OIDC 对接企业 IdP）+ RBAC 按租户/角色控制场景、插件、工具、MCP、沙箱模式上限；SSO/SCIM 自动开通，账号停用后 5 分钟内会话与令牌全失效 |
| 干了什么赖不掉 | 最小审计集六类 **fail-closed**（记不下即拒绝该动作）；WORM + 哈希链；五元组审计键；取证包可导出、可独立验证 |
| 用户要删数据 | DSR 全清单删除（日志/附件/FTS/快照/对象存储版本/容器临时层）+ 墓碑 + 删除报告 + 哈希链证明；生效 ≤ 24h、撤销窗口 7 天 |
| 有人把资源吃光 | 配额分级（软/硬）+ 公平调度：超额租户**按比例限速**，其他租户不受影响；软依赖故障绝不阻断执行 |
| 依赖挂了怎么办 | 降级阶梯 L0/L1/L1b/L2/L3：进入退出阈值、滞回与最短驻留、按租户聚合告警、错误预算与冻结清单 |
| 升级把客户数据搞坏 | 迁移状态机五态 + `targetBaseSeq == sourceLastReplicatedSeq` 断言防丢尾；真源 = 日志 + 上传确认水位；升级流水线五道 gate + 前提监控项逐次复核 |
| 合规要证明 | 取证包 + 删除证明 + 哈希链，全部可导出、可独立验证 |

## 实现与规划的一致性（对照）

最初的规划（见 [工程手册](docs/ENGINEERING-HANDBOOK.md)）就是把缺的外层建出来、把已有的两层钉死。逐层对照：

| 规划 | 实现 | 判定 |
|---|---|---|
| 内层：注册入口唯一 + 单一预设 + 升权上限 | P0-A2 注册桥（全仓 `ctx.tools.register` 唯一命中点）+ P3-2 四目录域外判定 | ✅ 一致 |
| 中层：审批应答者 + 参数通道 + 三层截止时间 | P0-A3（契约 11/11）+ Profile `deadlines` 三层必填校验 | ✅ 一致 |
| 中层：Windows ACL 实测，不通过则移出多租户隔离 | P0-A6 实测 fail → Windows 禁入多租户隔离（规划的分支被如实执行） | ✅ 一致 |
| 外层：自建租户/资源隔离 | P1 持久化 + P2 隔离域池/租约/成本 + P3 身份/配额/计费/路由/DSR + P3-4 SDK/SSO/降级阶梯 | ✅ 一致 |
| 演进：升级有门禁 | P4 升级流水线五道 gate + P-1/P-2/P-3 前提复核 | ✅ 一致 |
| **未完成（基础设施缺口，非代码缺口）** | GATE-002 C9 Windows 容器实测、演练 3/6、PP-01…PP-35 压测回填 | 🔶 如实 blocked |

## 快速开始

```bash
pnpm install

# 起本地最小拓扑：反向网关桩 + 内存 attest + 种子 Profile
pnpm dev:up          # HTTP 端点在 http://127.0.0.1:7301（JSON API）
pnpm dev:smoke       # 跑一轮完整轮次
```

## 构建你的业务系统

在 DSH-BOOT 上写业务系统 = 定义四类资产，平台负责其余一切：

| 你定义 | 通过 | 平台保证 |
|---|---|---|
| **场景（Scenario）** | `presetId + pluginSet + policies` | presetId 只增不改（永久兼容面） |
| **工具（Tool）** | 注册桥唯一入口；不在 toolAllowlist 内一律不注册 | 恶意 MCP 推新工具也进不了可见集 |
| **连接器（Connector）** | 目录注册，默认 `untrusted` | 凭证只存引用；例外归属须安全评审 |
| **技能（Skill）** | platform / tenant / user 三级作用域 | 按租户装配，互不越界 |

```bash
# 11 个契约套件——平台承诺的每条语义都有测试钉死
pnpm contract:llm && pnpm contract:tools && pnpm contract:approval
pnpm contract:ready && pnpm contract:persistence-l1 && pnpm contract:pool
pnpm contract:identity-quota && pnpm contract:registry
pnpm contract:session-ops && pnpm contract:lifecycle

# 规格与文档校验
node tools/lint-specs.mjs && node tools/check-gates.mjs
node tools/validate-contracts.mjs && node tools/lint-docs.mjs
```

## 设计原则

1. **强制力只来自域外**——层级合法性在 Profile 生成时判定，域内不自我证明（域内自证合规即不通过）。
2. **门禁只接受域外事实**——域内上报只能作交叉核验，不一致即摘域。
3. **软依赖绝不阻断执行**——计费/一般审计挂了，执行继续；有界丢弃 + 墓碑 + 补传。
4. **做不到就说做不到**——每处未完成项都如实登记，不编造数字。

## 当前状态与边界（诚实版）

- ✅ 六个阶段门禁（GATE-001…006）全部可达，各有证据工件；11 个契约套件全绿。
- ❌ **Windows 禁入多租户隔离**：容器内 ACL 实测未通过（GATE-002 条件 9，如实 fail）。
- 🔶 **演练 3/6**：DRL-03/04/06 需要核内组件与多节点拓扑，如实 blocked。
- 🔶 **压测参数未回填**：`PP-01…PP-35` 全部为"示例推导值 + 待压测回填"——不编造数字。
- 🚫 **无 UI**：本仓库交付库与 HTTP API（网关桩），不含产品界面。

## 文档

- [工程手册](docs/ENGINEERING-HANDBOOK.md) — 权威顺序、门禁速查、缺口台账、变更记录（贡献者必读）
- [规格总纲](spec/00-规格总纲.md) — 规格集入口
- [故障域矩阵](docs/reliability/failure-domain-matrix.md) / [降级阶梯](docs/reliability/degradation-ladder.md) / [DSR 清单](docs/security/dsr-inventory-and-proof.md)

## License

[MIT](LICENSE)
