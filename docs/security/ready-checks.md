# 域就绪判据：可执行检查（7 条）

| 项 | 值 |
|---|---|
| 文档编号 | `SEC-DOC-04` |
| 交付物 | `SPEC-01` §3 交付物 4 |
| 版本 | 1.0 |
| 状态 | 生效 |
| 上游依据 | 设计文档 v2.6 §4.1.2（**门禁只接受域外事实**）/ §4.2 / §4.8.3 / §5.4 / §6.3 / §9.4；`SPEC-00` §7.1 `GATE-002` 条件 3、4 |
| 落实的 `SEC-*` | `SEC-037`、`SEC-038`、`SEC-039`、`SEC-040`、`SEC-041`、`SEC-042`、`SEC-043`、`SEC-044`；配套 `SEC-013`、`SEC-014`、`SEC-015`、`SEC-025`、`SEC-046` |
| 实现落点（引用） | `ENG-026`、`ENG-027`、`ENG-040`、`ENG-062`；`GATE-002-C11`（FTS 派生库存在性）、`GATE-002-C12`（credential provider 拒绝清单存在性） |
| 硬性纪律 | 每条的「证据来源」必须是**域外事实**。域内上报（`/internal/kernel/ready/*`、selfcheck、attest 自报）**只能**列在「交叉核验」列，**不得**出现在「判定输入」列 |

---

## 1. 判据清单与设计文档的对应（防实现错表）

`SPEC-01` `SEC-037`–`SEC-043` 是**权威顺序**（`SEC-00` §1.2：角色规格 > 设计文档）。设计文档 §4.1.2 的七行顺序不同，映射如下：

| 本文件的检查 | `SEC-*` | 设计 §4.1.2 对应行 | 差异说明 |
|---|---|---|---|
| RC-1 关键平台行无 `disabled` | `SEC-037` | 第 5 行 | 顺序不同 |
| RC-2 桥已装载且工具集 == `toolAllowlist` | `SEC-038` | 第 6 行 | 顺序不同 |
| RC-3 `plugin-manager` 与 `hmr` 无活动 fiber | `SEC-039` | （并入第 3 行"运行时配置"） | SEC 拆为独立一条 |
| RC-4 单一预设且宽模式不可达 | `SEC-040` | （并入第 4 行"Profile 已过校验"） | SEC 拆为独立一条 |
| RC-5 无 credential provider 插件 | `SEC-041` | （并入第 4 行） | SEC 拆为独立一条 |
| RC-6 只读挂载校验通过 | `SEC-042` | 第 3 行"profile 与制品路径不可写" | 同义 |
| RC-7 必需 connector 就绪 | `SEC-043` | 第 7 行 | 相同 |
| （证据来源规则） | `SEC-044` | 设计 §4.1.2 收口修正段 | 相同 |

**判定纪律**：7 条**逐条**判定，不允许合并为单一布尔值；不允许以「域能启动」替代（`SEC-044`）。

---

## 2. 逐条可执行检查

字段约定：**判定输入** = 域外事实；**交叉核验** = 域内上报，仅用于发现不一致；**拒绝路径** = 具体调用链与响应。

### RC-1 — 关键平台行无 `disabled`（`SEC-037`）

| 项 | 内容 |
|---|---|
| 判定输入（域外） | ① `criticalRows` 常量清单（域外代码常量，`ENG-027`）；② Profile `trainVersion` 单值；③ 镜像内容清单（发布时登记的包与版本）；④ 域外推定的"关键行集合" = `criticalRows` 与镜像内实际导出行的交集 |
| 检查步骤 | ① 读 `trainVersion`；② 取该列车号对应的镜像行清单（发布产物，非域内上报）；③ 对 `criticalRows` 每项断言：该行存在于镜像清单 **且** 其版本 == `trainVersion`；④ 读域外留存的运行时行清单（若有）做交叉核验 |
| 通过谓词 | `∀ row ∈ criticalRows: present(row, imageManifest) ∧ version(row) == trainVersion` |
| 失败告警 | 硬告警 `ready.denied.critical_row_disabled`；`severity=critical`；载荷 `{domainId, row, expected, actual}`；不得降级为通知 |
| 拒绝路径 | Session Router：`creating --RC1 fail--> failed(ready_denied)`；域**不得**进入 `ready`，**不得**接收任何会话；会话创建请求返回 `503`，响应体 `{"error":"domain_not_ready","check":"RC-1","row":"<行名>"}` |
| 交叉核验 | 域内 selfcheck 的 `{item:"criticalRows", ok, detail}`；不一致 ⇒ 记漂移并进入摘域流程（**不是**通过依据） |
| 失败注入用例 | 构造 peer 版本不匹配使反向网关适配器行被标 `disabled`；断言 `ready=false` + 告警 + 失败信息**列出具体行名**（`ENG-026` 判据③） |
| 不可判定条件 | `criticalRows` 清单缺失，或 `trainVersion` 非单值 ⇒ 判 **不通过**（不是跳过） |
| 证据工件 | `evidence/GATE-002/RC-1/<domainId>/<ts>.json`，字段 `{rowsExpected[], rowsFromImage[], verdict}` |

