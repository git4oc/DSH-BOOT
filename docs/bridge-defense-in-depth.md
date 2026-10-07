# 桥的纵深防御结论（P0 第一优先级验证项）

| 项 | 值 |
|---|---|
| 文档编号 | `VER-001`（§1–§5）+ `VER-002`（§6）+ `GATE-002` 条件 2 内核侧定论（§7） |
| 上游依据 | 设计文档 v2.6 §4.5.1 / §14-8；`SPEC-03` `ENG-001`、`ENG-004`；`SPEC-01` `SEC-029` |
| 对应门禁 | `GATE-002` 条件 2 / 8（`SPEC-00` v1.2） |
| 对应需求 | `ENG-001`、`ENG-004`、`SEC-029`、`REL-*`（无直接依赖） |
| 验证对象 | `ctx.tools.restrict()` 与 `ctx.tools.guard()` 的**作用域语义**（§1–§5）；全局 `guard()` 的**执行路径覆盖**（§6）；注册路径**单一漏斗**（§7） |
| 方法 | **目标版本列车源码判读**（`dsh-tools` 0.2.0-rc.2 发行包实现与类型声明）+ 可复现运行时实测（§6.2） |
| 结论 | **`restrict()` 不可用于全局；`guard()` 是唯一可用的全局纵深防御**（§2）；全局 `guard()` **覆盖** PTC `run_code` 内调用、子代理、嵌套派发（§6）；注册路径单一漏斗**成立**（§7） |
| 状态 | **已定论**（原"待实测"占位符作废；`SEC-029`/`ENG-004` 被证实、未被推翻） |

---

## 1. 问题

设计文档 §4.5.1 拦截点 6 把 `ctx.tools.restrict({ allow: toolAllowlist })` 列为**纵深防御**，`SPEC-03` `ENG-004` 要求"桥装载完成后必须调用一次 `restrict({ allow: toolAllowlist })`"。

需要回答：**`restrict()` 能否在宿主（全局）上下文调用？它的作用域是什么？**

---

## 2. 结论（逐条带证据）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **`restrict()` 在非 scoped 上下文直接抛错** | `dsh-tools/lib/index.js:2896-2897`：<br>`const scope = scopeOf(this.ctx);`<br>`if (scope === void 0) throw new Error("tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead");` |
| 2 | `restrict()` 只作用于**调用它的 agent scope** | `index.js:2889`（"Restrict global tools for the calling agent scope"）；`:2909` `this.layers.effect(this.ctx, …)` |
| 3 | `restrict()` **不覆盖 scoped 注册** | `index.d.ts:505-506`："Restrictions intersect and **do not affect scoped registrations** or the reserved PTC mode transport"；`index.js:2891`："Restrictions intersect; **scoped registrations remain visible**" |
| 4 | `restrict()` 只能命名**全局**工具 | `index.d.ts:509-512`（"**Global** tool names that stay visible / removed"）；`index.js:2906` 的 `restrictableNames` 取自全局层（`:2972`） |
| 5 | 空 filter 抛错 | `index.js:2900`："`tools.restrict({})` is a no-op" |
| 6 | **未知工具名抛错**（fail-loud） | `index.js:2907-2908` |
| 7 | 不得命名 `run_code` | `index.js:2905` |
| 8 | **`guard()` 可以在普通（全局）上下文注册，并对全部 agent 生效** | `index.js:2913`："A plain-context guard **applies globally**; one registered through `agent.ctx` applies only to that agent" |
| 9 | `guard()` 是**单调只否**（无 allow），后注册者无法把拒绝翻回允许 | `index.d.ts:515-521`："Because guards have **no allow result**, listener ordering cannot turn a denial back into permission" |
| 10 | guard 在**派发时**求值，先全局层后 scope 链 | `index.js:2913-2916`、`:657`（"First monotonic denial from the **global** then the scope chain's guard layers, farthest first"） |
| 11 | `register()` 把工具插入**调用方 `ctx` 所在的层** | `index.js:2886` `this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), …)` |
| 12 | scoped 注册**遮蔽**全局注册 | `index.d.ts:524`："Scoped registrations shadow globals" |
| 13 | 可见性是**各层取交集** | `index.js:2973` `if (layers.every((layer) => layer.admits(name))) visible.set(name, definition)` |

---

## 3. 对设计的影响

### 3.1 `ENG-004` 原条款**不可执行**

