# DSH 企业级应用架构设计

> 版本 v1.0 ｜ 2026-10-06 ｜ 基于 DSH `@deepseek-ai/dsh` 0.1.6-alpha.2 实际包结构与源码验证

---

## 0. 文档定位

| 项 | 说明 |
|---|---|
| **读者** | 架构师、平台工程、安全合规、产品负责人 |
| **目的** | 给出把 DSH 从"本机 Agent 外壳"演进为"企业级 Agent 平台"的完整架构基线 |
| **性质** | 架构决策记录（ADR）合集 + 接口契约 + 演进路线 |
| **不包含** | 具体排期、人力估算、供应商选型 |
| **依据** | 对 DSH 发行包的实测：`dsh-llm`、`dsh-user-approval`、`dsh-sandbox*`、`dsh-experimental-agent-team`、`dsh-agent-preset` 的 README 与类型声明 |

### 0.1 术语表

| 术语 | 含义 |
|---|---|
| **spike** | 小型可行性验证。写一段用完即扔的代码回答一个技术问题，验证完删除。目的不是交付功能，而是在大投入前证伪假设 |
| **enforcement: full / partial** | 沙箱后端对"本模式承诺的每个文件操作"的管辖程度。`full`=全覆盖；`partial`=只管辖子集，存在绕过路径 |
| **seam（接缝）** | DSH 暴露的可替换能力接口。形如 `ctx.<capability>`，实现由组合方提供 |
| **preset** | Cordis YAML 里声明的"一个 Agent 的子插件列表"。决定该 Agent 拥有哪些能力 |
| **workspace** | DSH 的隔离与归属单位。内核一等概念：`workspaceRoot` / `SessionHeader.cwd` / peer 派生 |
| **experimental 包** | 包名带 `dsh-experimental-*` 者。官方声明"不承诺稳定性" |
| **turn（轮次）** | 一次用户输入驱动的完整推理循环。DSH 的 commit/replay 边界，也是持久化的原子单位 |

---

## 1. 背景

### 1.1 DSH 的现有定位

DSH 当前是**本机 Agent 外壳**：

- Host 内核（Cordis 插件树）与 Web UI（浏览器侧 Cordis client 树）**同机部署**
- 通过 Typert 类型安全 RPC 通信
- 信任模型基于 **loopback**
- 插件组合在**启动时确定**

对个人开发者极优：零配置、类型安全、热重载、前后端同构构建。

### 1.2 企业化的三个结构性不匹配

| # | 不匹配 | 具体表现 |
|---|---|---|
| 1 | **能力无法集中供应** | 每人一份 DSH 实例，harness 散落各终端，无法统一管控、统一升级、统一审计 |
| 2 | **产品壳无法独立演进** | Web UI 是 Host 的投影，Typert descriptor 同构构建，前后端版本锁死 |
| 3 | **缺少租户与执行隔离** | 内核无租户概念；沙箱只管文件写且为 `partial`，不构成安全边界 |

> 注意：第 3 条常被忽略，但它是多租户能否成立的**前提**，不是附加项。

### 1.3 两种既有思路及其局限

**思路 A：HaaS（Harness as a Service）** —— 把 harness 抽成云端多副本服务，OpenAPI 对外。

- ✅ 方向对：控制面四件套（Auth/RBAC、Session Router、Plugin Registry、OpenAPI Generator）是正确的组合
- ❌ 局限一：以 MaaS 类比论证。MaaS 的收益来自"无状态可批处理"，而 harness 负载**不可批处理**；唯一可池化的 LLM 调用**已由 MaaS 集中**，集中 harness 只增成本不增效率
- ❌ 局限二：要求"Worker 完全无状态 / agent step 纯函数化"。与 DSH 内核现实冲突（见 §2.2）
- ❌ 局限三：以弹性为主目标。agent 负载按人数、长连接、非突发
- ❌ 局限四：无执行隔离；API 还开了绕过 agent loop 的 `/llm/chat`，成为治理绕过口

**思路 B：MOVO（把 DSH 当引擎嵌入产品）** —— cordis 插槽接线 + 双向网关回环。

- ✅ 可行且现在就能做：顺着 DSH 的设计用 DSH，不改内核
- ✅ **密钥不出宿主**是真实的安全属性：内核每要调模型、每要跑工具都反向回调产品侧
- ✅ 不追求无状态 Worker，绕开了最难点
- ⚠️ 代价：双进程回环在关键路径上，Python 侧成为单点
- ❌ 局限：仅覆盖单租户嵌入场景，无多副本、无执行隔离

### 1.4 本设计的主张

**二者不是二选一，而是同一根轴的两端。** 最优解是：

> **MOVO 的接线方式**（插槽 + 反向网关 + 零密钥）
> **＋ HaaS 的控制面**（身份 / 配额 / 审计 / Registry / 网关）
> **＋ 两者都缺的外层容器隔离**
> **＋ DSH 自己的事件溯源当弹性基础**