### RC-2 — 桥已装载且工具集 == `toolAllowlist`（`SEC-038`）

| 项 | 内容 |
|---|---|
| 判定输入（域外） | ① Profile 的 `toolAllowlist`；② 含桥制品的镜像摘要（**装配由 Profile 决定**）；③ 域外保存的工具面快照来源：进入模型的 tools 数组/`GET /v1/sessions/{id}/tools` 的**域外可观测副本**（网关侧） |
| 检查步骤 | ① 断言镜像含桥制品且镜像摘要匹配；② 取域外观测到的工具名集合 `T_obs`；③ 计算 `T_obs Δ allowlist` |
| 通过谓词 | `桥制品在镜像内` ∧ `T_obs == set(toolAllowlist)`（**集合相等，不是包含**） |
| 失败告警 | 硬告警 `ready.denied.toolset_mismatch`；载荷 `{domainId, diff:{extra[], missing[]}}` |
| 拒绝路径 | `creating --RC2 fail--> failed(ready_denied)`；`{"error":"domain_not_ready","check":"RC-2","extra":[…],"missing":[…]} ` |
| 交叉核验 | 桥自测端点 / 域内上报的工具集指纹；不一致 ⇒ 摘域流程 |
| 失败注入用例 | ① 以缺失桥的镜像启动 ⇒ 拒绝 ready；② 正常镜像下比对两侧集合，差集必须为空；③ 受控恶意 MCP 推送新工具（`SEC-005` 负向用例）⇒ `T_obs` 不得出现该名 |
| 注意事项 | 桥的**运行期断言输出**不得替代本条的域外判定（`SEC-DOC-01` §1.2） |
| 证据工件 | `evidence/GATE-002/RC-2/<domainId>/<ts>.json`，含两侧集合与 diff |

### RC-3 — `plugin-manager` 与 `hmr` 无活动 fiber（`SEC-039`）

| 项 | 内容 |
|---|---|
| 判定输入（域外） | ① Profile `removedRows` ⊇ `{tool-plugin-manager, plugin-manager}`；② `hmr.enabled === false`；③ 域外编排器读取的容器内活动 fiber 清单（经域外执行的任务产出，非域内自报） |
| 检查步骤 | ① 校验 Profile 两项；② 在容器内由**域外驱动**的采集任务枚举活动 fiber，输出仍由域外落库 |
| 通过谓词 | `removedRows ⊇ {tool-plugin-manager, plugin-manager}` ∧ `hmr.enabled === false` ∧ `fiberSet ∩ {plugin-manager, hmr} == ∅` |
| 失败告警 | 硬告警 `ready.denied.manager_fiber_present`；载荷 `{domainId, fibers[]}` |
| 拒绝路径 | `creating --RC3 fail--> failed(ready_denied)`；响应 `{"error":"domain_not_ready","check":"RC-3","fibers":[…]}` |
| 交叉核验 | 域内 `活动 fiber 检查`（attest 请求字段）；不一致 ⇒ 摘域流程 |
| 失败注入用例 | 以未移除行的镜像启动 ⇒ 检出对应 fiber 并拒绝 ready；已移除时无对应 fiber |
| 证据工件 | `evidence/GATE-002/RC-3/<domainId>/<ts>.json`，含 `removedRows`、`hmr`、`fibers[]` |

### RC-4 — 单一预设且宽模式不可达（`SEC-040`）

| 项 | 内容 |
|---|---|
| 判定输入（域外） | ① Profile `permissionPresets.enabled` / `.reachable`；② 容器环境变量 `DSH_PERMISSION_MODE` 的**注入值**（域外编排器记录，不读域内回显）；③ `sandboxMode` / `sandboxModeCeiling` |
| 检查步骤 | ① `reachable.length == 1`；② `reachable[0] ∉ {danger-full-access, never}`；③ `env.DSH_PERMISSION_MODE == "read-only"`；④ `order(sandboxMode) ≤ order(sandboxModeCeiling)` |
| 通过谓词 | 四项全真；任一项假 ⇒ 拒绝 ready |
| 失败告警 | 硬告警 `ready.denied.preset_reachable`；载荷 `{domainId, reachable[], env, ceiling}` |
| 拒绝路径 | `creating --RC4 fail--> failed(ready_denied)`；响应 `{"error":"domain_not_ready","check":"RC-4"}`；另：Remote `permissionPresets.set()` 不向产品壳暴露 |
| 交叉核验 | 域内会话日志 `permission/preset` 变更事件；出现即 60 s 内判漂移（`SEC-027`） |
| 失败注入用例 | 以含 `danger-full-access` 的预设表启动域并按名引用该预设 ⇒ 拒绝 ready；正常配置下按名引用不可达 |
| 证据工件 | `evidence/GATE-002/RC-4/<domainId>/<ts>.json` |