原条款要求"桥装载完成后调用一次 `restrict({ allow: toolAllowlist })`"。按事实 1，**该调用在全局上下文会抛错**，域启动即失败。**该条款必须改写。**

### 3.2 `restrict()` 也不能作为纵深防御（即使改为 per-agent）

即使改为在每个 agent scope 上调用，按事实 3 **它不覆盖 scoped 注册**——而 scoped 注册恰恰是最可能的绕过路径。**它防不住它该防的东西。**

### 3.3 `guard()` 才是正确的全局纵深防御

按事实 8/9/10：全局 guard 在**派发时**对**最终解析出的工具**求值，因此：
- 与工具是全局注册还是 scoped 注册**无关** → **覆盖 `restrict()` 漏掉的路径**（事实 3 vs 12）
- 单调只否 → 后注册的监听器无法翻盘
- 可在普通上下文注册 → 桥可以在宿主上下文一次性安装

### 3.4 修正后的纵深防御链

| 层 | 机制 | 作用时机 | 覆盖 | 性质 |
|---|---|---|---|---|
| **主防线** | 桥在 `register()` 入口拦截 | 注册期 | **能到达桥的全部注册路径** | preventive |
| **纵深** | 桥在宿主上下文安装**全局 `guard()`**，对 `toolName ∉ toolAllowlist` 返回拒绝理由 | **派发期** | **全部工具，含 scoped 注册** | preventive（单调只否） |
| ~~弃用~~ | ~~`restrict({allow})`~~ | — | 不覆盖 scoped 注册；全局调用抛错 | **不作防线** |

> **关键性质**：主防线依赖"桥确实被所有注册路径使用"（`GATE-002` 条件 2 的未验证假设）；**纵深防线不依赖该假设**——它按最终工具名判定。因此**纵深防线可独立成立**，这消除了 `ENG-001`/`ENG-003` 的覆盖面风险。

### 3.5 但 guard 不能替代主防线

`guard()` 在**执行期**拒绝，属于 D10 所说的"运行期拦截"；它**不能**满足"能力不可达"（工具仍会出现在模型可见的工具表里，模型会尝试调用并收到拒绝）。因此：

- **可见性必须由主防线解决**（工具不可见）
- **guard 只用于兜住主防线的覆盖面缺口**（可见但调用必被拒）

---

## 4. 条款修订指令

| 文档 | 条目 | 处置 |
|---|---|---|
| 设计文档 §4.5.1 | 拦截点 6 | 由 `restrict` 改为**全局 `guard()`**；删除"`restrict` 不影响 scoped 注册，只能作纵深"的旧表述 |
| 设计文档 §14 #8 | 该项 | **标记为已定论**，指向本文 |
| `SPEC-00` `GATE-002` 条件 8 | "restrict 作用域已实测" | 改为"已定论（见 `VER-001`）；纵深防御为**全局 `guard()`**" |
| `SPEC-03` `ENG-004` | 要求调用 `restrict` | **改写**：必须安装全局 `guard()`；**不得**在全局上下文调用 `restrict`（会抛错） |
| `SPEC-03` `ENG-001` | 验收判据 ③ "restrict 结论已实测并写入" | 指向 `VER-001`；改为"`guard` 已安装" |
| `SPEC-01` `SEC-029` | "restrict 实测语义定稿前…" | 改为已定论；硬保证**不得**依赖 `restrict` |
| `SPEC-02` §7 第 11 项 | "restrict 作用域结论待定" | 标记已定论 |
| `SPEC-03` `D-2` 交付物 | `docs/bridge-defense-in-depth.md` | **已产出**（本文） |

---

## 5. 未验证的残余

| # | 项 | 影响 | 处置 |
|---|---|---|---|
| 1 | 桥提供的 `ctx.tools` 是否真的被 **MCP 行与全部注册路径**使用 | 主防线覆盖面 | **内核侧已定论（成立，见 §7）**：内核无第二条注册路径；MCP 行唯一注册调用即 `ctx.tools.register`。组合层事实（桥代理确实挂为域内 `tools` 服务）仍由 `E-04`/`E-05` 在 `GATE-002` 出口随域构建实测 |
| 2 | 内核未来是否新增第二条注册路径 | 主防线 | `SPEC-00` 前提监控项 `P-1`，每次升级按 `GATE-006` 复核 |
| 3 | `guard()` 是否在所有执行路径上求值（含 PTC / 子代理 / 嵌套派发） | 纵深覆盖 | **已定论（成立，见 §6，`VER-002`）** |

