# 《DSH 企业级技术方案设计》v2.1 独立架构评审

| 项 | 值 |
|---|---|
| 评审对象 | `D:\proJects\open-viking\DSH企业级技术方案设计.md`（v2.1，981 行） |
| 评审人 | architect-reviewer（未参与该方案设计） |
| 评审方式 | 只读；逐条回源码/README/`.d.ts` 核对，不采信文档自述 |
| 证据基线 | 本机发行包：`C:\Users\pxgwt\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`（下文以 `PKG\` 代指此目录） |
| 结论 | **需修订后实施** |

> **重要前置说明**：文档第 8 行声明"内核基线 `@deepseek-ai/dsh` **0.1.6-alpha.2**（依赖包结构实测）"。
> 本机 `@deepseek-ai/dsh` 实际版本为 **0.2.0-rc.2**，其下全部 `@deepseek-ai/dsh-*` 依赖包亦均为 `0.2.0-rc.2`
> （`PKG\..\package.json:4`、各包 `package.json`）。本机全盘未发现任何 `0.1.6-alpha.2` 制品。
> 本报告的**全部源码依据取自 0.2.0-rc.2**。因此文档中所有标注"实测"的平台事实**无法在其自称的基线上被复核**（见【阻断】B1）。

---

## 1. 总体结论

**需修订后实施。**

理由摘要：

1. **正面结论**：方案最关键的两个假设**没有崩塌**，应予肯定。
   - "轮次边界迁移"（C2）与"同一份日志在新进程恢复"（G3/P1 的根基）在 DSH 中是**真实存在的能力**：
     `ctx.agents.resume()` / `agents[].resumeSessionId` 加载持久化会话，`resume` 先 `persistence.open(id,'write')`
     取写所有权再读日志（`PKG\dsh-agent-loop\README.zh.md:55,61,115`；`PKG\dsh-session-persistence\README.zh.md:39-41`）。
   - §2.2 的 C1–C12（除表述外延外）**逐条都能在源码/README 找到依据**，未发现凭空编造的平台事实。
2. **但方案对"恢复"的语义描述与 DSH 实际相反**（B4），P1 若按文档字面实现，会得到一个 DSH 根本不提供的"回滚到最近完整轮次"。
3. **§5.3 的"分层锁/硬约束"被当成了平台强制力，实际只是产品侧约定**（B2），而文档自己在 D2 中已声明内核进程不可信——两者冲突，且这是全篇唯一的"租户不可越权"防线。
4. **§8.2 的"零 MCP 凭证"与 §4.8 的 stdio 传输无法调和**（B3），P0 的验收判据"G1 达成：域内不存在任何凭证（含 MCP）"与常见 stdio MCP 服务器直接冲突。
5. 另有 12 条【重要】、9 条【建议】，集中在 MCP 出站代理的可行性、审批强度声明、Windows 补偿表的事实错误、SLO 无依据、删除/保留无平台接口等。

---

## 2. 【阻断】

### B1（事实错误）基线版本不一致，全部"实测"结论不可复核

- **位置**：文档第 8 行（内核基线）、§1.3（第 45-47 行）、§13.1（第 942-963 行）。
- **问题**：文档自称基线为 `0.1.6-alpha.2` 并声明所有平台事实来自"发行包实测"。但本机唯一的发行包是 `0.2.0-rc.2`，其下 200+ 个 `dsh-*` 包版本全部为 `0.2.0-rc.2`；全盘未发现 `0.1.6-alpha.2`。这意味着：
  - 文档中每一条"实测"断言都**无法在它声明的版本上复核**；
  - 若实际设计目标是 0.2.0-rc.2，则该版本字符串是错误的事实陈述，且 0.1.6→0.2.0 间的破坏性变更未被评估（例如本机 0.2.0 已引入 `dsh-session-format-v1..v4` 多代际格式与 `dsh-session-query`、`dsh-permission-presets` 等包，见 §I12）。
- **依据**：`PKG\..\package.json:4`（`"version": "0.2.0-rc.2"`）；抽查 `PKG\dsh-llm\package.json`、`PKG\dsh-mcp-client\package.json`、`PKG\dsh-user-approval\package.json` 均为 `0.2.0-rc.2`。
- **修改建议**：明确并冻结真实基线；重跑一次 §13.1 全部条目的核对；在文档头部加入"基线变更影响评估"一节（尤其 session 日志格式代际、preset 语义、沙箱默认档）。**在版本对齐前，本方案不应进入 P0 编码。**

### B2（事实错误＋架构自相矛盾）§5.3「分层锁」不是平台约束，且校验点落在自认不可信的域内

- **位置**：§1.2 插件五分类（第 32 行）、§5.3 第 401-414 行（"硬约束"在第 414 行）、§6.2 第 589 行（`pluginSet[].tier` "域启动时校验层级权限"）、§2.3 D2（第 86 行）。
- **问题**：
  1. DSH **不存在**任何"层"/"tier"/"锁定"概念。preset 就是一份 Cordis YAML 子插件列表；官方 README 原文：**"preset 不是安全沙箱：YAML 及插件可以执行 Host 代码。用户覆盖替换完整子插件列表，不自动合并内置列表的未来更新。"**（`PKG\dsh-agent-preset-registry\README.zh.md:95`）。即：租户侧的 preset 覆盖是**整体替换**，可以一次性去掉平台方注入的 seam 提供方——这与"第 2 类（seam 提供方）绝不进入租户自定义层"的"硬约束"直接冲突。
  2. 文档把层级校验放在"域启动时"（§6.2 第 589 行），而 D2 明确"DSH 内核进程是**不可信执行域**"。让不可信域自我校验加载层级，等于没有校验。DSH 启动期的真实校验只有 **peer 版本兼容性**，README 原文："这些检查使用 peer 声明，而不是 `engines.dsh`，**也不是防范恶意包代码的沙箱**"（`PKG\dsh-app-boot\README.zh.md:52`）。文档 §5.3 第 426 行声称"域启动时校验哈希与签名，失败即拒绝启动"——**DSH 不校验哈希与签名**，这是产品侧需要自行实现的能力，文档未标注。
  3. 域内 profile 是可写的：`dsh-base` 默认**挂载** `plugin-manager` 服务（`PKG\dsh-base\cordis.patch.yml:20-22`），其 `plugin_manager` 工具默认禁用（同文件第 16-18 行 `disabled: true`），但"使用预设的会话由其预设中的 `tool-plugin-manager` 条目控制"（`PKG\dsh-plugin-manager\README.zh.md:31-33`），Creator 预设即启用。而"已安装的 Host 代码在宿主进程内运行，**不受工作区沙箱限制**"（同上第 31 行）。因此只要某个预设启用了该工具、或某次 `danger-full-access` 调用获批，profile 的 `cordis.patch.yml`/`package.json` 与插件依赖都可被改写。
- **依据**：`PKG\dsh-agent-preset-registry\README.zh.md:95`；`PKG\dsh-app-boot\README.zh.md:52-54`；`PKG\dsh-base\cordis.patch.yml:16-22`；`PKG\dsh-plugin-manager\README.zh.md:31,40,132`；`PKG\dsh-scope\README.zh.md:60`（"该原语用于路由受信任的同进程插件；**它不是沙箱或权限边界**"）。
- **修改建议**：
  1. 明确"分层锁"是**产品侧治理策略**，不是 DSH 平台事实；从 §5.3 的"硬约束"降级为设计规定，并补上执行点：**Profile 在控制面生成 + 完整性（哈希/签名）在域外的加载器包装层校验 + 域启动前 attest**；
  2. 域内注入的 profile 文件（`cordis.patch.yml`、`package.json`、`compatibility.json`）应只读挂载，且**默认禁用 `tool-plugin-manager`、禁止任何预设启用它**；把"禁止域内改写组合"写入 §4.1 的域规格与 §8.2 的禁止项；
  3. 把 `pluginSet[].tier` 的校验从"域启动时"移到"控制面生成 Profile 时"，域只接收已裁决结果。

### B3（架构自相矛盾）stdio MCP 与 G1「内核零凭证」不可调和

- **位置**：§2.1 G1（第 57 行）、§4.8 传输表与凭证处理（第 336-351 行）、§6.2 第 586 行与示例第 561-565 行、§8.2 第 723 行、§12 P0 验收（第 929 行）。
- **问题**：文档规定"MCP 凭证**同样不得进入域内**"，并只给出**一条**合规路径：`streamable-http` 的 `url` 指向产品侧出站凭证代理（方案 a）。但 `stdio` 型 MCP 服务器的凭证只能通过 `env` 传入，而 `env` 的定义是"**合并到已清洗环境之上**"、"域容器内 spawn 子进程"（`PKG\dsh-mcp-client\README.zh.md:59`、`PKG\dsh-mcp-client\lib\types\index.d.ts:37-45`），即凭证**必然落在域内子进程环境变量中**。DSH 官方 README 的示例本身就是 `GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN`（`PKG\dsh-mcp-client\README.zh.md:42-44`）。文档 §6.2 的 stdio 示例把 `env` 写成 `{}`（第 564 行），等于默认 stdio connector **不需要凭证**——但这是绝大多数企业内网 MCP 工具的现实形态。
- **依据**：`PKG\dsh-mcp-client\README.zh.md:42-44,59,138`；`PKG\dsh-mcp-client\lib\types\index.d.ts:27-48`（`stdio` 分支含 `env`）；文档 §4.8 第 344-351 行只覆盖 `streamable-http`。
- **修改建议**：三选一并写入文档：
  1. 允许 stdio connector 使用**域级短时令牌**（与方案 b 同等口径，TTL ≤ 5 min），并把 G1 的判据从"不存在任何 MCP 凭证"改为"不存在长期凭证，域内凭证均为 ≤5 min 且由代理按需签发"；
  2. 为 stdio 定义"启动器包装"：域内不持有令牌，由包装器在 spawn 时向凭证代理换取一次性令牌并注入子进程（须承认令牌会短暂存在于域内）；
  3. 明文规定"stdio connector 不得需要凭证"，并在 Connector Registry 的准入清单中强制校验。
  **无论选哪条，P0 的验收判据必须相应改写**，否则 P0 无法验收。

### B4（事实错误）恢复语义与 DSH 相反：DSH 不支持"回滚到最近完整轮次"

- **位置**：§4.3 第 243 行（"运行时失败 → 从最近完整轮次恢复"）、§4.4 第 275 行、§4.7 第 329 行（"恢复后从最近完整轮次续跑"）、§7.4 第 683-690 行、§9.2 第 820 行。
- **问题**：DSH 的崩溃恢复是**追加合成 closer**，不是回滚。官方原文：
  - "崩溃后，已存储日志保留被中断的最终轮次……由执行恢复的读方通过其写句柄追加合成 closer"（`PKG\dsh-session-persistence-jsonl\README.zh.md:76`）；
  - "**合成 closer 是唯一崩溃方案**——恢复通过写句柄追加 `interruptedTurnClosers`；**没有继续中断轮次而不先关闭它的部分轮次恢复**"（`PKG\dsh-session-persistence\README.zh.md:154`）；
  - `resume` 的实际动作："通过句柄读取物理上有效的日志，并为在轮次中途崩溃的日志把 `interruptedTurnClosers` 作为普通批次追加"（`PKG\dsh-agent-loop\README.zh.md:115`）。
  即：中断轮次的**部分事件永久留在历史中**，DSH 用 `TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN` 结果配平，并指示模型"只重试只读或幂等操作；可能有副作用时先核验外部状态或询问用户"（`PKG\dsh-session\README.zh.md:160`）。文档 §4.3/§4.7/§9.2 承诺的"从最近完整轮次恢复/续跑"在 DSH 中不存在。
  另：文档 §7.4 第 687 行的恢复流程"**重放事件重建不变量状态 → 校验**"同样无支撑——seam 只暴露 `read/append/flush/close`（`PKG\dsh-session-persistence\lib\types\handle.d.ts:75,88,99,105`），DSH 的"重放"是 surface 折叠出模型历史，不是重建任意不变量状态。
- **依据**：上列四处 README 行号；`PKG\dsh-session-persistence\lib\types\handle.d.ts:75-105`。
- **修改建议**：
  1. 恢复语义改为："恢复 = `persistence.open(id,'write')` + 读日志 + 追加 `interruptedTurnClosers`；中断轮次**保留在历史中**，其副作用由产品侧策略补偿"；
  2. 若产品确实需要"回滚到完整轮次"，唯一合法路径是 **resume 后 `ctx.sessions.fork(source, boundary)` 派生子会话**（`PKG\dsh-session\README.zh.md:68`），但注意 fork 仅接受**活跃源会话**（同文件第 191 行），且子会话 id 变更——必须写入 §5.4 的迁移/恢复设计与 §6.1 的接口（会话 id 会变，前端与审计需相应处理）；
  3. 删除"重放事件重建不变量状态"的表述，改为"从日志前缀折叠模型历史 + 追加 closer"。

---

## 3. 【重要】

### I1（设计分歧，低估成本）出站凭证代理不是"通用 HTTP 转发"，而是 Streamable HTTP 协议栈的一部分

- **位置**：§4.8 第 340、348 行；§3.1 控制面组件"出站凭证代理"（第 108 行）；§3.3 第 157 行（"网关与凭证代理｜无状态服务｜副本数"）；§6.3 第 601 行（`/internal/egress/mcp/{serverName}`，方法 ALL）。
- **问题**：要让域内 `dsh-mcp-client` 的 `url` 指向代理，代理必须是一个**协议感知的 Streamable HTTP 反向代理**，至少需要：透传 `Accept: application/json, text/event-stream`、协议版本与 `Mcp-Session-Id`；支持 POST/GET（SSE 长连接）/DELETE 三种语义；不缓冲长连接、不吃掉中间设备的空闲超时；保证同一 MCP session 的上游亲和。文档把它描述成"无状态、多副本、不缓存决策"的凭证串接件，且没有一条关于 SSE 长连接、会话亲和、空闲超时的规定——按文档实现会得到一个**破坏 MCP 协商与 SSE 的代理**。同时，租户业务数据将流经控制面共享组件，这与 §3.2"控制面不承载业务状态"、§8.3"凭证｜租户隔离"、D6"执行分散"三处表述均有张力。
- **依据**：`PKG\dsh-mcp-client\README.zh.md:28,211`（"初始探测失败或 stdio 子进程崩溃都会使用配置的重连预算；HTTP 建立连接后，请求失败使用 SDK 传输的恢复机制"）；`PKG\dsh-mcp-client\lib\types\index.d.ts:54-71`（`streamable-http` 只有 `url`/`headers`）；文档 §3.3 第 157 行。
- **修改建议**：把代理重新定位为**数据面组件**，产出专门的协议要求清单（SSE 透传、无缓冲、session 亲和、空闲/首字节超时、请求体大小上限、上游连接池、凭证绑定到 (tenant, connector)）。或者放弃方案 a，采用 §4.8 的方案 b（域级短时令牌 ≤5 min），并明确接受"短期凭证在域内"这一残余风险——这比一个未定义的代理更可控。

### I2（事实错误）`failOnStartupError: true` 不能把关"域就绪"，"不 await 阻塞"也不是配置能实现的

- **位置**：§4.2 第 213 行（"MCP 挂载置于初始化序列末位且不阻塞其他能力"）、§4.8 第 353 行、§9.2 第 818 行（"否（必需 connector 除外）"）、§10.1 第 854 行。
- **问题**：
  1. `dsh-mcp-client` 的 `apply` **会等待**初始连接与发现完成（"启动监督器，并等待初始连接加发现完成"，`PKG\dsh-mcp-client\README.zh.md:128`）。因此"不 await 阻塞"**不是配置能做到的**——除非产品侧写一个包装插件在 boot 之后动态挂载 mcp-client 行，而文档明确说"两种均由 Runtime Profile 按域生成 Cordis 配置实现，**无需修改 DSH**"（第 351 行）。
  2. `failOnStartupError: true` 只让"插件激活"失败，而 MCP 行在 app-boot 中属于 **optional 条目**，required 名单是全局的（`agent-loop`/`webserver`/`modules`/`connection`/`headless-runner`/`acp`/`sdk-jsonrpc-server`），**不含任何 MCP 行**；官方原文："app-boot 的启动策略**仍允许可选 MCP 配置项失败，而不中止 harness**"（`PKG\dsh-mcp-client\README.zh.md:71`；`PKG\dsh-app-boot\README.zh.md:43,94`）。所以"必需 connector 置 true"达不到"域不就绪"的效果。
- **依据**：上列三处 README 行号。
- **修改建议**：把"域就绪"的门禁移到 **Session Router 的产品侧就绪探针**（§5.4），明确"必需 connector"由路由器判定，而非由 `failOnStartupError` 表达；删除或改写"不 await 阻塞"的表述，或把动态挂载列为 P0 的自研插件交付物（并同步 §12 的 P0 交付清单）。

### I3（威胁模型缺口）`instructions` 不是唯一的 MCP 注入面，且过滤点只有一个

- **位置**：§8.6 第 779-789 行、§8.5 第 772 行、§2.2 C10（第 77 行）、§7.1（第 649-657 行）。
- **问题**：文档把 MCP 提示注入面收窄为 `instructions` 段落。但 DSH 中进入模型上下文的 MCP 内容至少还有三类：**工具描述与输入 schema**（"工具注册期间，工具描述与输入 schema 会进入每次请求"，`PKG\dsh-mcp-client\README.zh.md:168`）、**工具结果与资源正文**（同文件第 178-186 行）。只过滤 `instructions` 相当于只堵住三个通道里最小的一个。
  关于"过滤点在哪里"：**确实拦得到**，且只有一个正确的点——`ctx.systemPrompt` 的 `system-prompt/assemble` waterfall；其 `assembly` 参数被明确描述为 **mutable**，返回值具权威性（`PKG\dsh-system-prompt\lib\types\index.d.ts:16-27`）。工具结果侧可用 `tools/post-execute` 包装。文档没有指出这个机制，读者会以为"过滤"是个平台现成功能。
- **依据**：上列 `dsh-mcp-client` README 行号与 `dsh-system-prompt` d.ts 行号；`PKG\dsh-mcp-resources\README.md:59`（"Server instructions belong to the MCP client and its logged system-prompt section"）。
- **修改建议**：把信任级策略扩展到"instructions + 工具描述/schema + 工具结果/资源正文"四类，并写明实施点（域内产品插件：`system-prompt/assemble` 段过滤 + `tools/post-execute` 结果包装/标注来源）。同时承认：域内过滤对"域内其他插件"不构成强制（scoped 注册机制"不是沙箱"，`PKG\dsh-scope\README.zh.md:60`）。

### I4（事实错误＋低估成本）跨进程单写者与迁移：文档完全没提锁、租约与 fencing

- **位置**：§5.4 第 436 行（迁移五步）、§7.3 第 677-679 行（卷 + 快照）、§12 P1（第 930 行"会话日志外置对象存储；替换 persistence 落点"）。
- **问题**：seam 只保证"**单个后端实例内**的写所有权"，跨进程排他由具体提供方负责；随产品交付的 JSONL 提供方用 `session.lock` 上的 `flock(2)`（Windows 为按路径派生的命名内核信号量）实现，"**咨询式 `flock` 在部分网络文件系统（NFSv3）上不可靠**，Windows 信号量名按登录会话隔离"（`PKG\dsh-session-persistence\README.zh.md:149`；`PKG\dsh-session-persistence-jsonl\README.zh.md:164`）。此外："活着的卡死持有者会阻塞写入方直到其进程退出"，且"在有活跃会话时重载后端插件会使其写入器明确报错……没有任何机制静默重新接管日志"（同两处）。
  文档把 P1 写成"替换 persistence 落点"，把迁移写成"提交日志 → 目标域恢复 → 切换路由"，既没有租约/围栏令牌，也没有"源域必须先关闭句柄释放锁"这一必要步骤。若日志落在共享 NFS/对象存储 FUSE 上，两个域同时写同一会话是**可能发生的静默双写**——这对"RPO 0 / 已提交轮次不丢失"是致命缺陷。
- **依据**：上列两处 README 行号；`PKG\dsh-agent-loop\README.zh.md:115`（`resume` 用 `open(id,'write')` "排除同 id 的并发恢复"）。
- **修改建议**：在产品侧 persistence 提供方中实现带 fencing token 的租约（或坚持"每域本地卷 + 异步复制到对象存储，不共享写路径"），并把迁移步骤补全为：静默 → 等轮次结束 → 暂停域 → **closer/关闭句柄并释放锁** → 校验日志完整性 → 目标域 `open(id,'write')` 取锁 → 切换路由；为卡死持有者定义超时与人工介入流程。P1 的交付物与工作量需按"实现一个新的 `SessionPersistence` 提供方"重估。

### I5（完备性缺口）删除/保留/数据主体请求在 DSH 侧没有任何接口

- **位置**：§4.3 第 236-240 行（`archived`/`destroyed`）、§7.5 第 692-703 行、§9.1（无删除相关 SLO）。
- **问题**：seam 明确"**无删除或保留接口**——剪枝已存储会话属于带外后端维护"，且"`list()` 无分页且无过滤——它返回每个已存储会话的快照；适合本地存储，大规模时无索引"（`PKG\dsh-session-persistence\README.zh.md:152-153`；`PKG\dsh-session-persistence-jsonl\README.zh.md:163`）。DSH 的 `workspace` 归档只是宿主侧分组标记，不删除数据，且"会话删除与文件夹移除是彼此独立且尚未提供的功能"（`PKG\dsh-workspace\README.zh.md:172`）。因此文档的 `destroyed` 状态、180 天保留、数据主体删除全部需要产品侧带外实现，且必须与 `session.lock`、workspace 注册记录、审计最小集协同。
- **依据**：上列 README 行号。
- **修改建议**：在 §7.5 增加"删除实现方式"一栏（对象存储生命周期规则 + 元数据库墓碑 + 锁协调），把"保留/删除服务"列为 P3 的显式交付物；并把 `list()` 无索引作为 Session Router / 控制面的容量前提（控制面必须自建会话索引，不能依赖 `list()`）。

### I6（事实错误＋内部矛盾）§8.4 Windows 补偿表两处与源码相反，且与 §13.1 自相矛盾

- **位置**：§8.4 第 753-762 行（补偿表），与 §13.1 第 954 行、§7.3 第 677-679 行冲突。
- **问题**：
  1. "常驻 Low 标签外溢至 DSH 之外 ｜ **标签仅存在于容器内，随域销毁**"——**错误**。官方原文："**安全描述符改动是对真实目录的驻留改动**。工作区 ACE、拒绝项与标签按设计常驻（复用缓存，绝不撤销）"；"**常驻 Low 标签的生命期长于 DSH**，并会向其他 Low 完整性的进程放宽该目录树……工作区的可继承标签在会话结束后（**以及同卷移动后**）依然存在"；"手工 `icacls` 清理无法在本平台回收它们（`ERROR_NONE_MAPPED` 1332）"（`PKG\dsh-sandbox-windows-acl\README.zh.md:130-131`）。而 §13.1 第 954 行自己列了"Low 标签生命期长于 DSH；`icacls` 无法回收"——**同一文档两处相反**。由于 workspace 是跨域持久化的卷（§7.3），"随域销毁"在物理上不成立。
  2. "AppContainer 包 SID 目录不可读 ｜ 域内使用独立用户，不复用宿主 ACL 状态"——**归因错误**。读失败源于**文件的 DACL 携带包 SID ACE**（由其他 AppContainer 自我隔离的工具写入），与域内用户身份无关；"补授 Everyone 读取无法解除"（同文件第 191 行）。用独立用户并不能修复。
  3. 另缺一条容量事实：授权物化是"急切的全树传播……**大型工作区树上以数十秒计**"（同文件第 189 行），§10.1 的域池预热与 §10.3 容量模型均未计入。
- **依据**：上列 `dsh-sandbox-windows-acl\README.zh.md` 行号。
- **修改建议**：改写两行（真实结论：Low 标签是不可回收的宿主侧残留，只能靠"每域独立卷 + 不与其他租户共享底层文件"控制影响面）；把大树 ACL 传播耗时写入 §10.1 预热预算与 §9.1 的域启动耗时指标。

### I7（事实错误）checkpoint / invariants 的默认挂载状态与文档描述错位

- **位置**：§7.2 第 666 行（"轮次结束 `fsync` 后视为已提交；不变量校验在追加前执行"）、§4.2 第 192 行（`ctx.invariants` 实现方写"内核内置"）、§11.1 第 894 行。
- **问题**：
  1. 提交点是 **flush**，不是"轮次结束 fsync"；`append` 明确是尽力而为，"只有完成的 `flush` 才承诺它在崩溃后依然存在"，且"批处理窗口是该 seam 在每个写句柄内部的调度策略"（`PKG\dsh-session-persistence\README.zh.md:49,86`；`PKG\dsh-session-persistence\lib\types\handle.d.ts:80-99`）。DSH 的真实检查点在**模型请求前、顶层工具产生副作用前、每个 `agent/pre-step` 边界**，比"轮次"更细（`PKG\dsh-session-checkpoint-policy\README.zh.md:12,48`）。文档以"轮次"为唯一原子点，会误导 §4.4⑤/§7.4 的实现与 RPO 论证。
  2. `ctx.invariants` **不是内核内置**：它是一个需要显式挂载的注册表插件，检查来自各包的 `./invariant` 伴生入口；而且"`dsh-sdk-minimal` 挂载它及四个核心有状态配套入口……**`dsh-base` 刻意省略运行时诊断**"（`PKG\dsh-invariants\README.zh.md:32`；`PKG\dsh-base\cordis.patch.yml` 中无 `invariants` 行）。若域组合基于 `dsh-base`（文档默认如此），"不变量校验在追加前执行"**默认不成立**。
  3. 正面事实（应写入文档以增强可验证性）：`dsh-base` 默认就挂载了 `dsh-session-checkpoint-policy`（`PKG\dsh-base\cordis.patch.yml:413-414`），也挂载了 `session-persistence-jsonl`（第 130-131 行）。
- **依据**：上列行号。
- **修改建议**：§7.2 改为"提交 = `ctx.sessions.flush()` / 后端 flush 屏障；DSH 默认在模型请求前与顶层工具副作用前各设一道屏障"；§4.2 把 `ctx.invariants` 的提供方改为"产品侧显式挂载（`dsh-invariants` + 各包 `./invariant`）"，并在 P0 交付清单中列出必须挂载的伴生入口。

### I8（事实错误）审批请求不携带工具参数 → §4.5/§8.5 的审批强度被高估

- **位置**：§4.5 第 281-304 行（阶段 2"参数约束"、阶段 3 审批）、§8.5 第 770 行（"提示注入诱导越权写 ✅ 沙箱 + 审批瀑布"）、§6.1 第 502 行。
- **问题**：`ApprovalRequestEvent` 的字段是 `agent / toolName / callId? / reason? / displayReason? / signal?`——**没有工具参数**（`PKG\dsh-user-approval\lib\types\types.d.ts:55-71`；README 亦确认"**请求不携带工具参数**"、`PKG\dsh-user-approval\README.zh.md:156`）。因此通过 `ctx.approval` 走到产品侧审批 UI 的请求，人类只能看到工具名与一句理由，对 `delete_file`/`bash` 这类工具**无法看到目标路径与命令内容**——§8.5 把"提示注入诱导越权写"标为"✅"依据不足。而且 DSH 的审批"**仅存在一次性授权**：结果词汇包含 `allowed-once`，但不含 `allow-always`、已记住的规则、撤销或授权存储"（同文件第 155 行）——文档 §5.2/§6.1 的审批策略存储必须完全自研。
- **依据**：上列行号。
- **修改建议**：明确审批的**参数可见性**方案：产品侧在反向网关的"工具裁决"点（该点可以看到完整参数）生成审批上下文并以 `callId` 关联到 `ctx.approval` 请求；或自建审批通道而不依赖 `approval/request` 的载荷。同时把 §8.5 中该行的强度下调为"⚠️：审批不含参数，需产品侧补上下文"，并在 §4.5 阶段 2 注明 `tools/pre-execute`"**有意不允许改写 `exec.arguments`**"（`PKG\dsh-tools\README.zh.md:230`），即"参数约束"只能是允许/拒绝/询问，不能是重写。

### I9（完备性缺口）`policies.writeScopes` 无执行者，`LlmAdapter` 的强契约被少列

- **位置**：§6.2 第 572 行（`"writeScopes": ["src/", "docs/"]`）、§4.2 第 188 行（`ctx.llm` 契约）、§6.3 第 595-596 行（`/llm/stream`、`/llm/models`）。
- **问题**：
  1. DSH 的沙箱策略**只有一个可写根**（`SessionHeader.cwd`）："每个会话只有一个主要工作区根目录——额外可写根目录不属于 `SandboxExecutionPolicy`"（`PKG\dsh-sandbox-policy\README.zh.md:147`）。文档的 `writeScopes` 在全文没有任何执行点（工具级 `ctx.tools.restrict` 限制的是**工具**而非路径，见 `PKG\dsh-tools\README.zh.md:81`）。
  2. `LlmAdapter` 的必选契约远不止"registerAdapter + stream"：还包括 `providerInfo()`、`providerRetryPolicy()`、`imageRequestPricing()`、`listModels()`、`resolveModel()`、`prepareCall()`，且"每个 provider HTTP 请求必须包含 `attributionHeaders()`"（`PKG\dsh-llm\lib\types\index.d.ts:122,136,142,152,161,171,181,187,126-128`）。文档 §6.3 只给了 stream 与"模型目录"两个端点，漏掉 `resolveModel`/`prepareCall` 这条**关键路径**——而 §6.3 对目录失败的定义是"返回缓存或空集"，这会让上下文窗口、推理强度、`systemPromptUpdate` 路由模式（影响历史内追加还是头部重写）在网关降级时静默改变。
- **依据**：上列行号。
- **修改建议**：`writeScopes` 要么删除，要么在 §4.5 阶段 2 明确"由产品侧裁决器按参数做路径白名单判定（只允许拒绝/询问，不重写）"并补齐通配与软链接解析规则；§6.3 增加 `/internal/kernel/llm/resolve-model`、`/internal/kernel/llm/prepare-call`，并把"失败语义"从"返回空集"改为 **fail-closed**（与 §4.2 第 211 行的总原则一致），同时写明 `attributionHeaders` 的透传责任。

### I10（设计分歧，无依据）§9.1 的 SLO 数字与方案自身的约束互相打架

- **位置**：§9.1 第 795-807 行、§4.8 第 359 行、§9.2 第 818-819 行。
- **问题**：
  1. **会话恢复 RTO ≤ 30 s**：与 C11 自陈的"启动与发现超时继承 MCP SDK 的 **60 秒**"直接冲突，而 §7.4 的恢复流程第 4 步就是"重新建立 connector 连接"；除非把 connector 重建排除在 RTO 之外（文档未排除，与首 token 行的排除写法不一致）。此外恢复需要读**整份日志**并校验，历史读取"回放整个日志……非常大的历史每次调用都要付出完整检查"（`PKG\dsh-session-query\README.zh.md:152`），历史代际还会触发与全库会话数成正比的扫描（`PKG\dsh-session-persistence-jsonl\README.zh.md:86`）——没有给出日志规模上界，30 s 无从论证。
  2. **首 token P95 ≤ 3 s**：路径为 产品壳→网关→Router→域→内核→反向网关→凭证代理→模型网关→提供方，至少 6 次网络跳转，另有每次工具调用的裁决回环；文档未给预算分解，也无测量点定义。"不含模型排队与 MCP 冷启"这一排除项承担了过多不确定性。
  3. **MCP 工具可用率 ≥ 99%**：与 §9.2 的降级路径不闭合——重连预算（默认 `maxAttempts: 10`）耗尽后"该服务器的工具会被移除，重连停止，**直到你重载配置或重启 harness**"（`PKG\dsh-mcp-client\README.zh.md:67,93`）。平台若不自建"重载/重启 connector"的自动化，可用率无法回到 99%。
  4. **RPO 0** 依赖 flush 屏障与 checkpoint 策略（见 I7），文档未把该策略列为交付物。
- **依据**：上列行号。
- **修改建议**：为每个 SLO 补齐〔测量点 / 分子分母 / 排除项 / 错误预算归属〕；把 RTO 拆成"内核日志恢复"与"connector 重建"两段分别给目标；为 MCP 可用率定义自动恢复机制（域级 reload 或按需要重建 connector 的产品侧控制器）；SLO 数值改为在压测后回填，不要在设计定稿里写死。

### I11（运维缺口）改造/升级 preset 会让既有会话**无法恢复**

- **位置**：§10.2 第 856-868 行（升级与兼容）、§5.3 第 421 行（版本策略）、§11.1 第 895 行。
- **问题**：官方原文："会话日志保存 preset ID 和空白会话的切换记录；**重启恢复使用该 ID 的当前定义，缺失时拒绝恢复**"（`PKG\dsh-agent-preset-registry\README.zh.md:58`）。因此升级时删除/重命名一个 preset、或删除 preset 引用的插件行，会导致所有引用该 preset 的既有会话**直接无法恢复**。文档的升级表只说"内核按域灰度升级；升级后仅影响新建域"和"会话日志格式只增不改"，遗漏了 preset id 这一兼容面。
- **依据**：上列行号；`PKG\dsh-agent-preset\README.zh.md:12,84`（重复 preset ID 加载失败）。
- **修改建议**：把 preset id 与插件行 id 声明为**永久兼容面**（只增不删，改名=新增+保留别名），写入 §10.2 与 §11.1 的版本策略；纳入契约测试；控制面维护 preset id 使用统计，删除前先扫存量。

### I12（责任未闭合）多个已定义能力没有归属组件；两个默认挂载、直接相关的 seam 未进入 §11.1

- **位置**：§6.1 第 504-517 行（`/messages`、`/trajectory`、`/files`、`/uploads`）、§7.5（保留/删除）、§5.5 第 447 行（成本）、§11.1 第 885-900 行（seam 清单）、§3.2（组件职责表）。
- **问题**：
  1. 会话历史读写、workspace 文件读写/上传、保留与删除、成本归因，在 §3.2 的职责表中**没有对应组件**；DSH 侧其实有现成 seam：`ctx.sessionQuery`（`listSessions/readSession/readSurface/filterEvents/traceSession/…`，`PKG\dsh-session-query\README.zh.md:32-44`），且 `dsh-base` 默认挂载 `dsh-session-query-sqlite`（`PKG\dsh-base\cordis.patch.yml:149-150`）。§11.1 完全没提它。
  2. `dsh-permission-presets` 也没有出现在 §11.1，但它才是"会话 pin 住 sandbox 模式 + 审批策略"的真实机制（`PKG\dsh-base\cordis.patch.yml:249-261`：`read-only/workspace-write → approval: ask`，`danger-full-access → approval: never`）。§4.6 只讲了 `ctx.sandbox` 与 `sandbox/mode` 事件，漏掉模式与审批策略被 permission preset 绑定这一层，也漏掉"`dsh-base` 的部署默认模式实际是 `workspace-write`（由 `DSH_PERMISSION_MODE` 决定，第 232 行）"——与文档 §4.6 第 314 行"部署默认值为 `read-only`"（包级 failsafe 默认）表述不同。
  3. `ctx.sessionQuery` 明确"**无调用方授权**——这是上下文范围内的可信基础设施；模型工具或 UI 必须限制调用方可检查的会话"（同 README 第 150 行）——这条必须进入 §5.1 的 RBAC 设计作为强制约束。
- **依据**：上列行号。
- **修改建议**：§3.2 为"历史查询/文件服务/保留删除/成本归因"指定归属组件；§11.1 增补 `dsh-session-query(-sqlite)`、`dsh-permission-presets`、`dsh-session-checkpoint-policy`、`dsh-invariants`；§4.6 补一节"模式与审批策略的绑定（permission preset）"并明确部署默认取 `read-only` 还是沿用 base 的 `workspace-write`。

---

## 4. 【建议】

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| S1 | §1.2 第 38 行 | 把 **workspace** 称为"DSH 的隔离与归属单位、内核一等概念"，属过度解读。DSH 的 `dsh-workspace` 是**宿主侧项目分组**（"对模型不可见""harness 中没有其他包需要它"，`PKG\dsh-workspace\README.zh.md:12,32`）；`workspaceRoot` 是 `dsh-sandbox-policy` 的配置字段而非内核实体。 | 改为"本方案以 `(tenantId, workspaceId)` 为隔离单位，映射到 DSH 的 `SessionHeader.cwd` 与沙箱可写根；DSH 无 workspaceId 实体，由产品侧维护" |
| S2 | §2.2 C9/C10（第 76-77 行） | C9 说"工具名可作策略与审计的稳定键"，但 §5.6 第 475 行又说必须用四元组——同一文档两处口径不一（正确结论是四元组：`PKG\dsh-mcp-client\README.zh.md:128`）。C10 暗示注入面仅 `instructions`（见 I3）。 | C9 直接写"四元组才是稳定键"；C10 扩展为四类注入通道 |
| S3 | §5.3 第 400 行、§13.1 第 963 行 | 把 `dsh-experimental-agent-team-profile` 放进"平台锁定层（随内核列车 pin）"，同时 §11.2 又要求实验包必须被适配层隔离；§13.1 的关键平台事实（host/client 可分离）**唯一来源是实验包 README**（`PKG\dsh-experimental-agent-team-profile\README.zh.md:61`）。 | 平台锁定层移除实验包；host/client 分离改引稳定包（`dsh-cordis-host-runner` / `dsh-client-modules`）或标注"来源为实验包，需在稳定包上复核" |
| S4 | §4.2 第 188 行、§4.3、§7.4 | 未说明**进程内状态不可恢复**：持久 shell（cwd/导出变量/后台任务，`PKG\dsh-tool-bash-persistent\README.zh.md:73-76,148`）、在跑的 MCP 子进程、`run_code` 中间值都不会随日志恢复。 | 在恢复语义中显式列出"不可恢复清单"及其对用户的影响（下一次调用从新 shell 开始） |
| S5 | §9.2 第 817 行、§4.5 | 工具定义里的 `timeoutMs` "**仅作声明之用**：注册表绝不会强制执行截止时间"（`PKG\dsh-tools\README.zh.md:232`）；要强制必须挂 `dsh-tool-call-timeout-policy`。文档未提。 | 把 `dsh-tool-call-timeout-policy` 列入 P0 必需插件与 §11.1 |
| S6 | §10.1、§10.3 | 容量模型未计入：Windows 大树 ACL 传播"数十秒计"（`PKG\dsh-sandbox-windows-acl\README.zh.md:189`）、`list()/stat()` 的全库扫描、历史代际 catalog 扫描。 | 在容量模型的"域资源"行加 ACL 冷启动成本；把"控制面自建会话索引"写成前提 |
| S7 | §4.1 第 174 行、§8.3 第 736 行 | "出站白名单"只写了目标，没有写执行者与机制（DSH 沙箱"不表达网络、进程、系统调用、设备或凭据限制"，`PKG\dsh-sandbox\README.zh.md:167`）。 | 明确由容器网络策略/服务网格承担出站白名单，并给出默认拒绝的落地清单（含 DNS、NTP、模型网关、MCP 上游） |
| S8 | §6.4 第 605-620 行 | 13 类产品 SSE 事件与 DSH 会话事件（`turn/end`、`step/*`、`approval/asked|decided`、`sandbox/mode`、`session/flush`、`agent/*`）没有映射表，审计回放与"以 `turnId` 关联"无法验证。 | 补一张"产品事件 ⇄ DSH 事件/字段"映射表，并标注哪些事件仅写日志、不进模型历史 |
| S9 | 全文 | 缺少企业平台常见必备设计：灾备与多区域、灰度/回滚的**数据面**方案（内核回滚"需保留旧域"过于单薄）、测试策略（仅 §11.1 一句"契约测试"）、DevEx/本地复现、容量压测计划、误删恢复、密钥轮换演练。 | 单列一章"未覆盖的设计域与补齐计划"，或在 §12 增加对应阶段/验收 |

---

## 5. 逐条核对 §2.2 C1–C12（"平台事实，不可协商"）

| ID | 判定 | 依据（`PKG\` 略） |
|---|---|---|
| C1 审批必须发生在未结束轮次内 | **成立** | `dsh-user-approval\README.zh.md:52,78,154`（轮次是持久日志的提交/回放边界） |
| C2 持久 shell 与在途工具调用持有进程级资源 | **成立** | `dsh-tool-bash-persistent\README.zh.md:73-76,148`；`dsh-session-persistence-jsonl\README.zh.md:164`（单写者/锁） |
| C3 团队能力由实验包提供，不承诺稳定性 | **成立** | `dsh-experimental-agent-team\README.zh.md:205`；`…-profile\README.zh.md:105` |
| C4 沙箱只管辖文件写，不表达网络/进程/系统调用/设备/凭据 | **成立（逐字一致）** | `dsh-sandbox\README.zh.md:167`；`dsh-sandbox\lib\types\index.d.ts:14-19` |
| C5 沙箱只适用于与宿主共享内核和文件系统的进程 | **成立** | `dsh-sandbox\README.zh.md:168`；`dsh-sandbox-local\README.zh.md:32` |
| C6 报告 `enforcement`，Windows 档 `partial` | **成立** | `dsh-sandbox\lib\types\index.d.ts:42-46`；`dsh-sandbox-local\README.zh.md:81`；`dsh-sandbox-windows-acl\README.zh.md:12` |
| C7 容器/microVM/远程执行需替换执行能力，不是沙箱后端选项 | **成立** | `dsh-sandbox\README.zh.md:32,168` |
| C8 无最终应答者 → `unavailable` 且 fail-closed | **成立（源码级）** | `dsh-user-approval\lib\types\index.js:184-190`（waterfall 默认 `Promise.resolve('unavailable')`，异常与非词汇返回值统一归一为 `unavailable`） |
| C9 工具名是 `(serverName, rawName)` 的纯函数，不采用远端 `serverInfo.name`；有损名追加 12 位 SHA-256 | **成立** | `dsh-mcp-client\README.zh.md:107-108`；`dsh-mcp-client\lib\types\tools.d.ts:42,46` |
| C10 `instructions` 注入系统提示词 `### MCP server: <serverName>` | **成立，但外延过窄** | `dsh-mcp-client\README.zh.md:192`；`dsh-mcp-client\lib\types\server-context.d.ts:16`；见 I3 |
| C11 启动与发现超时继承 SDK 60 s，插件不暴露旋钮 | **成立** | `dsh-mcp-client\README.zh.md:210`（另注：**单次工具调用**有 `toolCallTimeoutMs`，默认 60 s，文档未混用，正确） |
| C12 初始连接失败默认不致命；`failOnStartupError: true` 才拒绝激活 | **成立，但**"拒绝激活"不等于"域不就绪" | `dsh-mcp-client\README.zh.md:63,71`；`dsh-app-boot\README.zh.md:43,94`；见 I2 |

**小结**：C1–C12 未发现凭空编造项，平台事实部分扎实——这应记为方案的优点。但**C9/C10/C12 的"设计影响"列有过度引申**（分别引出"工具名可作稳定键""注入面只有 instructions""置 true 即可要求必需能力"），而 §5.3 的"分层锁"、§1.2 的"workspace 内核一等概念"、§8.4 的"标签随域销毁"是把**设计偏好/未验证假设**写成了平台事实。

---

## 6. 无法验证的项

1. **0.1.6-alpha.2 基线上的一切**：本机不存在该版本制品，文档所有"实测"结论无法在其自称基线上复核（见 B1）。
2. **端到端恢复**：我确认了 `resume` 的 API、调用顺序与崩溃 closer 语义（README + d.ts），但**未实际运行**"杀进程 → 新进程 `open(id,'write')` → 续跑"的端到端实验；P1 的可行性结论基于官方契约，建议 P1 开工前先做一次最小验证（`dsh-session-persistence-jsonl` + `dsh-agent-loop` 的 `resumeSessionId`）。
3. **MCP Streamable HTTP 经产品代理的真实行为**：SDK 版本固定为随包版本，代理对协商、`Mcp-Session-Id`、SSE 重连的实际影响需要点对点实测（我未搭建上游 MCP 服务器）。
4. **Windows ACL 后端在容器内运行的行为**：所有 Windows 结论来自单机（非容器）README；"容器内 ACL + 独立用户"的组合未见官方文档描述，§8.4 的补偿是否成立需实测。
5. **`session.lock` 在目标存储介质上的可靠性**：NFSv3 已知不可靠（官方明示），但 SMB/对象存储 FUSE 的行为未有官方结论，需在产品选型后实测。
6. **所有性能与可用性数字**（首 token 3 s、RTO 30 s、99.9%、99.5%、99%）：文档未给测量方法，我也未做压测，这些数字目前**无任何可验证依据**。
7. **`dsh-base` 之外的随附 profile 组合**：我只核对了 `dsh-base\cordis.patch.yml` 的关键行；`web/headless/acp/sdk` 等模板的行级组合未逐一核对。
8. **"DSH 不校验哈希与签名"**：我依据 `dsh-app-boot`（"不是防范恶意包代码的沙箱"，仅做 peer 版本检查）与 `plugin-manager`（pnpm/integrity 层面）判断产品必须自建；未穷尽检索全部插件加载路径，若 DSH 另有完整性入口，请以实测为准。

---

## 7. 「事实错误」与「设计分歧」分类

**事实错误（文档写错了平台事实或与源码相反，必须改）**

| 编号 | 位置 | 错误本质 |
|---|---|---|
| B1 | 第 8 行 | 基线版本不存在 |
| B4 / I7 | §4.3/4.7/7.4/9.2、§7.2、§4.2 | 恢复语义、"提交点"、`ctx.invariants` 定位与源码相反/不符 |
| I6 | §8.4 补偿表 | Low 标签"随域销毁"错误；AppContainer 读失败归因错误 |
| I8 | §4.5/§8.5 | 审批请求携带参数——事实相反 |
| I2 | §4.8/§9.2 | `failOnStartupError` 的效力、MCP 挂载是否会 await——事实相反 |
| I9（第 1 点） | §6.2 | `writeScopes` 在 DSH 中无对应能力并被当作既有能力 |
| S1 | §1.2 | workspace"内核一等概念" |
| B2 | §5.3/§6.2/§13.1 | 把产品约定写成平台强制力（并称"校验哈希与签名"是域启动行为） |

**设计分歧（DSH 能做，但方案的选择有问题；给出替代方案）**

| 编号 | 分歧点 | 我的替代方案 |
|---|---|---|
| B2 | 用"域内层级校验 + 约定"实现租户不可越权 | 控制面生成 Profile + 域外完整性校验 + 域内 profile 只读 + 默认禁用 plugin-manager 工具 + 域侧 attest |
| B3 | 零 MCP 凭证 vs stdio | 接受"≤5 min 域级短时凭证"，把 G1 判据改为"无长期凭证"；或 stdio 启动器换取一次性令牌 |
| I1 | 用一个无状态 HTTP 代理承载 MCP | 数据面协议感知代理（SSE/亲和/无缓冲）或改用方案 b |
| I2 | 指望 `failOnStartupError` 表达"必需能力" | Session Router 侧就绪探针 + 产品侧 connector 控制器 |
| I3 | 只过滤 `instructions` | 四通道信任级策略 + `system-prompt/assemble` / `tools/post-execute` 实施点 |
| I4 | "替换 persistence 落点"即可外置 | 自研带 fencing 的 `SessionPersistence` 提供方；迁移步骤补"释放锁" |
| I5 | 依赖 DSH 保留/删除 | 产品侧带外 GC + 生命周期规则 + 会话索引 |
| I10 | 在设计定稿里写死 SLO 数字 | 先定测量点与预算分解，数字留待压测回填 |
| I12 | 未给历史/文件/成本归因指定归属 | 显式指定组件并复用 `ctx.sessionQuery` |

---

## 8. 本次为"证伪"所做的检查（可复核清单）

- 逐个读取的包（README.zh.md 全文）：`dsh-session-persistence-jsonl`、`dsh-session-persistence`、`dsh-session`、`dsh-agent-loop`、`dsh-session-checkpoint-policy`、`dsh-session-query`、`dsh-user-approval`、`dsh-mcp-client`、`dsh-mcp-resources`、`dsh-agent-preset`、`dsh-agent-preset-registry`、`dsh-sandbox`、`dsh-sandbox-local`、`dsh-sandbox-policy`、`dsh-sandbox-windows-acl`、`dsh-experimental-agent-team`、`dsh-experimental-agent-team-profile`、`dsh-llm`、`dsh-tools`、`dsh-system-prompt`、`dsh-scope`、`dsh-plugin-manager`、`dsh-app-boot`、`dsh-invariants`、`dsh-skill`、`dsh-workspace`、`dsh-tool-bash-persistent`。
- 类型声明核对：`dsh-llm\lib\types\index.d.ts:122-253`、`dsh-sandbox\lib\types\index.d.ts:14-141`、`dsh-mcp-client\lib\types\{index,tools,server-context,connection}.d.ts`、`dsh-user-approval\lib\types\{index,types}.d.ts`、`dsh-user-approval\lib\types\index.js:164-190`、`dsh-session-persistence\lib\types\handle.d.ts:75-105`、`dsh-system-prompt\lib\types\index.d.ts:16-27`。
- 组合层核对：`dsh-base\cordis.patch.yml` 全文关键行（第 16-22、130-131、149-150、226-261、294-305、412-414、492-493、518-519 行）。
- 版本核对：`@deepseek-ai/dsh` 根 `package.json:4` 与 7 个重点包 `package.json`；全盘搜索 `0.1.6-alpha.2`（0 命中）。
- **未能证伪的三项**（即文档在这三点上是对的）：C1–C12 的平台事实；`resume` 的跨进程恢复能力；host/client 插件可分离、headless 无需 Web 服务。

---

*评审结束。以上每条均给出可复查的路径与行号；标注"无法验证"的部分未作推测性结论。*