### RC-5 — 无 credential provider 插件（`SEC-041`）

| 项 | 内容 |
|---|---|
| 判定输入（域外） | ① Profile `pluginSet` 与生成后的实际行清单；② 拒绝清单（`SEC-DOC-05` §2，代码常量 + 快照保护 `GATE-002-C12`） |
| 检查步骤 | ① 计算 `pluginSet ∩ denylist`；② 断言为空；③ 断言拒绝清单文件存在且非空（`GATE-002-C12`） |
| 通过谓词 | `pluginSet ∩ denylist == ∅` ∧ 拒绝清单存在 |
| 失败告警 | 硬告警 `ready.denied.credential_provider_present`；载荷 `{domainId, packages[]}` |
| 拒绝路径 | ① 域外生成器**拒绝签发**（首选）；② 若已签发，则 RC-5 判定 `fail` ⇒ `failed(ready_denied)` + 摘域流程 |
| 交叉核验 | 域内活动 fiber / 环境扫描（detective 补充，`SEC-045`） |
| 失败注入用例 | 强行加入 `dsh-credentials-local` 行 ⇒ 生成器拒签或 RC-5 拒绝 ready |
| 证据工件 | `evidence/GATE-002/RC-5/<domainId>/<ts>.json`，含 `denylistHash` |

### RC-6 — 只读挂载校验通过（`SEC-042`）

| 项 | 内容 |
|---|---|
| 判定输入（域外） | ① 域外编排器的挂载声明（挂载源、目标、`readOnly` 标志、特权位、附加挂载）；② 挂载内容摘要 `mountDigest` |
| 检查步骤 | ① 断言四类路径（`cordis.patch.yml`、`package.json`、`compatibility.json`、插件制品目录）均 `readOnly: true`；② 断言无声明外挂载、无特权、无 `hostPath` 直通；③ 断言 `mountDigest == profileGenerationDigest` 的挂载部分 |
| 通过谓词 | 三项全真 |
| 失败告警 | 硬告警 `ready.denied.mount_writable`；载荷 `{domainId, path, mountSpec}` |
| 拒绝路径 | `creating --RC6 fail--> failed(ready_denied)`；响应 `{"error":"domain_not_ready","check":"RC-6","path":"<路径>"}` |
| 交叉核验 | 域内写尝试全失败（`SEC-015` 验收） |
| 失败注入用例 | 以可写方式挂载 `cordis.patch.yml` 启动域 ⇒ 拒绝 ready |
| 证据工件 | `evidence/GATE-002/RC-6/<domainId>/<ts>.json`，含挂载声明与 `mountDigest` |

### RC-7 — 必需 connector 就绪（`SEC-043`）

| 项 | 内容 |
|---|---|
| 判定输入（域外） | Session Router 的 connector 探针结果（域外发起、域外判定）；Profile `connectors[].required` |
| 检查步骤 | 对每个 `required: true` 的 connector 执行探针（建连 + `tools/list` 成功）；记录 `{serverName, ok, toolCount}` |
| 通过谓词 | `∀ c: required(c) ⇒ ok(c)` |
| 失败告警 | 硬告警 `ready.denied.required_connector`；载荷 `{domainId, serverName, reason}` |
| 拒绝路径 | **差异点**：本条失败 ⇒ 域**不进入 `active`**（可停在 `ready` 但不可服务），**不**判 `ready_denied`；会话创建返回 `503`，响应 `{"error":"required_connector_unavailable","serverName":"…"}` |
| 交叉核验 | `connector.state` 事件 |
| 失败注入用例 | 停掉一个 `required: true` 的 connector ⇒ 域不进入 `active`；改为非必需 ⇒ 域进入 `active` 且该 connector 工具不可用 |
| 实现禁令 | **不得**用 `failOnStartupError` 表达必需性（该字段已从 schema 废止） |
| 证据工件 | `evidence/GATE-002/RC-7/<domainId>/<ts>.json`，逐 connector 一行 |

---

## 3. 判定函数与域外证据记录

### 3.1 判定（伪代码，语义固定）

