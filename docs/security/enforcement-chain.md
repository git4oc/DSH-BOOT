# 强制链拦截点清单（九项）

| 项 | 值 |
|---|---|
| 文档编号 | `SEC-DOC-03` |
| 交付物 | `SPEC-01` §3 交付物 3 |
| 版本 | 1.0 |
| 状态 | 生效 |
| 上游依据 | 设计文档 v2.6 `D10` / `D15` / `D16` / `C33`–`C38` / `C49` / `C51` / §4.1.2 / §4.5.1 / §5.3.1 / §8.2；`VER-001`；`CTR-001` §3 |
| 落实的 `SEC-*` | `SEC-010`、`SEC-011`、`SEC-012`、`SEC-013`、`SEC-014`、`SEC-015`、`SEC-016`、`SEC-017`、`SEC-018`、`SEC-019`；配套 `SEC-005`、`SEC-029`、`SEC-003`、`SEC-002` |
| 不重复声明 | 桥的装配契约见 `CTR-001` §3；本文件只给**拦截点的位置、性质、判定与验收用例**，不重写签名 |

---

## 1. 九项拦截点（一一对应 `SEC-010`–`SEC-018`）

**性质判定规则**：`preventive` = 动作不可能发生；`detective` = 只能发现动作发生过。标 `detective` 者**不构成硬保证**，不得计入 `GATE-002` 条件 1/3/8 的通过依据。

| # | 拦截点 | 位置（精确到组件） | 拦截动作 | 判定输入 | 判定谓词（可执行） | 性质 | `SEC-*` |
|---|---|---|---|---|---|---|---|
| **1** | Profile 生成与层级校验 | **域外** Profile 生成器（`packages/control-plane/src/profile/`） | 拒绝签发 Profile | 租户/场景声明 + Plugin Registry 台账 | §`SEC-DOC-02` §2 全部拒绝规则通过，且 `tier` 合法性判定在域外完成 | preventive | `SEC-010` |
| **2** | 制品完整性 | **域外** 加载器包装层（挂载前） | 拒绝加载该行 + 拒绝 ready | 制品字节 + `pluginSet[].integrity` + 签名 | `sha512(content) === integrity` **且** 签名验签通过；否则拒载 | preventive | `SEC-011` |
| **3** | 工具注册拦截（**核心**） | **域内** 桥 `@dsh-boot/domain-bridge` 的 `registerTool()`，包住内核 `ctx.tools.register` 唯一入口 | 不注册 + 硬审计 + 告警 | `definition.name` + 只读 Profile 的 `toolAllowlist` + 内核 `ctx.tools` | `allowlist.has(name) === true` 才调用内核 `register`；否则返回 no-op disposer，写 `bridge.register.denied`，`bridge_register_denied_total++` | **preventive（核心）** | `SEC-012`、`SEC-005` |
| **4** | 插件行移除 | Profile **挂载前**（生成器 + 容器装配） | 不插入管理行 | Profile `removedRows` + `hmr` | `removedRows ⊇ {tool-plugin-manager, plugin-manager}` **且** `hmr.enabled === false`；活动 fiber 中两者均不存在 | preventive | `SEC-013` |
| **5** | 预设表收敛 | Profile + 域外生成器 + 容器环境构造 | 使宽模式与 `never` 不可达 | `permissionPresets` + `DSH_PERMISSION_MODE` + `sandboxModeCeiling` | `reachable.length === 1` 且 `∉ {danger-full-access, never}`；环境变量 `=== read-only` | preventive | `SEC-014` |
| **6** | profile 与制品目录只读挂载 | **容器挂载层**（域外编排） | 拒绝 ready（写尝试失败） | `cordis.patch.yml`、`package.json`、`compatibility.json`、插件制品目录 | 四类路径在域内以写模式打开**均失败**；运行时声明无额外挂载、无特权位 | preventive | `SEC-015` |
| **7** | 域就绪门禁 | **域外** Session Router（七条全量） | 拒绝 ready；域不进入 `active` | 域外事实四项摘要 + 就绪探针结果 | `SEC-DOC-04` §2 的 RC-1…RC-7 全部 `pass`；任一 `fail` ⇒ `ready=false` | preventive（门禁） | `SEC-016` |
| **8** | 域外 attest（指纹比对） | **域外** attest 服务；输入来自域上报 | 告警 + 触发重签发或摘域**流程** | 域上报 `{rows[], tools[], fibers}` + 域外已知摘要 | 逐行比对行名与版本、工具名与 schema 哈希；不一致 ⇒ `deny`/`drain-domain` | **detective** | `SEC-017` |
| **9** | 运行期漂移检测 | **域外** 漂移判定器（域外已知制品摘要 + 域内上报） | 分流处置（下表） | 事件类别 + 来源可证性 | 见 §1.1 分流表 | **detective**（可触发 preventive 处置） | `SEC-018` |

