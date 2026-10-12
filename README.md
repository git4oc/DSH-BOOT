# DSH-BOOT

[English](README.en.md) | 简体中文 | [日本語](README.ja.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Русский](README.ru.md) | [Português](README.pt.md)

> **在 DSH 内核之上构建企业级 AI Agent 业务系统的平台。**
> 你只写业务逻辑。多租户隔离、安全审计、审批、配额计费、会话持久化、演进兼容——这些由平台实现，契约测试钉死，不需要你自己写。

## 为什么会有这个项目

DSH 开源之后，我一直在思考一个问题：**如何把 DSH 的能力引入企业级应用中去？**

我一直认为并不是所有公司，都具备开发一套完整 AI Agent 智能体平台的能力；但所有公司在 AI 时代都有同一个诉求——将自身业务场景与 AI 结合，进行本地化服务建设和云平台部署。

DeepSeek harness 不做这些具体的事。基于它「一切皆插件」的理念，我们可以把它当做可以自由支配、无版权风险的 harness 底座平台，并且这个底座平台站在技术最前沿不断在进化——这就免去了很多企业追求新技术的各种成本。

DSH 把单 Agent 的运行时做得非常好——工具沙箱、审批瀑布、预设与插件生态，这些先进理念开箱即得。但企业级应用需要的不止这些：多租户怎么隔离？审计怎么赖不掉？用户要删数据怎么办？有人把资源吃光怎么办？升级怎么不搞坏客户数据？——这些 DSH 内核没有，而每一家企业自己造一遍，就是把同样的坑重新踩一遍。

探索的结论是：**需要一个以 DSH 为内核的 harness 平台**。DSH 内核已经给了两层边界（能力边界、调用边界），缺的只有最外层（租户/资源隔离）——所以这个项目不重写 DSH，而是在它之上补齐外层、钉死内层与中层，把企业级的"难而正确"做成平台代码。

目标是：**企业专注于业务实现的同时，充分享受 DSH 带来的先进理念红利**——你定义场景、工具、连接器、技能；隔离、审计、审批、配额计费、持久化与恢复、演进兼容，由平台兜底，并且每一条承诺都有契约测试钉死。是否升级 DSH、何时升级，也由你按情况判断：升级经流水线五道 gate（契约测试、快照 diff、列车一致性、灰度记录、就绪复验）验证后平滑进行，业务不受影响。

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

## 快速开始

