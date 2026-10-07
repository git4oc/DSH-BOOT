# DSH 企业级技术方案设计

| 项 | 值 |
|---|---|
| 版本 | v2.6 |
| 状态 | 设计定稿（已经过架构评审 + 5 视角独立评审并修订） |
| 适用范围 | 基于 DeepSeek Harness 构建的多租户企业级 Agent 平台 |
| 目标基线 | **版本列车** `@deepseek-ai/dsh` + 全部 `@deepseek-ai/dsh-*` + `@deepseek-ai/cordis` **同值单列**（本版以 `0.2.0-rc.1` 为列车号） |

> ## ⚠️ 设计与评审纪律（最高优先级）
>
> **在本方案的设计、评审与开发全过程中，一律不考虑任何具体机器、现有部署或既有配置。**
>
> | # | 条款 |
> |---|---|
> | 1 | **方案只对目标架构负责。** 全部设计、约束与取舍，依据是**目标架构本身**与**目标版本列车**，不是任何一台已安装机器的现状。 |
> | 2 | **禁止"因为本机是 X，所以设计成 Y"的论证。** 本机现状既不能作为设计的**约束**，也不能作为设计的**依据**，更不能作为评审的**判据**。 |
> | 3 | **"平台事实"的定义收窄。** §2.2 的约束只允许来源于**目标版本列车的官方契约**（发行包 README / 类型声明 / 规范 / 编译产物），**不包含**"某台机器上恰好装了什么、跑着什么、配着什么"。 |
> | 4 | **评审判据。** 架构评审只评价**设计是否自洽、是否可行、是否完整**；"与本机不一致"**不构成**发现项。 |
> | 5 | **实现阶段同样适用。** 开发、联调、验收均以**目标架构**为准；本机环境差异属于**环境准备**问题，不得倒逼设计变更。 |
> | 6 | **冲突时以本纪律为准。** 本纪律的编号为 §2.3 的 **D13**。 |

### 修订记录

| 版本 | 变更 |
|---|---|
| **v2.6** | 依**5 视角独立评审**（安全合规 / SRE / 研发负责人 / 产品商业 / 演进反脆弱）作规格式修订，共 6 个根因：① **强制点归位** —— 白名单从"声明"改为 `register()` **拦截**，移除 plugin-manager 与 hmr，预设表收敛为单一预设，定义升权上限（D16）；② **信任模型一次性表态** —— 域镜像 + 只读 Profile 属 TCB，attest 降为 **detective**，删除"域内改写工具集 ✅"（D15）；③ **版本列车纪律** —— 基线改列车单值，"存在 disabled 关键行则域不得 ready"（C33/C34）；④ **判定语义修正** —— P1 拆 L1/L2、迁移状态机、轮次三层截止时间；⑤ **可用性与合规** —— 软依赖不得阻断执行（L1b）、真源改为"日志 + 上传确认水位"、审计等级与不可用行为解耦、DSR 补全清单与证明、删除语义反转；⑥ **安全收窄** —— 域令牌绑定租户、凭证代理授权口径、环境白名单构造、公网工具与子代理处置、审计键升五元组。另补加密与数据驻留、成本前置、DevEx 前置 |
| v2.5 | 补全 workspace 语义（四个同名概念、`cwd` 一对一投影、注册表归属 D14、用户端行为约定） |
| v2.4 | 新增**设计与评审纪律**（D13） |
| v2.3 | 依架构级评审修订：强制模型闭合、强制等级与降级阶梯、隔离域粒度改租户、一致性与对账、反转面收窄至 4、故障域矩阵、凭证规则收敛 |
| v2.2 | 依实现符合性评审修订：基线与分层锁执行点、stdio MCP 凭证口径、恢复语义改为追加合成 closer、注入面四通道、锁与 fencing、删除与保留、preset 永久兼容面、事件映射表 |
| v2.1 | 补入插件分类与分层锁；新增 MCP 接入设计；明确 host/client 插件分离 |
| v2.0 | 由架构评审转为设计定稿；移除论证性内容 |

---

## 1. 范围与术语

### 1.1 适用范围

本方案定义把 DSH 从"单机 Agent 外壳"部署为"企业级多租户 Agent 平台"的完整技术设计，覆盖：总体架构、运行时、控制面、接口契约、数据、安全、可靠性、部署运维、依赖策略与实施阶段。

不在范围内：具体排期与人力、供应商选型、DSH 内核自身的功能开发。

### 1.2 术语表

| 术语 | 定义 |
|---|---|
| **seam（接缝）** | DSH 暴露的可替换能力接口，形如 `ctx.<capability>`，实现由组合方提供 |
| **plugin（插件）** | DSH 的组合单元，即 Cordis 插件。分五类：bundle/profile 层、seam 提供方、tool 插件、UI（client-side）插件、skill provider |
| **preset** | Cordis YAML 中声明的"一个 Agent 的子插件列表"。**不是安全沙箱**：YAML 及插件可执行 Host 代码；用户覆盖是**整体替换** |
| **connector** | 外部 MCP 服务器。由 `dsh-mcp-client` 桥接；**本身不是 Cordis 插件** |
| **skill** | `SKILL.md` 内容资产，走 `ctx.skills` seam。**不是插件** |
| **隔离域** | 本方案的**安全与部署单位**：一个域承载一个 **`(租户, 隔离组)`**，形态为容器或 microVM |
| **隔离组** | 同一租户内被指派到同一个域的工作区集合。**默认一个域承载一个租户的全部工作区** |
| **workspace** | 域内的**分区单位**：`(tenantId, workspaceId)`，各占一个可写根。**不是安全边界**（安全边界是租户）。见 §7.3 |
| **TCB（可信计算基）** | 被显式声明为"假定未被攻陷"的部分。本方案的 TCB = **域镜像 + 只读 Profile + 域外全部组件**（D15） |
| **preventive / detective** | 强制 vs 检测。preventive 使动作**不可能发生**；detective 只能**发现**动作发生过 |
| **强制等级** | 硬（能力不可达 / fail-closed）、软（可缓冲、可事后对账）、缓存（可用陈旧值继续）。见 §2.4 |
| **提交点** | `flush` 屏障，而非"轮次结束" |
| **上传确认水位** | 已被对象存储确认接收的最后一个日志位置。**与"已 flush 位置"不同**，二者共同构成真源（§7.6） |
| **副作用台账** | 域外持久化的"可能已发生副作用"清单，用于恢复后禁止盲重试（§7.4.1） |
| **降级级别** | L0–L3 + L1b，见 §9.4 |
| **enforcement** | 沙箱后端对"该模式承诺的每个文件操作"的管辖程度。`full` / `partial` |

### 1.3 设计依据

平台事实来自**目标版本列车**的发行包 README、类型声明、规范与编译产物。§13.1 汇总。v2.6 新增的约束（C33–C50）均来自 5 视角评审的证据核对，逐条标注出处。

---

## 2. 设计目标与约束

### 2.1 设计目标

| ID | 目标 | 验收判据 |
|---|---|---|
| G1 | 内核无长期凭证 | 域内不存在长期凭证；**唯一例外须显式登记并进入合规报表** |
| G2 | 多租户隔离 | 跨**租户**的文件、网络、进程、依赖互不可见 |
| G3 | 会话可重启 | 进程被杀后同一会话可在另一实例续跑；中断轮次由合成 closer 收尾 |
| G4 | 产品壳独立演进 | 产品侧按 OpenAPI 生成 SDK，独立构建部署 |
| G5 | 治理可审计且**可强制** | 标记为"硬"的约束**不可被域内绕过**，且**在存在对抗者时仍成立**（D15/D16） |
| G6 | 内核可替换 | 内核升级只需重测适配层，产品代码不变 |
| G7 | **经济可行** | 单租户成本、域密度、冷启成本有可核算模型，且**在 P2 出口即可报价**（§10.4） |

### 2.2 设计约束（平台事实）

| ID | 约束 | 出处 |
|---|---|---|
| C1 | 审批请求**必须在一个未结束的轮次内**；轮次外算崩溃残留 | `dsh-user-approval` |
| C2 | 持久 shell 与在途工具调用持有进程级资源，不随日志恢复 | `-tool-bash-persistent`、`-session-persistence-jsonl` |
| C3 | 团队能力由实验包提供，**不承诺稳定性** | `dsh-experimental-agent-team(-profile)` |
| C4 | 沙箱**只管辖文件写**，不表达网络/进程/系统调用/设备/凭据限制 | `dsh-sandbox` |
| C5 | 沙箱只适用于与宿主共享内核和文件系统的进程 | `dsh-sandbox(-local)` |
| C6 | 沙箱报告 `enforcement`，Windows 档为 `partial` | `-sandbox(-windows-acl)` |
| C7 | 容器/microVM/远程执行需**替换**执行能力 | `dsh-sandbox` |
| C8 | 无最终应答者 → `unavailable` 且 fail-closed；**审批只有一次性授权**，无 allow-always / 规则存储 / 撤销 | `dsh-user-approval` |
| C9 | **审批请求不携带工具参数**（仅 `toolName`/`callId`/`reason`，**且不含 sessionId**） | `dsh-user-approval` |
| C10 | MCP 工具名是 `(serverName, rawName)` 的**纯函数**，不采用远端 `serverInfo.name` | `dsh-mcp-client` |
| C11 | **独立 Agent 作用域可复用同一 `serverName`** → `(serverName, rawName)` 非全局唯一键 | `dsh-mcp-client` |
| C12 | MCP 进模型上下文有**四类通道**：`instructions`、工具描述与 schema、工具结果、资源正文 | `dsh-mcp-client`、`-mcp-resources` |
| C13 | MCP 启动与发现超时继承 SDK（60 s）；单次调用另有 `toolCallTimeoutMs` | `dsh-mcp-client` |
| C14 | MCP stdio 的 `env` 合并到已清洗环境之上；**凭证只能经此进入域内** | `dsh-mcp-client` |
| C15 | MCP 初始连接失败默认不致命；`failOnStartupError` 只让插件激活失败，MCP 行属 **optional** | `dsh-mcp-client`、`-app-boot` |
| C16 | `dsh-mcp-client.apply` **会等待初始连接与发现完成** | `dsh-mcp-client` |
| C17 | **preset 不是安全沙箱**；用户覆盖**整体替换**子插件列表 | `-agent-preset-registry` |
| C18 | 启动期只校验 **peer 版本**，"不是防范恶意包代码的沙箱" | `-app-boot` |
| C19 | scoped 注册"**不是沙箱或权限边界**" | `dsh-scope` |
| C20 | 会话日志保存 preset ID；恢复用其当前定义，**缺失时拒绝恢复** | `-agent-preset-registry` |
| C21 | 提交点是 **`flush`**；检查点在模型请求前、顶层工具副作用前、每个 `agent/pre-step` | `-session-persistence`、`-checkpoint-policy` |
| C22 | 崩溃恢复是**追加合成 closer**，不是回滚；中断轮次的事件**永久留在历史中** | `-session-persistence(-jsonl)`、`-agent-loop` |
| C23 | persistence 只保证**单实例内**写所有权；跨进程靠 `session.lock`，**NFSv3 不可靠**；**该锁故意无过期**——"活着的卡死持有者会阻塞写入方直到其进程退出" | `-session-persistence(-jsonl)` |
| C24 | persistence **无删除/保留接口**；`list()` 无分页无过滤无索引 | `-session-persistence(-jsonl)` |
| C25 | `ctx.invariants` **需显式挂载**；`dsh-base` 刻意省略 | `-invariants`、`-base` |
| C26 | `ctx.sessionQuery` **无调用方授权** | `-session-query` |
| C27 | `tools/pre-execute` **不可改写** `exec.arguments`；沙箱**只有一个可写根**（`SessionHeader.cwd`） | `-tools`、`-sandbox-policy` |
| C28 | 工具定义的 `timeoutMs` **仅声明**；`dsh-tool-call-timeout-policy` 是**协作式**——"工具承诺遵守 `exec.signal`，包装器到点映射为 `TOOL_TIMEOUT`，**不赛跑也不放弃工具 promise**" | `-tools`、`-tool-call-timeout-policy` |
| C29 | `dsh-base` 部署默认 `workspace-write`（由 `DSH_PERMISSION_MODE` 决定）；包级 failsafe 为 `read-only` | `-base`、`-sandbox-policy` |
| C30 | Windows：ACE / 拒绝项 / Low 标签是对真实目录的**驻留改动**；**临时授权与标签可由模块 `dispose()` 撤销**，工作区安全描述符编辑**按设计保留**；手工 `icacls` 无法回收；授权物化**急切全树传播，数十秒计**；**Low 标签会加宽目录树**——同用户的其他 Low 完整性进程"**可以在工作区内写入与删除**"；硬链接别名可写 | `-sandbox-windows-acl` |
| C31 | `ctx.workspaceRegistry`（`dsh-workspace`）是**宿主侧呈现注册表**，对模型完全不可见 | `dsh-workspace` |
| C32 | **移除 workspace 记录不删除**其文件夹、文件或会话历史 | `dsh-workspace` |
| **C33** | 全部 `dsh-*` 包的 `peerDependencies` 是**无范围的精确 pin**（如 `"0.2.0-rc.2"`，无 `^`/`~`） | `-session-persistence-jsonl/package.json:31` 等 |
| **C34** | 内核加载期对 peer 做 `semver.satisfies`；**不匹配的行被标 `disabled`，域照常启动**——失败模式是**静默降级**而非拒绝启动 | `-app-boot` `evaluatePluginCompatibility()` |
| **C35** | `dsh-mcp-client` 在收到上游 `notifications/tools/list_changed` 时**自动重做发现并逐个 `ctx.tools.register()`**，注册路径**无任何白名单/过滤**，配置项也无工具过滤参数 | `-mcp-client` 发现循环与 `refreshTools()` |
| **C36** | `dsh-base` 插入 **两行** plugin-manager：工具行 `disabled: true`，**服务行 `disabled: !!js "!ctx.get('profileContext')"` → 有 profileContext 即启用**；`hmr` 同条件启用（"Profile configuration reloads by default"）。安装的 Host 代码**在进程内、工作区沙箱之外执行** | `-base/cordis.patch.yml:16-30`、`-plugin-manager` |
| **C37** | 会话沙箱模式由**会话日志的 `sandbox/mode` 事件**决定（`setSandboxMode` 只是 append 事件），"最后一条事件优先于部署默认值"；不变式**只校验取值在封闭词表内**，不校验调用者或是否需批准 | `-sandbox-policy` |
| **C38** | 默认权限预设表**含 `danger-full-access` = `danger-full-access` + `never`**（两把锁同时打开）；`PermissionPresetService` 是 **Remote 服务**，`set()` 可对外暴露 | `-permission-presets` |
| **C39** | `SessionHeader.version` 是**字面量类型 + 精确相等校验**；历史解码依赖内核的 format catalog（**build-static 生成物**），v3→v4 迁移包是 JSONL provider 自己的依赖 ⇒ **内核升格式后，旧版本读不了新格式** | `dsh-session`、`-session-format-catalog` |
| **C40** | 审批**无超时**：waterfall 只与 `request.signal` 赛跑，**只有 abort 才 cancelled**；`ApprovalOutcome` 取值集里**没有"超时"** | `-user-approval` |
| **C41** | `dsh-session-persistence-jsonl` 提供方**无具名导出**（`export default`），消费方耦合 `ctx.sessionPersistence`；发行版**不包含**契约测试套件 | `-session-persistence(-jsonl)` |
| **C42** | MCP 一次 outage 共享重连预算（默认 500ms→30s×N，`maxAttempts 10`）⇒ **约 151.5s 后永久注销该服务器全部工具**，"disposal（含 HMR）是唯一回来方式" | `-mcp-client` |
| **C43** | `dsh-session-checkpoint-policy`：顶层工具调用在工具体之前检查点；**嵌套派发复用外层持久调用** ⇒ 内层副作用无法逐个定位 | `-session-checkpoint-policy` |
| **C44** | 沙箱只限制**写与删**；**读、网络、进程可见性不受限**——"被限制的子进程可以读任何调用方可读的文件，**包括另一个工作区里的文件**" | `-sandbox-windows-acl` |
| **C45** | `<DSH_HOME>` 下有旁路数据：`attachments`（按内容去重、**从不自动删除**、无删除 API）、`spill`（默认 OS temp、`cleanupPeriodDays 30`、**清理只在启动扫描一次**、无检索/删除 API）、`session-query-sqlite` 的 **FTS 派生行跨重启保留** | `-attachment-local`、`-spill-local`、`-session-query-sqlite` |
| **C46** | 子进程环境清洗是**名称启发式** `/KEY\|PASSWORD\|SECRET\|TOKEN/i`——名字不含这些词的秘密（如带密码的 `DATABASE_URL`）**原样进入子进程** | `dsh-subprocess` |
| **C47** | `dsh-tool-web`：**公网抓取不请求审批**，shipped preset 在**每种沙箱与审批模式下**都暴露 `web_fetch` ⇒ "模型可以把数据发到公网 URL" | `-tool-web` |
| **C48** | 委派子代理时审批策略被**钉死为 `never`**，只继承父会话的显式沙箱 override；子代理工具集只由**部署侧** `toolFilter` 限制 | `-subagent`、`-tool-subagent` |
| **C49** | `ctx.tools.register(definition)` 是**唯一注册入口**，全文**无 pre-register 钩子**；可用手段只有运行期的 `restrict(filter)` 与 `guard()` | `dsh-tools` |
| **C50** | `writeScopes` **不是内核概念**，只存在于实验包 `dsh-experimental-agent-team`（且其语义是"规范化后的 workspace 相对前缀；视图只对重叠发警告，**绝不阻止 claim 或授予写权限**"） | `dsh-experimental-agent-team` |
| **C51** | `ctx.tools.restrict(filter)` **要求 scoped 上下文**——在**全局上下文调用直接抛错**（"a context-global restriction would mask every agent"）；且它**只过滤全局工具名、不影响 scoped 注册**（"scoped registrations remain visible"）。反之 `ctx.tools.guard(fn)` **可在全局上下文注册并对全部 agent 生效**，且**单调只否**（"no guard can force-allow a call another guard denied"） | `dsh-tools` |