---

## 6. `VER-002` 定论：全局 `guard()` 的执行路径覆盖（P0）

| 项 | 值 |
|---|---|
| 验证项 | `VER-002`（本文件 §6 派生，`SPEC-00` §11.2 `G-5`） |
| 状态 | **已定论：成立**（原"未验证"作废） |
| 判读对象 | `@deepseek-ai/dsh-tools` **0.2.0-rc.2** / `dsh-agent-loop` 0.2.0-rc.2 / `cordis`（内核包 `file:line` 实证）+ **可复现运行时实测**（5/5 通过，含 2 个移除式对照组） |
| 结论 | 全局 `guard()` **覆盖** PTC `run_code` 内的工具调用、子代理的工具调用、嵌套派发；`SEC-029` / `ENG-004` **被证实、未被推翻**，无需按 `SPEC-00` §8 收窄 |

### 6.1 逐条证据（内核 `file:line`）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **所有工具执行汇入同一个 prepare 阶段**；`[TOOL_RUNTIME_SCHEDULER]` 的 `prepare` 直接指向 `prepareScheduledExecution` → `prepareExecution` | `dsh-tools/lib/index.js:2674-2679`：`[TOOL_RUNTIME_SCHEDULER] = { prepare: (exec) => this.prepareScheduledExecution(exec), dispatch: (exec) => this.dispatchScheduledExecution(exec), … }`（"Internal staged view consumed by `dsh-agent-loop`'s parallel scheduler"）；`:3211-3213` → `:3214` |
| 2 | **guard 求值在 `prepareExecution` 内无条件执行**，先于任何 dispatch | `index.js:3241`：`const denialReason = decision.kind === "allow" ? this.guardReason(exec) : decision.reason;`；拒绝即返回 `post-result` 错误结果（`:3243-3257`），不进入 dispatch |
| 3 | `execute()`（非 scheduler 路径）同样汇入 `prepareExecution` | `index.js:3116-3117`：`async execute(exec) { return this.prepareExecution(exec, (prepared) => this.completeScheduledExecution(prepared)); }` |
| 4 | **guardReason 先查全局层，再查 agent scope 链**——普通（宿主）上下文安装的 guard 对**每一次执行**生效，与 agent / scope / 派发深度无关 | `index.js:2927-2936`（"First monotonic denial from the global then the scope chain's guard layers, farthest first"）；`:2913`（"A plain-context guard applies globally"）；`:2646-2651`（单层内逐个 guard） |
| 5 | **PTC `run_code` 内的工具调用走同一 prepare**：binding 构造带 `agent` 与 `parent` 令牌的 input，压入队列后经 `scheduler.prepare(input)` 执行 | `index.js:1293`（binding）；`:1305-1306`（`…exec.agent ? { agent: exec.agent }…`、`parent: exec.token`）；`:1309`（`const scheduler = registry[TOOL_RUNTIME_SCHEDULER]`）；`:1361`（`scheduler.prepare(input)`） |
| 6 | **嵌套派发不绕过 guard**：`dispatch` 只接收经 prepare 判定为 `"dispatch"` 的执行；两条调用路径都先 prepare 后 dispatch | `index.js:1362-1363`（run_code：`if (prepared.kind === "dispatch") … scheduler.dispatch`）；`dsh-agent-loop/lib/index.js:582-586`（模型直连同序）；`index.js:3334-3335` 不变式："dispatch only receives executions minted by this registry's prepare stage"（未过 prepare 直接抛 `unprepared execution`） |
| 7 | **嵌套 `run_code` 不可能**：`run_code` 不进程序绑定、不可注册/遮蔽 | `index.js:1403`（`if (schema.name === "run_code") continue;`）；`:2885`（"reserved … cannot be registered or shadowed"） |
| 8 | **子代理与宿主共用同一 Registry 与同一条 agent-loop 派发路径**；agent 对象本身就是 scope key | `dsh-agent-loop/lib/index.js:582`（唯一派发点）；`:778`（`this.scope = createScope(loopCtx, this)`）；`dsh-scope/lib/index.js:296-306`（createScope） |
| 9 | **scoped 注册（`VER-001` 事实 3 指出的 `restrict` 盲区）也被 guard 覆盖**：子层注册的工具在派发期同样过全局 guard | `dsh-subagent-in-process-driver/lib/index.js:55`（子层注册模式）；本文件 §6.2 实测 T3a/T3b |
| 10 | **附加事实（不推翻规格）**：ptc 模式下模型直连非 `run_code` 调用在 guard **之前**即被 PTC collapse 拒绝（fail-closed 方向，非覆盖缺口）；该拒绝在模型可见层面表现为 `UNKNOWN_TOOL` 类错误 | `index.js:3141`（`collapsed` 判定）、`:3176-3186`（返回 `ToolNotFoundError("only run_code is callable directly…")`）、`:3099-3100`（`collapses`）；关联 `VER-003`（P1，保持开放） |