前提只有一个：**承认 harness 是有状态的**。承认之后，路线从"三年重写"变成"十二个月渐进落地"。

---

## 2. 关键前置认知（决定架构形状）

### 2.1 DSH 已经给两层边界，只缺最外层

| 层 | 边界性质 | DSH 提供方 | 现状 |
|---|---|---|---|
| **外层** | 租户 / 资源隔离（内核级） | **无** | ❌ 需自建 |
| **中层** | 单次调用的文件写策略 + 审批瀑布 | `dsh-sandbox*` + `ctx.approval` | ✅ 有，但 Windows 档 `partial` |
| **内层** | 能力边界（该 Agent 有哪些工具/插件） | `dsh-agent-preset` + scope | ✅ 有 |

三层齐全，多租户才成立。**只在共享 Worker 上用 Context 做隔离 = 用能力边界冒充安全边界。**

### 2.2 为什么"无状态 Worker"不成立

| 事实 | 出处 | 影响 |
|---|---|---|
| "**不支持多个 harness 进程并发操作同一 Team**" | `dsh-experimental-agent-team` README | 团队状态无法跨进程 |
| `TeamId == SessionId`，状态"追加到**精确的 live Lead 会话**" | 同上 | 会话即团队，无法外置到共享存储后由任意副本接管 |
| "单进程、共享 checkout……不提供 worktree、远端成员、merge 或文件锁" | 同上 | 无文件系统隔离机制 |
| 插件持进程级资源（持久 shell 工具、定时器） | `dsh-tool-pwsh-persistent` / `dsh-tool-bash-persistent` 包；OpenViking 插件的 `setInterval` drainer | 在途状态不可序列化 |
| "mailbox 不保证跨进程 exactly-once" | agent-team README | 投递语义在分布式下失效 |

**结论**：不是"把状态外置"能解决的，是要重写内核。**放弃无状态 Worker 路线。**

### 2.3 沙箱的真实强度：`full` vs `partial`

DSH 沙箱每次执行报告 `enforcement`：

| 值 | 含义 |
|---|---|
| `full` | 后端管辖该模式承诺的每一个文件操作 |
| `partial` | **只管辖子集**，需要绝对边界的消费方应拒绝或向上暴露 |

**Windows ACL 档是 `partial`，三个已记录的绕过路径：**

| 绕过路径 | 后果 | 是否有解 |
|---|---|---|
| **NTFS 硬链接是文件对象别名** | 同一文件在工作区外有别名路径可写；无法一刀切禁（pnpm 依赖硬链接） | ❌ 平台限制 |
| **读取完全不受限** | 受限子进程可读该用户可读的任何文件，含其他 workspace | 需外层容器 |
| **被其他 AppContainer 工具打过包 SID 的目录不可读** | 该目录树对本后端子进程不可访问 | 需修复外部 ACL |

**Windows 档的实现要点**（理解它才能正确使用）：

1. 调用者令牌复制为 `WRITE_RESTRICTED` 受限令牌，restricting SID 携带能力 SID，并**降级为 Low 完整性**
2. Windows 执行**两次访问检查**（正常 SID + restricting SID，都过才授予写），内核强制完整性检查再拒绝对非 Low 对象的写
3. 每次授权在**同一次 `SetNamedSecurityInfoW`** 写入三样：能力 SID 的 allow ACE + 对 world SID 的 `FILE_DELETE_CHILD` 拒绝 ACE + Low 完整性标签
4. 工作区 SID 由规范化路径**确定性派生**，每机器每工作区只物化一次；每个会话/工作区对另分配随机私有临时目录与可撤销 SID
5. 任何 Win32 失败即抛错，**绝不不受限 spawn**；runner 失败输出 `windows-acl-run: <detail>` 并退出 127

**运维副作用（必须知悉）**：

- 常驻工作区 ACE 是**不可见残留**；工作区改名会派生新 SID，旧 ACE 留在原地
- **常驻 Low 标签的生命期长于 DSH**：会话结束后依然存在，因此同一用户下其他 Low 完整性进程也能写该目录树
- 手工 `icacls` 清不掉（`ERROR_NONE_MAPPED` 1332），须通过模块回收
- 授权物化是**急切全树传播**，大型工作区树上耗时以数十秒计

**安全结论**：**DSH 沙箱是"防误操作"的边界，不是"防对抗"的安全边界。** 多租户必须靠外层容器。

### 2.4 DSH 的稳定性分级（选型硬约束）

DSH **用包名标记稳定性**。`dsh-experimental-*` 即"实验原型、不承诺稳定性"：

| 包 | 官方表述 |
|---|---|
| `dsh-experimental-agent-team` | "以实验性名称公开发布、**不承诺稳定性**"、"孵化期间约定仍可自由变更" |
| `dsh-experimental-tool-agent-team` | 同上族 |
| `dsh-experimental-agent-team-profile` | 同上族；"默认关闭" |
| `dsh-experimental-auto-review` / `-schedule-bundle` / `-ptc-runtime-python` / `-voice-input-bundle` | 实验族 |