### 2.3 设计基线（不可协商的设计选择）

| ID | 基线 |
|---|---|
| D1 | 承认 harness 是有状态的。会话、workspace、插件状态均为真实且不可随意搬迁的实体 |
| D2 | DSH 内核进程是**不可信执行域**。凭证、身份、配额、审计、状态全部位于其外 |
| D3 | 内核接线采用 **cordis DI 插槽**，不采用进程外协议 |
| D4 | 弹性通过**可丢弃、可重启的隔离域 + 外置事件日志**实现，不通过无状态化 Worker |
| D5 | **安全边界是租户，不是 workspace。** 隔离域 = `(租户, 隔离组)`；默认一租户一域；**跨租户永不共享** |
| D6 | 治理集中（分发、裁决、记账），执行分散（域内本地） |
| D7 | 产品核心只依赖非 experimental 的 seam |
| D8 | MCP 与 Skill **不是插件**，分属不同类别、独立治理 |
| D9 | **一切强制力必须在域外**：域内只有执行，没有裁决 |
| D10 | **强制只靠"能力不可达"。** 运行期裁决只用于**审批与提示**，不作为强制手段；需要运行期拦截时机制是**中断当前轮次** |
| D11 | **凭证统一规则**：默认**任何凭证不得进入域内**。例外唯一（§4.8.2），须登记、降级信任、进入合规报表 |
| D12 | **可用性分级**：硬 / 软 / 缓存三级（§2.4）。硬不可用则拒绝执行；软不可用则**继续执行并事后对账**；缓存不可用则用陈旧值继续 |
| D13 | **设计与评审纪律**（见文首纪律块） |
| D14 | **产品侧 workspace 的注册表与授权同源**：域外自建并作唯一真源；不使用内核 `ctx.workspaceRegistry` |
| **D15** | **信任模型（一次性表态）**：TCB = **域镜像 + 只读 Profile + 域外全部组件**。D2 的"不可信"**只适用于模型生成的动作与数据，以及运行期被改写的组合**。因此：`/internal/kernel/attest` 的自报指纹、域内漂移上报，一律定性为 **detective（可发现配置漂移），不防篡改，不计入硬控制**。**凡"域内自证"的设计不得出现在硬强制链中** |
| **D16** | **强制点必须落在拦截上。** 任何声明式白名单（"域内只注册 X"）**不构成强制**。凡需硬保证的能力，必须在**唯一入口处拦截**（`ctx.tools.register`）、在**挂载前移除**（不插入插件行）、或**使其不可达**（预设表收敛）。§5.3.1 的强制链必须逐项指明**拦截点**，无拦截点者降级为 detective 或删除 |

### 2.4 强制等级

**每条约束必须归入且只归入一级。** v2.6 新增**第二维判定**：是否消耗共享资源。

| 等级 | 覆盖内容 | 实现机制 | 依赖不可用时 |
|---|---|---|---|
| **硬** | 工具可达性、凭证、沙箱模式上限、租户边界、**审计最小集**、**共享资源配额** | 挂载前移除 / 入口拦截 / 域外决定 | **fail-closed**：拒绝该动作 |
| **软** | 用量计量、一般审计、计费 | 域内**本地缓冲** + 域外异步消费；按 `turnId` 幂等 | **继续执行**；缓冲或**有界丢弃**（§9.4 L1b），**绝不阻断执行** |
| **缓存** | 工具清单、模型目录、场景定义、connector 清单 | 带 TTL 的最优已知清单 | **用缓存继续** |

**二维判定规则（新增）**

| 问题 | 若"是" | 若"否" |
|---|---|---|
| 该约束**影响其他租户的可用性**（消耗共享资源）？ | **硬**（域槽位、CPU、内存、模型并发） | 看下一问 |
| 该约束**需要作为证据**（合规/取证）？ | **硬**（最小审计集） | 看下一问 |
| 该约束**可事后计量并结算**？ | **软** | **硬** |

**反模式**：不得把软依赖实现为硬依赖（无谓降低可用性）；不得把硬依赖实现为软依赖（安全缺口）；**不得让软依赖的缓冲上限变成执行阻断器**（v2.5 的错误，见 §9.4 L1b）。

**fail-closed 最小审计集（新增）**：以下事件**记不下就拒绝该动作**——凭证签发、出站授权、沙箱模式/preset 变更、审批决策、**白名单外注册尝试**、attest 失败。其余审计可缓冲。

---

## 3. 总体架构

### 3.1 架构图

```
┌──────────────── 控制面（无状态，多副本）────────────────┐
│  身份 / 多租户 / RBAC      配额与计费（软）              │
│  审计落库（软，另有最小集为硬）  成本归因                 │
│  Plugin Registry   Connector Registry                    │
│  Skill Catalog     Scenario Catalog                      │
│  Profile 生成器（域外：产出工具清单 + 完整性校验）          │
│  Session Router（就绪探针 / 迁移 / 自建会话索引）            │
│  OpenAPI 网关（契约 + SDK + 版本协商）                     │
│  Connector 控制器（重载 / 重建 / 健康）                     │
└───┬─────────────────────────────────────────────────▲────┘
    │ ① Runtime Profile（域外生成校验）                    │ ② 反向：内核 I/O
    ▼                                                   │
┌──────────────── 隔离域池（TCB）────────────────────────┐
│  一域 = 一 (租户, 隔离组)；容器 / microVM                │
│  ┌────────────────────────────────────────────────┐  │
│  │  DSH 内核（仅 host 侧插件）                       │  │
│  │   ★ 工具注册桥：唯一入口拦截（D16）                │  │
│  │   ✱ 无 plugin-manager / 无 hmr / 单一预设         │  │
│  │   ✱ 无凭证；profile 只读挂载                      │  │
│  └────────────────────────────────────────────────┘  │
│  域内分区：workspace A / B / … 各自可写根（读不隔离）    │
│  会话日志 · workspace 卷                              │
└───┬─────────────────────────────────────────────────▲────┘
    │ ③ 产品壳（多场景 / 多版本 / 独立部署）              │
    ▼                                                   │
┌──────────────── 数据面（有状态）────────────────────────┐
│  凭证代理（域身份查表）· MCP 出站代理（含 stdio 宿主）     │
└────────────────────────────────────────────────────────┘
┌──────────────── 持久层 ────────────────────────────────┐
│  对象存储 · 卷 · 元数据库（会话索引）· 密钥库 · 审计 WORM  │
└────────────────────────────────────────────────────────┘
```

### 3.2 组件职责

| 组件 | 职责 | 边界 |
|---|---|---|
| **OpenAPI 网关** | 对外契约、鉴权前置、SDK 生成、版本协商 | 不承载业务状态 |
| **Session Router** | 按 `(租户, 隔离组)` 路由；就绪探针；**迁移状态机**；自建会话索引 | 不做轮内迁移 |
| **身份与多租户** | 租户 / 用户 / 角色；令牌签发与校验；**域令牌绑定租户** | 不下发凭证 |
| **配额与计费（软）** | 令牌与工具配额；用量归集与归因；以**日志 + 上传确认水位**对账 | 不在热路径阻塞执行 |
| **Plugin Registry** | Cordis 插件制品、版本、标签、签名、回滚 | 不参与运行时 |
| **Connector Registry** | MCP 目录、传输、归属、凭证引用、信任级、健康 | 不参与工具裁决 |
| **Connector 控制器** | connector 重载/重建；**重连预算耗尽后的自动恢复** | 数据面 |
| **Profile 生成器** | 域外生成 Profile：**产出工具清单**、校验层级与完整性、只读挂载内容 | **唯一强制力产生点** |
| **反向网关** | 承接 llm / approval / skills / **降级级别下发**；不承担"拒绝工具"职责 | 不改语义 |
| **模型 / 工具凭证代理** | **以调用方已认证的域身份查表取凭证**，绝不解析请求体中的凭证名 | 数据面 |
| **MCP 出站代理** | 协议感知代理；有凭证的 connector 一律在此托管（含 stdio） | 数据面，有状态 |
| **工具注册桥（域内）** | **唯一工具注册入口的拦截点**（D16） | 域内唯一被信任的强制点 |
| **副作用台账服务** | 记录非幂等调用的"可能已发生"清单（§7.4.1） | 域外 |
| **历史查询服务** | 会话历史与 trajectory；**须自行施加调用方授权** | 不得暴露 `ctx.sessionQuery` 的无授权语义 |
| **保留与删除服务** | 全清单生命周期、DSR、**删除证明** | 带外实现 |
| **隔离域** | 承载会话的运行时；域内本地执行 | TCB 的一部分；不自行裁决 |

### 3.3 部署拓扑

| 平面 | 部署单元 | 伸缩 | 状态 |
|---|---|---|---|
| 控制面 | 无状态服务 | 副本数 | 无本地状态 |
| 数据面 | **有状态** | 副本数 + **会话亲和** | 上游连接、MCP 会话、stdio 子进程 |
| 隔离域池 | 容器 / microVM | 池容量（三态） | 域内本地：会话日志 + workspace |
| 持久层 | 对象存储 / 卷 / 元数据库 / 密钥库 / WORM 审计 | 托管 | 长期 |

---

## 4. 运行时设计

### 4.1 隔离域

**定义**：一个隔离域承载一个 **`(tenantId, isolationGroupId)`**。

| 属性 | 规定 |
|---|---|
| 归属 | 唯一属于一个 `(tenantId, isolationGroupId)` |
| **跨租户** | **永不共享**（D5） |
| **域内分区** | 按 workspace 分区，各占独立可写根与独立卷。**域内 workspace 之间不构成安全边界**；且**读不隔离**（C44）——见 §7.3.5 |
| 网络 | 默认拒绝入站；出站白名单由**容器网络策略 / 服务网格**承担。**域内不挂载公网访问工具**，或按 §8.8 登记为已披露外泄通道 |
| 文件 | 仅挂载本域各 workspace 卷与容器临时层 |
| profile 挂载 | `cordis.patch.yml`、`package.json`、`compatibility.json`、**plugin 制品目录**均**只读** |
| **插件行移除** | **必须移除 `tool-plugin-manager` 与 `plugin-manager` 两行**（C36），**并关闭 `hmr`**。只禁工具行不足 |
| **权限预设** | Profile 只定义**单一预设**，使 `danger-full-access` 与 `never` **不可达**（C38、§4.6） |
| 用户身份 | 容器内独立用户；**例外 connector 子进程用独立 uid/命名空间**（§4.8.2） |
| 生命周期 | 创建 → 就绪 → 活跃 → 空闲 → 温/零态 → 回收 |
| **就绪判据** | 见 §4.1.2：**存在任一被 `disabled` 的关键平台行 → 域不得进入 ready**（C34） |

#### 4.1.1 域粒度决策

| 方案 | 安全 | 成本 | 结论 |
|---|---|---|---|
| 一 workspace 一域 | 过度隔离 | 高 | ❌ |
| 一租户多域（按隔离组） | 满足 | 中 | ✅ 大租户 / 需 need-to-know 的客户 |
| **一租户一域** | 满足 | 低 | ✅ **默认** |

**约束**：同一域内所有 workspace 的插件集是**并集**，工具面因此相同。**有 per-workspace 裁剪需求者走独立隔离组**（成本由 §10.4 覆盖）。
**隔离组可选粒度**：`(租户)` 默认 / `(租户, 团队)` / `(租户, 用户)`——**需要 need-to-know 的客户必须选后两档**（因为域内读不隔离）。

#### 4.1.2 域就绪判据（替代"静默降级"）

> **v2.6 收口修正（重要）**：本节初稿把判据 3–6 表述为"域内自检结果"。这与 **D15**（域内自报一律为 detective、不防篡改）**自相矛盾**——用自报当门禁等于**自证**，一个被改写的域可以自报全绿。
>
> **修正原则：门禁只接受域外事实。** 域内上报一律降为**交叉核验**；不一致时调查并摘域，但**不作为通过的依据**。

| # | 判据 | 证据来源 | 性质 | 失败处置 |
|---|---|---|---|---|
| 1 | 域镜像摘要 == Profile 声明的镜像摘要 | **域外**（平台自己选择的镜像） | preventive | 拒绝 ready |
| 2 | 只读挂载的 profile 与插件制品内容摘要 == 域外生成时的摘要 | **域外**（平台自己挂载的内容） | preventive | 拒绝 ready |
| 3 | 容器运行时配置：无额外挂载、无特权、profile 与制品路径不可写 | **域外**（运行时声明，非域内自述） | preventive | 拒绝 ready |
| 4 | 下发的 Profile 已过域外校验（层级、完整性、单一预设、无 plugin-manager/hmr 行、`toolAllowlist` 非空） | **域外**（Profile 生成器） | preventive | 拒绝 ready |
| 5 | 无被 `disabled` 的关键平台行（C34） | **域外推定**（列车单值 + 镜像内容已知）**＋** 域内上报交叉核验 | preventive（域外）| 拒绝 ready；域内上报不一致 → 摘域 |
| 6 | 工具注册桥已装载且工具集 == `toolAllowlist` | **域外**（桥的装配由 Profile 决定）**＋** 域内上报指纹交叉核验 | preventive（域外）| 拒绝 ready；域内上报不一致 → 摘域 |
| 7 | 必需 connector 就绪 | **域外**（Session Router 探针） | preventive | 不进入 `active` |

**由本判据产生的 P0 交付物（新增）**：平台**必须**能产出并留存上述域外事实——镜像摘要、挂载内容摘要、运行时配置快照、Profile 生成摘要，且**每次域创建时留证**。否则本判据**无法执行**，门禁为空。

> **判据 5 是对 v2.5 的关键修正**：v2.5 默认"域能起来就行"，而 C34 的失败模式是**插件被静默禁用、域照常启动**——适配器失效会导致**凭证回流、G1 静默破防而所有健康检查为绿**。

### 4.2 内核接线

**最小反转集（硬上限 4）**

| 类别 | seam | 处置 |
|---|---|---|
| **必须反转** | `ctx.llm` | 域内适配器 → 反向网关 → 凭证代理 |
| **必须反转** | `ctx.tools` | **工具注册桥（入口拦截，D16）** |
| **必须反转** | `ctx.approval` | 域内终端应答者 → 域外审批 UI |
| **必须替换实现** | `dsh-session-persistence` | 域外提供方（带 fencing，§5.4） |
| **保持原生** | `ctx.sandbox`、`dsh-mcp-client`、`ctx.skills` | 原样装配（MCP 见 §4.8） |

**插槽契约**

| 插槽 / 插件 | 契约 | 实现方 |
|---|---|---|
| `ctx.llm` | `registerAdapter(providers, adapter)`；`LlmAdapter` 实现 `stream` 及 `providerInfo` / `providerRetryPolicy` / `imageRequestPricing` / `listModels` / `resolveModel` / `prepareCall`。**注意**：只有 `stream` 是 `abstract`，其余有默认实现——但 `GET /v1/llm/providers` 依赖 `listModels`/`resolveModel`，故**二者必须实现**。`attributionHeaders()` 是**模块级函数**，适配器须在 wire 请求中带上它 | 域内适配器 → 反向网关 |
| `ctx.tools` | **唯一入口拦截**（见 §4.5.1）。`pre-execute` 不可改写参数（C27） | **域内工具注册桥** |
| `ctx.approval` | waterfall 应答者；载荷不含参数与 session（C9） | 域内终端应答者 → 域外 UI |
| `ctx.invariants` | `register(packageName, install)`；**需显式挂载**（C25） | 显式挂载 |
| `dsh-tool-call-timeout-policy` | **已在 `dsh-base` 默认挂载**（C29 修正）。语义是**协作式**，依赖工具遵守 `exec.signal`（C28） | **无需显式挂载**；改为就绪**断言存在** |
| `dsh-session-checkpoint-policy` | 检查点策略（C21） | `dsh-base` 默认挂载 |
| `dsh-permission-presets` | **收敛为单一预设**（C38），见 §4.6 | 显式覆盖 base 配置 |

**接线规则**

1. 插槽绑定在域启动时完成，随 Profile 决定
2. 域内**不注入**凭证（D11）；适配器只持有反向网关的**短期会话租约**（§4.2.1）
3. 硬依赖不可用时**拒绝执行**（§9.4 L3）
4. disposer 由域生命周期管理
5. **不挂载任何 credential provider**（§8.2.1）