### 1.1 第 9 项的分流表（不得混为一类）

| 事件类别 | 判定条件（可执行） | 处置 | 是否摘域 | `SEC-*` |
|---|---|---|---|---|
| connector 生命周期变化（预期） | 来源 = Connector Registry / 控制器上报；且变更工具全部属于**同一** `serverName` | 该 connector 工具不可用 + 告警 + Connector 控制器自动重载；既有工具保持可用 | **否** | `SEC-018`、`SEC-021` |
| Profile 未授权注册或清单外工具出现（异常） | 桥产生 `bridge.register.denied`，或域内出现 `toolAllowlist` 外工具名 | 触发摘域**流程**；摘域动作进入**独立审批**后才执行 | 是（经审批） | `SEC-018` |
| `sandbox/mode`、`permission/preset`、`approval/policy` 变更 | 域内会话日志出现对应事件，或域外配置快照变化 | **60 s 内**判为漂移并进入摘域流程 | 是（经审批） | `SEC-027` |

### 1.2 覆盖项（第 3 项的覆盖面，`SEC-019`）

| 覆盖路径 | 覆盖手段 | 判定谓词 | 性质 | `SEC-*` |
|---|---|---|---|---|
| MCP 发现循环（`notifications/tools/list_changed`、重连后重发现） | 桥提供的 `ctx.tools` 代理被 MCP 行注入 | 逐个新工具过第 3 项判定；未授权者不注册 + 硬审计 | preventive | `SEC-020`、`SEC-019` |
| scoped 注册 | 全局 `guard()`（宿主上下文一次性安装） | 派发期 `toolName ∉ allowlist` ⇒ 返回拒绝理由 | preventive（单调只否） | `SEC-029`、`SEC-019` |
| 运行期动态注册 | 同第 3 项入口 | 同第 3 项 | preventive | `SEC-019` |
| PTC `run_code` / 子代理 / 嵌套派发 | 全局 `guard()` 派发期求值（与 scoped 注册同一机制；`VER-002` 已定论：内核全执行路径汇入同一 `prepareExecution`，`dispatch` 只接收经 prepare 的执行；见 `docs/bridge-defense-in-depth.md` §6） | 派发期 `toolName ∉ allowlist` ⇒ 返回拒绝理由；ptc 模式下模型直连非 `run_code` 调用被 PTC collapse 先行拒绝 | preventive（单调只否） | `SEC-029`、`SEC-019` |

---

## 2. 派生拦截点（不在九项内，但属于强制链）

| 派生点 | 位置 | 拦截动作 | 性质 | `SEC-*` |
|---|---|---|---|---|
| D-1 域令牌绑定校验 | 反向网关 / 凭证代理 / MCP 出站代理入站 | 请求租户 ≠ 令牌租户 ⇒ 拒绝 + 硬审计 | preventive | `SEC-007` |
| D-2 凭证签发（会话级租约） | 域外凭证代理 | `TTL > 300 s` 或 per-request ⇒ 拒绝 | preventive | `SEC-008` |
| D-3 容器环境白名单构造 | 域容器启动（域外） | 仅注入白名单变量；三探针变量（`DATABASE_URL`/`GOOGLE_APPLICATION_CREDENTIALS`/`APP_DSN`）不得出现 | preventive | `SEC-047` |
| D-4 connector 归属校验 | Connector Registry 归属校验 + 生成器 | 需凭证且非数据面托管 ⇒ 拒绝（例外除外） | preventive | `SEC-050` |
| D-5 例外令牌校验 | 数据面代理 | 六元组比对 + audience + 单次使用 + TTL | preventive | `SEC-052` |
| D-6 例外登记上限 | Connector Registry | 条数 > `credentialExceptionMaxPerDomain` ⇒ 拒绝登记 + 告警 | preventive | `SEC-055` |
| D-7 审批前参数上报 | 桥（审批判定前） | 十项字段齐备才发起审批；否则 `unavailable` | preventive | `SEC-058`、`SEC-063` |
| D-8 审批入站解析 | 域外审批服务 | 解析不到 `sandbox_permissions` / `justification` ⇒ `rejected` 或 `unavailable` | preventive | `SEC-024` |
| D-9 无参数即不注册 | 生成器 + 桥 | 无法产出 `argsDigest` 的工具列入 `requireApproval` ⇒ 不签发 / 不注册 | preventive | `SEC-062` |
| D-10 最小审计集前置 | 六类动作各自的域外决策点 | 审计写入失败 ⇒ 动作不发生 | preventive | `SEC-070` |
| D-11 会话 preset 不可变 | 域内装配层（不暴露写路径）+ 桥子集判定 | 请求切换 preset ⇒ 拒绝；工具面不得扩张 | preventive | `SEC-028` |
| D-12 子代理作用域 | 生成器派生 `toolFilter` + 桥作用域判定 | `requireApproval` 工具在子代理内被硬拒，不产生审批请求 | preventive | `SEC-033` |
| D-13 公网工具不挂载 | 生成器（不插入行）+ 桥（不在白名单） | 未登记则既不在 `pluginSet` 也不在 `toolAllowlist` | preventive | `SEC-031`、`SEC-095` |
| D-14 Windows 域卷归属 | 域编排配置校验（挂载前） | 挂载宿主共享目录 ⇒ 拒绝 ready | preventive | `SEC-094` |