**规则**：产品核心**只依赖非 experimental 的 seam**；experimental 能力要么不用，要么加**可整体替换的适配层**。

---

## 3. 设计目标与非目标

### 3.1 目标

| # | 目标 | 验收方式 |
|---|---|---|
| G1 | 内核零密钥 | 在隔离域内全盘搜索，找不到任何模型凭证 |
| G2 | 多租户隔离 | 跨 workspace 的文件、网络、进程互不可见 |
| G3 | 会话可重启 | 进程被杀后，同一会话可在另一实例续跑（轮次边界） |
| G4 | 产品壳独立演进 | 产品侧按 OpenAPI 生成 SDK，独立构建部署 |
| G5 | 治理可审计 | 每次 turn / 工具调用 / 模型请求可追溯、可配额、可计费 |
| G6 | 内核可替换 | 依赖精确 pin；内核升级只需重测适配层，不改产品代码 |

### 3.2 非目标

| # | 非目标 | 理由 |
|---|---|---|
| N1 | Worker 完全无状态 | 与内核现实冲突（§2.2） |
| N2 | 以多副本弹性为主目标 | agent 负载非突发；弹性是 G2/G3 的结果 |
| N3 | 用 Context 做租户边界 | Context 是能力/作用域边界，非安全边界 |
| N4 | 重写推理循环 / 会话溯源 / 不变量 | 这些是 DSH 数年打磨的可靠性资产，重造必踩坑 |
| N5 | 让内核直接持有模型密钥 | 破坏 G1 |

---

## 4. 核心原则

### P1 · 承认 harness 是有状态的
一切设计从"会话、workspace、插件状态都是真实的、不可随意搬迁的"出发。

### P2 · 内核 = 不可信执行域
把 DSH 内核进程当作浏览器的标签页：**它可能被提示注入、被工具链污染、被插件缺陷影响**。所有有价值的东西（密钥、身份、配额、审计、状态）都在它之外，且**所有资源访问都穿过它自己的边界**出去。

### P3 · 三层边界各司其职
外层容器（租户）／中层沙箱+审批（单次调用）／内层 preset+scope（能力）。**不可用内层冒充外层。**

### P4 · 治理集中，执行分散
集中"分发、裁决、记账"，不集中"执行"。插件集中**注册**，不集中**运行**；策略集中**反转出去**，执行留在域内。

### P5 · 只依赖稳定 seam
见 §2.4。实验包必须被适配层包住。

---

## 5. 总体架构

```
┌─────────────────── 控制面（无状态，可多副本）───────────────────┐
│  身份 / 多租户 / RBAC      配额 / 限流 / 计费                     │
│  审计落库 / 合规报表         Scenario & Plugin Registry（版本/回滚）│
│  Session Router（按 workspace 路由）                              │
│  OpenAPI 网关（对外契约 + SDK 生成 + 版本协商）                    │
└────┬──────────────────────────────────────────────────────▲──────┘
     │ ① 正向：下发 Runtime Profile                          │ ② 反向：内核所有 I/O
     │   (workspace / preset / 配额 / 策略 / 凭证引用)         │   /internal/kernel/llm/*
     │                                                       │   /internal/kernel/tools/*
     ▼                                                       │   /internal/kernel/approval/*
┌─────────────────── 隔离运行时池 ───────────────────────────────┐
│  单位：一个隔离域 = 一个 (租户, workspace)                       │
│  形态：容器 / microVM（预热池）                                  │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  DSH 内核（Cordis 插件树，所有 I/O 插槽指向反向网关）    │    │
│  │   · 推理循环 · 会话状态机 · 不变量校验 · 系统提示词组装  │    │
│  │   · 工具管线 · 审批瀑布骨架 · 中层沙箱（文件写策略）      │    │
│  │   · preset / scope（内层能力边界）                      │    │
│  │   ✱ 内核内无任何模型密钥                                │    │
│  └──────────────────────────────────────────────────────┘    │
│  会话事件日志（JSONL，事件溯源） ──┐                             │
│  workspace（卷 / 对象存储）      ──┴──► 外置持久化               │
└──────────────────────────────────────────────────────────────┘
     ▲
     │ ③ 产品壳（多场景 / 多版本 / 独立部署）：按 OpenAPI SDK 调用
     │    客服壳 · 编码壳 · 分析壳 · 自定义业务壳
┌──────────────────────────────────────────────────────────────┐
│  产品侧服务：知识库 · 文档解析 · Skill 发布 · 工作台 · 管理后台   │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 组件职责

| 组件 | 职责 | 明确不做 |
|---|---|---|
| **控制面** | 身份、租户、RBAC、配额、计费、审计落库、Registry、路由、对外契约 | 不执行 agent 逻辑 |
| **Session Router** | 按 workspace 路由到隔离域；域不可用时按轮次边界迁移 | 不做轮内迁移 |
| **Plugin Registry** | 插件制品、版本、标签、签名、回滚 | 不参与运行时 |
| **隔离域** | 承载一次或多次会话的内核实例；域内本地执行工具 | 不持有长期凭证 |
| **反向网关** | 把内核的 llm/tools/approval/skill 请求转给产品侧裁决 | 不缓存决策、不改语义 |
| **产品壳** | 交互渲染、业务编排、UI 定制 | 不自己调模型 |

### 5.2 一次 turn 的数据流

```
产品壳 ──POST /turns──► 控制面
                          ├─ 鉴权 / 配额预检 / 审计开记
                          ├─ 路由到 workspace 所属隔离域
                          └─► 隔离域：内核开始推理
                                  │
              ①LLM 请求 ──────────┤ 反向网关 ─► 产品侧：鉴权/配额/记账 ─► 模型网关 ─► 流回
              ②工具执行 ──────────┤ 策略反转：产品侧裁决权限与审批
                                  │          执行本地（域内沙箱内）
              ③审批 ──────────────┤ 反向网关 ─► 产品侧审批 UI ─► 决策流回
              ④事件流 ────────────┴─► 控制面 ──SSE──► 产品壳
                                  │
                          会话日志追加（轮次结束时 fsync）