### 6.2 可复现运行时实测（5/5 通过）

环境：与本仓对应的内核发行包（`@deepseek-ai/dsh-tools` 0.2.0-rc.2）+ `cordis` + `dsh-scope`。用同进程 mock `ptcRuntime`（同步 `resolve`，与 `NodePtcRuntime.resolve` 同签名；`sandboxMode` 缺省故不触发沙箱解析，`index.js:1190`）承载 `run_code` 程序——被验证对象是 **dsh-tools 派发链本身**，与沙箱无关。最小装配：cordis Context + `systemPrompt` stub + `ptcRuntime` mock + `ToolRuntime({ mode: "ptc" })`；注册全局工具 `echo`；在宿主上下文安装 `tools.guard`（对白名单外工具名返回拒绝理由，即桥的纵深防线等价物）。

| 用例 | 构造 | 断言 | 结果 |
|---|---|---|---|
| T1 | 全局 guard 安装，`run_code` 程序内调用 `tools.echo(...)` | `isError === true` 且错误含 guard 原因 | **PASS**：`code run failed (program-error): GUARD-DENY: echo is not in toolAllowlist` |
| T2（对照） | **移除** guard 后重跑同一程序 | 子派发执行、无拒绝 | **PASS**（`isError === false`——拒绝确实来自 guard） |
| T3a | 子代理替身（对象即 scope key，`dsh-agent-loop:778` 模式）：经 `createScope` 派生子层**注册** `child_tool`，`run_code` 程序（`agent` = 子代理）内调用 | 全局 guard 拒绝 | **PASS**：`GUARD-DENY: child_tool is not in toolAllowlist` |
| T3b（对照） | **移除** guard 后重跑 | 子代理的 scoped 工具执行 | **PASS**（`isError === false`） |
| T4（记录性） | ptc 模式下模型**直连**非 `run_code` 工具 | 被 PTC collapse 拒绝（非 guard 路径） | **PASS**：`unknown tool "echo": only run_code is callable directly…` |

> 证据规范对齐 `SEC-DOC-03` §3：`verdict` 只取 `pass`/`fail`，`input`/`observation` 如上。实测脚本全文与输出随 `GATE-002` 条件 2 的域外实测报告一并归档（`evidence/GATE-002/...`）。

### 6.3 对设计的影响

- `SEC-029` / `ENG-004` 的纵深防线（全局 `guard()`）**被证实可用**：一条在宿主上下文安装的单调只否 guard 即覆盖主防线的全部覆盖面缺口（scoped 注册、PTC 子派发、子代理、嵌套派发）。**无需**按 `SPEC-00` §8 收窄 `ENG-004` 兜底范围，`SEC-029` 无需声明残余。
- `ENG-004` 验收判据②③（移除式双向对照）与 `SEC-029` 判据②③的**可执行性已被本实测演示**（T3a/T3b 即该用例的最小形态）；P0 出口仍须按 `SEC-DOC-03` §3 用域内桥与真实 Profile 复跑并归档。
- `ENG-001` 判据③（"`guard` 已安装"启动断言）的内核前提成立：`guard()` 可在宿主上下文一次性安装（`index.js:2921-2926`）。

---

## 7. `GATE-002` 条件 2 的内核侧定论：注册路径单一漏斗（ENG）

| 项 | 值 |
|---|---|
| 验证项 | `GATE-002` 条件 2 的内核侧前提（`README` §6 台账第 2 行；`CTR-001` §8 第 2 项） |
| 状态 | **内核侧已定论：成立**。组合层事实（桥代理确实挂为域内 `tools` 服务）仍由 `E-04`/`E-05` 在 `GATE-002` 出口随域构建实测 |
| 判读对象 | `dsh-tools` / `dsh-mcp-client` / `cordis` 0.2.0-rc.2 + 全内核包注册调用点检索 |

### 7.1 逐条证据（内核 `file:line` + 可复现检索）