#### 4.2.1 域→域外身份与租约（新增，修正 v2.5 缺口）

> v2.5 只要求"mTLS + 短时令牌"，**未规定令牌绑定租户**，也未规定域外必须校验"请求声称的租户 == 令牌里的租户"。这使一个失陷或配置错误的域可**冒充其他租户**调用模型/工具/凭证代理——**这条路绕开全部外层容器隔离**。

| 要求 | 规定 |
|---|---|
| 令牌绑定 | 域令牌必须绑定 **`(tenantId, isolationGroupId)`**，签发时固化 |
| 校验 | 域外**必须**校验"请求中的租户 == 令牌中的租户"，不一致即拒绝并硬审计 |
| 租约粒度 | 域→域外的凭证访问用**会话级租约**（TTL ≤ 5 分钟），**不是 per-request**。（SRE 角色指出 per-step 往返会吃光轮次错误预算） |
| 刷新 | 按 `TTL/3` 刷新 + **每域随机抖动**；定义"网关故障恢复爬坡"（续期令牌桶 + 准入限流 + 排队） |
| 时钟 | 定义域内时钟偏差上界（TTL 与审计时延均依赖） |
| 轮换 | 双证书重叠期 + 轮换演练属 **P0/P1 级风险**（一次误轮换 = 全平台不可用） |

**host / client 插件分离**：产品壳取代 DSH Web UI，只装配 host 侧插件。

### 4.3 会话状态机

```
创建 → creating ──(域就绪判据全通过 + preset 可解析)──► active ⇄ idle
                                                          │
                                         归档策略 ──► archived ──(保留期/删除)──► destroyed
```

**迁移**：仅 `active`/`idle` → 另一域 `active`，必须在轮次边界，遵循 §5.4。
**恢复**：§7.4。**恢复不是回滚**——中断轮次保留在历史中，由合成 closer 收尾。

### 4.4 轮次执行流程与截止时间

```
产品壳 ──POST /turns──► 网关 ─► Session Router ─► 隔离域
  ① 模型调用  → 反向网关 → 凭证代理 → 模型网关   [硬]  预算 T_m
  ② 工具执行  → 域内本地（挂载期已获准）          [硬]
     审批判定 → 反向网关 → 域外审批 UI            [硬]  预算 T_a
  ③ 用量/审计 → 本地缓冲 → 域外异步消费           [软]
  ④ 事件流    → 网关 → SSE → 产品壳
  ⑤ 提交      → flush 屏障
  总预算 T_turn
```

#### 4.4.1 三层截止时间（新增，修正 v2.5 缺口）

> v2.5 没有任何轮次级截止时间。后果：**一个挂死轮次永久占用会话唯一的开放轮次 + 写句柄 + `session.lock`**，并锁死迁移与跨实例恢复（C23 的锁无过期）。

| 预算 | 建议值 | 超时行为 | 依据 |
|---|---|---|---|
| **`T_a` 审批应答** | 60–120 s | 收敛为 `rejected`/`cancelled`（**不是无限等**） | C40：内核**无审批超时**，blackhole 连接必须靠超时 |
| **`T_m` 单次模型流** | 含重试总预算 | fail-closed 中断本轮 | 重试由**可选**插件 `dsh-llm-retry` 执行，须显式声明挂载与预算 |
| **`T_turn` 轮次总预算** | ≤ 15 min | `turn/cancel` 并记录原因 | §4.7 同会话至多一个开放轮次 |

**同时修正 v2.5 的过度声明**：`dsh-tool-call-timeout-policy` 是**协作式**（C28），**不中止**不遵守 `exec.signal` 的工具。文档一律不得再称其"强制"。对不遵守 `signal` 的工具建立**准入审查**。

**新增指标**：挂死轮次（无进展 > `T_turn`）计数、审批等待时长分布。

### 4.5 工具执行与审批

| 阶段 | 时机 | 执行方 | 等级 | 内容 |
|---|---|---|---|---|
| **0 工具集生成 + 注册拦截** | **挂载期** | **域外生成 / 域内桥拦截** | **硬** | 见 §4.5.1 |
| 1 解析 | 运行期 | 域内内核 | — | 工具名与参数到 schema |
| 2 审批判定 | 运行期 | 域外 | 硬（附加闸门） | 该次调用是否需要人工审批 |
| 3 执行 | 运行期 | 域内本地 | — | 沙箱内执行；**执行前写副作用台账**（§7.4.1） |
| 4 记录 | 运行期 | 双向 | 软 | 域内记结果；域外异步落审计 |

#### 4.5.1 工具强制的实现（v2.6 重写）

> **D16**：强制 = **在唯一入口拦截**。声明式白名单不构成强制。

**拦截点**

| # | 拦截点 | 位置 | 作用 |
|---|---|---|---|
| 1 | **工具注册桥** | 域内 `ctx.tools.register` 的**唯一入口**（C49） | 非 `toolAllowlist` 内一律**不注册** + 硬审计 + 告警 |
| 2 | **MCP 发现闸门** | 桥内，同一入口 | MCP `listChanged` 自动重同步（C35）**同路受管**：新工具在域外重新授权前**不进入可见集** |
| 3 | **插件行移除** | Profile 挂载前 | 不插入 `tool-plugin-manager` / `plugin-manager`；关闭 `hmr`（C36） |
| 4 | **预设收敛** | Profile | 单一预设，`danger-full-access` / `never` 不可达（C38） |
| 5 | **升权上限** | Profile + 域外审批 | 见下 |
| 6 | **纵深防御：全局 `guard()`** | 宿主上下文一次性安装 | 对 `toolName ∉ toolAllowlist` 返回拒绝理由。**按最终解析出的工具名在派发期判定**，故**覆盖 scoped 注册**（见 `S14` 说明） |
| ~~弃用~~ | ~~`ctx.tools.restrict({allow})`~~ | — | **不作防线**：全局上下文调用**直接抛错**，且**不覆盖 scoped 注册**（C51） |

**关于 `restrict()` 与 `guard()` 的作用域语义（已定论，见 `docs/bridge-defense-in-depth.md`）**

| seam | 全局上下文可用 | 覆盖 scoped 注册 | 判定时机 | 结论 |
|---|---|---|---|---|
| `restrict(filter)` | ❌ **抛错** | ❌ 不覆盖 | 可见性（注册/继承期） | **不可用于本方案** |
| `guard(fn)` | ✅ **可**（"plain-context guard applies globally"） | ✅ 覆盖 | **派发期**（对最终工具名） | **纵深防御的正确机制** |

| 规定 | 内容 |
|---|---|
| 主防线 | 桥在 `register()` 入口拦截（**可见性**：不在清单内即不注册） |
| 纵深防线 | 桥在宿主上下文安装**全局 `guard()`**（**执行期**：不在清单内即拒绝） |
| 二者的关系 | 主防线依赖"桥被全部注册路径使用"；**纵深防线不依赖该假设**——它按最终工具名判定。故纵深防线可独立成立 |
| **不得** | 在全局上下文调用 `restrict()`（会抛错，域启动失败）；也不得把 `restrict()` 当作覆盖 scoped 注册的手段 |
| 残余 | `guard()` 属**运行期拦截**，不满足 D10 的"能力不可达"（工具仍可见、模型会尝试调用并收到拒绝）⇒ **可见性必须由主防线解决，guard 只兜覆盖面缺口** |

**升权（escalation）处置（新增）**

内核对工具族广告 `sandbox_permissions` + `justification`，模型可对**单次调用**请求更宽模式（C38）。v2.5 未处置。规定：

| 项 | 规定 |
|---|---|
| 租户级上限 | Profile 定义 `sandboxModeCeiling`；**请求超过上限即拒绝**（域外判定，不依赖域内） |
| 审批可见 | 域外审批方**必须解析** `sandbox_permissions`；**解析不到即 fail-closed**（不因 C9 载荷无参数而盲批） |
| 默认上限 | `read-only`（部署默认，§4.6） |
| 审计 | `sandbox_permissions` 请求与批准进**最小审计集** |

**语义收窄（延续 v2.3）**

| 原表述 | 修正后 |
|---|---|
| `toolPolicy.deny` | **不存在运行期 deny**。`deny` = 不进 `toolAllowlist` |
| `toolPolicy.allow` | 即 `toolAllowlist` 的来源 |
| `toolPolicy.requireApproval` | 保留；域外审批判定 |
| `writeScopes` | **不是内核概念**（C50），删除该字段。要限制写入必须拆隔离组或用独立域 |
| 运行期发现参数越界 | **中断当前轮次**并记录（D10）。**但**：参数 schema 校验（`validateArgs`）本就是第一道边界，能表达的都应由 **schema** 表达——**schema 的 `deny` 是 UX/正确性手段，不承担安全语义**；安全语义只允许"工具不可达 + 凭证不下发 + 模式不超上限 + 租户边界"四条 |

**审批参数通道（新增，修正三方命中的缺口）**

v2.5 要求"域外须生成审批上下文"，但**没有任何通道**把参数送到域外（C9 载荷无参数且无 sessionId）。三个视角独立命中此洞。

| 项 | 规定 |
|---|---|
| 通道 | 域内桥在**审批判定前**上报 `(tenantId, isolationGroupId, workspaceId, sessionId, turnId, callId, toolName, argsDigest, argsPreview, redacted)` |
| 脱敏 | 键级脱敏规则 + 体积上限（防止把大文件塞进审批流） |
| 定序 | `tool.call` 事件**必须先于**同 `callId` 的 `approval.requested` 投递 |
| 回补 | `GET /v1/sessions/{id}/turns/{tid}/calls/{callId}` 供重连后回补 |
| 兜底 | **参数无法送达域外的工具，禁止进入 `requireApproval` 集合，且不予注册**（D10 一致：无法强制的闸门不应假装存在） |

**审批状态机**

```
pending ──► decided{allowed-once | rejected | cancelled | unavailable | timeout} ──► consumed
```

| 规则 | 规定 |
|---|---|
| 有效期 | 一次批准仅作用该次调用；**无 allow-always / 规则存储 / 撤销**（C8） |
| **禁止** | 域外自建"记住此工具"的 allow-always 缓存——等于发明内核不承认的授权语义，审计口径分裂 |
| 参数可见性 | 见上"审批参数通道" |
| 缺应答者 / 超时 | `unavailable` / `timeout`，fail-closed |
| 轮次约束 | 必须在未结束轮次内发起（C1） |
| 全局收件箱 | 审批按**用户维度**聚合（非按会话），并定义 `T_a` 超时 |
| 风险分档 | **保守档**：写/外发类进 `requireApproval`，逐次审批。**敏捷档**：`requireApproval` 为空 + 沙箱锁 `read-only` + 只注册零副作用工具，**用发轮次前的一次前置确认**换取免逐次弹窗。**禁止第三档**（自研 allow-always） |

### 4.6 沙箱策略

| 模式 | 语义 |
|---|---|
| `read-only` | 拒绝写入（必需 sink 除外） |
| `workspace-write` | 允许写工作区根与私有临时区 |
| `danger-full-access` | 绕过隔离，直接 spawn 原始 argv |

**模式面闭环（新增，修正 C37/C38）**

v2.5 有**三条平行控制面、零处闭环**：会话 `sandbox/mode` 事件（域内可写）、`DSH_PERMISSION_MODE` 环境变量、以及 `permission-presets` 的可选目录（含 `danger-full-access`）。

| 规定 | 内容 |
|---|---|
| 唯一真源 | Profile 的 `sandboxMode` + `sandboxModeCeiling`，**域外签发** |
| 预设表 | **收敛为单一预设**（`read-only` + `ask`），使更宽模式与 `never` **不可达** |
| 环境变量 | **禁止**将 `DSH_PERMISSION_MODE` 设为 `danger-full-access`；目标架构下恒为 `read-only` |
| 域内写路径 | **禁用会话级模式提升**（C37 的 `setSandboxMode` 写路径不得由域内触发）；显式 mode 只允许来自域外审批返回 |
| Remote 暴露 | **不向产品壳暴露 `permissionPresets` Remote**，或外包一层域外授权 |
| 漂移检测 | 把 `sandbox/mode`、`permission/preset`、`approval/policy` 变更纳入就绪判据与运行期漂移（**变化即摘域**，因它们同时打开多把锁） |
| 审计 | 上述变更进**最小审计集**（硬） |

**优先级**：域外签发的显式模式 > 会话最后一条 `sandbox/mode` 事件 > 部署默认值（**仅当域内写路径已禁用时该序才安全**）。

**部署默认**：本方案取 **`read-only`**，Profile 显式下发。
**域内分区与可写根**：只有一个可写根（C27）；不同 workspace 必须对应不同会话的不同 cwd。
**执行报告** `enforcement: full | partial`；Windows 为 `partial`（§8.4）。
**等级**：**硬（限文件写效果类；对域内对抗者不成立；Windows 为 partial）**——见 §8.1。

### 4.7 并发与幂等

| 场景 | 规定 |
|---|---|
| 同会话并发 turn | 拒绝（409）；**并定义前端行为**（排队 / "取消并发送"），不直接把错误码抛给用户 |
| 跨实例并发写同一会话 | 提供方实例内写所有权 + 跨进程锁（§5.4） |
| turn 幂等 | 客户端可选幂等键；同键返回同一 `turnId` |
| 用量扣减幂等 | 按 `(tenantId, turnId)` 去重（§7.6） |
| 事件投递 | 单一 SSE 通道按序投递；`Last-Event-ID` 续传 |
| 迁移并发 | 迁移期间域内拒绝新 turn |
| 域故障 | 在途轮次标记中断；恢复按 §7.4 |

### 4.8 MCP 接入

**位置**：`dsh-mcp-client` 在隔离域内挂载，一实例一服务器，**受工具注册桥管治**。

#### 4.8.1 凭证规则（D11）

> **规则：任何凭证不得进入域内。** 需要凭证的 connector **一律在数据面托管**；域内只保留无凭证的薄桥或无桥。

| connector 类型 | 凭证 | 需域内工作区访问 | 归属 | 域内凭证 |
|---|---|---|---|---|
| 内部工具（无鉴权） | 无 | 是 | **域内** | 无 ✅ |
| HTTP 服务 | 有 | 否 | **数据面** | 无 ✅ |
| stdio 服务 | 有 | 否 | **数据面**（代理托管 stdio 子进程） | 无 ✅ |
| stdio 服务 | 有 | **是** | **例外**（§4.8.2） | 有 ⚠️ |

**另有未清点的凭证通道（新增）**

| 通道 | 问题 | 规定 |
|---|---|---|
| 子进程环境清洗 | **名称启发式**（C46）——`DATABASE_URL`、`GOOGLE_APPLICATION_CREDENTIALS`、`*_DSN` 等**不被清洗** | 域容器环境**用白名单构造**，不依赖内核启发式；把它记为"已知启发式、非控制" |
| credential provider 插件 | 域内可挂载并从 `ctx.credentials` 或进程环境取 key | Profile 维护**拒绝清单**（`dsh-credentials(-local)`、`dsh-llm-*-api-key`、`dsh-deepseek-account*`、`dsh-web-search-deepseek`）；就绪判据断言其不存在 |
| 公网工具 | `web_fetch` **不请求审批**且在所有预设下可见（C47） | **域内不挂载公网访问工具**；改由域外代理施加策略、DLP、硬审计与配额。若保留，按 §8.8 登记为已披露外泄通道 |

#### 4.8.2 登记的例外（唯一）

**条件**：持有凭证，且必须读写域内工作区文件。

| 要求 | 内容 |
|---|---|
| 显式登记 | `credentialException: true`，列入合规清单 |
| 凭证形态 | **单次使用、绑定 `(tenantId, isolationGroupId, sessionId, turnId, callId, connectorName)`**，TTL ≤ 5 分钟，**audience 限定为数据面代理**（令牌对上游无效） |
| **进程隔离** | 例外子进程放进**独立 uid / 命名空间 / AppContainer**，使域内其他进程**读不到其环境**（修正 v2.5：同 uid 下 `/proc/<pid>/environ` 可读，令牌实际持有者是"域内任何代码"） |
| **禁止自续签** | 明文禁止域内自触发续签；改为**按轮次预签发 + 硬上限 + 超限告警** |
| 信任降级 | 自动 `trust: untrusted` |
| 审计 | 每次签发进**最小审计集**；报表单列占比 |
| 准入 | 须安全评审；按域设**硬条数上限**，超限即拒 |

#### 4.8.3 数据面 MCP 代理的协议要求

| 要求 | 内容 |
|---|---|
| 传输 | 完整透传 Streamable HTTP：`Accept: application/json, text/event-stream`；POST / GET(SSE) / DELETE |
| 会话 | 透传并保持 `Mcp-Session-Id`；同一 session 上游**连接亲和** |
| stdio 托管 | stdio 帧转换为等价流；保持双向顺序与背压 |
| 缓冲 | 不得缓冲长连接 |
| 超时 | **区分**"建连/发现 60 s"（C13）与"单次调用 `toolCallTimeoutMs`"；代理超时设为**略大于后者**，而非 60 s 的倍数 |
| 体量 | 请求体上限；连接池与并发上限 |
| 凭证 | 绑定 `(tenantId, connectorName)`，按请求注入，不落域 |
| 观测 | 协议版本、协商结果、SSE 建连/断开、上游错误分类 |
| 状态 | **有状态**，部署于数据面 |