---

## 3. 逐项验收用例（可执行）

**统一证据规范**：每次执行产出 `evidence/<GATE>/<检查号>/<domainId>/<UTC时间戳>.json`，字段 `{case, input, observation, verdict, artifactHashes[], operator, ranAt}`。`verdict` 只取 `pass` / `fail`。

| 用例 | 对应拦截点 | 注入/构造 | 观察（断言） | 证据工件 |
|---|---|---|---|---|
| E-01 | 1 | 构造把租户自带 tool 插件标 `tier: platform` 的 Profile | 生成器拒绝签发；域不 ready；产生审计记录 | `profile-reject.json` + 审计记录 ID |
| E-02 | 2 | 改动某插件制品 1 byte（文件名与版本号不变） | 拒载、域不 ready、硬审计；摘要与签名均匹配时正常加载 | `artifact-tamper.json` |
| E-03 | 3 | 注入直接调用 `ctx.tools.register('not-in-allowlist')` 的探针插件 | 该工具不出现在模型可见集；最小审计集出现「白名单外注册尝试」；`bridge_register_denied_total` +1 | `bridge-deny.json` + 工具集 diff |
| E-04 | 3、覆盖 | 受控恶意 MCP 初始只暴露 `a`，稳定后新增 `b` 并发 `list_changed` | 60 s 内 `GET /v1/sessions/{id}/tools` 与模型 tools 数组均不含 `b`；审计记 `rawName=b`；域外把 `b` 写入白名单并重签发后 `b` 才出现 | `negative-mcp.json`（`GATE-002` 条件 1） |
| E-05 | 3、覆盖 | 仅移除 `guard` 安装，用 scoped 注册路径注册清单外工具 | 该工具**可被调用**（证明 `guard` 是覆盖 scoped 的唯一手段）；装回后调用被拒 | `guard-scope-diff.json`（`CTR-001` §3、`SEC-029` 判据②③） |
| E-06 | 3、失败面 | 单独移除桥的 `register` 判定（保留 guard） | 「白名单外工具不可见」断言**必须失败**（证明可见性防线确实在桥） | 同上 |
| E-07 | 3、失败面 | 域内改写环境变量/域内文件试图放行 | 工具仍不注册 + 硬审计（判定源只来自只读 Profile） | `allowlist-source.json` |
| E-08 | 4 | 以未移除行的镜像启动域 | 检出 `tool-plugin-manager` / `plugin-manager` fiber ⇒ 拒绝 ready；已移除时无对应 fiber | `fiber-enum.json` |
| E-09 | 5 | 以含 `danger-full-access` 的预设表启动域并按名引用 | 拒绝 ready；正常配置下按名引用不可达 | `preset-reach.json` |
| E-10 | 6 | 域内以写模式打开四类路径 | 四次均失败（只读文件系统或权限拒绝）；就绪判据 6 通过 | `ro-mount.json` |
| E-11 | 7 | 逐条注入 RC-1…RC-7 失败态（见 `SEC-DOC-04` §4） | 每种各自产生独立告警与拒绝 ready；无一被「能启动」掩盖 | `ready-deny-<RCn>.json` |
| E-12 | 8 | 篡改域内某工具 schema 后触发 `boot` attest；随后停掉 attest 服务 | 前者比对不一致并告警；后者工具面强制仍由第 3 项保证（E-04 仍不进入可见集） | `attest-drift.json` |
| E-13 | 9 | 触发 MCP 重连预算耗尽（约 151.5 s） | 该 connector 工具不可用 + 告警 + 自动重载，域**不摘除** | `connector-lifecycle.json` |
| E-14 | 9 | 域内产生清单外注册尝试；产生 `permission/preset` 变更事件 | 均触发摘域流程且摘域动作经**独立审批**后才执行 | `drain-approval.json` |