```
ready(domain) =
      RC1 ∧ RC2 ∧ RC3 ∧ RC4 ∧ RC5 ∧ RC6        // 任一 false ⇒ ready=false 且不接收会话
active(domain) = ready(domain) ∧ RC7           // RC7 false ⇒ 不进入 active
```

- 任一 `RCn` 判定**不可执行**（输入缺失）⇒ 记 `fail`，**不得**记 `pass`、**不得**记 `skip`。
- 判定结果必须落审计（`ready.decision`），字段 `{domainId, results:{RC1..RC7}, evidenceRefs[], decidedAt}`，留存同审计策略（`SEC-076`）。

### 3.2 域外证据记录 schema（`domainEvidence` 的落地形态）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `domainId` | string | 是 | 域标识 |
| `tenantId` / `isolationGroupId` | string | 是 | `SEC-007` 绑定 |
| `imageDigest` | string | 是 | 镜像摘要（域外自产） |
| `mountDigest` | string | 是 | 只读挂载内容摘要 |
| `runtimeConfigDigest` | string | 是 | 运行时配置快照摘要（挂载表、特权、用户、网络策略） |
| `profileGenerationDigest` | string | 是 | Profile 生成摘要 |
| `criticalRowsDigest` | string | 是 | `criticalRows` 常量的版本化摘要 |
| `denylistDigest` | string | 是 | credential provider 拒绝清单摘要（`GATE-002-C12`） |
| `results` | object | 是 | `{RC1..RC7: {verdict, observed, source}}` |
| `createdAt` | string | 是 | UTC ISO-8601，含域外时钟源标识 |
| `retainedAt` | string | 是 | 留存位置（WORM 路径） |

**留存要求**：每次域创建必须留证（`GATE-002` 条件 4）；留存期 ≥ 366 天；记录本身进哈希链。

---

## 4. 失败注入用例矩阵（逐条一个可执行检查）

| 用例 | 注入 | 期望观察（逐条独立告警） | 期望拒绝形式 |
|---|---|---|---|
| RC-1-F | peer 版本不匹配 ⇒ 关键行 `disabled` | `ready.denied.critical_row_disabled` + 行名 | 拒绝 ready |
| RC-2-F | 镜像缺桥；或白名单外注入一个工具 | `ready.denied.toolset_mismatch` + diff | 拒绝 ready |
| RC-3-F | 未移除 `plugin-manager` 行 | `ready.denied.manager_fiber_present` | 拒绝 ready |
| RC-4-F | 预设表含 `danger-full-access` | `ready.denied.preset_reachable` | 拒绝 ready |
| RC-5-F | Profile 强加 `dsh-credentials-local` | `ready.denied.credential_provider_present`（或生成器拒签） | 拒绝 ready |
| RC-6-F | 可写挂载 `cordis.patch.yml` | `ready.denied.mount_writable` + 路径 | 拒绝 ready |
| RC-7-F | 停必需 connector | `ready.denied.required_connector` | 不进入 `active` |
| G-1 | 构造"能启动但 6 条中任一条失败"的域 | 7 种失败态各自独立告警；无一被「能启动」掩盖 | 全部阻断 |
| G-2 | 全部七条通过 | `ready.decision` 记 7×`pass`；会话可创建 | 进入 `active` |

**门禁证据**：以上 9 行构成 `GATE-002` 条件 3 的证据集；缺任一行 ⇒ 条件 3 不通过。

---

## 5. 与其他规格的接口

| 依赖 | 来源 | 内容 |
|---|---|---|
| `REL-044`(d) | `SPEC-02` | RC 失败 ⇒ 降级级别 **L3**、当前轮次被拒并携带原因码 |
| `REL-124` | `SPEC-02` | 「域就绪判据失败」必须为**硬告警**，不得降级为通知 |
| `ENG-026` / `ENG-027` / `ENG-040` | `SPEC-03` | RC-1 的实现、`criticalRows` 常量、启动自检项清单 |
| `ENG-062` | `SPEC-03` | `deadlines`/`buffers`/`sandboxModeCeiling` 纳入自检项 |
| `SEC-069`/`SEC-070` | 本角色 | `ready.decision` 与 `ready.denied.*` 的审计字段与 fail-closed 语义（`SEC-DOC-07`） |

---

## 6. 本文件的失效条件

| 触发 | 动作 |
|---|---|
| 内核新增"就绪"概念或新判定源 | 重评 §1 映射与 §3.1 判定函数 |
| `P-2` 被推翻（镜像或挂载层可被域内改写） | RC-1/RC-2/RC-3/RC-6 的证据来源须重新设计 |
| `GATE-002-C11`/`C12` 检查项编号变更 | 同步本文件 §2 RC-2/RC-5 与 `SEC-DOC-13` 证据索引 |