**挂载与容错**

| 项 | 规定 |
|---|---|
| 启动阻塞 | `apply` 会等待初始连接与发现（C16）。若需非阻塞，须由域内包装插件在 boot 后动态挂载——计入 P0 |
| 必需 connector | **不由 `failOnStartupError` 表达**（C15）；由 Session Router 就绪探针判定 |
| 单 connector 失败 | 该 connector 工具不可用；域继续 |
| **重连预算耗尽** | 约 151.5 s 后**永久注销**该服务器全部工具（C42）。**必须由 Connector 控制器自动重载/重建**，并补 SLO"重连耗尽 → 自动重载完成 P95 ≤ 60 s" |
| **与漂移检测解耦（新增）** | 见下 |

**漂移检测的两类事件（新增，修正 v2.5 的连锁故障）**

v2.5 把"域上报工具集指纹 ≠ Profile"一律判为漂移并**摘除整域**——而 MCP 重连耗尽导致工具注销是**内核预期行为**（C42）。若不区分，一次 MCP 抖动就要摘掉整个租户；若开白名单，攻击者只需伪装 MCP 掉线即可绕过。

| 事件类别 | 判定 | 处置 |
|---|---|---|
| **connector 生命周期变化**（预期） | 来源可证：Connector Registry / 控制器上报 | **不摘域**：该 connector 工具不可用 + 告警 + 自动重载 |
| **Profile 未授权的插件/工具出现**（异常） | 域内出现清单外注册尝试 | **摘域**，且**摘域动作单独审批**（一次杀掉该租户全部会话） |

**注入面**：见 §8.6（四通道）。

---

## 5. 控制面设计

### 5.1 身份与多租户

| 层 | 机制 |
|---|---|
| 传输 | TLS 终止于网关 |
| 身份 | JWT（OIDC，对接企业 IdP）；**SAML/SCIM 生命周期为 P1 交付物** |
| 授权 | RBAC：按租户 / 角色控制场景、插件、工具、MCP、沙箱模式上限 |
| 租户绑定 | 用户令牌绑定 `tenantId` 与允许的 workspaceId 集合 |
| **域访问** | 域令牌**绑定 `(tenantId, isolationGroupId)`**；域外校验"请求租户 == 令牌租户"（§4.2.1） |

**隔离维度**：`tenantId`（**安全边界**）→ `isolationGroupId` → `workspaceId`（分区）。

**SKU 级隔离承诺（新增）**

> **同一 `tenantId` 内部假定互信。** 任何需要隔离的边界（部门、子公司、外部协作者、**个人用户**）**必须建模为独立 `tenantId` 或至少独立隔离组**。

| 形态 | 安全租户 | 隔离组粒度 | 说明 |
|---|---|---|---|
| 企业版 | 每客户一个 | 默认租户级；need-to-know 客户用团队/用户级 | 容器级隔离 |
| 团队版 | 每团队一个 | 租户级 | 容器级隔离 |
| 个人版 | **每人一个租户**（推荐） | — | 成本靠温/零态压（§10.4） |
| 共享域档（可选立项） | 一个平台池租户 | 用户级 | **禁止一切带凭证能力、强制 `read-only`、禁止跨 workspace 共享挂载、合同如实披露"共享运行时"** |

**明确否决**：把多个自然人放进一个 `tenantId` 靠"域内分区"隔离 —— 因为**读不隔离**（C44），那是**无隔离**而非弱隔离。

**workspace 授权时机（新增决定）**：workspaceId 的"允许集合"**在签令牌时固化**，同时**每次请求校验一次租户与隔离组**（硬依赖，但在网关本地完成，不进模型热路径）。理由：workspace 授权变更后靠令牌刷新生效（TTL ≤ 5 分钟），换取授权路径不引入新的同步远程调用。

**强制约束（C26）**：仅"禁止透传 `ctx.sessionQuery`"不足。**域内不得挂载 `dsh-session-query(-sqlite)` 及其 FTS 派生库**——该服务自带"无调用方授权"，域内挂载等于在不可信域放一份**全租户会话全文检索**，且是 DSR 之外的又一数据副本。

### 5.2 配额与计费

| 配额维度 | 计量点 | 等级 | 超限行为 |
|---|---|---|---|
| 令牌用量 | 域外（消费域内缓冲） | 软 | 拒绝新 turn 或降级模型 |
| 工具调用次数 | 域外 | 软 | 拒绝新 turn |
| 并发会话数 | Session Router | 硬 | 拒绝创建 |
| **域槽位 / CPU / 内存 / 模型并发** | 域池 + 网关 | **硬** | **超额租户按比例限速**（§5.2.1） |
| **每 workspace 并发与 CPU 份额** | 域内 + 域外 | **硬** | 拒绝该 workspace 新 turn |
| 存储用量 | 保留与删除服务 | 软 | 触发归档 |

**缓冲与阻断解耦（新增，修正 v2.5）**

v2.5 让计费、审计、配额**共用一个缓冲**，且"上限到达即拒绝新 turn"——**与 D12 的"软依赖继续执行"直接冲突**。规定：

| 规定 | 内容 |
|---|---|
| 分缓冲 | **计费**与**审计**各自独立缓冲 |
| 容量以时间定义 | "≥ 24 h @ P99 速率"，**不是字节数**；字节上限只是安全阀 |
| 压力下不阻断 | 超限时改**有界丢弃** + 落本地磁盘 + 打 `reconciled:false` 墓碑，**保留告警**；不可计费用量作为**已度量、有上限**的风险写进合同 |
| 补传 | 每域**随机抖动** + 令牌桶，避免恢复瞬间全 fleet 同时补传 |
| 水位→拒绝 | 单列为 **L1b**（§9.4），**不藏在 L1** |
| 领先指标 | 暴露"**缓冲最老事件年龄**"而非仅水位（水位是滞后指标） |

#### 5.2.1 公平调度（新增）

| 机制 | 内容 |
|---|---|
| 全局背压 | 域池水位超阈值时，对**超额租户**（用量 > 承诺额度）按比例限速/排队，**而不是让所有租户平等 503** |
| 跨租户 | 域池是全局共享资源；**不得把某租户的用量失控转化为其他租户的不可用**（SLA 会被击穿且无法免责） |
| 跨工作区 | 域内对 workspace 施加硬份额，避免**同租户内连坐** |
| 自助 | 80% 预警 + 可自助扩容；超额按合同单价结算、设上限倍数、超出后限速 |
| 合同 | 软配额**只有在合同里写清**才是商业优势，否则是坏账来源 |

**计费与归因**：按租户归集到 `turnId`；区分输入/输出令牌与缓存命中；MCP 调用按 connector。**用量以"日志 + 上传确认水位"为真源**（§7.6）。

### 5.3 Plugin Registry

**管理对象**：仅 Cordis 插件。MCP 走 §5.6，Skill 走独立目录。

| # | 类别 | 实例 | 进 Registry | 说明 |
|---|---|---|---|---|
| 1 | Bundle / Profile 层 | `dsh-base` | ✅ | 随列车 pin |
| 2 | Seam 提供方 | `dsh-sandbox-local`、`dsh-llm` 适配器 | ✅ | 替换 `ctx.*` 实现 |
| 3 | Tool 插件 | `dsh-tool-pwsh` | ✅ | **决定 `toolAllowlist` 的可选集** |
| 4 | UI / client-side | `client-ui-*` | ⚠️ 默认不进 | 由产品壳取代 |
| 5 | Skill provider | `dsh-skill-filesystem` | ✅ | 资产走 Skill Catalog |

**分层锁（产品侧治理策略，非平台强制力）**

> DSH **不存在** tier / 锁定概念：**preset 不是安全沙箱**（C17）；启动期只校验 peer 版本（C18）；scoped 注册不是权限边界（C19）。**等级：硬**——但强制力**全部来自 §5.3.1 的拦截点**。

| 层 | 可变更方 | 覆盖类别 |
|---|---|---|
| 平台锁定层 | 仅平台方 | 第 1、2 类 |
| 场景可选层 | 平台登记 | 第 3、5 类 |
| 租户自定义层 | 租户自带并经审核 | 第 3 类 |

#### 5.3.1 强制链（v2.6 重写：逐项标注拦截点）

> **D15/D16**：无拦截点者**不得**列为硬控制。下表逐项标注性质。

| # | 环节 | 位置 | **拦截点** | 性质 |
|---|---|---|---|---|
| 1 | Profile 生成与层级校验 | **域外** | Profile 生成器 | preventive |
| 2 | 制品完整性（哈希 + 签名） | **域外** | 加载器包装层 | preventive |
| 3 | **工具注册拦截** | 域内 | **`ctx.tools.register` 唯一入口** | **preventive（核心）** |
| 4 | **插件行移除** | 挂载前 | 不插入 plugin-manager / hmr | **preventive** |
| 5 | **预设表收敛** | Profile | 单一预设，宽模式不可达 | **preventive** |
| 6 | profile 与制品目录只读挂载 | 挂载层 | 容器挂载 | preventive |
| 7 | 域就绪判据（§4.1.2） | 域外判定 | Session Router | preventive（门禁） |
| 8 | **域外 attest（指纹比对）** | 域外 | 域上报 + 域外已知摘要 | **detective**（C/D15：自报不可防篡改） |
| 9 | **运行期漂移检测** | 域外 | 双向：域外已知制品摘要 + 域内上报工具 schema 哈希 | **detective** |

**v2.5 的两处错误已修正**：
1. v2.5 把 `toolAllowlist` 当作"域内只注册"的声明式强制 → **现改为入口拦截**（第 3 项）
2. v2.5 把 attest 当作硬强制链的一环 → **现降为 detective**，并删除 §8.5 中"域内改写工具集 ✅"的判定

**Registry 能力**：制品（含哈希与签名）／语义化版本／分层标记（合法性在**域外**判定）／分发／回滚／**由域外加载器校验**。

### 5.4 Session Router 与迁移状态机

| 职责 | 规定 |
|---|---|
| 路由键 | `(tenantId, isolationGroupId)` |
| 域选择 | 优先复用；无则从池分配或新建 |
| 就绪探针 | 判定必需 connector 是否就绪 |
| 会话索引 | **自建**（C24：内核 `list()` 无分页无过滤无索引） |
| 迁移 | 见 §5.4.1 |
| 降级 | 无可用域时 503 并排队，**不降级到共享域** |

#### 5.4.1 迁移状态机（新增，修正 v2.5 的单向门）

v2.5 的步骤 4（释放锁）之后**没有回退点**，且目标域可能拿到**更旧**的日志副本而**静默丢尾**。

```
PENDING ──► HANDOFF_ARMED ──► SOURCE_RELEASED ──► OWNED ──► (切换路由)
   │              │                  │              │
   └──────────────┴──────────────────┴──────────────┴──► FAILED ──► 可幂等重驱动
```

| 步骤 | 内容 | 断言 |
|---|---|---|
| 1 | 源域静默：拒绝新 turn | — |
| 2 | 等待/取消当前轮次 | — |
| 3 | **目标域预备**：`open` 就绪、connector 预连、取得**可转移租约（epoch+1）** | 目标就绪 |
| 4 | **`assert targetBaseSeq == sourceLastReplicatedSeq`** | **不等即拒绝 handoff**（防止丢尾） |
| 5 | 源域：追加 closer / flush → 关闭句柄 → **释放 `session.lock`** | 源已停写 |
| 6 | 目标域提交 epoch；源在 epoch 提升后的 append **被拒** | 单一写者 |
| 7 | 切换路由 | — |

| 规定 | 内容 |
|---|---|
| **失败终态** | 任一步失败进入 `FAILED`，**可幂等重驱动**；不得停留在"无写者"状态 |
| **回退** | `HANDOFF_ARMED` 之前可回退；之后走 `FAILED` 重驱动路径（不静默回退） |
| **锁语义** | `session.lock` **无过期**（C23）；取得所有权唯一方式是 `open(id,'write')`。故必须显式释放 + 目标提交，不得依赖超时 |
| **新增 SLO** | **无写者会话持续时长 P99 ≤ 5 min**；**迁移后事件数不减少**（不变量） |
| **存储介质** | **不把会话日志写路径放在共享 NFS/FUSE 上**；每域本地卷 + **异步复制**（故见 §7.6 的水位定义） |
| **禁止** | 不得依赖"重载后端插件即静默接管日志" |

**workspace 独占性（新增，修正 v2.5 缺口）**

| 规定 | 内容 |
|---|---|
| 独占 | **一个 workspace 在任一时刻只被一个域可写**，且带**可转移租约** |
| 理由 | `session.lock` 只护单个会话，**不护 workspace**；两个域挂同一 workspace 卷会丢更新/撕裂 |
| 容量溢出 | 走"同域扩容 / 排空 + 迁移会话"，**不是"新建隔离组共享 workspace"** |
| 纳入 | workspace 租约进入 §5.4 的 fencing 体系与 §9.5 的爆炸半径 |

> **工作量更正**：P1 实为**实现一个新的 `SessionPersistence` 提供方**，且需按 §11.4.1 分层。

### 5.5 审计

| 事件类别 | 权威来源 | 等级 | 关键字段 |
|---|---|---|---|
| 会话 / 轮次 | 控制面 + 域 | 硬（状态） | tenantId, isolationGroupId, workspaceId, sessionId, turnId, 结果, 是否中断 |
| 模型调用 | 反向网关 | 软 | 租户, 模型, 令牌用量, 延迟, 成本 |
| 工具裁决 | 挂载期 + 运行期 | 硬 + 软 | **五元组**, 是否在清单, 审批结果 |
| **工具集 attest / 漂移** | 域外 | 硬（门禁）+ **detective** | 域, 期望摘要, 实际摘要, 结果 |
| MCP 连接 / 调用 | 域 + Registry + 数据面 | 软 | **五元组**, transport, 状态, 工具数, 重连 |
| 审批 | 域 + 域外 | **硬** | approvalId, callId, 工具, 决策, 决策者, 耗时, **参数摘要** |
| **凭证签发 / 例外** | 域外 | **硬（最小集）** | connector, 绑定字段, TTL, 清单编号 |
| **沙箱 / 预设 / 审批策略变更** | 域外 | **硬（最小集）** | 会话, 旧值, 新值, 请求来源 |
| **白名单外注册尝试** | 域内桥 + 域外 | **硬（最小集）** | **五元组**, rawName, 结果 |
| 注入过滤 | 域内产品插件 | 软 | **五元组**, 通道类别, 信任级, 动作 |
| 沙箱执行 | 域 | 软 | 模式, enforcement, 拒绝标记 |
| 平台 | 控制面 | — | 域生命周期, 迁移, 池水位, 降级级别 |

**审计键升五元组（新增）**：`(tenantId, isolationGroupId, workspaceId, agentId, serverName, rawName)`——因独立 Agent 作用域可复用 `serverName`（C11），四元组**不足以唯一定位调用**。

**审计完整性（新增，修正 v2.5）**

| 问题 | 修正 |
|---|---|
| v2.5 把"审批/工具裁决/凭证例外"标硬，§9.2 又规定"审计落库不可用 = 软" → **同一条不能既硬又软** | **把"等级"与"不可用时的行为"解耦**：定义 **fail-closed 最小审计集**（§2.4），记不下就**拒绝该动作**；其余可缓冲 |
| 安全事件的**产生源在不可信域内**（D2），可被伪造/丢弃/延迟 | **权威来源移到域外控制点**（反向网关、凭证代理、MCP 代理、attest 服务、Session Router）；域内上报只作补充 |
| 无防篡改要求 | 审计库**哈希链 + 域外签名密钥 + 只追加/WORM**，且**可导出取证包**——列为 **P3 出口条件**，不是"计划" |

**约定**：事件以 `turnId` 关联；`enforcement != full` 打标；MCP 相关一律五元组。

### 5.6 Connector Registry

| 能力 | 规定 |
|---|---|
| 目录 | 租户 / 场景可用的 MCP 服务清单 |
| 身份 | `serverName`（`[A-Za-z0-9_-]{1,32}`），同注册作用域内唯一 |
| 归属 | **必须显式选择 §4.8.1 的归属**；例外须安全评审 |
| 传输 | `stdio` 或 `streamable-http` |
| 凭证 | 仅存 `credentialRef`；`credentialException` 须评审 |
| 策略 | 工具级 `allow`（→ `toolAllowlist`）与 `requireApproval`；**无运行期 deny 语义** |
| 健康 | 连接状态、**工具数**、重连次数；**工具数突变必须告警** |
| **突变处置** | 升级为"**突变即冻结该 connector 的新工具可见性**"（配合 §4.5.1 闸门） |
| 信任级 | `trusted` / `untrusted`。**默认 `untrusted`**（未知即不可信）；例外自动降级 |
| 生命周期 | 重连耗尽后由 Connector 控制器**自动重载** |

---

## 6. 接口契约

### 6.1 对外 OpenAPI