---

## 4. 拦截点失效的影响矩阵（逐项给出立刻失效的条款）

| 失效的拦截点 | 立刻失效的 `SEC-*` | 残余防线 | 是否可继续服务 |
|---|---|---|---|
| 1（生成器） | `SEC-006`、`SEC-010`、`SEC-014`、`SEC-030`、`SEC-031`、`SEC-032`、`SEC-036`、`SEC-046` | 就绪判据 2/3/4/5 | 否（`GATE-002` 阻断） |
| 2（加载器） | `SEC-011` | 容器隔离 | 否 |
| 3（桥入口） | `SEC-005`、`SEC-012`、`SEC-019`、`SEC-020`、`SEC-022` | 全局 `guard()`（仅执行期，可见性丢失） | 否（`GATE-002` 条件 1 阻断） |
| 4（行移除） | `SEC-013` | 就绪判据 3 | 否 |
| 5（预设收敛） | `SEC-014`、`SEC-025`、`SEC-026` | 就绪判据 4；域外审批判定点 | 否 |
| 6（只读挂载） | `SEC-015`、`SEC-006` 的持久性 | 就绪判据 6 | 否 |
| 7（就绪门禁） | `SEC-016`、`SEC-037`–`SEC-044` | 无（门禁即门禁） | 否 |
| 8（attest） | **无硬保证失效**（detective） | 1–7 不变 | 是（降级为「漂移不可见」并披露） |
| 9（漂移检测） | **无硬保证失效**（detective） | 1–7 不变 | 是（摘域时效变差） |

> 第 8/9 项的失效**不**触发 `GATE-002` 失败，但必须按 `SEC-DOC-10` §2 的口径对外披露「对账只能发现不一致，不能发现伪造」。

---

## 5. 门禁引用

| 门禁条件 | 本文件的对应 | 证据 |
|---|---|---|
| `GATE-002` 条件 1（E1 强制可验证，含负向用例） | 第 3 项 + 覆盖项 | E-03、E-04、E-06 |
| `GATE-002` 条件 2（桥覆盖面实测） | 覆盖项 §1.2 | E-04、E-05、`tools/change` 指纹 diff |
| `GATE-002` 条件 3（就绪 7 条可执行） | 第 7 项 | E-11 |
| `GATE-002` 条件 8（纵深为全局 `guard()`） | 覆盖项 §1.2 | E-05 + 启动断言 `bridge.guard.installed=true` |
| `GATE-002` 条件 9（Windows ACL 实测） | 第 6 项 + `SEC-DOC-10` §5 | `SEC-DOC-10` 卸载/复原执行记录 |
| `GATE-002` 条件 10（快照 diff 收敛到 4 反转面） | 第 3 项所在面 | `ENG-032`/`ENG-033` 快照报告 |

---

## 6. 未闭合，不得据本文件声称已实现

| # | 项 | 影响 | 主 |
|---|---|---|---|
| ~~1~~ | ~~`VER-002`：全局 `guard()` 是否覆盖 PTC `run_code` / 子代理 / 嵌套派发~~ | ✅ **已定论（成立）**（`docs/bridge-defense-in-depth.md` §6）：§1.2 第四行已改为 preventive；P0 出口仍须按 §3 用域内桥与真实 Profile 复跑归档 | ENG + SEC |
| ~~2~~ | ~~桥提供的 `ctx.tools` 是否确被 MCP 行与全部注册路径使用~~ | ✅ **内核侧已定论（成立）**（`docs/bridge-defense-in-depth.md` §7）：`tools.insert` 仅存在于内核 `register()` 内，MCP 行唯一注册调用即 `ctx.tools.register`（`inject: ["tools"]`）；组合层（桥代理挂为 `tools` 服务）仍由 `E-04`/`E-05` 在 `GATE-002` 条件 2 出口随域构建实测 | ENG |
| 3 | 前提 `P-1`（`ctx.tools.register` 唯一入口）被推翻 | 九项中第 3 项及全部派生点重评 | 总纲维护者 |