**要求**：Node ≥ 22、pnpm；**Linux 主机**（生产多租户仅 Linux——Windows 已实测排除，见[边界](#当前状态与边界诚实版)）。

```bash
pnpm install

# 起本地最小拓扑：反向网关桩 + 内存 attest + 种子 Profile
pnpm dev:up          # HTTP 端点在 http://127.0.0.1:7301（JSON API）
pnpm dev:smoke       # 跑一轮完整轮次
```

## 先说清几个词

本仓库和 DSH 方案反复使用这几个概念：

- **域（isolation domain）**：一个隔离的运行环境，跑着服务于某租户某隔离组的 DSH 实例（生产中在独立容器里）。域与域之间互不可见——这是多租户隔离的基本单位。
- **域内 / 域外**：域内 = DSH 实例内部，模型和工具在这里执行，**不可信**（可能被提示注入或篡改）；域外 = dsh-boot 控制面与网关一侧，**可信**。所以授权、审计、制品校验、就绪判定都在域外做，域内上报只能作参考——这叫"强制力只来自域外"。
- **门禁（GATE）**：进入下一阶段前的强制检查点。每个门禁有可执行的验证（契约测试、演练、实测）和归档的证据；不过就停，不签字放行。
- **契约测试**：把平台承诺的每条语义（"跨租户互相不可见""审批失败不自动重试""撕裂尾永不返回给用户"）写成自动化测试。后续任何改动改坏了承诺，测试立即变红。

## 一套业务系统，三层组成

用你的业务系统做一次会话，从上到下经过三层：

```
你的用户
   │
   ▼
┌──────────────────────────────────────────────┐
│ 业务系统（你写的）                            │
│ 你的界面（Web/App/CLI）+ 你的业务流程          │
│ + 你定义的场景、工具、连接器、技能              │
└──────────────────┬───────────────────────────┘
                   │ 调平台 API 发起会话/轮次
                   ▼
┌──────────────────────────────────────────────┐
│ DSH-BOOT（本项目，平台层）                     │
│ 登录鉴权 · 配额计费 · 审批 · 审计取证 ·        │
│ DSR 删除 · 降级 · 升级门禁                    │
└──────────────────┬───────────────────────────┘
                   │ 把轮次派发到隔离域
                   ▼
┌──────────────────────────────────────────────┐
│ DSH 内核（每个隔离域一个实例）                 │
│ 模型调用 · 工具执行 · 沙箱 · 插件              │
└──────────────────────────────────────────────┘
```

| 层 | 谁提供 | 你要做什么 |
|---|---|---|
| **业务系统** | **你写**：界面、业务流程，以及你定义的场景/工具/连接器/技能 | 定义四类资产 + 调平台 API；界面随你的业务形态（Web/App/CLI 均可） |
| **DSH-BOOT** | **本仓库**（已实现，契约测试钉死）：多租户、审计、配额计费、DSR、降级、升级门禁 | 部署时接基础设施（Linux 容器运行时、企业 IdP、对象存储）并做配置 |
| **DSH 内核** | **DSH 开源内核**（不修改）：单 Agent 运行时 | 无——版本、就绪、漂移由 DSH-BOOT 替你管理 |

安全视角下，这三层对应**三层边界**：内层能力边界、中层调用边界归 DSH 内核与 DSH-BOOT 共同把守，外层租户/资源隔离由 DSH-BOOT 提供——逐层见下表。

## DSH-BOOT 与 DSH 的关系：三层边界，只缺最外层

DSH 内核给了单个 Agent 的完整运行时：模型调用（`ctx.llm`）、工具注册（`ctx.tools`）、审批瀑布（`ctx.approval`）、沙箱（`dsh-sandbox*`）、预设（`dsh-agent-preset`）。但**三层边界它只给了两层**——缺的恰好是多租户最需要的外层：

| 层 | 边界性质 | DSH 内核 | DSH-BOOT 做了什么 |
|---|---|---|---|
| **内层：能力边界** | 该 Agent 有哪些工具/插件 | ✅ `dsh-agent-preset` + scope | **钉死 + 域外治理**：工具注册桥唯一入口拦截（不在 toolAllowlist 内一律不注册）；单一预设 + 升权上限；Plugin/Connector/Skill/Scenario 四目录，层级合法性在域外 Profile 生成时判定——**租户自定义插件进不了平台锁定层** |
| **中层：调用边界** | 单次调用的文件写策略 + 审批瀑布 | ⚠️ 有，但 Windows 档 partial | **补全 + 实测**：审批应答者 + 十字段参数通道（脱敏/截断/定序）+ 三层截止时间（`T_a`/`T_m`/`T_turn`）；Windows 容器内 ACL 实测后**如实判定不通过 → Windows 禁入多租户隔离** |
| **外层：租户/资源隔离** | 内核级多租户 | ❌ 无 | **自建（本次工程的主体）**：隔离域池三态（热/温/零）、域令牌绑定 `(tenantId, isolationGroupId)`、workspace 独占租约、身份/RBAC/配额/公平调度/计费、SessionPersistence L1/L2 + 迁移状态机、审计 fail-closed + WORM 哈希链、DSR 删除证明、降级阶梯 |

**三层齐全，多租户才成立。** 只有内层（Agent 有哪些工具）就宣称能隔离，等于把"能力边界"冒充"安全边界"——这是本项目一切架构决策的起点。

那么 DSH-BOOT 到底是什么？它是一个**多租户 AI Agent 平台软件**，由三部分组成：

1. **控制面服务**（TypeScript 包）：身份与 RBAC、配额与公平调度、计费归集、审计与取证、DSR 删除、会话路由与索引——企业平台的后台逻辑；
2. **DSH 集成**（反向网关桩 + 域桥）：把 DSH 的模型调用、工具注册、审批瀑布接到控制面，并在域外做制品校验与漂移检测——不修改 DSH 内核；
3. **工程门禁**（规格集 + 校验工具）：397 条需求、六个门禁、快照 diff——保证上面的承诺不被后续改动悄悄破坏。

它不重写 DSH：每个 Agent 仍由 DSH 内核运行；DSH-BOOT 把很多个这样的 Agent 管成一家企业的多租户平台。部署形态：控制面服务 + 每隔离域一个 DSH 实例（Linux 容器）+ 网关。

### DSH-BOOT 与 DSH 之间的交互

每个隔离域里跑一个 DSH 实例，两者之间只有几条明确的通道：

| 交互 | 方向 | 内容 |
|---|---|---|
| **Profile 下发** | 域外 → 域内 | 你定义的场景/工具/连接器/技能，经 Profile 生成器（域外）产出 `pluginSet`、`toolAllowlist`、`skillRoots`，只读挂载进 DSH 实例 |
| **插件/制品注册** | 域外 | 插件在 Plugin Registry 登记（版本、签名、完整性哈希）；合法性在域外判定后进 Profile——**域内没有"装插件"这个动作** |
| **工具注册** | 域内 | DSH 启动后唯一入口是 `ctx.tools.register`，只在 `toolAllowlist` 白名单内放行；运行期域内上报工具清单哈希，域外比对——不一致即摘域 |
| **模型调用** | 域内 → 域外 | `ctx.llm` 调用经反向网关出域：凭证由域外代理发放，令牌用量在域外计费归集 |
| **审批** | 域内 → 域外 | 危险动作发起审批，域外应答者应答；参数经通道送达（脱敏/截断/定序），三层截止时间内必须收敛 |
| **凭证** | 域外 → 域内 | MCP 连接器只拿短 TTL 凭证引用，域内不存长期凭证 |
| **会话持久化** | 域内 → 域外 | 会话日志写域内本地卷，域外按"上传确认水位"消费——配额、计费、审计都以此为真源 |

一句话：**域内只执行，域外做判定**。DSH 实例不知道其他租户的存在；所有跨租户的决策（谁能进、能用什么、干了什么、怎么删）都在 DSH-BOOT 这边。

对应关系一句话：**DSH 之于 DSH-BOOT，约等于 JVM 之于 Spring Boot**——内核管单实例运行时，平台管多租户的企业级语义。

## 构建你的业务系统

在 DSH-BOOT 上写业务系统 = 定义四类资产，平台负责其余一切：

| 你定义 | 通过 | 平台保证 |
|---|---|---|
| **场景（Scenario）** | `presetId + pluginSet + policies` | presetId 只增不改（永久兼容面） |
| **工具（Tool）** | 注册桥唯一入口；不在 toolAllowlist 内一律不注册 | 恶意 MCP 推新工具也进不了可见集 |
| **连接器（Connector）** | 目录注册，默认 `untrusted` | 凭证只存引用；例外归属须安全评审 |
| **技能（Skill）** | platform / tenant / user 三级作用域 | 按租户装配，互不越界 |

最小示例（节选自契约测试，可复制运行）：

```js
import { ScenarioCatalog, ConnectorRegistry } from "../../../../packages/control-plane/src/registry/registries.ts";

// 定义一个场景：presetId + 插件集 + 策略
const scenarios = new ScenarioCatalog();
scenarios.define({
  presetId: "preset-1",
  pluginSet: ["dsh-base"],
  policies: { requireApproval: ["shell"], toolAllowlist: ["fs"] },
});

// 注册一个 MCP 连接器：默认 untrusted，例外归属须安全评审
const registry = new ConnectorRegistry(2);
registry.register({
  serverName: "github-mcp",
  transport: "stdio",
  hosting: "domain",
  credentialRef: "credref-1",
  trust: "untrusted",
  securityReviewPassed: false,
});
```

业务用户**不写任何隔离、审计、配额、持久化代码**——定义四类资产，这些由平台提供。

```bash
# 12 个契约套件——平台承诺的每条语义都有测试钉死
pnpm contract:llm && pnpm contract:tools && pnpm contract:approval
pnpm contract:ready && pnpm contract:persistence-l1 && pnpm contract:persistence-l2
pnpm contract:pool && pnpm contract:identity-quota && pnpm contract:registry
pnpm contract:session-ops && pnpm contract:lifecycle
pnpm fixtures:selftest

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

- ✅ 六个阶段门禁（GATE-001…006）全部可达，各有证据工件；12 个契约套件全绿。
- ❌ **Windows 禁入多租户隔离**：容器内 ACL 实测未通过（GATE-002 条件 9，如实 fail）。
- 🔶 **演练 3/6**：DRL-03/04/06 需要核内组件与多节点拓扑，如实 blocked。
- 🔶 **压测参数未回填**：`PP-01…PP-35` 全部为"示例推导值 + 待压测回填"——不编造数字。
- 🚫 **无 UI**：本仓库交付库与 HTTP API（网关桩），不含产品界面。
- 📦 **生产部署需自备执行环境**：隔离域的容器/microVM 执行环境不由本仓库实现——部署时由部署者提供基础设施（Linux 容器运行时、企业 IdP、对象存储）并接线；业务用户不受影响。

实现与最初规划的逐层一致性对照（六项全一致，含"Windows 不通过"分支被如实执行），见[工程手册](docs/ENGINEERING-HANDBOOK.md#9-实现与规划的一致性对照)。

## 文档

- [工程手册](docs/ENGINEERING-HANDBOOK.md) — 权威顺序、门禁速查、缺口台账、变更记录（贡献者必读）
- [规格总纲](spec/00-规格总纲.md) — 规格集入口
- [故障域矩阵](docs/reliability/failure-domain-matrix.md) / [降级阶梯](docs/reliability/degradation-ladder.md) / [DSR 清单](docs/security/dsr-inventory-and-proof.md)

## 交流群

扫码加入「dsh 企业应用开发技术」微信群，一起讨论 DSH 与 DSH-BOOT 的使用与开发（二维码 10 月 19 日前有效，过期后重新生成）：

![dsh 企业应用开发技术微信群](docs/assets/wechat-group-qr.jpg)

## License

[MIT](LICENSE)