```
# 场景与目录发现
GET    /v1/scenarios
GET    /v1/plugins?kind=&tag=
GET    /v1/connectors
GET    /v1/skills

# 工作区
GET    /v1/workspaces
POST   /v1/workspaces
GET    /v1/workspaces/{id}
POST   /v1/workspaces/{id}:unregister        # 移除注册，明确不删数据
DELETE /v1/workspaces/{id}                   # 默认真删；二次确认 + 7 天宽限期
GET    /v1/workspaces/{id}/files/{path*}     # 新增：不依赖 sessionId 的文件入口
GET    /v1/workspaces/{id}/sessions          # 新增

# 会话
POST   /v1/sessions                          # 须指定 workspaceId
GET    /v1/sessions/{id}
DELETE /v1/sessions/{id}                     # 语义：删会话历史；不动 workspace 数据

# 轮次
POST   /v1/sessions/{id}/turns
GET    /v1/sessions/{id}/events
POST   /v1/sessions/{id}/turns/{tid}/cancel
GET    /v1/sessions/{id}/turns/{tid}/calls/{callId}   # 新增：审批参数回补

# 工具与审批
GET    /v1/sessions/{id}/tools
POST   /v1/sessions/{id}/approvals/{aid}
GET    /v1/approvals?status=pending          # 新增：用户维度全局收件箱

# 历史（须由域外施加 RBAC）
GET    /v1/sessions/{id}/messages?cursor=&limit=
GET    /v1/sessions/{id}/trajectory?cursor=&limit=

# 用量（新增，T+1）
GET    /v1/usage?dim=workspace|user|scenario|connector
GET    /v1/usage/export

# 模型
GET    /v1/llm/providers
```

| 项 | 规定 |
|---|---|
| 删除语义反转 | **危险语义要有危险的名字**：移除用 `:unregister`，删除用 `DELETE`。**删除承诺**：生效时延 ≤ 24 h（墓碑 → 域卷标记 → 对象存储生命周期 → 域回收时物理擦除），撤销窗口 7 天 |
| 文件入口 | 不能只有 `sessionId` 前缀——否则删掉最后一个碰过该 workspace 的会话后**文件失去入口** |
| 命名冲突 | 历史类统一 `cursor` + `limit`；`workspaceId` 在令牌的允许集合内校验 |
| 不提供 | 模型直连 |

### 6.2 Runtime Profile（正向）

```jsonc
{
  "profileId": "…",
  "protocolVersion": "1.0",
  "trainVersion": "0.2.0-rc.1",          // ★ 版本列车单值（C33）
  "tenantId": "…",
  "isolationGroupId": "…",
  "workspaces": [
    { "workspaceId": "w-a", "root": "/workspace/w-a", "writable": true },
    { "workspaceId": "shared-readonly", "root": "/workspace/shared", "writable": false }
  ],
  "presetId": "coding",

  "pluginSet": [
    { "name": "@…/plugin-x", "version": "1.2.0", "integrity": "sha512-…", "tier": "platform" }
  ],
  "removedRows": ["tool-plugin-manager", "plugin-manager"],   // ★ 必须
  "hmr": { "enabled": false },                                 // ★ 必须

  "toolAllowlist": [ "dsh-tool-fs", "dsh-tool-pwsh",
                     "mcp__corp-jira__get_issue" ],            // ★ 拦截依据（D16）

  "sandboxMode": "read-only",
  "sandboxModeCeiling": "read-only",                           // ★ 升权上限
  "permissionPresets": { "enabled": ["read-only"], "reachable": ["read-only"] },  // ★ 单一预设

  "connectors": [
    { "serverName": "corp-jira", "transport": "streamable-http",
      "url": "https://egress-data-plane.internal/mcp/corp-jira",
      "hosting": "data-plane", "credentialRef": "vault://tenant-x/mcp/jira",
      "trust": "trusted", "required": true,
      "requireApproval": ["mcp__corp-jira__comment"] }
  ],

  "deadlines": { "approvalSeconds": 90, "modelStreamSeconds": 300, "turnSeconds": 900 },  // ★
  "buffers": { "audit": { "retainHours": 24 }, "billing": { "retainHours": 24 } },        // ★ 分缓冲

  "quota": { "tokensPerDay": 1000000, "toolCallsPerTurn": 50 },
  "credentialRef": "vault://tenant-x/llm",
  "requiredPlugins": ["dsh-invariants"]                        // 仅真正缺失者
}
```

| 项 | 规定 |
|---|---|
| `trainVersion` | **整列车单值**；域内实际版本与 Profile 不一致 → 拒绝 ready（C33/C34） |
| `removedRows` / `hmr` | **必填**；缺省即拒绝 ready（C36） |
| `toolAllowlist` | 必填；**由注册桥拦截执行**（D16）；缺省语义"无工具"而非"全部工具" |
| `sandboxModeCeiling` | 必填；升权请求超过上限即拒（§4.5.1） |
| `permissionPresets` | 收敛为单一预设（C38） |
| `deadlines` / `buffers` | 必填（§4.4.1 / §5.2） |
| `hosting` | 必填；决定 connector 归属 |
| `workspaces[].writable` | `false` 表示租户级**只读共享工作区**——**不突破单一可写根**（C44 已明说读不受限，只读挂载不改变威胁模型） |

### 6.3 反向 I/O 契约

| 端点 | 方法 | 等级 | 用途 | 失败语义 |
|---|---|---|---|---|
| `/internal/kernel/llm/stream` | POST | 硬 | 模型调用（流式） | fail-closed |
| `/internal/kernel/llm/models` | POST | 缓存 | 模型目录 | 用 TTL 缓存 |
| `/internal/kernel/llm/resolve-model` | POST | 硬 | 模型解析 | fail-closed |
| `/internal/kernel/llm/prepare-call` | POST | 硬 | 调用准备 | fail-closed |
| `/internal/kernel/approval/request` | POST | 硬 | 审批（**须携带 sessionId/turnId/callId**，C9 内核字段不含这些） | 返回 `unavailable` |
| `/internal/kernel/tool-audit` | POST | **软** | 副作用台账 + 工具审计（**审批判定前上报参数摘要**） | 本地缓冲（台账为硬，见 §7.4.1） |
| `/internal/kernel/skills/resolve` | POST | 缓存 | Skill 解析 | 用 TTL 缓存 |
| `/internal/kernel/usage` | POST | **软** | 用量与一般审计 | 缓冲/有界丢弃 |
| `/internal/kernel/attest` | POST | 硬（门禁） | 域启动 attest 与运行期工具集指纹；**响应含降级级别** | 拒绝 ready |
| `/internal/egress/{kind}/{name}` | ALL | 硬 | 凭证代理出站 | fail-closed |

> **不存在** `/internal/kernel/tools/resolve`：工具强制已在挂载期完成（§4.5.1）。

**`/internal/kernel/attest` 契约（新增，v2.5 从未定义却作 P0 门禁）**

| 方向 | 字段 |
|---|---|
| 请求 | `profileId`、`trainVersion`、**实际加载的插件行与版本**、`tools[]`（名称 + schema 哈希）、**活动 fiber 检查**（plugin-manager / hmr / credential provider）、触发原因枚举 `boot｜tools-change｜heartbeat` |
| 响应 | `accept` / `deny` / `resync-profile` / `drain-domain` + **当前降级级别（L0–L3 / L1b）** |
| 触发源 | `tools/change` 事件（工具注册/注销或 scoped restriction 变化）是**指纹变更的自然触发源** |
| 版本 | 反向通道须带 `protocolVersion`；不兼容返回 426 |

**流式契约（新增，v2.5 缺失导致两团队无法并行实现）**

| 要求 | 内容 |
|---|---|
| 上行 | **原样转发** `GenerateOptions`（深冻结对象，逐字段保真，不得重组） |
| 下行 | 逐 chunk 透传 `StreamChunk`；**显式终止帧**区分"正常结束 / adapter error / aborted" |
| 取消 | `options.signal` 的 abort **必须在 TTFB 前生效**，且网关侧取消上游连接 |
| 背压 | **不得无界缓冲** |
| 失败 | 任何一项缺失，"中断当前轮次"会退化成"挂住的轮次" |

**统一要求**：mTLS + **绑定租户的域令牌**（§4.2.1）；携带 `turnId`；幂等键；`requestId` 回传。**硬端点一律 fail-closed**。

### 6.4 事件模型与 SSE

| 产品事件 | 说明 | 对应 DSH 事件 |
|---|---|---|
| `turn.started` | 轮次开始 | `turn/start` |
| `message.delta` / `reasoning.delta` | 文本 / 推理增量 | 模型流 chunk |
| `tool.call` / `tool.result` | 工具调用与结果 | `tool/call` / `tool/result` |
| **`tool.outcome_unknown`** | **新增**：`TOOL_OUTCOME_UNKNOWN` / `TOOL_NOT_STARTED` 提升为一等事件 | closer 合成结果 |
| `step.end` / `checkpoint` | 步骤 / 检查点 | `step/end` / policy 边界 |
| `connector.state` | MCP 连接或工具集变化 | supervisor 事件 |
| `approval.requested` / `.decided` | 审批（**须晚于同 callId 的 `tool.call`**） | `approval/asked` / `decided` |
| `sandbox.mode` | 沙箱模式变更 | `sandbox/mode` |
| `usage` | 令牌与成本增量 | token meter |
| `turn.completed` / `.failed` / `.interrupted` / `.cancelled` | 轮次终态 | `turn/end` |
| `domain.degraded` | **降级级别变化**（含 L1b） | 域外判定 |

| 传输规定 | 内容 |
|---|---|
| 协议 / 序号 | SSE；单调 `seq` 作为 SSE `id` |
| 重连 | `Last-Event-ID` 从 `seq+1` 续传 |
| **保留窗口** | **≥ 最长常见重连间隔**；心跳 **≤ 15 s**（同时满足 §4.8.3 的"空闲超时须大于客户端心跳"） |
| **`resync` 语义** | 必须携带"**已丢失区间 + 期间结论**"（在途轮次怎么办、已渲染内容怎么对账、token 是否重复计费） |
| 反压 | 慢消费端丢弃并 `resync`；**必须告知用户存在静默缺口** |

### 6.5 版本协商

| 项 | 规定 |
|---|---|
| 协议版本 | `X-DSH-Protocol: 1.0` |
| **列车版本** | Profile 携带 `trainVersion`；域上报实际列车号；不一致即拒绝 ready |
| 不兼容 | 按版本路由；无法兼容返回 426 |

---

## 7. 数据设计

### 7.1 数据分类

| 类别 | 位置 | 敏感性 | 真源？ |
|---|---|---|---|
| 会话事件日志 | 对象存储 / 域内卷 | 高 | ✅ **真源的一部分** |
| **上传确认水位** | 元数据库 | 中 | ✅ **真源的另一部分**（§7.6） |
| workspace 文件 | 卷 / 对象存储 | 高 | ✅ |
| **附件（`attachments`）** | `<DSH_HOME>` 域卷 | 高 | ✅ **DSR 清单必含**（C45） |
| **溢出文件（`spill`）** | `<DSH_HOME>` 域卷 | 高 | ✅ 清单必含 |
| **FTS 派生库** | `<DSH_HOME>` 域卷 | 高 | 派生，但**跨重启保留** |
| 快照 / 对象存储版本 | 对象存储 | 高 | 清单必含 |
| 配额账本 / 计费 | 元数据库 | 中 | 派生（可重建） |
| 审计记录 | **WORM** | 高 | 追加型，**哈希链** |
| 凭证 | 域外密钥库 | 极高 | ✅ |

**加密与驻留（新增，v2.5 全文缺失）**

| 项 | 规定 |
|---|---|
| 传输加密 | 全域内 mTLS；对外 TLS 1.3；**HSTS** |
| 静态加密 | 卷、对象存储、元数据库、WORM 审计**全部静态加密**；密钥在域外密钥库/HSM |
| 字段级 | 凭证与个人信息字段**应用层加密**，密钥与数据分离 |
| 驻留 | 每个租户绑定**驻留区域**；日志、workspace、快照、审计**不出区域**；跨区复制需显式开启并登记 |
| 证明 | DSR 删除报告须证明"**在全部副本上完成**" |

### 7.2 会话事件日志

| 属性 | 规定 |
|---|---|
| 模型 | 事件溯源，追加写（JSONL） |
| 提交点 | **`flush` 屏障**；`append` 为尽力而为（C21） |
| 检查点粒度 | 模型请求前、顶层工具副作用前、每个 `agent/pre-step`（C21） |
| **格式版本** | `SessionHeader.version` 是**精确相等校验**（C39）。**域冻结在其 format 版本**；跨格式版本的域**不得接收迁移会话与快照**；回滚只能用带外备份 |
| 不变量校验 | `dsh-invariants` + 各包 `./invariant`（需显式挂载，C25） |
| 外置 | 写本地后**异步复制**；恢复优先本地；**水位定义见 §7.6** |
| 只写日志的事件 | 审批审计对、`sandbox/mode` 等不进模型历史 |

### 7.3 workspace

#### 7.3.1 四个同名概念

| # | 名称 | 载体 | 语义 | 对模型可见 | 执行/安全语义 |
|---|---|---|---|---|---|
| 1 | **`ctx.workspaceRegistry`** | `dsh-workspace` | 宿主侧**项目分组注册表** | **完全不可见**（C31） | ❌ 纯呈现 |
| 2 | **沙箱"工作区根"** | `dsh-sandbox-policy` | `workspace-write` 允许写的**那一个**根 | — | ✅ 唯一可写根 |
| 3 | **`SessionHeader.cwd`** | `dsh-session` | 会话**不可变** cwd | 间接 | ✅ #2 的取值来源 |
| 4 | **产品侧 workspace** | **本方案** | `(tenantId, workspaceId)` 工作上下文分区 | 间接 | 授权 / 配额 / 生命周期 |

#### 7.3.2 投影关系

```
产品侧 workspace (tenantId, workspaceId)   ← 授权 · 配额 · 生命周期 · 用户可见分组
        │ 一对一投影
        ▼
会话的 SessionHeader.cwd                    ← 内核原生，创建后不可变（C27）
        │ 即
        ▼
沙箱的唯一可写根                            ← 文件写的边界
```

| 事实 | 推出的硬约束 |
|---|---|
| 沙箱**只有一个**可写根（C27） | 一个会话**只能**对应一个 workspace 目录 |
| `cwd` **会话不可变** | **会话中途不能换 workspace**；要换 = 新建会话 |

#### 7.3.3 workspace 注册表归属（D14）

**决策**：**域外自建，作为唯一真源。** 理由：workspaceId 必须参与授权，而授权只能在域外做（D9）；域内再挂一份会造成两处真源。
**代价**：放弃内核现成的分组能力，需自实现；换来**授权与呈现同源**。

#### 7.3.4 数据属性

| 属性 | 规定 |
|---|---|
| 绑定 | `(tenantId, workspaceId)`；域外维护 |
| 域内映射 | 各 workspace 对应独立可写根；会话 cwd 即其可写根 |
| **独占** | **一个 workspace 任一时刻只被一个域可写**，带可转移租约（§5.4.1） |
| 隔离 | 不同 workspace 不同卷；**域内 workspace 之间不是安全边界，且读不隔离**（C44） |
| 生命周期 | 独立于会话；**移除注册不删除数据**（C32） |
| 只读共享 | 支持 `writable:false` 的**租户级只读共享工作区**（不突破单一可写根） |
| 快照 | 周期性快照；**进 DSR 清单** |

#### 7.3.5 用户端行为约定（产品契约）

| 用户看到的 | 背后是什么 |
|---|---|
| 侧边栏里的"项目 / 工作区" | 域外的 workspace 记录 |
| 展开后的会话 | 该 workspace 下 `cwd` 指向它的会话 |
| 在 A 的会话里看到的文件 | A 目录（该会话的可写根） |
| 切到 B → 文件列表完全不同 | 换了 workspace = 换了可写根 |
| **删除会话后，项目文件仍在原处可访问** | 文件入口不再只依赖 sessionId（§6.1） |

**四条必须在产品上表达的硬约束：**

| # | 约束 | 成因 | 产品义务 |
|---|---|---|---|
| 1 | **一个会话绑定一个 workspace，中途不能换** | `cwd` 不可变 | UI 让"换工作区 = 新建会话"一目了然 |
| 2 | **同 workspace 会话共享文件；不同 workspace 之间平台不保证互相看不见** | D5 + **读不隔离**（C44） | **必须写成用户能判断的规则**：<br>"同一个工作区里的会话可以互相看到文件；不同工作区之间**平台不保证互相看不见**——**需要互相看不到的人/团队，请放在不同租户或不同隔离组下。**" |
| 3 | **"从侧边栏移除" ≠ "删除数据"** | C32 | 两个动作、两个名字（§6.1 `:unregister` vs `DELETE`）；删除须给**生效时延与撤销窗口** |
| 4 | **恢复后终端状态丢失** | §7.4 不可恢复清单 | 中断/恢复后注入**系统级横幅**："本次恢复后，之前的终端状态与后台任务已丢失；请先核验外部状态再继续" |
| 5 | **当前模式与待审批状态可见** | §4.6 / §4.5 | 会话页常驻**模式徽章** + 工具集 + 待审批数 + 用量余额 |

### 7.4 检查点与恢复

**恢复语义**：DSH 的崩溃恢复是**追加合成 closer**，**不是回滚**（C22）。