```

**要点**：
- **①：内核只知道"要向产品侧要一次模型调用"**，不知道密钥、不知道配额、不知道计费
- **②：策略反转、执行本地** —— 裁决走产品侧，工具执行留在域内，避免 Python 成为每次文件操作的必经之路
- **④：产品壳只消费事件流**，不参与推理

---

## 6. 架构决策记录（ADR）

### ADR-1 · 内核接线用 DI 插槽，不用进程外协议

| 项 | 内容 |
|---|---|
| **背景** | 需要让产品侧接管内核的所有 I/O |
| **可选** | ① OpenAPI + SSE（进程外）；② cordis DI 插槽（进程内） |
| **决策** | **选 ②** |
| **理由** | 插槽是 DSH 的原生设计意图。已验证存在：`ctx.llm.registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle`；`LlmAdapter` 是抽象类，仅留 `abstract stream(options): AsyncIterable<StreamChunk>`；`ctx.approval` 由组合方提供应答者；返回的 handle 含 disposer 与 `replace()`，支持运行期替换 |
| **代价** | 产品侧与内核同生命周期；跨语言需网关；升级需重测适配层 |
| **替代方案被否的原因** | 进程外协议会丢失 Typert 的 waterfall / 事件流语义对等，且强制状态外置（见 ADR-4） |

### ADR-2 · 零密钥：内核所有 I/O 反向回调

| 项 | 内容 |
|---|---|
| **背景** | 密钥放内核 = 扩大泄露面；放产品侧才能做配额与计费 |
| **决策** | **内核不持有任何模型凭证**。所有模型调用经反向网关回产品侧，由产品侧持有密钥并完成鉴权/配额/记账 |
| **理由** | 可验证的安全属性（G1）；同时天然解决审计与配额；把内核降级为"不可信执行域"（P2） |
| **代价** | 每次模型调用多一跳；产品侧成为关键路径，需高可用 |
| **硬约束** | **禁止**任何形式的"绕过 agent loop 直连模型"接口对外暴露 |

### ADR-3 · 隔离域 = workspace，容器为一等公民

| 项 | 内容 |
|---|---|
| **背景** | 多租户需要真正的资源隔离；DSH 沙箱是 `partial`，不足以担当 |
| **决策** | 一个隔离域 = 一个 **(租户, workspace)**，形态为容器/microVM。域内可跑该租户的多个会话；**跨租户绝不共享域** |
| **理由** | workspace 是内核已有的一等概念（`workspaceRoot` / `SessionHeader.cwd` / peer 派生），无需发明新单位；容器补上外层边界；与 JupyterHub / CI runner 同构 |
| **代价** | 每域一份运行时开销与启动延迟 → 用预热池缓解 |
| **被否方案** | "共享 Worker 内多 SubContext 做租户隔离" —— 用能力边界冒充安全边界 |

### ADR-4 · 弹性 = 可重启运行时 + 外置事件日志，不是无状态 Worker

| 项 | 内容 |
|---|---|
| **背景** | 需要弹性，但内核不可无状态化（§2.2） |
| **决策** | 弹性通过**可丢弃、可重启的隔离域**实现。会话状态依赖 DSH 已有的**事件溯源 + 不变量 + 检查点**，日志外置到对象存储；替换 `dsh-session-persistence-jsonl` 的落点即可（持久化本身是 seam） |
| **理由** | DSH 的会话是它少有的"天然可重启"的部分；**不必让 worker 变纯函数**也能获得弹性 |
| **代价** | 恢复粒度是"轮次"，不是"毫秒"；文件系统一致性需额外核对 |

### ADR-5 · 会话迁移只在轮次边界

| 项 | 内容 |
|---|---|
| **背景** | 在途状态不可序列化 |
| **决策** | 迁移/重调度只允许发生在 **turn 边界**。在途的持久 shell、工具调用、审批请求必须本地跑完或明确取消 |
| **理由** | `dsh-tool-pwsh-persistent` / `dsh-tool-bash-persistent` 等持进程级资源；`ctx.approval` 的请求**必须在一个未结束轮次内**（官方：轮次外的事件是"crash tail"） |
| **代价** | 单轮长任务无法迁移；需对超长轮次设上限或提供取消 |

### ADR-6 · 只依赖非 experimental 包

| 项 | 内容 |
|---|---|
| **背景** | DSH 用包名标记稳定性；experimental 明确"不承诺稳定性" |
| **决策** | 产品核心**只依赖非 experimental seam**；experimental 能力（Agent Teams、PTC workflow）**必须被自研适配层包住**，实现可整体替换 |
| **理由** | 避免把企业产品建在流沙上 |
| **代价** | 短期内无法把多智能体作为核心卖点；需自建等价的编排层或等待收敛 |

### ADR-7 · 插件只集中分发，不集中运行

| 项 | 内容 |
|---|---|
| **背景** | 需要统一管控插件版本，但不能因此把运行时也集中 |
| **决策** | Registry 只管**制品 / 版本 / 标签 / 签名 / 回滚**；隔离域按 profile **拉取并本地加载**到 Cordis 树 |
| **理由** | 插件是进程内对象，集中运行会把插件状态问题放大为分布式问题 |
| **代价** | 需解决制品分发的一致性与缓存 |

### ADR-8 · 策略反转、执行本地

| 项 | 内容 |
|---|---|
| **背景** | 工具调用既要治理又要低延迟 |
| **决策** | **裁决走产品侧**（权限、配额、审批、审计）；**执行留在隔离域内**（域内沙箱） |
| **理由** | 若每次文件/shell 操作都跨进程回产品侧，Python 侧成为所有 I/O 的串行瓶颈 |
| **代价** | 产品侧策略需下推并被域内强制；需防止"域内自裁决"绕过 |

### ADR-9 · 审批语义与 turn 绑定

| 项 | 内容 |
|---|---|
| **背景** | 企业需要异步审批流，但 DSH 的审批是 turn-enclosed |
| **现状事实** | `ctx.approval` 的应答者是 `approval/request` waterfall 监听器；无最终应答者时解析为 `unavailable` 并 **fail-closed**；`never` 策略在服务内先于 waterfall 执行（后注册的 `prepend` 监听器无法绕过）；审计事件 `approval/asked` / `approval/decided` **只写日志**、不进入模型历史；`request()` 在轮次外调用直接抛错 |
| **决策** | 产品侧实现**最终应答者**；对需要人工长时审批的场景，产品侧用"挂起 + 轮内等待 + 超时 fail-closed"实现，**不改内核语义** |
| **代价** | 审批等待占用一个打开的轮次；超长审批需超时与补偿策略 |

---

## 7. 接口契约

### 7.1 正向：Runtime Profile（控制面 → 隔离域）

```jsonc
{
  "profileId": "…",
  "tenantId": "…",
  "workspaceId": "…",              // 隔离域的身份，决定容器归属
  "workspaceRoot": "/…",
  "presetId": "coding",            // 对应 dsh-agent-preset 的 config.id
  "pluginSet": [                    // 来自 Plugin Registry
    { "name": "@…/plugin-x", "version": "1.2.0", "integrity": "sha512-…" }
  ],
  "policies": {
    "sandboxMode": "workspace-write",     // read-only | workspace-write | danger-full-access
    "approvalPolicy": "ask",              // ask | never
    "writeScopes": ["src/", "docs/"]      // 提示性，非锁
  },
  "quota": { "tokensPerDay": 1000000, "toolCallsPerTurn": 50 },
  "credentialRef": "vault://tenant-x/llm" // 仅引用，不含明文
}
```

### 7.2 反向：内核 → 产品侧

| 端点 | 用途 | 语义 |
|---|---|---|
| `POST /internal/kernel/llm/stream` | 模型调用 | 流式返回；产品侧完成鉴权/配额/记账 |
| `POST /internal/kernel/llm/models` | 模型目录 | 供 `listModels` / `resolveModel` |
| `POST /internal/kernel/tools/resolve` | 工具裁决 | 是否允许、是否需要审批、参数约束 |
| `POST /internal/kernel/approval/request` | 审批 | 同步返回 `allowed-once` / `rejected` / `cancelled` / `unavailable` |
| `POST /internal/kernel/skills/resolve` | Skill 解析 | 返回可用 Skill 目录与内容 |
| `POST /internal/kernel/audit` | 审计事件 | 追加式，产品侧落库 |

**统一要求**：全部经 **mTLS + 短时令牌**；域内无长期凭证；请求体携带 `turnId` 以便与轮次边界对齐。

### 7.3 对外 OpenAPI（修订版草案）

```
# 目录与能力发现（原草案缺失，为阻塞项）
GET    /v1/scenarios                       # 场景目录（含可用 preset / plugin 组合 + schema）
GET    /v1/plugins?tag=                    # 插件目录与版本

