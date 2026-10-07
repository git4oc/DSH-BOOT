# dsh-boot 开发 Playbook — 各阶段开工提示词

| 项 | 值 |
|---|---|
| 用途 | 逐个阶段开工用的**可复制提示词** |
| 上游依据 | [docs/ENGINEERING-HANDBOOK.md](docs/ENGINEERING-HANDBOOK.md) §1 权威顺序 / §4 门禁 / §6 缺口台账；[spec/03-实现与工程规格.md](spec/03-实现与工程规格.md) `ENG-058` 量级 |
| 使用方式 | **一个阶段 = 一个新会话**。工作目录固定 `D:\proJects\dsh-boot`。 |

---

## 0. 怎么用

1. **一个阶段开一个新会话**，工作目录设为 `D:\proJects\dsh-boot`
2. 复制该阶段的提示词，**原样使用**，不要删减（尤其纪律块）
3. 每个阶段收尾动作固定：**跑四个校验器 + 该阶段门禁有证据**
4. **门禁不过，不得进入下一阶段**——这是 `SPEC-00` §7 的硬规定

### 阶段总览

| # | 阶段 | 门禁 | 量级（`ENG-058`） | 提示词 |
|---|---|---|---|---|
| 0a | 两项 P0 实测 | — | 1–2 天 | [§1](#1-阶段-0a--两项-p0-实测) ✅ **已完成** |
| 0b | 仓库骨架 + 依赖门禁 | — | 基础设施 | [§2](#2-阶段-0b--仓库骨架--依赖门禁) ✅ **已完成** |
| P-1 | DevEx 与测试夹具 | **`GATE-001`** | 1.5–2.5 人月 | [§3](#3-p-1--devex-与测试夹具) ✅ **已完成** |
| P0-A1 | `ctx.llm` 反转 | — | 2–4 人月 | [§4](#4-p0-a1--ctxllm-反转) ✅ **已完成** |
| P0-A2 | 工具注册桥 + `guard` + 行移除 + 单一预设 | — | 2–3 人月 | [§5](#5-p0-a2--工具注册桥--guard--行移除--单一预设) ✅ **已完成** |
| P0-A3 | 审批应答者 + 参数通道 + 三层截止时间 | — | 2–3 人月 | [§6](#6-p0-a3--审批应答者--参数通道--三层截止时间) ✅ **已完成** |
| P0-A4 | 就绪判据 + 域令牌 + 版本列车 + Profile 校验 | — | 2–3 人月 | [§7](#7-p0-a4--就绪判据--域令牌--版本列车--profile-校验) ✅ **已完成** |
| P0-A5 | 契约测试套件 + `.d.ts` 快照 | — | 1–2 人月 | [§8](#8-p0-a5--契约测试套件--dts-快照) ✅ **已完成** |
| P0-A6 | Windows ACL 实测 + `GATE-002` 收口 | **`GATE-002`** | — | [§9](#9-p0-a6--windows-acl-实测--gate-002-收口) ✅ **已完成**（C9 容器 ACL 实测诚实 fail：Windows 禁入多租户隔离） |
| P1-B | SessionPersistence L1 + 恢复 + 台账 + 分缓冲 | **`GATE-003`** | 6–10 人月 | [§10](#10-p1-b--sessionpersistence-l1--恢复--台账--分缓冲) ✅ **已完成**（演练 3/6 如实 blocked） |
| P2 | 隔离域池 + workspace 租约 + 成本 | **`GATE-004`** | 6–10 人月 | [§11](#11-p2--隔离域池--workspace-租约--成本) ✅ **已完成** |
| P3-1 | 身份/RBAC + 配额/公平调度 + 计费 | — | P3 合计 | [§12](#12-p3-1--身份rbac--配额公平调度--计费) ✅ **已完成** |
| P3-2 | 四个 Registry / Catalog | — | **20–35 人月** | [§13](#13-p3-2--四个-registry--catalog) ✅ **已完成** |
| P3-3 | Session Router + 历史查询 + 保留删除/DSR + 取证 | — | 分 4 段推进 | [§14](#14-p3-3--session-router--历史查询--保留删除dsr--取证) ✅ **已完成** |
| P3-4 | 对外 OpenAPI/SDK + SSO/SCIM + 降级阶梯落地 | **`GATE-005`** | — | [§15](#15-p3-4--对外-openapisdk--ssoscim--降级阶梯落地) ✅ **已完成** |
| P4 | 演进与升级门禁 | **`GATE-006`** | 4–8 人月 | [§16](#16-p4--演进与升级门禁) ✅ **已完成**（PP 实测回填 blocked：缺目标机型压测环境，D13） |

**总量：46–79 人月**（`ENG-058`，高值口径）。**团队 6–10 人。**

### 通用纪律块（每个提示词都已内置，勿删）

```
纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

### 三个反复出现的坑

| 坑 | 后果 | 预防 |
|---|---|---|
| 一次读完全部 68 份文档 | 上下文被淹没 | README §3 按任务给最小必读集 |
| 给 `PP-01`…`PP-35` 编数字 | SLO/容量/报价全建立在意想上 | 待压测项必须标 `PP-xx`，不许填"看起来合理"的值 |
| 把乐观排期当承诺 | `ENG-058` 口径是 46–79 人月 | 每阶段结束回填 `docs/effort-actuals.md`（`D-12`） |

---

## 1. 阶段 0a — 两项 P0 实测

> **✅ 本阶段已完成（2026-10-07）**：两项结论均为**成立**——① `VER-002` 已定论：全局 `guard()` 覆盖 PTC `run_code` 内调用、子代理、嵌套派发；② `GATE-002` 条件 2 内核侧已定论：注册路径单一漏斗成立。证据见 [docs/bridge-defense-in-depth.md](docs/bridge-defense-in-depth.md) §6/§7（内核 `file:line` 实证 + 运行时实测 5/5）。`SEC-029`/`ENG-004` 被证实、未被推翻；`SPEC-00` 升 v1.2（§11.1 第 21/22 条）。以下提示词保留作追溯；**组合层残余**（桥代理挂为域内 `tools` 服务）由阶段 P0-A6 的 `E-04`/`E-05` 出口实测。

> **为什么排第一**：这两项结论**可能推翻已定稿的规格**。先做，成本 1–2 天；后做，可能推倒已写的桥代码。

```
工作目录：D:\proJects\dsh-boot

先读 README.md §1（权威顺序）与 §3（按任务入口）。

只做一件事：完成两项 P0 运行时实测，产出带证据的结论到 docs/。

实测项：
1) VER-002：全局 guard() 是否覆盖 PTC run_code 内的工具调用 / 子代理(subagent) /
   嵌套派发
2) GATE-002 条件 2：桥提供的 ctx.tools 代理是否确被 MCP 行与全部注册路径使用

动手前必读：
· docs/bridge-defense-in-depth.md（VER-001，已定论 restrict 不可用、guard 是唯一
  可用的全局纵深防御）
· docs/reversal-contracts.md §3（工具注册桥契约）
· docs/security/enforcement-chain.md 拦截点 1–3

要求：
· 结论必须带证据（内核包的 file:line，或可复现的实测步骤），不得只给判断
· 结论写进 docs/bridge-defense-in-depth.md 的 §6 或新建同目录文档，并把 VER-002
  从"未验证"改为"已定论"
· 若结论推翻 SEC-029 / ENG-004，先按 SPEC-00 §8 改规格（含 SPEC-00 §11.1 收口记录），
  再收工

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。

交付判定：两项结论明确（成立 / 不成立），各有证据，且规格已同步或已声明无需同步。
```

---

## 2. 阶段 0b — 仓库骨架 + 依赖门禁

> **✅ 本阶段已完成（2026-10-07）**：9 个包按 `ENG-020` 建成（`pnpm -r list --depth -1` 实测 == 清单）；`packages/protocol` 依赖零 `@dsh-boot/*` 与内核运行期包（判据②）；`tools/check-deps.mjs` 覆盖 `LAYER-001` §6 五项，**两条故意违规边实测均非零退出**（`apps/domain → packages/sdk`、`packages/protocol → packages/domain-bridge`，后者同时命中 R-1/R-2/R-3 三条断言）；CI 已接 `spec:deps` 与 `spec:id-format`（`.github/workflows/repo-gates.yml`）；`tsc --noEmit` 全绿。矩阵 §3 一处笔误（`apps/domain → sdk` ✅）已按 §4 `O-1` 更正为 ❌。

```
工作目录：D:\proJects\dsh-boot

先读 README.md §1、§3，然后读：
· spec/03-实现与工程规格.md 的 ENG-020、ENG-021、ENG-022、ENG-024、ENG-048
· docs/layer-dependency-matrix.md（LAYER-001，含 §3 白名单矩阵与 §4 已裁定的边）
· contracts/profile.schema.json（要落位到 packages/protocol）

本次任务：建立可编译的 monorepo 骨架，并把层依赖矩阵变成会拦人的 CI 门禁。

要做：
1) 按 ENG-020 建 9 个包/目录，包名与职责一一对应：
   packages/protocol、packages/domain-bridge、packages/reverse-gateway、
   packages/control-plane、packages/sdk、apps/domain、apps/control、
   tools/snapshot、tests/contract
2) packages/protocol 内含：Profile JSON Schema（机器可读）、反向 I/O 类型、
   事件类型；且 dependencies/peerDependencies 不含任何 @dsh-boot/* 与内核运行期包
   （ENG-020 判据②）
3) 实现 tools/check-deps.mjs，覆盖 LAYER-001 §6 的五项：
   ① 白名单矩阵逐条比对 ② DFS 零环 ③ 反转面目录数断言
   ④ §4 未列为允许的边一律按禁止 ⑤ 违规输出格式「包A → 包B 违反方向」
4) CI 至少接上 spec:deps 与 spec:id-format 两个 job

验收（必须实测，不得只写代码）：
· pnpm -r list --depth -1 列出的包集合 == ENG-020 的清单
· 故意加一条 apps/domain → packages/sdk 的依赖，check-deps.mjs 必须非零退出
· 故意加一条 packages/protocol → packages/domain-bridge 的依赖，必须非零退出

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

---

## 3. P-1 — DevEx 与测试夹具

> **门禁 `GATE-001`**。量级 1.5–2.5 人月。

```
工作目录：D:\proJects\dsh-boot

先读 README.md §1、§3，然后读：
· spec/03-实现与工程规格.md 的 ENG-042–ENG-047（DevEx 与 GATE-001）、D-9、D-10
· spec/00-规格总纲.md §7 的 GATE-001 通过条件
· spec/03 的 ENG-043（反向网关桩必须实现 §6.3 全部端点 + 故障旋钮）
· spec/03 的 ENG-044（内存 attest 桩）
· DSH企业级技术方案设计.md §6.3（反向 I/O 契约，含 attest 契约与流式契约）

本次任务：交付 P-1，目标是 GATE-001。

要做：
1) dev/compose.yml + pnpm dev:up / dev:smoke / gate:001 三个命令
2) 反向网关桩 packages/reverse-gateway/src/stub/：
   实现 §6.3 全部端点，并具备故障旋钮（TTFB 延迟、aborted、adapter error、
   审批不响应、各端点不可达）；桩对缺归因头的请求返回 400（ENG-008）
3) 内存 attest 桩（ENG-044）：四值响应 accept/deny/resync-profile/drain-domain，
   + 降级级别下发
4) 开发态 toolAllowlist 逃生门：可开关；生产态必须拒绝 "*"、拒绝缺省、拒绝通配
   （SEC-036、ENG-045、ENG-047）
5) 测试夹具（ENG-046）：至少 8 个注入器，且四个反转面各自的夹具可单独加载

验收（GATE-001 唯一判据）：
· pnpm gate:001 单命令退出码 0
· 最小拓扑跑通一个完整轮次
· 反向网关桩与内存 attest 自检通过
· 开发态逃生门可开关，生产态拒绝 "*"

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。

收工动作：把 GATE-001 的证据归档到 evidence/GATE-001/；回填 docs/effort-actuals.md。
```

---

## 4. P0-A1 — `ctx.llm` 反转

```
工作目录：D:\proJects\dsh-boot

先读：
· docs/reversal-contracts.md §2（LlmAdapter 契约，含"只有 stream 是 abstract"
  与"attributionHeaders 是模块级函数"两个易错点）
· spec/03 的 ENG-005、ENG-006、ENG-007、ENG-008
· DSH企业级技术方案设计.md §6.3（反向 I/O 契约 + 流式契约五条）

本次任务：实现 LlmAdapter 适配器，把模型调用经反向网关出域。

要做：
1) 适配器实现 stream 及 providerInfo / providerRetryPolicy / imageRequestPricing /
   listModels / resolveModel / prepareCall
   —— listModels 与 resolveModel 虽有默认实现但必须实现（GET /v1/llm/providers 依赖）
2) 上行 GenerateOptions 深冻结对象逐字段保真转发，不得重组/改名/增删
3) prepareCall 返回的 PreparedLlmCall 必须由适配器自己用于派发，不得绕过
4) 每个 provider HTTP 请求携带 attributionHeaders() 的返回值
5) 遵守 options.signal，abort 必须在 TTFB 前生效并取消网关侧上游连接
6) 下行 chunk 透传 + 显式终止帧区分「正常结束 / adapter error / aborted」
7) T_m 超时自持（含重试总预算），并声明是否挂载 dsh-llm-retry

验收：
· 契约测试：字段保真比对（深冻结请求 JSON 往返一致）
· 契约测试：abort 在 TTFB 前生效
· 契约测试：反向网关桩对四个 LLM 端点全断言归因头，缺头返回 400
· 注入持续 429，断言在 T_m 内终结且不突破 T_m
· resolve-model / prepare-call 失败必须 fail-closed，不得返回缓存或默认值

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

---

## 5. P0-A2 — 工具注册桥 + `guard` + 行移除 + 单一预设

> **这是全案的核心强制链。** 阶段 0a 的结论直接决定这里的写法。

```
工作目录：D:\proJects\dsh-boot

先读：
· docs/bridge-defense-in-depth.md（VER-001 + VER-002 结论）
· docs/reversal-contracts.md §3（工具注册桥契约，含 restrict/guard 作用域定论）
· spec/03 的 ENG-001、ENG-002、ENG-003、ENG-004
· spec/01 的 SEC-005、SEC-012、SEC-013、SEC-019、SEC-020、SEC-021、
  SEC-023、SEC-025、SEC-029、SEC-040
· docs/security/enforcement-chain.md（九项拦截点）
· contracts/profile.schema.json（toolAllowlist / removedRows / hmr / sandboxModeCeiling /
  permissionPresets 字段）

本次任务：实现工具强制的两道防线 + 组合面收敛。

要做：
1) 工具注册桥：内核 ctx.tools.register 的唯一入口；不在 toolAllowlist 内一律不注册 +
   硬审计 + bridge_register_denied_total++
   · toolAllowlist 缺省或空数组 ⇒ 可见工具集为【空集】，不是全集
2) MCP 发现闸门与注册桥同路：dsh-mcp-client 收到 notifications/tools/list_changed 或
   重连后重做发现时，逐个过同一判定；未授权者不注册
3) 纵深防御：在【宿主上下文】安装全局 guard()，对 toolName ∉ toolAllowlist 返回拒绝理由
   · 严格禁止在全局上下文调用 restrict()（会抛错）
4) Profile 层收敛：removedRows 必须含 tool-plugin-manager 与 plugin-manager 两行；
   hmr.enabled 必须为 false；permissionPresets 收敛为单一预设，使
   danger-full-access 与 never 不可达
5) 升权上限：解析 sandbox_permissions，超过 sandboxModeCeiling 即拒绝；
   解析不到即 fail-closed

验收（必须含负向用例）：
· 负向：起一个受控恶意 MCP，运行中推送 1 个新工具，断言该工具【永不进入】模型可见集
· 正向：toolAllowlist=["a"] ⇒ 可见 {a}；=[] ⇒ 空集；缺省 ⇒ 空集
· guard 覆盖 scoped 注册：仅移除 guard 安装后用 scoped 注册路径注册清单外工具，
  断言该工具【可被调用】（证明 guard 是覆盖 scoped 注册的唯一手段）
· 源码检索：全仓 .tools.register( 命中数 == 1；宿主上下文不得出现 .tools.restrict(

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

---

## 6. P0-A3 — 审批应答者 + 参数通道 + 三层截止时间

```
工作目录：D:\proJects\dsh-boot

先读：
· docs/reversal-contracts.md §4（审批面契约：载荷无参数无 sessionId、
  displayReason 绝不持久化、词表闭合、禁止 allow-always）
· spec/03 的 ENG-009、ENG-010、ENG-011、ENG-012
· spec/01 的 SEC-058–SEC-068（审批安全语义与参数通道）
· docs/security/approval-parameter-channel.md（十字段载荷、键级脱敏、体积上限、定序）
· DSH企业级技术方案设计.md §4.4.1（T_a / T_m / T_turn 三层截止时间）

本次任务：实现审批应答者与参数送达通道，并把三层截止时间落进 Profile。

要做：
1) 审批应答者注册为 approval/request waterfall 应答者，返回词表内四值
   allowed-once / rejected / cancelled / unavailable（本方案扩展 timeout）
2) 参数通道：桥在审批判定前上报
   (tenantId, isolationGroupId, workspaceId, sessionId, turnId, callId, toolName,
    argsDigest, argsPreview, redacted) —— 十字段
   · 键级脱敏规则落配置；体积上限 8 KiB（8192 字节）与固定截断顺序
   · 定序：同 callId 的 tool.call 必须先于 approval.requested 投递
   · 回补端点 GET /v1/sessions/{id}/turns/{tid}/calls/{callId} 可用
   · 兜底：参数无法送达域外的工具【不可注册】且不得进入 requireApproval
3) 应答者自持 T_a 超时（取自 Profile deadlines.approvalSeconds，默认 90，范围 60–120）
   —— 内核【无】审批超时，只有 abort 才 cancelled，不得依赖内核 signal 收敛
4) 禁止项：不得实现任何跨 callId 的授权复用（无 allow-always、无规则存储）
5) 全局收件箱端点 GET /v1/approvals?status=pending（按用户维度聚合）
6) 三层截止时间进 Profile：T_a < T_turn 且 T_m < T_turn，T_turn ≤ 15 min

验收：
· 起永不响应的审批桩，断言在 T_a + 5s 内调用进入终态且轮次不再挂起
· 连续两次同工具调用，断言产生两个不同 approvalId 且审计计数 == 2（无缓存命中）
· 事件流中同 callId 的 seq(tool.call) < seq(approval.requested)
· 参数不可送达的工具，断言其不可注册

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

---

## 7. P0-A4 — 就绪判据 + 域令牌 + 版本列车 + Profile 校验

> **本阶段的核心纪律**：门禁只接受**域外事实**。域内自报只能作交叉核验。

```
工作目录：D:\proJects\dsh-boot

先读：
· DSH企业级技术方案设计.md §4.1.2（域就绪判据 7 条 + **收口修正：门禁只接受域外事实**）
  与 §4.2.1（域→域外身份与租约：域令牌必须绑定租户）
· spec/03 的 ENG-025、ENG-029、ENG-030、ENG-036、ENG-037、ENG-039、ENG-040、
  ENG-041、ENG-045、ENG-062
· spec/01 的 SEC-037–SEC-044、SEC-006、SEC-007、SEC-008
· spec/01 的 ready-checks.md（RC-1…RC-7：判定输入（域外）与交叉核验（域内）两列）
· contracts/profile.schema.json（trainVersion / removedRows / hmr / toolAllowlist /
  skillRoots / sandboxModeCeiling / permissionPresets / deadlines / buffers /
  modelDegradation / sessionProjectionCache / residencyRegion + 12 项语义检查）
· docs/security/gate-checklist.md（GATE-002 十条 + C11–C17）

本次任务：实现 Profile 校验器 + 域就绪判定 + 域令牌绑定 + 版本列车纪律。

要做：
1) Profile 校验器（表驱动），覆盖 schema 的 required/类型/枚举 + 全部
   x-ov-semanticChecks（PC-001…PC-012），逐字段失败用例
2) 域就绪判据 7 条，**每条的证据来源必须是域外事实**：
   镜像摘要 / 挂载内容摘要 / 运行时配置快照 / Profile 生成摘要；
   域内上报只作交叉核验，不一致时调查并摘域，**不作为通过的依据**
3) 平台必须能产出并留证上述域外事实，每次域创建留证（GATE-002 条件 4）
4) 域令牌绑定 (tenantId, isolationGroupId)；域外必须校验
   「请求声称的租户 == 令牌里的租户」，不一致即拒绝 + 硬审计
5) 版本列车：trainVersion 单值（非数组）；域内实际版本与 Profile 不一致即拒绝 ready；
   存在被 disabled 的关键平台行即拒绝 ready
6) attest 契约（ENG-041）：定义请求体/响应体/触发原因枚举/降级级别下发/协议版本

验收（必须实测）：
· 逐字段负例（删字段/错类型/违反大小关系）各至少一条，断言域拒绝 ready
· 从域内上报"全绿"但域外证据不符时，断言域【仍被拒绝】（证明门禁不是自证）
· 用 A 域令牌以 B 租户身份发请求，断言被拒且产生硬审计
· trainVersion 缺失/为数组/含两个值，断言返回 EVO_TRAIN_VERSION_AMBIGUOUS

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

---

## 8. P0-A5 — 契约测试套件 + `.d.ts` 快照

```
工作目录：D:\proJects\dsh-boot

先读：
· spec/03 的 ENG-031（自建契约套件 A–F 六项）、ENG-032、ENG-033、ENG-034、
  ENG-046、ENG-051、ENG-052
· spec/00-规格总纲.md §7 的 GATE-006
· docs/reversal-contracts.md（四个面的契约，测试逐面覆盖）

本次任务：建自建契约测试套件与内核 .d.ts 快照门禁。

背景（必须理解）：发行版【不含】契约测试套件（C41），参考实现也【无具名导出】，
所以套件必须自建、不能依赖内核仓库。

要做：
1) tests/contract 覆盖 A–F 六项，缺一不可：
   A 撕裂尾（物理半帧/损坏帧不被 read 返回）
   B 单写者（第二个写句柄失败且错误码正确）
   C closed handle（关闭后各方法返回 SESSION_HANDLE_CLOSED，close 幂等且完成持久化）
   D freshness（写后启动的读至少看到该前缀）
   E format 拒绝方向（不能解码的格式必须被拒绝，不得尝试升级或宽松解码）
   F flush 即物化空会话（空会话 flush 后对其他进程可 list/open）
2) tools/snapshot：把 @deepseek-ai/dsh* 与 @deepseek-ai/cordis 的 .d.ts 导出符号与
   签名抽成快照文件入库；升级时 diff 非空即门禁失败
   · **diff 范围必须收敛到 4 个反转面**，不得全量（全量会产生大量噪声 diff，
     导致规则被"签字放行"而失效）
3) CI：contract job 对 persistence/snapshot/ready 路径强制全量，不得只跑受影响子集

验收：
· node --test 与 CI 两处都能跑 A–F，日志按 A–F 分列
· 逐项失败信息必须点名是 A–F 中的哪一项与哪条断言
· 快照 diff 在无变更时打印 identical 退出 0；有变更时逐包 added/removed/changed
  并非零退出

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

---

## 9. P0-A6 — Windows ACL 实测 + `GATE-002` 收口

> **门禁 `GATE-002`。这一条是唯一可能改变整个平台形态的实测。**

```
工作目录：D:\proJects\dsh-boot

先读：
· spec/00-规格总纲.md §7.1（GATE-002 的十条条件，逐条核）
· DSH企业级技术方案设计.md §8.4（Windows 的正确表述与三项残留）
· docs/security/disclosure-checklist.md §2.4、§3（三项残留 + 已修改路径清单 +
  卸载复原流程）
· docs/security/gate-checklist.md（逐项：通过谓词 / 证据工件 / 判定者）

本次任务：完成 GATE-002 的全部十条并归档证据。

关键项（其余逐条核）：
1) 【最高风险】Windows 容器内 ACL 行为实测。文档现有结论来自【非容器】README，
   必须在容器内实测：Low 标签加宽、DACL 永久改写与删除语义变化、硬链接别名可写
   · 若结论与文档不符 → 按 SPEC-00 §8 改 §8.4 / §10.1 / §11.3，再收口
   · 未通过则**禁止 Windows 参与多租户隔离**
2) 产出「已修改路径清单 + 卸载复原流程 + 责任人」三件套（交付物 12）
3) 逐条核 GATE-002 十条：E1 负向用例、guard 覆盖 scoped 注册、域外证据就绪判据、
   域外证据留存、无长期凭证、四 LLM 端点 fail-closed + 域令牌绑租户、
   三层截止时间、restrict 路线已废弃、Windows 实测、快照 diff 范围收敛

验收：
· GATE-002 十条逐条有证据工件，归档到 evidence/GATE-002/
· Windows 实测报告存在；若结论为"不通过"，则在 README §6 登记并把 Windows 从
  多租户隔离范围中移除

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。

收工动作：GATE-002 通过后，G1（内核无长期凭证）与 G5（治理可强制）才算达成。
```

---

## 10. P1-B — SessionPersistence L1 + 恢复 + 台账 + 分缓冲

> **门禁 `GATE-003`**。量级 6–10 人月（L1 口径）。

```
工作目录：D:\proJects\dsh-boot

先读：
· docs/reversal-contracts.md §5（SessionPersistence 契约，含 8 个错误类全集、
  "格式不受支持 ≠ 损坏"、SessionOwnershipLostError 无参考行为基线）
· spec/03 的 ENG-013–ENG-019、ENG-059–ENG-061，以及 §11.4.1（P1 分层：L1 范围与禁止事项）
· DSH企业级技术方案设计.md §5.4.1（迁移状态机）、§7.4（恢复语义）、§7.4.1（副作用台账）、
  §7.5（保留与销毁）、§7.6（真源与对账）
· spec/02 的 REL-069–REL-101（恢复、迁移、台账、真源对账）
· docs/reliability/migration-runbook.md、side-effect-ledger-spec.md、
  buffer-and-tombstone.md、reconciliation-report.md、drill-cases.md

本次任务：实现 SessionPersistence L1，以及恢复、台账、分缓冲与对账。

L1 的【禁止事项】（写错就返工）：
· 仅单域内、Linux-only、compression: none
· 禁止世代迁移（启动即断言"仅支持当前 format"）
· 不得把会话日志写路径放在共享 NFS/FUSE 上

要做：
1) export default class 的 SessionPersistence 提供方，实现
   create/open/flush/stat/list + 句柄 read/append/flush/close 与
   id/header/inheritedEventCount/access
2) 语义级契约：提交点 = flush 屏障；撕裂尾永不返回；单写者（第二个写句柄
   必须拒绝且返回 SessionAlreadyOwnedError，不得排队、不得依赖超时）；
   close 幂等且完成未决持久化；freshness；list 无分页无过滤无索引；
   格式拒绝方向（不得尝试升级或宽松解码）
3) 「格式不受支持」与「损坏」必须分开；拒绝文案必须让用户看到"升级 harness"，
   绝不能用 "corrupt"；使用内核的 sessionFormatVersionRefusal 生成文案
4) 租约续期/过期阈值【必须自定】（内核无参考行为基线），不得声称"与内核一致"
5) 恢复：追加合成 closer，不是回滚；中断轮次永久保留在历史中
6) 副作用台账：非幂等工具执行前写域外；恢复后由产品策略禁止自动重试
7) 分缓冲：计费与审计各自独立判定级别；按时间定容；超限有界丢弃 + reconciled:false
   墓碑 + 硬告警；**绝不阻断执行**
8) 真源 = 会话日志 + 上传确认水位；RPO 分层（节点内 0 / 跨节点 = 复制滞后）
9) 迁移状态机五态 + targetBaseSeq == sourceLastReplicatedSeq 断言 + 无写者 SLO

验收（GATE-003）：
· 进程被杀后可在另一实例续跑；中断轮次经 closer 收尾且【不被回滚】
· 副作用台账可用：恢复后非幂等调用由产品策略禁止自动重试
· 审计服务故障 6 小时【不阻断执行】（有界丢弃 + 墓碑生效）
· 对账差异率 ≤ 0.01%（少计与多计分列）；收敛时长达标
· 演练门禁：最小演练集 6 项全通过（docs/reliability/drill-cases.md）

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

---

## 11. P2 — 隔离域池 + workspace 租约 + 成本

> **门禁 `GATE-004`**。量级 6–10 人月。

```
工作目录：D:\proJects\dsh-boot

先读：
· DSH企业级技术方案设计.md §4.1（隔离域）、§4.1.1（域粒度）、§4.1.2（就绪判据）、
  §5.4.1（workspace 独占与租约）、§7.3（workspace 四个同名概念与投影）、
  §9.5（故障域与爆炸半径）、§10.4（域三态与成本模型）
· spec/02 的 REL-060–REL-068（故障域、N_node、反亲和）
· spec/04 的 PRD-043–PRD-049（成本可核算与单位经济）
· docs/reliability/failure-domain-matrix.md、docs/product/cost-and-unit-economics.md

本次任务：把平台从"单个域能跑"推进到"多租户隔离 + 可报价"。

要做：
1) 隔离域池三态：热 / 温 / 零
   · 冻结前必须 flush + 排空缓冲 + 写 suspend 标记
   · 快照必须含投影缓存与未上传缓冲，否则恢复后用量永久丢失
2) 一 (租户, 隔离组) 一容器/microVM；跨租户永不共享
   · 域内按 workspace 分区，各占独立可写根
   · 明确"域内读不隔离"，需要 need-to-know 的客户走团队/用户级隔离组
3) workspace 独占租约：一个 workspace 任一时刻只被一个域可写，带可转移租约；
   容量溢出走"同域扩容/排空+迁移会话"，不是"新建隔离组共享 workspace"
4) 运行期漂移检测，且与 connector 生命周期【拆成两类事件】：
   · connector 生命周期变化（预期）→ 不摘域，工具不可用 + 告警 + 自动重载
   · Profile 未授权的插件/工具出现（异常）→ 摘域，且摘域单独审批
5) 容器网络策略与出站白名单（默认拒绝入站）
6) 冷启动与域池排队对用户表现为【等待页而非错误码】
7) 成本可核算：≥3 个典型客户画像能算出毛利率；4 画像 × 3 档单位经济矩阵

验收（GATE-004）：
· 跨租户文件/网络/进程互不可见
· ≥3 个客户画像可算毛利率
· N_node = min(内存约束, 爆炸半径约束) 且有数字
· workspace 独占租约生效（无并发写同一 workspace）

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

---

## 12. P3-1 — 身份/RBAC + 配额/公平调度 + 计费

```
工作目录：D:\proJects\dsh-boot

先读：
· DSH企业级技术方案设计.md §5.1（身份与多租户、SKU 级隔离承诺、workspace 授权时机）、
  §5.2（配额）、§5.2.1（公平调度）、§4.2.1（域令牌）
· spec/04 的 PRD-020–PRD-028（SKU 与隔离承诺）、PRD-034–PRD-042（计费与配额）
· docs/product/sku-and-tenant-mapping.md、billing-explainer.md
· spec/02 的 REL-052–REL-059（分缓冲——计费侧与审计侧必须独立判定）

本次任务：实现控制面的身份、配额与计费。

要做：
1) 身份：JWT（OIDC 对接企业 IdP）；RBAC 按租户/角色控制场景、插件、工具、MCP、
   沙箱模式上限；令牌绑定 tenantId 与允许的 workspaceId 集合
2) workspace 授权时机：签令牌时固化允许集合 + 每次请求校验租户与隔离组
3) 配额分级：令牌/工具调用/存储 = 软；域槽位/CPU/内存/模型并发/每 workspace 份额 = 硬
4) 公平调度：域池水位超阈值时对【超额租户】按比例限速，而不是让所有租户平等 503
   · 不得把某租户的用量失控转化为其他租户的不可用
5) 计费：用量归集到 turnId，区分输入/输出/缓存命中；MCP 按 connector 归集
6) 对客用量端点：GET /v1/usage?dim=workspace|user|scenario|connector（T+1）、
   GET /v1/usage/export，含 reconciled 标记与分方向差异

验收：
· 超额租户被限速而其他租户不受影响（用例覆盖）
· 软依赖（计费/一般审计）不可用时不阻断执行；拒绝原因码集合中不含软依赖
· 用量以「日志 + 上传确认水位」为真源，按 (tenantId, turnId) 幂等去重

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

---

## 13. P3-2 — 四个 Registry / Catalog

```
工作目录：D:\proJects\dsh-boot

先读：
· DSH企业级技术方案设计.md §5.3（Plugin Registry + 插件五分类 + 分层锁）、
  §5.3.1（强制链九项）、§5.6（Connector Registry）、§4.8（MCP 接入）
· spec/01 的 SEC-010–SEC-019（强制链）、SEC-045–SEC-057（凭证）
· spec/03 的 ENG-063（Skill Catalog 分发）
· spec/05 的 EVO-011–EVO-020（兼容面、依赖生命周期、弃用）
· contracts/profile.schema.json（Profile 生成器的输出形态）
· docs/evolution/preset-id-registry.md、deprecation-ledger.md

本次任务：实现四个目录/注册表，并把"强制力只来自域外"落到实现。

四个：
1) Plugin Registry：Cordis 插件制品、版本、标签、签名、完整性哈希、回滚
   · 层级合法性的判定【必须在域外 Profile 生成时】完成，不在域内
   · 分层锁是【产品侧治理策略】，不是平台强制力（preset 不是安全沙箱）
2) Connector Registry：MCP 目录、传输、归属（domain/data-plane/exception）、
   凭证引用、信任级（默认 untrusted）、健康
   · 工具数突变必须告警；处置为"冻结该 connector 新工具的可见性"
   · 例外（hosting=exception）须安全评审 + 按域硬上限
3) Skill Catalog：按 SEC-105 三级作用域 + ENG-063 的 skillRoots 装配
4) Scenario Catalog：presetId + pluginSet + policies

验收：
· Profile 生成器产出的内容能被 P0-A4 的校验器接受
· 租户自定义插件无法进入平台锁定层（层级校验在域外执行）
· 例外 connector 超过按域上限即被拒
· 出现"域内自证合规"的实现即判不通过（D9/D15）

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

---

## 14. P3-3 — Session Router + 历史查询 + 保留删除/DSR + 取证

```
工作目录：D:\proJects\dsh-boot

先读：
· DSH企业级技术方案设计.md §5.4（Session Router）、§5.4.1（迁移状态机与 workspace
  租约）、§7.5（保留与销毁，全清单）、§7.6（一致性与对账）
· spec/01 的 SEC-069–SEC-088（审计最小集、取证、DSR、删除证明）
· spec/02 的 REL-077–REL-089（迁移运行手册）
· docs/security/audit-event-dictionary.md、dsr-inventory-and-proof.md
· docs/reliability/migration-runbook.md

本次任务：实现会话路由、历史查询、保留/删除与取证。

要做：
1) Session Router：按 (tenantId, isolationGroupId) 路由；就绪探针；
   【自建会话索引】（内核 list() 无分页无过滤无索引）
2) 迁移状态机五态，含 targetBaseSeq == sourceLastReplicatedSeq 断言、幂等重驱动、
   "无写者会话 P99 ≤ 5 min"
3) 历史查询服务：基于 ctx.sessionQuery，但【必须由域外施加调用方授权】
   （该 seam 明确"无调用方授权"）；域内不得挂载 session-query 及其 FTS 派生库
4) 审计：最小审计集（六类）fail-closed，记不下即拒绝该动作；权威源在域外控制点；
   WORM + 哈希链；五元组审计键（+ serverName/rawName）
5) 保留与删除【全清单】：日志 + FTS 派生库 + spill + attachments + 快照 +
   对象存储版本 + 容器临时层 + 审计；spill.root 与附件目录固定到域卷
6) DSR：删除清单 + 墓碑 + 删除报告 + 哈希链证明；生效时延 ≤ 24h、撤销窗口 7 天；
   证据包可导出且可验证
7) 对客三个正交语义：移除注册(:unregister) ≠ 删除数据(DELETE) ≠ 删会话历史

验收（GATE-005 相关）：
· 取证包可导出且可验证
· DSR 可出具删除报告，且覆盖全清单（含附件/spill/FTS/快照）
· 删除某 workspace 全部会话后，文件仍可从 workspace 级端点列出并读取

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

---

## 15. P3-4 — 对外 OpenAPI/SDK + SSO/SCIM + 降级阶梯落地

> **门禁 `GATE-005`。**

```
工作目录：D:\proJects\dsh-boot

先读：
· contracts/openapi.json（已有 30+ 操作的 OpenAPI 3.1，packages/sdk 由它生成）
· spec/03 的 ENG-020（packages/sdk 全部文件带 // @generated 头，CI 校验与 OpenAPI 一致）
· DSH企业级技术方案设计.md §6.1（对外契约）、§9.4（降级阶梯）、§9.5（故障域）
· spec/02 的 REL-037–REL-051（降级阶梯）、REL-121–REL-127（告警与错误预算）
· spec/04 的 PRD-050–PRD-056（签约前置要件，含 SSO/SCIM 停用 ≤5 min）
· docs/product/signing-prerequisites.md、docs/reliability/degradation-ladder.md、
  alert-rules-and-budget.md

本次任务：把对外契约、企业身份生命周期与降级可观测性落地，收口 GATE-005。

要做：
1) packages/sdk 由 contracts/openapi.json 生成（不手写）；CI 校验生成物与 OpenAPI 一致
2) SSO/SCIM：SAML/OIDC + SCIM 自动开通/离职收回；账号停用后相关会话与令牌
   在 5 分钟内失效（COPY-027）
3) 降级阶梯落地：L0/L1/L1b/L2/L3 的进入退出阈值、滞回与最短驻留、
   跨作用域聚合规则、**软依赖绝不阻断执行**；级别下发通道打通
4) 按租户聚合降级事件，只在跨过驻留阈值时告警；错误预算政策与冻结清单
5) 故障域矩阵可演练；数据面副本行的 RTO/RPO 必须有数字
6) SLA / 赔偿 / 维护窗口 / 数据驻留声明 / 租户数据导出定稿

验收（GATE-005）：
· 取证包可导出且可验证（P3-3）
· DSR 可出具删除报告
· SLA/赔偿/维护窗口/数据驻留/租户导出已定稿
· 降级阶梯与故障域矩阵可观测可演练
· SSO/SCIM 生命周期可用

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

---

## 16. P4 — 演进与升级门禁

> **门禁 `GATE-006`**（持续）。量级 4–8 人月。

```
工作目录：D:\proJects\dsh-boot

先读：
· spec/05 全部（EVO-001–EVO-036）+ docs/evolution/ 全部 12 份
· spec/03 的 ENG-035、ENG-053，以及 §11.4/§11.4.1（契约基线与 P1 分层）
· spec/00-规格总纲.md §7 的 GATE-006、§11.4（前提监控项 P-1/P-2/P-3）
· docs/reliability/pending-params-ledger.md（PP-01…PP-35）

本次任务：把"变化"变成有门禁的流程，并完成实测回填。

要做：
1) 升级流水线五道 gate：契约测试报告 / .d.ts 快照 diff 报告 / 列车一致性报告 /
   灰度记录 / 就绪复验记录（docs/evolution/upgrade-pipeline-spec.md）
2) 前提监控项每次升级必须复核：
   P-1 ctx.tools.register 是否仍是唯一注册入口
   P-2 域镜像 + 只读 Profile 是否仍属 TCB
   P-3 域内读是否仍不隔离
   —— 任一被推翻，按 SPEC-00 §11.4 重评对应条款
3) SessionPersistence L2：世代迁移、Windows、对象存储直读（L1 的禁止事项在此解除）
4) 实验能力适配层（dsh-experimental-* 必须被适配层隔离，不得进入平台锁定层）
5) 成本与 SLO 实测回填：把 PP-01…PP-35 逐项填上实测值与来源；
   docs/effort-actuals.md 回填各阶段实际工时
6) 变化场景 Runbook 落地演练：内核升级、100x 扩容、供应商弃用、域失陷、监管变更

验收（GATE-006，持续）：
· 契约测试 + API 快照 diff 通过；无混版（trainVersion 单值）
· 六个门禁（GATE-001…006）全部可达且各有证据
· README §6 的"运行期验证项"全部关闭

纪律（不可协商）：
· spec/ 是开发约束，不是建议。冲突时按 README §1 的权威顺序处理，不得自行选择。
· 不得自造需求 ID；发现缺条款先走 SPEC-00 §8 变更控制。
· 每条实现都要对应具体 XXX-###，提交说明里写出 ID。
· 判据以目标架构为准，不以本机现状为准（D13）。
· 收工前必须跑通：
  node tools/lint-specs.mjs && node tools/check-gates.mjs
  && node tools/validate-contracts.mjs && node tools/lint-docs.mjs
· 门禁不过，不得进入下一阶段（见 README §4）。
· 做不到就说"做不到 + 缺什么"，不要猜、不要编数字。
```

---

## 附：每个阶段的固定收尾动作

| # | 动作 | 命令 / 位置 |
|---|---|---|
| 1 | 跑四个校验器 | `node tools/lint-specs.mjs && node tools/check-gates.mjs && node tools/validate-contracts.mjs && node tools/lint-docs.mjs` |
| 2 | 归档门禁证据 | `evidence/GATE-00X/` |
| 3 | 回填工时 | `docs/effort-actuals.md`（`D-12`） |
| 4 | 更新缺口台账 | `README.md` §6 |
| 5 | 若改了规格 | `spec/00-规格总纲.md` §11 收口记录 + 版本号 |

## 变更记录

| 版本 | 变更 |
|---|---|
| 1.1 | 阶段 0a 标记**已完成**：`VER-002` 已定论（成立）、`GATE-002` 条件 2 内核侧已定论（成立），证据见 `docs/bridge-defense-in-depth.md` §6/§7；`SEC-029`/`ENG-004` 被证实、无需收窄。阶段 0a 提示词保留作追溯 |
| 1.0 | 初版：16 个阶段的开工提示词（0a / 0b / P-1 / P0-A1…A6 / P1-B / P2 / P3-1…4 / P4），含阶段总览、通用纪律块与固定收尾动作 |