```
恢复 = persistence.open(id,'write')   ← 取写所有权与锁
     + 读物理日志（撕裂尾部截断）
     + 计算并追加 interruptedTurnClosers（合成 tool/result 错误 + 未闭合 step/end + turn/end{interrupted}）
     + 折叠日志前缀得到模型历史
     + 重建 connector 连接
     + 继续
```

| 项 | 规定 |
|---|---|
| 中断轮次 | **永久保留在历史中** |
| 模型侧提示 | 内核只提供**给模型看的一句提示文本**（"结果未知…只重试只读或幂等操作…不要盲重试"） |
| **v2.5 的错误** | v2.5 写"副作用由**域外策略补偿**"——**该机制在设计与内核里都不存在**。v2.6 改为下面 §7.4.1 的台账机制 |
| **不可恢复清单** | 持久 shell 的 cwd / 导出变量 / 后台任务；在跑的 MCP 子进程；`run_code` 中间值；**嵌套派发的内层副作用**（C43） |
| 检查点用途 | 决定折叠起点与重试边界 |
| 需真正回滚时 | `fork(source, boundary)` 派生子会话；**仅接受活跃源会话**，且**子会话 id 变更** |
| 事件暴露 | `TOOL_OUTCOME_UNKNOWN` / `TOOL_NOT_STARTED` **提升为一等产品事件与指标**（v2.5 只进模型历史，运维无法计数） |

#### 7.4.1 副作用台账（新增，替代 v2.5 的空话）

**问题**：v2.5 让"模型自己判断能否重试"。而**嵌套派发复用外层持久调用**（C43）——同一会话内经 workflow / PTC / 进程内 subagent 的副作用，持久化粒度是**外层调用**；恢复只能告诉模型"外层结果未知"，**无法定位内层哪几个副作用已发生**。模型若重跑外层脚本，内层副作用**整体重放**。

| 规定 | 内容 |
|---|---|
| 台账 | 对标记为**非幂等**的工具，在**执行前**把 `(tenantId, isolationGroupId, workspaceId, sessionId, turnId, callId, toolName, 参数摘要, 目标资源)` 落到**域外** |
| 时机 | 挂在与检查点同一时机（外层副作用前已 flush） |
| **恢复后** | 对台账中"未确认结果"的调用，由**产品策略（而非模型判断）禁止自动重试**；UI 显示参数并要求确认 |
| 嵌套派发 | 强制要求内层副作用先落台账，**或**明确禁止这类工具执行非幂等副作用 |
| 等级 | 台账写入为**硬**（属最小审计集） |
| 指标 | "结果未知调用数"按租户/按工具计数 |

### 7.5 保留与销毁

**约束**：persistence **无删除或保留接口**；`list()` 无分页无过滤无索引（C24）。DSH 的 workspace 归档只是宿主侧标记。以下全部为**域外带外实现**。

**数据清单（新增，v2.5 漏了四类同源数据）**

| 数据 | 默认保留 | 实现方式 |
|---|---|---|
| 会话事件日志 | 租户策略（默认 180 天） | 对象存储生命周期 + 元数据库墓碑 + 与 `session.lock` 协调 |
| **附件 `attachments`** | 随域 | **按内容去重（C45）→ 删除粒度问题**：引入引用计数，或"删除即抹除内容、保留引用占位"。目录**固定到域卷**，随域销毁 |
| **溢出文件 `spill`** | 30 天（C45） | **`spill.root` 固定到域卷**；不依赖其一次性启动扫描 |
| **FTS 派生库** | 随域 | 域卷；**域内不得挂载** `dsh-session-query-sqlite`（§5.1） |
| **快照 / 对象存储版本** | 按策略 | 进删除顺序；含不可变/合规锁模式 |
| 容器临时层 | 域回收即销毁 | 容器销毁 |
| 审计记录 | 合规要求（默认 ≥ 1 年） | **WORM + 哈希链**；仅按合规流程 |
| 凭证 | 长期 | 密钥库轮换 |

| 规定 | 内容 |
|---|---|
| 会话索引 | **域外必须自建** |
| 删除顺序 | 停写（取锁）→ 墓碑 → 删数据 → 释放锁；避免与迁移竞争 |
| **合法扣留优先** | 审计留存与 DSR 冲突时：对**保留的审计做假名化而非删除**；删除前先抽出计费/审计所需的**假名化聚合**（解决与 §7.6 真源冲突） |
| **删除证明** | 定义"**删除清单 + 墓碑 + 删除报告 + 哈希链证明**"，并给出**生效时延**（≤ 24 h）与**撤销窗口**（7 天） |
| 交付物 | 保留与删除服务为 **P3 出口条件**（不是"计划"） |

**等级**：删除与证明 = **硬**（合规义务）。

### 7.6 一致性与对账

**真源模型（v2.6 修正）**

> v2.5 说"以会话日志为准"，但日志写**本地卷后异步复制**——**节点丢失时日志本身就缺那段**，真源不成立。RPO 0 与异步复制也不能同时成立。

| 角色 | 存储 | 性质 |
|---|---|---|
| **唯一真源** | **会话事件日志 + 上传确认水位** | 追加型；水位界定"哪些已离开节点" |
| 派生视图 | 配额账本、计费、审计补写、会话索引 | **可重建**，允许落后 |

| 规定 | 内容 |
|---|---|
| `uploadInterval` | **显式参数**（如 30 s），纳入 §10.3 容量模型与 §9.1 SLO |
| **RPO 分层** | **节点内 RPO = 0（已 flush）**；**跨节点 RPO = 复制滞后**（给 P99，如 ≤ 30 s）。**不得笼统写 RPO 0** |
| 撕裂尾部 | 窗口期内**不得上传不完整帧** |
| 幂等扣减 | 派生视图按 `(tenantId, turnId)` 去重 |
| **不阻断** | 派生视图落后**绝不影响执行**；缓冲超限走**有界丢弃 + 墓碑**（§5.2），**不拒绝新 turn** |
| 对账 | `diff_rate(tenant, window) = \|log_derived − ledger\| / log_derived`；窗口（T+24 h 快照）、**绝对上限（每租户 ≤ X 元）**、**收敛 SLO（≤ T_h）** |
| 方向分列 | **少计（收入漏损）与多计（客户争议）方向相反，必须分列统计** |
| 裁定 | 差异以真源裁定并回写；差异的**真实来源**即"未上传尾部"，须单独作为 RPO 指标暴露 |
| 边界声明 | 若接受"信任域内日志"，则对账只能发现**不一致**，**不能发现伪造**——须在 §8.5 与合规说明中写明 |
| 明确不做 | 不引入跨存储分布式事务 |

---

## 8. 安全设计

### 8.1 三层边界（修正 v2.5 的过度定性）

| 层 | 强制者 | 保证 | 不保证 | 等级 |
|---|---|---|---|---|
| 外层 | 容器 / microVM | **跨租户**文件、网络、进程、依赖互不可见 | 同租户内 workspace 之间（**且读不隔离**） | 硬（Windows 需**随域销毁的独立卷或 microVM**，见 §8.4） |
| 中层 | DSH 沙箱 | 单次调用只能写工作区 + 私有临时区 | 读取、网络、进程、系统调用、设备、凭据 | **硬（限文件写效果类；对域内对抗者不成立；Windows 为 `partial`）** |
| 内层 | preset / scope | 能力裁剪 | **非安全边界**（C17/C19） | 非强制 |

### 8.2 凭证管理

| 项 | 规定 | 等级 |
|---|---|---|
| 内核 | **不持有长期凭证**；仅持**绑定租户**的域令牌/租约（§4.2.1） | 硬 |
| 模型 / 工具凭证 | 域外密钥库；凭证代理注入 | 硬 |
| **代理授权口径（新增）** | **一律以调用方已认证的域身份查表，绝不解析请求体中的凭证名**；缺映射即拒绝并审计 | 硬 |
| MCP 凭证 | 统一规则不入域（§4.8.1）；例外须登记（§4.8.2） | 硬 |
| **环境构造** | 域容器环境**白名单构造**，不依赖内核的名称启发式清洗（C46） | 硬 |
| **credential provider** | 域内**禁止挂载**任何 credential provider；就绪判据断言其不存在 | 硬 |
| 传递 | 一律 `credentialRef` 引用 | 硬 |
| 禁止项 | 绕过轮次直连模型；域内配置长期凭证；**任何"域内自证合规"的设计**（D9/D15） | 硬 |

### 8.3 隔离矩阵

| 资源 | 隔离粒度 | 机制 | 等级 |
|---|---|---|---|
| 网络 / 进程 / 依赖 / 计算 | **租户** | 容器 / microVM | 硬 |
| 凭证 | 租户 | 域外密钥库 + 代理（域身份查表） | 硬 |
| 文件系统 | **写**：workspace；**读：无隔离**（C44） | 独立卷 + 独立可写根；只读共享区显式声明 | 跨租户硬；域内仅写隔离 |
| 插件集 | 租户 / 场景 | Cordis 树（仅 host）+ **行移除** + 就绪判据 | 硬 |
| 工具可达性 | 租户 / 会话 | **注册桥入口拦截**（D16） | 硬 |
| 沙箱模式 | 租户 | **单一预设 + 上限**（§4.6） | 硬 |
| profile 与制品 | 域 | 只读挂载 | 硬 |
| 会话状态 / 历史查询 | 会话 / 租户 | 会话日志 + 域外 RBAC（C26）；**域内不挂 query 插件** | 硬 |
| 配额 / 一般审计 | 租户 | 分缓冲 + 事后对账 | 软 |
| **共享资源配额** | 租户 / workspace | 域池槽位、CPU、并发 | **硬** |

### 8.4 平台差异处理

| 平台 | 后端 | enforcement | 处置 |
|---|---|---|---|
| Linux | `bwrap` → Landlock | `full` | 中层边界 |
| macOS | Seatbelt | `full` | 中层边界 |
| Windows | ACL 受限令牌 + Low 完整性 | **`partial`** | 中层边界，**不作安全边界** |

**Windows 的正确表述（v2.6 修正 v2.5 的事实错误）**

| 项 | v2.5 的写法 | **修正后** |
|---|---|---|
| 撤销 | "绝不撤销 / 无法消除 / 物理不可能" | **"临时授权与标签可由模块 `dispose()` 撤销；工作区安全描述符编辑按设计保留"**——这是**设计选择**，不是物理不可能。手工 `icacls` 无法回收（`ERROR_NONE_MAPPED` 1332），**但经该模块可以** |
| 残留期 | 含糊 | **驻留期 = 卷 / 目录生命期**；**销毁域即销毁卷**可消除工作区残留 |
| Low 标签 | 只说"残留" | **Low 标签会加宽目录树**：同用户的其他 Low 完整性进程（别的产品的 Low-IL 沙箱、受保护模式阅读器）**可以在工作区内写入与删除**。**该风险在 Windows 上无排除手段** |
| 补偿 | "每域独立卷 + 不与任何 Low 进程共享底层文件" | 这是**断言而非控制**。**强制要求**：Windows 域使用**随域销毁的独立卷**，**不得**落在宿主共享目录；共享场景一律改用 **microVM / Hyper-V** |
| 硬链接 | 只说"文件对象别名" | **继承的工作区授权会传播到既有硬链接上**，同一底层对象经外部别名可写；且授权会**永久改写客户真实目录的 DACL**，并把 `FILE_DELETE_CHILD` 对 world 拒绝（**连用户自己的普通删除路径都被改变**） |
| 披露 | 只提 Low 标签 | 合规文档须补：**硬链接别名可写** + **永久改写客户目录 DACL（含 DELETE 语义变化）**，并提供"**已修改路径清单 + 卸载/复原流程 + 责任人**" |
| 门禁 | §14 待验证 | **"Windows 容器内 ACL 行为实测"提升为 P0 出口门禁**；未通过则**禁止 Windows 参与多租户隔离** |

### 8.5 威胁覆盖（删除 v2.5 的假 ✅）

| 威胁 | 覆盖 | 手段 |
|---|---|---|
| 跨租户数据读取 | ✅ | 外层容器（Windows 需独立卷/microVM） |
| **域内执行白名单外能力** | ✅ **（v2.6 修正）** | **注册桥入口拦截**（D16）+ 行移除 + 预设收敛；v2.5 的声明式白名单**不成立**（C35/C36/C38） |
| **域内违规注册工具** | ✅ preventive | 入口拦截 + 最小审计集硬告警 |
| **域内改写插件组合** | ⚠️ **（v2.6 下调）** | 行移除 + 只读挂载 + 就绪判据为 preventive；**attest/漂移仅 detective，不防篡改（D15）** |
| **域冒充其他租户** | ✅ | 域令牌**绑定 `(tenantId, isolationGroupId)`** + 域外校验（§4.2.1；v2.5 缺失） |
| 凭证泄露 | ✅（例外登记并可度量） | 统一规则 + 代理（域身份查表）+ 例外进程隔离 + 上限报表 |
| **公网外泄** | ⚠️ | `web_fetch` **不请求审批**（C47）⇒ **域内不挂公网工具**，改由域外代理施加 DLP 与硬审计；若保留则登记为已披露通道 |
| 提示注入诱导越权写 | ⚠️ | 沙箱 + 审批；**审批载荷不含参数（C9）**⇒ 依赖 §4.5.1 的参数通道 |
| **子代理绕过审批** | ⚠️ | 委派时审批被**钉死为 `never`**（C48）⇒ `requireApproval` 工具在子代理内被硬拒。须：由 Profile 依 `toolAllowlist` 派生 `toolFilter`，并声明"**子代理内审批不可用**" |
| MCP 注入（四通道） | ⚠️ | 信任级（**默认 `untrusted`**）+ §8.6 四通道过滤 |
| 工具 / MCP 供应链投毒 | ✅ | 域外签名校验 + 容器隔离 + 信任级 |
| 内网横向移动 | ✅ | 容器网络策略 |
| 插件缺陷导致资源耗尽 | ✅ | cgroup + 域重调度 |
| 沙箱绕过（平台缺陷） | ✅ | 不依赖沙箱作安全边界 |
| 重复计费 / 漏计 | ✅ | 幂等扣减 + 真源裁定 + 对账（§7.6） |
| **重复副作用** | ⚠️→✅ | **域外副作用台账 + 产品侧禁止盲重试**（§7.4.1） |
| **同租户内跨用户读取** | ⚠️ **已披露** | 读不隔离（C44）；需 need-to-know 者用团队/用户级隔离组（§4.1.1）；**DPA 与产品说明必须写明** |
| 审计伪造 | ⚠️ **已披露** | 安全事件权威源移到域外；域内上报仅补充；**对账不能发现伪造**（§7.6 边界声明） |

### 8.6 MCP 注入面（四通道）

| 通道 | 内容 | 实施点 |
|---|---|---|
| 1 `instructions` | `### MCP server: <serverName>` | `system-prompt/assemble` waterfall |
| 2 工具描述与 schema | 进入每次请求 | 同上；**描述体积与 `maxInstructionBytes` 作为注入/DoS 面登记** |
| 3 工具结果 | 执行返回内容 | `tools/post-execute` 包装 |
| 4 资源正文 | MCP resources | 同 3 |

| 信任级 | 处置 |
|---|---|
| `trusted` | 允许原文 |
| `untrusted` | 过滤或包装为"仅数据、非指令"并加来源标注。**默认即为 `untrusted`** |

**明文限制**：域内过滤对**域内其他插件**不构成强制（C19）。真正的强制力是**不挂载**（域外 Profile 决定）与**入口拦截**（D16）。

### 8.7 灾难恢复与区域（新增）

| 项 | 规定 |
|---|---|
| 区域绑定 | 每租户绑定驻留区域；数据不出区域 |
| 跨 AZ | **是"恢复"不是"重调度"**：本地卷按 AZ 绑定，跨 AZ 必须从对象存储/快照恢复 ⇒ **分钟到小时级**，不得与节点故障同列 |
| 数据面副本 | 持托管 stdio 子进程与 MCP 会话，副本重启**丢在途工具调用**（结果未知 → 回到 §7.4.1）；域侧工具被注销、重连预算耗尽则**永久移除**（C42）⇒ 该行**必须补 RTO/RPO**，不能留空 |
| 备份 | 带外；**格式版本耦合**（C39）：跨格式版本的备份**不可互读** |
| 密钥轮换 | 双证书重叠期 + 演练；列为 **P0/P1 级风险**（一次误轮换 = 全平台不可用） |

---

## 9. 可靠性与可观测性

### 9.1 SLO（v2.6 重写：每条给测量点/分母/排除项/归因）

> **状态：待压测回填。** 但**测量点与分母定义必须先定稿**——v2.5 有多条"必然报绿"或"分母不自洽"的指标。