| # | 事实 | 证据 |
|---|---|---|
| 1 | `ctx.tools` 经 cordis DI 以**服务名 `"tools"`** 解析：内核全部包（含 MCP 行）只能经该名取到**同一个**服务实例 | `dsh-tools/lib/index.js:2703-2704`（构造 `super(ctx, "tools")`）；`cordis/lib/index.js:1770-1772`（Service 构造）、`:1763`（`ctx.reflect.provide(name, this, …)`）、`:1648`（"A context is a proxy: normal property reads go through the service resolver"） |
| 2 | **MCP 行的唯一注册调用就是 `ctx.tools.register`**，初次同步与 `list_changed` 重同步共用它 | `dsh-mcp-client/lib/index.js:763`（`const inject = ["tools"];`）；`:127-161`（`syncTools`："Sync the MCP server's tool list into the harness ToolRuntime … `@param ctx` - Cordis context providing the `tools` service for registration"）；`:153`（`disposers.set(publicName, ctx.tools.register(definition))`）；`:634-638`（"tool list changed, re-syncing" → 重跑 `syncTools`） |
| 3 | **全内核注册调用点全部解析 `ctx.tools`**（`ctx.tools.register` / `toolCtx.tools.register` / `childCtx.tools.register` / `scoped.tools.register`），共 74 处；无任何包直接 import `ToolRuntime` 类进行注册（仅类型与符号引用） | 可复现检索：`grep -rn "\.tools\.register\(" node_modules/@deepseek-ai/dsh` 与 `grep -rn "ToolRuntime" node_modules/@deepseek-ai/dsh`（命中仅 `dsh-tools` 自身、类型签名与注释） |
| 4 | **`register()` 是工具层唯一插入点**：`tools.insert` 在整个内核只出现在 `dsh-tools` 的 `register()` 内；`layers` 不导出 | `dsh-tools/lib/index.js:2886`（`this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), …)`）；全内核检索 `tools.insert` 仅命中 `dsh-tools` 自身及其类型镜像 |
| 5 | 内核自身把 `ToolRuntime.execute` 视为**被 guard 的唯一执行路径**，并据此封堵"直接调另一工具"的旁路 | `dsh-cordis-host-runner/lib/types/guard.js:574-577`（沙箱 `get` 只回 schema 视图，"letting it call another tool directly and bypass `ToolRuntime.execute` — identity protection, pre-policy, monotonic guards, …"） |

### 7.2 定论与残余

- **内核侧成立**：无论平台把什么实现挂为 `"tools"` 服务，MCP 行与全部注册路径**只能**经它注册——内核不存在第二条注册路径，也不存在绕过该服务的 import 旁路。桥只要（按 `ENG-001`）成为平台侧唯一注册入口、并（按 `CTR-001` §3.6）使 MCP 注册走同一判定入口，即覆盖全部路径。
- **组合层残余**："`tools` 服务在域内挂的是否确为桥代理"是装配事实（`SEC-DOC-03` 拦截点 1/2 的 Profile/pluginSet 决定），其**负向用例**（`E-04`：恶意 MCP 新增工具不进可见集；`E-05`：仅移除 guard 的对照）须在 P0 出口随域构建复跑归档——本结论不替代 `GATE-002` 条件 2 的出口实测，只闭合其内核侧前提。

---

## 8. 新增验证项（由本结论派生）

| ID | 内容 | 优先级 |
|---|---|---|
| ~~`VER-002`~~ | ~~全局 `guard()` 是否覆盖 PTC `run_code` 内的工具调用、子代理的工具调用、嵌套派发~~ | ~~P0~~ → **已定论（成立）**，见 §6 |
| `VER-003` | 全局 `guard()` 的拒绝是否在**模型可见层面**表现为 `UNKNOWN_TOOL` 还是普通工具错误（影响模型行为与用户体验） | P1 |

---

## 变更记录

| 版本 | 变更 |
|---|---|
| 1.1 | **`VER-002` 定论（成立）**：全局 `guard()` 覆盖 PTC `run_code` 内调用、子代理、嵌套派发（§6，内核 `file:line` + 运行时实测 5/5）；`GATE-002` 条件 2 内核侧定论（§7，单一漏斗成立）；`SEC-029`/`ENG-004` 被证实、无需收窄 |
| 1.0 | 定论：`restrict()` 全局调用抛错且不覆盖 scoped 注册；`guard()` 为唯一可用的全局纵深防御；给出修正后的防御链与条款修订指令 |