# Session
POST   /v1/sessions                        # 202 + Location
GET    /v1/sessions/{id}
DELETE /v1/sessions/{id}

# Agent Loop（二选一，不并存两套流）
POST   /v1/sessions/{id}/turns             # 发起一轮 → {turnId}
GET    /v1/sessions/{id}/events            # 唯一 SSE 端点，支持 Last-Event-ID 重连
POST   /v1/sessions/{id}/turns/{tid}/cancel

# 审批（补齐三态）
GET    /v1/sessions/{id}/tools
POST   /v1/sessions/{id}/approvals/{aid}   # { decision: allow-once | deny }

# 历史（补分页）
GET    /v1/sessions/{id}/messages?cursor=&limit=
GET    /v1/sessions/{id}/trajectory?cursor=&limit=

# Workspace（通配路径 + 补全 + 二进制走签名上传）
GET    /v1/sessions/{id}/files
GET    /v1/sessions/{id}/files/{path*}
PUT    /v1/sessions/{id}/files/{path*}
POST   /v1/sessions/{id}/uploads
DELETE /v1/sessions/{id}/files/{path*}

# 模型
GET    /v1/llm/providers
# ✗ 不提供 /llm/chat —— 会绕过治理与审计
```

**相对原草案的修订理由**：

| 修订 | 原因 |
|---|---|
| 新增 `/scenarios`、`/plugins` | 创建 session 要传 plugin 组合，却无接口能查询目录 —— **阻塞性缺口** |
| `POST /agent-loop` 与 `/agent-loop/events` 二选一 | 两套流职责重叠；订阅式还有"必须先订阅再发起"的竞态，原草案未定义 |
| 新增 `turns/{tid}/cancel` | 长跑 turn 无取消接口；SSE 断开是否等于取消未定义 |
| 审批补 `deny` | 原草案只有 approve，缺 2/3 状态 |
| 历史补 `cursor` / `limit` | 会话可很长 |
| SSE 补 `Last-Event-ID` | 断线重连否则丢事件 |
| 文件路径改通配 `{path*}` | `%2F` 可能被网关规范化 |
| **删除 `/llm/chat`** | 绕过 agent loop = 绕过 RBAC/配额/审计；且使产品壳不再是"纯交互层" |

---

## 8. 隔离与安全模型

### 8.1 三层边界

| 层 | 强制者 | 保证 | 不保证 |
|---|---|---|---|
| 外层 | 容器 / microVM | 租户间文件、网络、进程、依赖互不可见 | — |
| 中层 | DSH 沙箱 | 单次调用只能写工作区 + 私有临时区 | **读取、网络、进程**；Windows 档为 `partial` |
| 内层 | preset / scope | 该 Agent 只能用声明的工具与插件 | 不是安全边界 |

### 8.2 威胁模型

| 威胁 | 是否防 | 靠什么 |
|---|---|---|
| 提示注入诱导模型越权写文件 | 部分 | 中层沙箱 + 审批瀑布（fail-closed） |
| 工具链供应链投毒 | 部分 | Registry 签名 + 完整性哈希 + 容器隔离 |
| 跨租户数据读取 | **是** | 外层容器 |
| 密钥泄露 | **是** | 零密钥（ADR-2） |
| 提示注入诱导模型读取宿主其他文件 | **否（中层）** | 需外层容器；DSH 沙箱不管读取 |
| 插件缺陷导致进程崩溃/资源耗尽 | 部分 | 外层容器 cgroup / 重调度 |
| 内网横向移动 | 部分 | 容器网络策略（DSH 沙箱不管网络） |

### 8.3 Windows `partial` 的补偿措施

| 绕过路径 | 补偿 |
|---|---|
| 硬链接别名 | 容器内工作区独立卷；不与其他租户共享底层文件 |
| 读取不受限 | 容器只挂载本租户 workspace；宿主敏感路径不挂载 |
| AppContainer 包 SID 不可读 | 容器内重建干净的用户环境，避免宿主 ACL 残留 |
| 常驻 Low 标签外溢 | 用**容器内的一次性用户/卷**，让标签随容器销毁 |
| `icacls` 清不掉 | 在容器内操作，不在宿主上留残留 |

---

## 9. 状态与持久化

| 状态 | 载体 | 生命周期 | 备注 |
|---|---|---|---|
| 会话事件日志 | JSONL（事件溯源） | 长期，外置对象存储 | 唯一真源；可重放；含不变量校验 |
| 检查点 | 由会话日志派生 | 中期 | 决定恢复起点 |
| workspace 文件 | 卷 / 对象存储 | 长期 | 与 workspaceId 绑定 |
| 域内临时（TMP/TEMP、私有临时目录） | 容器临时层 | **域销毁即弃** | 不上传、不跨域 |
| 在途工具 / 持久 shell | 进程内存 | **轮次内** | **不可迁移**（ADR-5） |
| 审批请求 | 会话日志（log-only 事件对） | 轮次内 | `approval/asked` + `approval/decided` |
| 团队状态（若启用） | Lead 会话日志 | 会话内 | 实验能力，需适配层 |

**恢复语义**：从会话日志重放到最后一个完整轮次，重建不变量状态后继续。**不承诺毫秒级恢复。**

---

## 10. 可观测性与审计

| 维度 | 采集点 | 内容 |
|---|---|---|
| **模型** | 反向网关 | 租户、模型、token 用量、延迟、成本、失败原因 |
| **工具** | 反向网关（裁决）+ 域内（执行） | 工具名、参数摘要、裁决结果、执行耗时、退出码 |
| **审批** | 反向网关 + 会话日志 | `approval/asked` / `approval/decided` 全量落库 |
| **沙箱** | 域内 | 请求模式、`enforcement` 值（full/partial）、拒绝标记、runner 失败签名 |
| **会话** | 控制面 | 创建/销毁/迁移、轮次计数、恢复次数 |
| **平台** | 控制面 | 域池水位、启动延迟、路由命中率 |

**约定**：所有审计事件以 `turnId` 关联；`enforcement != full` 时必须打标，供合规报表区分"强隔离"与"弱隔离"时段。

---

## 11. 演进路线

| 阶段 | 目标 | 关键动作 | 验收标准 |
|---|---|---|---|
| **P0** | 内核接线 + 零密钥（单租户） | 反向网关接管 llm/tools/approval/skill；精确 pin DSH；**只用非 experimental seam** | G1 达成：域内搜不到凭证；产品侧能配额与记账 |
| **P1** | 可重启会话 | 会话日志落对象存储；workspace 外置；替换 persistence 落点 | G3 达成：杀进程后同一会话可续跑（轮次边界） |
| **P2** | 外层隔离 | 一 (租户, workspace) 一容器/microVM；预热池 | G2 达成：跨域文件/网络/进程互不可见 |
| **P3** | 控制面 | 身份/RBAC/配额/审计落库 + Registry + OpenAPI 网关 + 对外契约 | G4、G5 达成：多租户上线，产品壳可独立构建部署 |
| **P4** | 收编实验能力 | 待 Agent Teams 稳定化、DSH 的"环境一致能力组"落地后吸收 | G6 持续达成：内核升级只重测适配层 |

**P1 是全路线的分水岭**：拿到"可重启会话"之前，谈多副本弹性都是空的；拿到之后，弹性是水到渠成。

### 11.1 明确不做（负面清单）

1. ❌ 不做"无状态 Worker / step 纯函数化"
2. ❌ 不用 Context 做租户边界
3. ❌ 不让密钥进入内核，不开任何"绕过 agent loop"的口子
4. ❌ 不在共享 Worker 上跑跨租户会话
5. ❌ 产品核心不依赖 `dsh-experimental-*`
6. ❌ 不做轮内会话迁移

---

## 12. 风险登记册

| ID | 风险 | 影响 | 概率 | 缓解 |
|---|---|---|---|---|
| R1 | 反向网关成为关键路径单点 | 全平台不可用 | 中 | 网关多副本 + 内核侧短超时 + 降级为"拒绝而非放行" |
| R2 | DSH 升级破坏适配层 | 升级停滞 | 中 | 精确 pin + 契约测试 + 单域灰度 |
| R3 | 会话日志外置后一致性 | 数据损坏/丢轮次 | 中 | 追加写 + fsync + 恢复期不变量校验 |
| R4 | Windows `partial` 被当作强隔离 | 安全误判 | **高** | 文档显式标注；`enforcement != full` 打标；合规报表区分 |
| R5 | 依赖 experimental 包 | 内核升级即断裂 | **高** | ADR-6 适配层隔离；或自建等价编排 |
| R6 | 容器启动延迟影响体验 | 首轮慢 | 中 | 预热池 + 会话预创建 |
| R7 | 审批等待占用打开的轮次 | 长时审批无法完成 | 中 | 轮内等待 + 超时 fail-closed + 产品侧补偿流程 |
| R8 | 插件制品分发不一致 | 域间行为漂移 | 中 | Registry 签名 + 完整性哈希 + 启动时校验 |

---

## 13. 待验证假设

> 以下三点会**改变架构形状**，应在 P0/P1 之前确认。验证方式为一次性小规模实验（用完即弃），不产出交付物。

| # | 假设 | 若证伪的后果 |
|---|---|---|
| A1 | **会话能否跨进程续跑**：杀掉进程后，用同一份会话日志在新进程恢复，会话/不变量/检查点自洽 | P1 不成立 → 必须放弃"可重启会话"，弹性只能靠"域内不动" |
| A2 | **一域一会话的启动成本**可压到用户无感 | P2 形态要改（共享域 + 更强沙箱，但那会撞 ADR-3 的结论） |
| A3 | **反向网关对工具执行的延迟增量**可接受 | ADR-8 要调整（可能需把更多裁决下推，只保留审计回传） |

---

## 14. 附录：DSH seam 与稳定性分级

### 14.1 可依赖的稳定 seam（实测存在）

| seam | 包 | 关键契约 |
|---|---|---|
| `ctx.llm` | `dsh-llm` | `registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle`；`LlmAdapter` 抽象类，仅 `abstract stream(options): AsyncIterable<StreamChunk>`；handle 含 disposer 与 `replace()` |
| `ctx.approval` | `dsh-user-approval` | 应答者为 `approval/request` waterfall 监听器；缺最终应答者 → `unavailable` 且 fail-closed；`never` 先于 waterfall 执行；审计事件仅写日志；**请求必须轮次内** |
| `ctx.sandbox` | `dsh-sandbox` + `dsh-sandbox-local` + `dsh-sandbox-policy` | 模式 `read-only` / `workspace-write` / `danger-full-access`；`confine()` 返回 argv 或 `SANDBOX_UNAVAILABLE`；**绝不静默不受限运行**；执行报告 `enforcement: full/partial` |
| `ctx.skills` | `dsh-skill` / `dsh-skill-filesystem` | provider 接口；可注册额外根 |
| `ctx.invariants` | `dsh-invariants` | `register(packageName, install)`；用于会话事件校验 |
| preset | `dsh-agent-preset` + `dsh-agent-preset-registry` | Cordis YAML 声明 `id` / `plugins` / `name` / `description` / `order`；多 preset 由会话选择；`registry.config.default`；**修改只影响之后创建的 Agent** |
| 会话持久化 | `dsh-session-persistence-jsonl` | 可替换落点（P1 依赖） |
| 系统提示词 | `dsh-system-prompt` / `dsh-persona` | 组装与人格贡献 |
| 工具 | `dsh-tools` / `dsh-tool-*` | 工具管线与审批消费 |

### 14.2 experimental（不承诺稳定性，须适配层隔离）

`dsh-experimental-agent-team` · `dsh-experimental-tool-agent-team` · `dsh-experimental-agent-team-profile` · `dsh-experimental-auto-review` · `dsh-experimental-schedule-bundle` · `dsh-experimental-ptc-runtime-python` · `dsh-experimental-voice-input-bundle`

### 14.3 沙箱各平台档

| 平台 | 后端 | 强制完整度 |
|---|---|---|
| Linux | `bwrap` → Landlock | bwrap `full`；旧 Landlock ABI `partial` |
| macOS | Seatbelt（`sandbox-exec`，SBPL 默认允许 + `deny file-write*` + allow-list） | `full`（依赖 Apple 未移除私有引擎） |
| Windows | ACL 受限令牌（`WRITE_RESTRICTED` + Low 完整性） | **`partial`**（见 §2.3） |

### 14.4 关键约束速查

| 约束 | 出处 |
|---|---|
| 审批请求必须在未结束轮次内 | `dsh-user-approval` README |
| 团队不支持多进程并发操作同一 Team | `dsh-experimental-agent-team` README |
| 团队成员共享 cwd，无 worktree / 文件锁 | 同上 |
| write scope 仅提示性，不阻止 claim、不授予写权限 | 同上 |
| 沙箱只管文件写；不表达网络/进程/系统调用/设备/凭据 | `dsh-sandbox` README |
| 沙箱只适用于与宿主共享内核和文件系统的进程 | 同上 |
| 容器/microVM/远程执行需**替换** `ctx.shell` / `ctx.fs` 能力，而非新增后端 | 同上 |

---

## 15. 结论

1. **harness 是有状态的**——承认这一点，路线就从"三年重写内核"变成"十二个月渐进落地"
2. **DSH 已给中层（沙箱+审批）与内层（preset+scope）边界，只缺外层容器**——这是投入重点
3. **零密钥是最高性价比的一条**：可验证、可审计、天然带来配额与计费
4. **弹性是结果不是目标**：靠"可重启运行时 + 外置事件日志"得到，不靠"无状态 Worker"
5. **实验包是最大的隐性风险**：多智能体能力目前建在 `dsh-experimental-*` 上，必须适配层隔离
6. **`partial` 必须被如实对待**：DSH 沙箱防盗不防对抗，多租户安全只能靠容器