| 指标 | 目标 | 测量点 / 分子分母 | 排除项 | 归因 |
|---|---|---|---|---|
| 控制面可用性 | 99.9% | 网关 5xx **按责任方分列**（平台 / 模型 / 策略 fail-closed） | 客户端错误 | 平台 |
| ~~网关可用性~~ | **删除** | v2.5 与上条**同一指标计两次** | — | — |
| **平台首 token 开销 P95** | ≤ 400 ms | 反向网关收到请求 → 上游发出；上游首字节 → SSE 发出 | — | 平台 |
| **端到端首 token P95** | ≤ 3 s（含模型） | 用户发送 → 首次可见增量。**须定义"首 token" = `message.delta` 还是含 `reasoning.delta`** | — | 按模型归因；厂商故障**不打爆平台 SLO** |
| 轮次成功率 | ≥ 99.5% | `turn.completed` / (全部 turn − **`turn.cancelled`**) | 用户取消**在分母也扣除** | 平台 |
| **内核日志恢复 RTO** | ≤ 30 s @ ≤10⁵ 事件；**按日志规模分档** | 进程启动 → **用户下一次 turn 被接受**（**不是** `open` 完成） | 见下 | 平台 |
| **connector 重建 RTO** | 单独定义 | 恢复开始 → 必需 connector 就绪 | — | 平台 |
| **用户可见 RTO** | **必须有数字** | 崩溃 → 会话可再次接受 turn（= 日志恢复 + connector 就绪） | — | 平台 |
| **节点内 RPO** | 0（已 flush） | — | 未 flush 的追加 | 平台 |
| **跨节点 RPO** | = 复制滞后，P99 ≤ 30 s | `uploadInterval` 与水位差 | — | 平台 |
| 迁移成功率 | ≥ 99.9% | 迁移完成 / 发起，**且含一致性断言通过** | 用户取消 | 平台 |
| **无写者会话时长 P99** | ≤ 5 min | 迁移/handoff 期间会话无写者的时长 | — | 平台 |
| 审计落库时延 P95 | ≤ 5 s | 事件产生（**域内时钟**）→ 落库（**域外**）；**须定义时钟偏差上界**；**不排除降级期** | — | 平台 |
| **最小审计集可用性** | 99.99% | 记不下即拒的动作比例 | — | 平台 |
| **用量对账差异率** | ≤ 0.01% | `diff_rate(tenant, T+24h)`；**少计与多计分列**；单位 = 金额 | — | 平台 |
| **对账收敛时长** | ≤ T_h | 差异归零所需时间 | — | 平台 |
| **挂死轮次** | 计数（无进展 > `T_turn`） | — | — | 平台 |
| MCP 工具可用率 | ≥ 99% | **按时间**（非按调用）：connector 处于"工具可见"状态的时长占比 | 已下架 | 依赖 Connector 控制器 |
| **重连耗尽 → 自动重载完成 P95** | ≤ 60 s | — | — | 平台 |

**已删除的错误指标**：
- `toolAllowlist` 拒绝数（D10 下**不存在拒绝路径**，按构造恒为 0，无检测语义）→ 改为"**白名单外注册尝试数**"
- "控制面/网关可用性"重复计数
- "会话恢复 RPO 0 ｜ 排除未 flush"（同义反复）

**RTO 的分 span 要求**：拿锁 / 读+closer / 折叠 / connector 就绪 / 工具集就绪，各自给预算。注意 `openTurnClosers` 是**全日志线性扫描**，且持久化层**无压缩无轮转**，故必须有事件量上界；`dsh-session-projection-cache` 须明确为**必挂组件**并规定 `writeEveryEvents` / `writeIntervalMs` 与"缓存行也须随域复制"（自述"fold shortcut, never an authority"）。

### 9.2 故障处理与降级

| 故障 | 等级 | 处理 |
|---|---|---|
| 反向网关 / 凭证代理 / 模型网关不可用 | 硬 | 中断当前轮次（L3）；**不本地直连** |
| 审批不可用 / 超时 | 硬 | `unavailable` / `timeout`，fail-closed |
| 沙箱后端不可用 | 硬 | `SANDBOX_UNAVAILABLE`，拒绝执行 |
| 域就绪判据失败 / 违规注册 / 模式漂移 | 硬 | 拒绝 ready / **摘域（单独审批）** |
| **配额与共享资源** | **硬** | 超额租户按比例限速（§5.2.1） |
| 计费服务不可用 | **软** | 独立缓冲继续；**超限有界丢弃**，**不拒绝新 turn** |
| 一般审计落库不可用 | **软** | 同上；最小审计集不在此列 |
| **最小审计集不可用** | **硬** | 记不下即**拒绝该动作** |
| 目录服务不可用 | **缓存** | 用 TTL 内清单继续；超 TTL 停止新建域 |
| 单个 MCP connector 失败 | 硬（`required`）/ 软（其余） | 必需则不就绪；否则工具不可用、域继续 |
| **MCP 重连预算耗尽** | 软 | **Connector 控制器自动重载**（非摘域，§4.8.3） |
| 域崩溃 | — | 摘除；在途轮次经 closer 收尾；从日志恢复 |
| 单节点 / 单 AZ | — | 见 §9.5 |
| 域池耗尽 | 硬 | 503 并排队 + **全局背压**；不降级到共享域 |

**统一映射原则（新增）**：每个触发**只有一个**补救动作。v2.5 对"attest 失败/漂移"给了三种口径（拒绝 ready / 摘域 / 拒绝当前轮次）——现在只有两种且有明确边界：**就绪类 → 拒绝 ready**；**运行期违规 → 摘域（需单独审批）**。

### 9.3 指标与审计事件

| 类别 | 指标 |
|---|---|
| 业务 | 活跃租户、活跃会话、轮次数、成功率 |
| 模型 | 令牌用量、成本、延迟分布、失败分类 |
| 工具 | 调用量、审批率、耗时 |
| **强制** | **白名单外注册尝试数（硬告警）**、就绪判据失败数、模式漂移数 |
| MCP / connector | 每 connector：连接状态、**工具数**、重连次数、自动重载次数与耗时、注入过滤计数 |
| **凭证例外** | 例外数量、占比、签发次数（合规报表） |
| 沙箱 | 模式分布、enforcement 分布、拒绝次数 |
| **平台** | 域池水位、域三态分布、域启动耗时（含 Windows ACL 传播）、**当前降级级别（L0/L1/L1b/L2/L3）**、迁移/恢复次数 |
| **缓冲** | **最老事件年龄**（领先指标）、水位（滞后指标）、有界丢弃计数与墓碑数 |
| **恢复** | 挂死轮次数、无写者会话数、**结果未知调用数** |
| 对账 | 差异率（分方向）、收敛时长、补写条数 |
| 合规 | `partial` 时段占比、`untrusted` connector 占比、**Windows ACL 残留披露记录** |

### 9.4 降级阶梯（v2.6 修正：补 L1b、滞回、穷尽性）

> v2.5 的问题：L3 触发集不穷尽；作用域混用；无抖动抑制；L2→L0 不可判定；告警风暴；且 **L1 把软依赖悄悄变成硬依赖**。

| 级别 | 触发 | 行为 | 对外表现 |
|---|---|---|---|
| **L0** | — | 全功能 | — |
| **L1 软降级** | 计费 / 一般审计不可用 | 独立缓冲继续 | 用量与审计延迟展现 |
| **L1b 缓冲耗尽（新增）** | 缓冲超过**时间**容量 | **有界丢弃 + `reconciled:false` 墓碑 + 硬告警**；**仍不阻断执行** | 提示"部分用量未能计量，将于恢复后对账" |
| **L2 缓存降级** | 目录服务不可用 | 用 TTL 内清单继续；停止新建域 | 新场景可能不可用 |
| **L3 硬停** | 反向网关 / 凭证代理 / 模型网关 / 审批不可用；最小审计集不可用；就绪判据失败 | **拒绝执行当前轮次** | 会话暂停并提示原因 |

**L3 触发集补全（新增）**：沙箱后端不可用（`SANDBOX_UNAVAILABLE`）、域池耗尽（503 排队）、required connector 不就绪、持久层故障。

| 规定 | 内容 |
|---|---|
| 聚合 | 阶梯是 **(依赖 × 作用域 × 观测窗口)** 的函数；**作用域**须显式（每域 / 全局），"取最严重者"须定义跨作用域聚合规则 |
| **滞回** | 每级加**进入/退出阈值与最短驻留**：进入需连续 3 次探测失败或 30 s；退出需 5 min 稳定 |
| **L2→L0** | 退出**必须强制刷新目录并重新 attest**；指纹变化则**排空域**，不得静默回 L0 |
| 告警 | **按租户聚合**降级事件，只在跨过驻留阈值时告警（避免 1000 域 × 抖动 = 1000 条） |
| 通报 | L2 持续 > 5 min、任意 L3 触发，须告警并通知租户，附**客户可见文案与状态页规则** |
| 禁止 | 硬依赖不得可降级；软依赖不得实现为 L3；**软依赖的缓冲不得阻断执行** |
| 成本 | 每级配"可用性收益 / 一致性或计量损失"成本表；写**错误预算政策**（预算耗尽时冻结什么变更） |

### 9.5 故障域与爆炸半径（v2.6 修正 RPO 与阈值）

| 故障 | 影响范围 | RTO | RPO |
|---|---|---|---|
| 单会话崩溃 | 1 个会话 | 内核日志恢复 RTO | 节点内 0 |
| **单域崩溃** | **该租户该隔离组的全部会话** | 日志恢复 + connector 重建 | 节点内 0 |
| 单节点故障 | 该节点上全部域（**多个租户**） | 域**恢复** + 重调度 | **= 复制滞后**（v2.5 误写 0） |
| **单 AZ 故障** | 该 AZ 全部域 | **恢复型**（跨 AZ 必须从快照恢复，**分钟到小时级**） | 见 §7.6 |
| 持久层故障 | 全局 | §9.2 | 由持久层保证 |
| 数据面单副本故障 | 途经该副本的会话 | 会话亲和重路由；**在途工具调用结果未知** | **须给出数字，不得留空** |

**密度与反亲和（新增阈值）**

| 规定 | 内容 |
|---|---|
| 密度上限 | **给出数字**：每节点 ≤ N 个租户、≤ Y% 租户总量。**`N_node = min(内存约束, 爆炸半径约束)`**——v2.5 的 `N_node` 只由内存推出，与爆炸半径**没有挂钩** |
| 反亲和 | "同一租户多隔离组不同节点"**管不住主要风险**（默认一租户一域）。真正约束爆炸半径的是**密度上限 + 跨租户反亲和** |
| 大租户 | 按关键级给 **N+1 热备域** |
| 自伤 | 内存压力 OOM 会杀光同节点所有域 ⇒ 压测是唯一防线 |
| 声明义务 | 本矩阵是**对外承诺的一部分**，容量变更时同步更新 |

---

## 10. 部署与运维

### 10.1 域池与容量

| 参数 | 规定 |
|---|---|
| 池类型 | 预热域池 |
| 预热数 | 按活跃**隔离组**数配置 |
| **预热预算** | 须计入 **Windows 大树 ACL 传播（数十秒计，C30）** 与 connector 首次建连 |
| 冷启动降级 | 池空时按需创建，前端显示等待（**非错误码**） |
| 单域会话上限 | 可配；超限走**同域扩容 / 排空 + 迁移会话**（**不是共享 workspace**，§5.4.1） |
| 资源限制 | 按域设 CPU / 内存 / 磁盘 |
| **镜像基线** | 必须包含 `@deepseek-ai/node-addon-system` 对应架构的**可选依赖**（或 Windows 档的 koffi 路径），否则 `flock` 不可用、写所有权直接拒绝 ⇒ 列为**域启动自检项** |

### 10.2 升级与兼容

| 对象 | 策略 |
|---|---|
| 控制面 / 网关 | 滚动升级，向后兼容；协议多版本共存 |
| 数据面 | 滚动升级；**须处理会话亲和、长连接与托管 stdio 子进程** |
| 内核 | **按域批次灰度**（保持每租户在同一列车内）；**版本列车整列同升，禁止混版**（C33/C34） |
| **格式版本** | **域冻结在其 format 版本**；跨格式版本的域**不得接收迁移会话与快照**；回滚只能用**带外备份** |
| 插件 | Registry 版本化；域重启生效 |
| connector | 服务端升级**不改变模型可见工具名**（C10） |
| 回滚 | 控制面/网关按版本；**内核"保留旧域"不构成回滚方案**——新域一旦以新格式写盘，旧域连同备份快照一并不可读（C39） |

**永久兼容面**

| 面 | 规定 | 依据 |
|---|---|---|
| **preset id** | **只增不删**；改名 = 新增 + 保留别名 | 缺失则**拒绝恢复**（C20） |
| **会话日志格式** | 只增不改；**且格式版本是硬边界** | C39 |
| `toolAllowlist` 工具名 | 已发布工具名不得静默改名 | 会话历史与审批规则依赖 |
| **preset 的三处持久痕迹** | ① `SessionHeader.agentPreset`（不可变）② `agent-preset/selected` 事件 ③ **`agentPreset` 会话投影**（重建读投影，**不单读 header**） | `-agent-preset-registry` |

| 规定 | 内容 |
|---|---|
| **preset 不可变** | **会话创建后 preset 不可变**；域内禁用 `select` / `recompose`（或限定创建窗口内且新 preset 的工具面是原集合**子集**）——否则换 preset 即绕过工具面强制 |
| 平台级不变量 | 任何域都必须能解析**全平台历史会话引用过的全部 preset id**；否则该域**不得作为迁移目标** |
| 删除前扫描 | 域外维护 preset id / 工具名使用统计 |
| **契约门禁** | **无发行版契约测试套件（C41）** ⇒ 自建套件 + **内核 `.d.ts` 在 pin 版本处的 API 快照 diff**；diff 非空即升级门禁失败 |

### 10.3 容量模型

| 维度 | 估算输入 |
|---|---|
| 域数 | 活跃隔离组数 × 峰值系数 |
| 域资源 | 单域 CPU / 内存 / 磁盘 + **Windows ACL 传播冷启动成本** |
| 存储 | 会话日志增长率 × 保留期 + workspace 总量 |
| 网关吞吐 | 模型调用 QPS + 事件流并发连接 |
| 数据面吞吐 | 模型 + 工具 + MCP 调用总 QPS；**MCP SSE 长连接数与托管 stdio 进程数** |
| **审计上传吞吐** | 由 `uploadInterval` 决定，吞吐 ≈ 域数 ÷ `uploadInterval`。**`uploadInterval` 的取值以 §7.6 为唯一来源**，且必须与 §9.1 的"跨节点 RPO P99 ≤ 30 s"同源（两者是同一个量，不得各写一套）。示例：D=1000 域、`uploadInterval`=30 s ⇒ **≈33 req/s 基线**（多为空转）。**必须计入，v2.5 漏了** |
| **域内缓冲** | 按**时间**容量（≥24h @ P99 速率）折算的内存/磁盘 |
| 元数据库 | 会话索引（自建）、审计、插件、connector、skill |

### 10.4 域三态与成本模型

| 态 | 定义 | 资源 | 成本 |
|---|---|---|---|
| **热** | 常驻，connector 已连 | 全量 | — |
| **温** | 容器暂停 | 磁盘 + 少量内存 | 秒级 |
| **零** | 仅快照 | 对象存储 | 冷启 T |

**成本正确性（v2.6 修正：v2.5 漏掉主成本项）**

> v2.5 的公式以内存为主，而企业 Agent 平台的 COGS 通常由**推理 token 主导**——用次要成本项锚定主成本项，必然出现"越活跃的客户毛利越低"。

```
C_tenant ≈ 固定摊分(控制面 + 数据面 + 网关 + 池预热)
         + Σ_token(输入 / 输出 / 缓存命中 × 单价)        ← ★ 主成本项
         + MCP 托管(进程数 + 长连接数)
         + 存储 + 出网流量
         + Windows 域溢价(ACL 传播)
         + 支持成本
```

| 规定 | 内容 |
|---|---|
| **报价前置** | **"成本可核算"从 P4 提前到 P2 出口条件**——报价能力必须先于签约能力 |
| 出口判据 | P2 完成时，**≥3 个典型客户画像必须能算出毛利率** |
| 单位经济矩阵 | 4 画像（重度编码 / 轻度问答 / MCP 密集 / 个人档）× 3 档用量 → 毛利率曲线；识别"微利客户画像"并做成产品限制（MCP 密集可单独 SKU） |
| 保守壳 | 实测回填前可按"上分位假设 + 成本加成 + 毛利护栏"报价 |
| 定价结构 | 平台费 + 用量包 + 并发/域阶梯 + 存储 + Windows/合规档溢价 + 最低月消费 + 年度折扣。**不做纯 seat 定价**（会话共享，席位与成本脱钩） |
| **温/零态前置条件** | 冻结前必须 **flush + 排空缓冲 + 写 suspend 标记**；快照**必须含投影缓存与未上传缓冲**，否则恢复后用量的**永久丢失** |
| 决策 | 默认一租户一域；闲置→温；长期闲置→零 |

---

## 11. 依赖与版本策略

### 11.1 可依赖的稳定 seam

| seam | 包 | 契约摘要 | 用法 |
|---|---|---|---|
| `ctx.llm` | `dsh-llm` | `registerAdapter`；只有 `stream` 是 abstract；`attributionHeaders()` 是模块级函数 | 反转 |
| `ctx.tools` | `dsh-tools` | **`register` 是唯一入口、无 pre-register 钩子**（C49）；运行期只有 `restrict` / `guard`；`pre-execute` 不可改写参数 | **反转（入口拦截）** |
| `ctx.approval` | `dsh-user-approval` | 载荷不含参数**且不含 session**；**无超时**；仅一次性授权 | 反转 |
| 持久化 | `-session-persistence(-jsonl)` | **无具名导出**（C41）；`session.lock` **无过期**（C23）；无删除/保留 | 替换实现 |
| `ctx.sandbox` | `-sandbox(-local/-policy)` | 三模式；**`setSandboxMode` 只是 append 事件**（C37）；只有一个可写根 | 原生 + **单一预设覆盖** |
| MCP | `-mcp-client` | 两种传输；**自动重同步无白名单**（C35）；**重连耗尽约 151.5s 后永久注销**（C42） | 原生 + **注册桥管治** |
| 权限预设 | `-permission-presets` | 默认表含 `danger-full-access`+`never`（C38）；是 Remote 服务 | **收敛为单一预设** |
| 检查点 | `-session-checkpoint-policy` | **嵌套派发复用外层调用**（C43） | 默认挂载 |
| 不变量 | `-invariants` | 需显式挂载（C25） | 显式挂载 |
| 会话查询 | `-session-query(-sqlite)` | **无调用方授权**；FTS 跨重启保留 | **域内不挂载**（§5.1） |
| 会话 | `dsh-session` | **`version` 是字面量精确校验**（C39） | 冻结格式版本 |
| 启动/组合 | `-app-boot` / `-scope` / `-plugin-manager` | **peer 精确 pin + 不匹配静默 disabled**（C33/C34）；plugin-manager 服务行默认启用（C36） | **行移除 + 就绪判据** |
| preset | `-agent-preset(-registry)` | 三处持久痕迹；**不是安全沙箱** | 装配 |
| 子代理 | `-subagent` / `-tool-subagent` | **审批钉死 `never`**（C48） | 需显式处置 |
| 工具 | `-tool-web` | **公网抓取不请求审批**（C47） | **域内不挂载** |
| 环境 | `dsh-subprocess` | 清洗是**名称启发式**（C46） | **白名单构造** |

**版本策略**：**整列车单值**；契约 API 快照 diff；按域批次灰度；**禁止混版**。

### 11.2 实验能力处理

| 包 | 处理 |
|---|---|
| `dsh-experimental-agent-team*` | 不作核心依赖；需多智能体时自建等价层 |
| `dsh-experimental-auto-review` / `-schedule-bundle` / `-ptc-runtime-python` / `-voice-input-bundle` | 经适配层引入 |

**规则**：含 `dsh-experimental-` 即不稳定契约，必须适配层隔离。**不得进入平台锁定层。**
**注意**：`writeScopes` 只存在于实验包且**无强制语义**（C50）——本方案不得引用它。

### 11.3 沙箱平台档

| 平台 | 后端 | enforcement | 使用方式 |
|---|---|---|---|
| Linux | `bwrap` → Landlock | `full` | 中层边界 |
| macOS | Seatbelt | `full` | 中层边界 |
| **Windows** | ACL 受限令牌 | `partial` | **P0 门禁：容器内 ACL 行为实测未通过前，禁止用于多租户隔离** |

### 11.4 适配层 TCO 与契约测试

**反转面清单（4 个，硬上限）**

| # | 面 | 维护成本来源 |
|---|---|---|
| 1 | `LlmAdapter` | 新增 provider 语义、重试策略、计费接口 |
| 2 | 工具注册桥 | 工具 schema 与审批语义变化 |
| 3 | `ctx.approval` 应答者 | 审批状态词汇与轮次约束变化 |
| 4 | `SessionPersistence` 提供方 | **格式与语义双重承载**：flush 屏障 / closer 合成 / 写所有权 |

| 规定 | 内容 |
|---|---|
| 上限 | **反转面 ≤ 4**；新增须架构审批 |
| **契约基线（新增）** | **无发行版契约测试套件（C41）** ⇒ ① 平台自建套件，覆盖：撕裂尾、单写者、closed handle、freshness、**format 拒绝方向**、flush 即物化空会话；② **内核 `.d.ts` 在 pin 版本处的 API 快照 diff**——diff 非空即门禁失败（这比"跑契约测试"更能捕捉**语义变更**） |
| 升级门禁 | 内核升级必须**先过契约测试 + 快照 diff** 再进灰度 |
| 弃用流程 | 内核弃用某语义时，先在适配层加兼容垫片 |
| 监控 | 适配层错误率独立监控 |

#### 11.4.1 P1 分层（新增，修正 v2.5 的 3–5 倍低估）

| 层 | 范围 | 工期 |
|---|---|---|
| **L1** | **单域内、Linux-only、`compression: none`、无世代迁移**（启动即断言"仅支持当前 format"）、本地卷 + 异步复制、复用已有锁原语 | **4–8 周** |
| **L2** | 世代迁移与历史格式、Windows、对象存储直读 | 后续 |

**必须补写的两条事实**：
1. **`SessionPersistence` 提供方无具名导出**（C41）——参考实现**在树内不可引用**，只能按类型声明重写
2. **`node-addon-system` 预编译平台不含 Windows**；跨平台锁的 Windows 路径走 koffi 加载 kernel32 命名信号量 ⇒ 镜像缺该依赖则**写所有权直接拒绝**

**provider 替换规矩**：Profile 显式 `disabled: true` base 的 jsonl 行；provider **仅 boot 期一次性挂载**；**域内禁用 HMR**；"provider 不可热替换"列为平台硬约束。

---

## 12. 实施阶段

| 阶段 | 交付物 | 验收 |
|---|---|---|
| **P-1 DevEx（新增，2–3 周）** | 本地最小拓扑（单域 + 反向网关桩 + 内存 attest）、5 分钟起的 compose 与种子 Profile、**开发态 `toolAllowlist` 逃生门**（生产态必填且拒绝 `*`）、测试夹具与故障注入器 | 开发者无需完整控制面即可跑通一个轮次；**"E1 强制可验证"在本地可重复执行** |
| **P0** | 反向网关接管 `ctx.llm`（含 resolve-model/prepare-call）/ `ctx.approval`；**工具注册桥（入口拦截）**；**行移除 plugin-manager/hmr**；**单一预设 + 升权上限**；凭证代理 + MCP 出站代理（含 stdio 托管）；**域外制品校验**；`dsh-invariants` 显式挂载；**域就绪判据**；**域令牌绑定租户**；**审批参数通道**；轮次三层截止时间 | **E1 强制可验证**：域内工具集 == `toolAllowlist`，**含负向用例**（受控恶意 MCP 推送新工具 → 永不进入可见集）；域内无长期凭证；四个 LLM 端点 fail-closed；**Windows 容器内 ACL 实测通过** |
| **P1** | **`SessionPersistence` L1**（单域/Linux/无世代迁移/fencing 租约）；日志与 workspace 外置；恢复（追加 closer）；**副作用台账**；**软事件分缓冲 + 幂等扣减 + 真源 = 日志+水位 + 对账**；不可恢复清单的用户可见说明 | **E2** 进程被杀后可在另一实例续跑；**对账差异率 ≤ 0.01%（分方向）**；**审计故障 6h 不阻断执行** |
| **P2** | 隔离域池（三态）；一 (租户, 隔离组) 一容器；域内 workspace 分区 + **workspace 独占租约**；只读共享工作区；**运行期漂移检测（detective）**；网络策略；预热预算；**成本可核算** | **E3 隔离**：跨租户互不可见；**≥3 个客户画像可算毛利率**（G7） |
| **P3** | 身份/RBAC/配额（含**公平调度**）/审计落库（**最小审计集硬 + WORM 哈希链**）/成本归因；三个 Registry/Catalog；Session Router（**迁移状态机** + 自建索引）；**保留与删除服务（含删除证明）**；历史查询服务；**合规取证导出**；**DSR 端到端**；SSO/SCIM；**降级阶梯与故障域矩阵落地**；对外 OpenAPI 与 SDK | **E4 治理**：G5 达标；**取证包可导出且可验证**；**DSR 可出具删除报告** |
| **P4** | 实验能力适配层；`SessionPersistence` L2（世代迁移/Windows/对象存储直读）；内核升级流程与门禁；**成本与 SLO 实测回填** | **E5** 内核升级仅重测 4 个反转面；单租户月成本可核算 |

**依赖与排期（v2.6 修正）**：
- **P0 → P1 → P2 → P3 严格串行**是 v2.5 的写法，导致首个可售形态落在 P3 之后（≈7–12 个月）且**中间无任何可交付中间态**。
- **改为双轨**：轨 A = 强制面（P0）；轨 B = 持久化与恢复（P1，可在单域本地先跑，**不需要完整控制面**）。汇合于 P2。
- **MVP 排序原则**：**"能报价"必须早于"能多租户放量"**。
- **可砍项（首批客户 MVP）**：跨实例迁移 + 分布式锁 + fencing ⇒ 换"**同域单实例恢复 + 迁移禁用 + 月度维护窗口**"；域外 attest 降为部署时校验；Registry/Catalog 降为"配置即代码 + 人工发布"；温/零态只做热态 + 冷启动等待页。

**演练门禁（新增，P1 起生效）**：**演练未通过不得进灰度**。最小演练集：
1. `kill -9` 后跨实例续跑 + **副作用台账核对**
2. 迁移在 handoff / release / commit **各注入一次失败**，验证可幂等重驱动与"无写者"时长
3. MCP 重连耗尽 → 自动重载 → 工具恢复
4. 反向网关 5 min 与 30 min 不可用，验证 L3、**令牌恢复风暴**、错误预算消耗
5. 审计服务 6 h 故障，验证缓冲与**不阻断执行**
6. 单节点 / 单 AZ 故障，验证 RPO 与恢复时长

---

## 13. 附录

### 13.1 关键约束速查

| 约束 | 出处 |
|---|---|
| 审批请求必须在未结束轮次内；载荷**不含工具参数与 session**；**仅一次性授权**；**无超时** | `-user-approval` |
| 无最终应答者 → `unavailable` 且 fail-closed | `-user-approval` |
| 团队能力由实验包提供，不承诺稳定性 | `-experimental-agent-team(-profile)` |
| 沙箱只管辖文件写；不表达网络/进程/系统调用/设备/凭据 | `dsh-sandbox` |
| **沙箱只限制写与删；读、网络、进程可见性不受限（含另一工作区）** | `-sandbox-windows-acl` |
| 容器/microVM/远程执行需替换执行能力 | `dsh-sandbox` |
| 沙箱策略**只有一个可写根** | `-sandbox-policy` |
| 沙箱模式由**会话事件**决定；不变式只校验词表 | `-sandbox-policy` |
| `dsh-base` 部署默认 `workspace-write`；包级 failsafe `read-only` | `-base` / `-sandbox-policy` |
| Windows：ACE/Low 标签驻留；**临时授权与标签可由模块撤销**；**Low 标签加宽目录树，同用户其他 Low-IL 进程可写删**；硬链接别名可写；**永久改写客户目录 DACL**；ACL 传播数十秒 | `-sandbox-windows-acl` |
| **preset 不是安全沙箱**；覆盖整体替换；**id 缺失则拒绝恢复**；三处持久痕迹 | `-agent-preset-registry` |
| **peer 是无范围精确 pin；不匹配的行静默 `disabled`，域照常启动** | `-app-boot` |
| scoped 注册不是沙箱或权限边界 | `dsh-scope` |
| **plugin-manager 服务行在 profile 下默认启用；hmr 默认开**；安装的 Host 代码在沙箱外执行 | `-base/cordis.patch.yml`、`-plugin-manager` |
| **`ctx.tools.register` 是唯一入口、无 pre-register 钩子** | `dsh-tools` |
| 工具定义 `timeoutMs` 仅声明；**timeout-policy 是协作式** | `-tools`、`-tool-call-timeout-policy` |
| 提交点是 **flush**；检查点在模型请求前 / 顶层工具副作用前 / `agent/pre-step` | `-session-persistence(-checkpoint-policy)` |
| **嵌套派发复用外层持久调用** | `-session-checkpoint-policy` |
| 崩溃恢复是**追加合成 closer**；**没有继续中断轮次的部分轮次恢复** | `-session-persistence(-jsonl)` |
| persistence **无具名导出**；**无发行版契约测试套件** | `-session-persistence(-jsonl)` |
| **`session.lock` 故意无过期** | `-session-persistence-jsonl` |
| persistence **无删除/保留接口**；`list()` 无分页无过滤无索引 | `-session-persistence(-jsonl)` |
| **`SessionHeader.version` 字面量精确校验；旧版本读不了新格式** | `dsh-session` |
| `ctx.sessionQuery` **无调用方授权**；FTS 跨重启保留 | `-session-query(-sqlite)` |
| `ctx.invariants` 需显式挂载；`dsh-base` 刻意省略 | `-invariants` / `-base` |
| MCP 仅 `stdio` 与 `streamable-http` | `-mcp-client` |
| MCP 工具名是纯函数；**独立 Agent 作用域可复用 serverName** | `-mcp-client` |
| MCP 有**四类注入通道** | `-mcp-client` / `-mcp-resources` |
| MCP stdio 的 `env` 合并到已清洗环境；凭证只能经此进入 | `-mcp-client` |
| **MCP 自动重同步工具，注册路径无白名单** | `-mcp-client` |
| **MCP 重连耗尽约 151.5s 后永久注销工具** | `-mcp-client` |
| MCP 启动超时继承 SDK 60s；`apply` 等待初始连接；MCP 行属 optional | `-mcp-client` / `-app-boot` |
| **权限预设默认表含 `danger-full-access`+`never`，且是 Remote 服务** | `-permission-presets` |
| **`workspaceRegistry` 对模型完全不可见；移除不删数据** | `dsh-workspace` |
| **`writeScopes` 只存在于实验包且无强制语义** | `-experimental-agent-team` |
| **子进程环境清洗是名称启发式** | `dsh-subprocess` |
| **`web_fetch` 不请求审批，所有预设下可见** | `-tool-web` |
| **委派子代理时审批钉死为 `never`** | `-subagent` |
| **`<DSH_HOME>` 有旁路数据：attachments（去重、从不自动删、无删除 API）、spill（30 天、仅启动扫描、无删除 API）** | `-attachment-local` / `-spill-local` |

### 13.2 缩略语

| 缩略 | 全称 |
|---|---|
| DSR | Data Subject Request |
| JWT | JSON Web Token |
| MCP | Model Context Protocol |
| mTLS | Mutual TLS |
| OIDC | OpenID Connect |
| RBAC | Role-Based Access Control |
| RPO / RTO | Recovery Point / Time Objective |
| SLO | Service Level Objective |
| SSE | Server-Sent Events |
| TCB | Trusted Computing Base |
| TCO | Total Cost of Ownership |
| WORM | Write Once Read Many |

---

## 14. 未覆盖的设计域与补齐计划

| # | 设计域 | 现状 | 计划 |
|---|---|---|---|
| 1 | **测试策略与恢复演练** | §12 有最小演练集 | **优先级最高**：每个可靠性机制都是"过程"而非组件，P1 又是新写的持久化实现 |
| 2 | 容量压测 | §10.4 有模型，无实测 | 压测回填 `M_domain`、`N_node`、域启动耗时、§9.1 全部 SLO。**是报价与容量承诺的共同输入** |
| 3 | DevEx / 本地复现 | 已提升为 **P-1**（§12） | 保留为开工第一阻塞项 |
| 4 | 误删恢复 | 未覆盖 | 墓碑 + 宽限期（7 天）+ 恢复流程；与 §7.5 联动 |
| 5 | 合规取证导出 | 已列 P3（§12） | 取证导出 + 链式保全 + 留存证明 |
| 6 | DSR 端到端 | 已列 P3（§12） | 受理 → 定位（依赖自建索引）→ 删除 → 证明 |
| 7 | **多租户侧信道** | 未覆盖 | CPU / 缓存 / 时间侧信道评估；必要时 cpuset、cache partitioning |
| 8 | ~~`ctx.tools.restrict()` 在宿主上下文是否收紧全部 agent~~ | **已定论** | ✅ 见 `docs/bridge-defense-in-depth.md`：`restrict()` 在全局上下文**抛错**，且**不覆盖 scoped 注册**；纵深防御改用**全局 `guard()`**（可在全局注册、单调只否、按最终工具名在派发期判定）。**派生新 P0 项 `VER-002` 已定论（成立）**：全局 `guard()` **覆盖** PTC `run_code` 内调用、子代理与嵌套派发（内核全执行路径汇入同一 `prepareExecution` → guard 派发期求值、全局层先查；内核 `file:line` 实证 + 运行时实测 5/5，见该文档 §6）；`SEC-029`/`ENG-004` 被证实、无需收窄 |
| 9 | **Windows 容器内 ACL 行为实测** | 已提升为 **P0 出口门禁** | 未通过则禁止 Windows 参与多租户隔离；若与契约结论不同，§8.4/§10.1/§11.3 整体改写 |
| 10 | **温/零态切换的稳定性** | §10.4 定义了态，未验证 | 实测暂停对 PTY、定时器、**flock 描述符**、Node 事件循环的影响 |
| 11 | **`M_domain` 实测** | 依赖估算 | 实测单域内存下限与缓冲水位关系 |
| 12 | **供应链完整性** | §5.3.1 有"哈希 + 签名" | 密钥与发布流程未展开：签名密钥保护（HSM）、发布审计、撤销流程 |
| 13 | **产品壳自身的认证/授权实现** | 只在契约层声明 | 域外壳的实现评审 |
