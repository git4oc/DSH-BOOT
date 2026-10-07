# 反转面契约（Reversal Contracts）

| 项 | 值 |
|---|---|
| 文档编号 | `CTR-001` |
| 版本 | 1.1 |
| 状态 | 生效 |
| 交付物编号 | `SPEC-03` `D-1` |
| 上游依据 | 设计文档 v2.6 §4.2 / §4.5.1 / §4.4.1 / §6.3 / §7.2；`SPEC-03` `ENG-005`–`ENG-019`；`SPEC-01` `SEC-010`–`SEC-070` |
| 签名来源 | 内核 `.d.ts` **实证**（非文档转述），逐条标注 |
| 用途 | 四个反转面的**可编译契约**。两个团队据此可并行实现，无需再协商接口 |

---

## 0. 地位与范围

设计文档 §4.2 定了**反转面 ≤ 4** 的硬上限。本文件是这 4 个面的**唯一契约来源**。

| # | 面 | 谁实现 | 谁消费 | 规格 |
|---|---|---|---|---|
| 1 | `ctx.llm`（`LlmAdapter`） | `packages/domain-bridge` | 内核 `dsh-agent-loop` | `ENG-005`–`ENG-008` |
| 2 | 工具注册桥（`ctx.tools`） | `packages/domain-bridge` | 内核及各工具插件、`dsh-mcp-client` | `ENG-001`–`ENG-004` |
| 3 | `ctx.approval`（审批应答者） | `packages/domain-bridge` | 内核 | `ENG-009`–`ENG-012` |
| 4 | `SessionPersistence` 提供方 | `packages/domain-bridge` | 内核 `dsh-agent-loop` / `dsh-session` | `ENG-013`–`ENG-019` |

**不在本文件内**：`ctx.sandbox`、`ctx.skills`、`dsh-mcp-client` —— 按设计 §4.2 保持原生装配，不是反转面。

---

## 1. 共同约定（四面均适用）

| # | 约定 | 依据 |
|---|---|---|
| C-1 | **fail-closed**：域外通道不可达时**拒绝该动作**，**绝不**回退本地直连或静默降级 | `D9`、§9.2 |
| C-2 | 每个域外请求**必须**携带 `turnId`，且响应携带 `requestId` | §6.3 统一要求 |
| C-3 | 域标识**必须**为**绑定 `(tenantId, isolationGroupId)` 的域令牌**；域外**必须**校验"请求声称的租户 == 令牌中的租户" | `C51` 相邻、§4.2.1 |
| C-4 | **disposer 必须原样透传**：内核返回的 disposer 是唯一的卸载手段，包装层不得吞掉或替换 | 见各面 |
| C-5 | 所有审计键**必须**为五元组 `(tenantId, isolationGroupId, workspaceId, agentId, serverName, rawName)`；MCP 相关再带 `rawName` | §5.5 |
| C-6 | 超时**必须**自持，不得依赖内核 signal 收敛 | `C40` |
| C-7 | **不得**记录任何长期凭证；例外仅限 `SEC-051`/`SEC-055` 登记的短时令牌 | `D11` |
| C-8 | 时间戳用单调时钟；跨域比较**必须**带时钟偏差上界 | `REL-*` 时钟条款 |

---

## 2. 面 1：`ctx.llm`（`LlmAdapter`）

### 2.1 职责

| | 内容 |
|---|---|
| **负责** | ① 把内核的模型调用意图**逐字段保真**转发至反向网关；② 在 wire 请求上带归因头；③ 实现 retry policy 解析并把它并入 `T_m` 预算；④ 提供模型目录与模型解析；⑤ 遵守 `signal` |
| **不负责** | 凭证（域外代理持有）、配额、计费、模型选择策略、上下文窗口计算（域外 `resolve-model` 返回） |

### 2.2 签名（来源：`dsh-llm/lib/types/index.d.ts`）

```ts
// 注册
ctx.llm.registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle;

// 抽象基类 —— 只有 stream() 是 abstract
abstract class LlmAdapter {
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>;

  // 以下均有默认实现，但本方案要求必须实现：
  providerInfo(provider: string): ProviderInfo;
  listModels(provider: string): Promise<ModelInfo[]>;              // ← GET /v1/llm/providers 依赖
  resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<ModelRef>;

  providerRetryPolicy(provider: string): RetryPolicy;
  imageRequestPricing(provider: string): ImagePricing | undefined;
  prepareCall(provider: string, model: string, config: CallConfig): PreparedLlmCall;
}

// 归因头是**模块级函数**，不是 LlmAdapter 的方法
import { attributionHeaders } from '@deepseek-ai/dsh-llm';
```

> **易错点**：`attributionHeaders` 是模块级导出。设计文档与规格一律不得写成 `this.attributionHeaders`（`ENG-008` 判据③）。

### 2.3 不可变性契约（最容易踩）

| 事实 | 要求 |
|---|---|
| `GenerateOptions` **深冻结**（mutation throws），其内容是会话日志的纯函数 | **逐字段保真转发**，**不得**重组、重命名、增删字段（`ENG-007`） |
| `PreparedLlmCall` 携带调用配置 | 适配器**必须**用自己 `prepareCall` 返回的 `PreparedLlmCall` 派发；请求的 call-config 字段**必须**与 `config` 匹配，否则 `INVALID_PREPARED_CALL`（`ENG-006`） |
| 存在代数混用风险 | **不得**出现"先 `resolveModel` 再直接 `ctx.llm.stream`"的路径 |

### 2.4 取消、超时、背压

| 项 | 要求 |
|---|---|
| 取消 | **必须**遵守 `options.signal`；abort **必须**在 TTFB 前生效，且**必须**取消网关侧上游连接（`§6.3` 流式契约） |
| 超时 | `T_m` = 单次模型流**含重试总预算**；由**域外**计时（`REL-102`） |
| 重试 | 由**可选**插件 `dsh-llm-retry` 执行；本方案**必须**显式声明是否挂载及其 `retryableCodes` / backoff 预算（`REL-102`） |
| 背压 | **不得**无界缓冲 |
| 下行 | **必须**有**显式终止帧**区分"正常结束 / adapter error / aborted" |

### 2.5 错误语义

| 情形 | 行为 |
|---|---|
| 反向网关不可达 / 5xx | **fail-closed**，中断当前轮次（L3） |
| `resolve-model` / `prepare-call` 失败 | **fail-closed**（**不得**返回缓存或默认值——否则上下文窗口、推理强度、提示词路由模式会静默改变） |
| `listModels` 目录服务不可用 | **缓存等级**：用 TTL 内最优已知清单 |
| 上游 `aborted` | 以终止帧表达，**不得**伪装成正常结束 |

### 2.6 disposer

`registerAdapter` 返回 `AdapterRegistrationHandle`；由域生命周期持有，域销毁时释放。**不得**在装配后热替换适配器。

---

## 3. 面 2：工具注册桥（`ctx.tools`）

### 3.1 职责

| | 内容 |
|---|---|
| **负责** | ① 作为工具进入域内注册表的**唯一入口**；② 在白名单外**不注册**并硬审计；③ 在宿主上下文安装**全局 `guard()`** 作纵深；④ 管治 MCP 的运行期自动重同步 |
| **不负责** | **运行期 deny 语义**（`D10`：`deny` 一律表达为"不进 `toolAllowlist`"）；参数改写（`C27` 禁止） |

### 3.2 签名（来源：`dsh-tools/lib/types/index.d.ts` + `lib/index.js` 实证）

```ts
// —— 内核侧（桥要包装/调用的） ——
ctx.tools.register(definition: ToolDefinition): () => void;   // 唯一注册入口，无 pre-register 钩子（C49）
ctx.tools.restrict(filter: ToolRestriction): () => void;      // ⚠ 仅 scoped；全局调用抛错（C51）
ctx.tools.guard(guard: ToolGuard): () => void;                // ✅ 全局可用，单调只否

interface ToolRestriction { readonly allow?: readonly string[]; readonly deny?: readonly string[]; }
type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined;

// —— 桥侧（本方案定义） ——
function registerTool(definition: ToolDefinition, ctx: Context): () => void;
function installGuard(ctx: Context, allowlist: ReadonlySet<string>): () => void;
```

### 3.3 `restrict` 与 `guard` 的作用域语义（**已定论**，`VER-001`）

| 机制 | 全局上下文 | 覆盖 scoped 注册 | 判定时机 | 本方案 |
|---|---|---|---|---|
| `restrict(filter)` | ❌ **抛错** | ❌ 不覆盖 | 可见性 | **不得使用** |
| `guard(fn)` | ✅ **可** | ✅ 覆盖 | **派发期**（按最终工具名） | **纵深防御** |

源码依据：`dsh-tools/lib/index.js:2897`（`restrict` 的 scoped 断言）、`:2913`（"A plain-context guard applies globally"）、`index.d.ts:515-521`（guard 无 allow 结果，后注册者无法翻盘）。

> **由此得到的强制链**：
> **主防线** = 桥的 `register` 拦截（**可见性**，能力不可达）
> **纵深** = 全局 `guard()`（**执行期**，按最终工具名，**覆盖主防线的覆盖面缺口**）
> 两者**互相独立**：纵深不依赖"桥被所有注册路径使用"这一假设。

### 3.4 白名单语义

| 输入 | 可见工具集 |
|---|---|
| `toolAllowlist = ["a"]` | `{a}` |
| `toolAllowlist = []` | **空集** |
| `toolAllowlist` 缺省 | **空集**（**不是**全集）——`ENG-002` |

### 3.5 disposer

桥**必须原样返回**内核 `register` 的 `disposer`（`ENG-002` 判据①要求其调用后无副作用）。**不得**用自建空函数替代，否则工具无法卸载。

### 3.6 MCP 同路受管

`dsh-mcp-client` 收到 `notifications/tools/list_changed` 时**自动重做发现并逐个 `ctx.tools.register()`**（`C35`，注册路径无白名单）。桥**必须**使这些注册走同一判定入口；未授权者不注册 + 硬审计 + `bridge_register_denied_total` 自增。

---

## 4. 面 3：`ctx.approval`（审批应答者）

### 4.1 职责

| | 内容 |
|---|---|
| **负责** | ① 注册为 `approval/request` waterfall 应答者；② **自持 `T_a` 超时**；③ 从桥的审批前上报通道补全参数上下文；④ 返回闭合词表内的一次性决策 |
| **不负责** | 内核**无审批超时**（`C40`）；载荷**不含参数与会话**（`C9`） |

### 4.2 载荷（来源：`dsh-user-approval/lib/types/types.d.ts:54-71`）

```ts
interface ApprovalRequestEvent {
  readonly agent: Agent;                 // 经 Client Context 投影
  readonly toolName: string;
  readonly callId?: ToolCallId;
  readonly reason?: string;
  readonly displayReason?: { readonly en: string; readonly [locale: string]: string };
  readonly signal?: AbortSignal;
}
```

| 事实 | 后果 |
|---|---|
| **无参数** | 域外**必须**经桥的审批前上报通道取得参数（`ENG-012`） |
| **无 `sessionId`** | 域外请求端点**必须**由域内应答者补齐 `(sessionId, turnId, callId)`（`C9`） |
| `displayReason` **仅本地化展示，绝不写入审批审计事件** | 审计**必须**只写 `toolName`/`callId`/`reason`/决策，**不得**持久化 `displayReason` |

### 4.3 返回词表（闭合）

```ts
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
// 本方案扩展：'timeout'（内核取值集内无"超时"，由域外看护定时器产生，见 REL-103）
```

| 情形 | 返回 |
|---|---|
| 用户批准 | `allowed-once` |
| 用户拒绝 | `rejected` |
| 请求被取消（`signal` abort） | `cancelled` |
| 域外通道不可达 / 参数补全失败 | `unavailable` |
| `T_a` 到期 | `timeout`（收敛为 fail-closed） |

**词表外取值即 CI 失败**（`ENG-009`）。

### 4.4 禁止项

| 禁止 | 理由 |
|---|---|
| 任何跨 `callId` 的授权复用（"记住此工具"） | `C8`：内核无 allow-always / 规则存储 / 撤销。自研等于发明内核不承认的授权语义，审计口径分裂（`ENG-010`） |
| 依赖内核 `signal` 收敛超时 | 内核只有 abort 才 cancelled；黑洞连接必须靠自持定时器（`C40`） |
| 在审批落库中写 `displayReason` | 见 §4.2 |

### 4.5 定序约束

同 `callId` 的 `tool.call` 事件**必须**先于 `approval.requested` 投递（`REL-*` / `ENG-012` 判据③）。
参数无法送达域外的工具**不可注册**且**不得进入** `requireApproval`（`ENG-012` 判据②）。

### 4.6 状态机

```
pending ──► decided{allowed-once | rejected | cancelled | unavailable | timeout} ──► consumed
```

---

## 5. 面 4：`SessionPersistence` 提供方

### 5.1 职责

| | 内容 |
|---|---|
| **负责** | ① 实现 `SessionPersistence`；② 保证 `flush` 提交点语义；③ 单写者与 fencing 租约；④ 撕裂尾处理；⑤ 格式拒绝方向 |
| **不负责** | 删除/保留（`C24`：接口不存在）、索引（`list()` 无分页无过滤无索引）、跨存储事务 |

### 5.2 签名（来源：`dsh-session-persistence/lib/types/index.d.ts`、`handle.d.ts`）

```ts
export default class XxxSessionPersistence implements SessionPersistence {
  create(header: SessionHeader, opts?: CreateOptions): Promise<SessionHandle>;
  open(id: SessionId, access: 'read' | 'write', opts?: OpenOptions): Promise<SessionHandle>;
  flush(): Promise<void>;
  stat(id: SessionId, opts?: StatOptions): Promise<SessionStat>;
  list(opts?: ListOptions): Promise<SessionSummary[]>;
  // 注意：参考实现只 export default，无具名导出（C41）
}

interface SessionHandle {
  readonly id: SessionId;
  readonly header: SessionHeader;
  readonly inheritedEventCount: number;
  readonly access: 'read' | 'write';
  read(offset?: number, length?: number, opts?: ReadOptions): Promise<SessionEvent[]>;
  append(events: SessionEvent[], opts?: AppendOptions): Promise<void>;
  flush(opts?: FlushOptions): Promise<void>;
  close(): Promise<void>;
}
```

**消费方纪律**：**只允许**经 `ctx.sessionPersistence` 使用。参考实现（`dsh-session-persistence-jsonl`）除 `export default` 外**无具名导出**；`JsonlCompressionSchema` / `Config` / `JsonlCompression` 是**配置形态**、**不是实现句柄**（`ENG-013` 判据②③）。

### 5.3 语义级契约

| # | 契约 | 依据 |
|---|---|---|
| P-1 | **提交点 = `flush` 屏障**：`append` 解析成功**不等于**持久化；**空会话在 `flush` 后**才对其他进程可 `list`/`open` | `C21`、`ENG-014` |
| P-2 | **撕裂尾永不返回**：`read()` 只返回合法**连续逻辑日志前缀**；同一句柄重复读**不得**返回更旧状态 | `ENG-015` |
| P-3 | **单写者**：同一 `id` 至多一个写句柄；遇既有持有者**必须**拒绝并返回 `SessionAlreadyOwnedError`，**不得**排队、**不得**依赖超时兜底（`session.lock` 故意**无过期**） | `C23`、`ENG-016` |
| P-4 | **`close()` 幂等 + 完成未决持久化 + 释放写所有权，且不可取消**；`Symbol.asyncDispose` 委托 `close` | `ENG-017` |
| P-5 | **freshness**：上次 `append`/`flush` 解析后启动的任意读**必须**至少看到此前缀；`stat().revision` **不得**当作跨实例变更令牌 | `ENG-018` |
| P-6 | **`list()` 无分页无过滤无索引**：平台**不得**依赖它做规模查询 | `C24`、`ENG-019` |
| P-7 | **格式拒绝方向**：不能解码的格式**必须**被拒绝，**不得**尝试升级或宽松解码 | `C39`、`ENG-031`(E) |

### 5.4 错误类全集（来源：`dsh-session-persistence/lib/types/errors.d.ts`）

| # | 类 | 触发 |
|---|---|---|
| 1 | `SessionPersistenceNotFoundError` | 请求的会话身份在本调用方视角下无持久日志 |
| 2 | `SessionAlreadyExistsError` | `create` 指向已存在的身份 |
| 3 | `SessionAlreadyOwnedError` | 写打开发现已被活动写句柄占用 |
| 4 | `SessionReadOnlyError` | 读句柄上调用 `append`/`flush` |
| 5 | `SessionOwnershipLostError` | 租约过期 / 续期失败 / 所有权记录不再指向本句柄。**永不复得**——须关闭并重新以写打开 |
| 6 | `SessionHandleClosedError` | `close()` 之后调用任何操作 |
| 7 | `SessionPersistenceCorruptionError` | 后端读取成功后内容校验失败 |
| 8 | `SessionFormatUnsupportedError` | **日志完好但本运行时无法忠实解释**（格式版本不受支持，或事件类型未知） |

> **⚠ 关键区分（源自内核注释）**：
> - **7 与 8 必须分开**。格式不受支持**不是**损坏——用户必须看到"**升级 harness**"，**绝不能**看到 "corrupt"。
> - 内核提供 `sessionFormatVersionRefusal(id, version)` 生成该方向性文案，**必须**使用它而非自造。
> - `SessionFormatUnsupportedError` 可携带 `SessionLocation { kind, path }` 指向原始日志——**仅供拒绝诊断**，**不是**面向消费者的查询入口。
>
> **⚠ 无参考行为基线**：`SessionOwnershipLostError` 的注释明写 *"Declared for the cross-process lease layer; **the shipped in-process backends never throw it yet**"*。
> ⇒ **本方案必须自行定义**租约续期/过期的阈值与边界，**不得**声称"与内核行为一致"（`SPEC-03` §11.4.1）。

### 5.5 disposer 与装配

| 项 | 要求 |
|---|---|
| 导出 | **必须** `export default class` |
| 替换 base 行 | Profile **必须**显式 `disabled: true` base 的 `session-persistence-jsonl` 行 |
| 挂载 | **仅 boot 期一次性挂载**；**域内禁用 HMR**（"provider 不可热替换"为平台硬约束） |
| 禁写位置 | **不得**把会话日志写路径放在共享 NFS/FUSE 上（`C23`） |

---

## 6. 跨面共性

| 主题 | 要求 |
|---|---|
| **超时** | `T_a`（审批，60–120 s，默认 90）< `T_turn`；`T_m`（模型流含重试）< `T_turn`；`T_turn ≤ 15 min`。三者**必须**为 Profile 必填 `deadlines`（`REL-102`） |
| **取消** | 四面**必须**遵守传入的 `signal`；abort 后**必须**释放持有的资源（句柄、锁、上游连接） |
| **幂等** | 域外端点**必须**接受幂等键；用量扣减按 `(tenantId, turnId)` 去重 |
| **观测** | 每面**必须**暴露：调用量、错误率、延迟分位、超时计数。适配层错误率**独立监控**（`ENG-035`） |
| **审计** | 五元组键（C-5）；`enforcement != full` 打标；**最小审计集**（`SEC-069`）记不下即拒绝该动作 |
| **契约测试** | 每面**必须**有独立契约测试，且**可单独加载**（`ENG-046` 要求单面夹具可独立使用） |

---

## 7. 追溯矩阵

| 面 | 契约条款 | 规格 | 设计依据 |
|---|---|---|---|
| 1 | §2.2 签名 | `ENG-005`、`ENG-006` | §4.2 插槽契约、§11.1 |
| 1 | §2.3 不可变性 | `ENG-007` | §6.3 流式契约 |
| 1 | §2.4 取消/超时 | `ENG-006`、`REL-102` | §4.4.1、§6.3 |
| 1 | §2.5 错误语义 | `ENG-008` | §6.3 统一要求 |
| 2 | §3.2 签名 | `ENG-001` | `C49`、§4.5.1 |
| 2 | §3.3 作用域定论 | `ENG-004`、`SEC-029` | `C51`、`VER-001` |
| 2 | §3.4 白名单语义 | `ENG-002` | §6.2 `toolAllowlist` |
| 2 | §3.6 MCP 同路 | `ENG-003` | `C35`、§4.5.1 拦截点 2 |
| 3 | §4.2 载荷 | `ENG-012`、`SEC-058` | `C9` |
| 3 | §4.3 词表 | `ENG-009`、`SEC-063` | `C8`、§4.5 状态机 |
| 3 | §4.4 禁止项 | `ENG-010`、`ENG-011` | `C8`、`C40` |
| 4 | §5.2 签名 | `ENG-013` | `C41`、§11.4.1 |
| 4 | §5.3 P-1…P-7 | `ENG-014`–`ENG-019` | `C21`–`C24`、`C39` |
| 4 | §5.4 错误类 | `ENG-016` | 内核 `errors.d.ts` |
| 4 | §5.5 装配 | `ENG-013`、§11.4.1 | §11.4.1 provider 替换规矩 |

---

## 8. 未闭合项

| # | 项 | 影响 | 主 |
|---|---|---|---|
| ~~1~~ | ~~`VER-002`：全局 `guard()` 是否覆盖 **PTC `run_code` 内调用 / 子代理 / 嵌套派发**~~ | ~~面 2 纵深兜底范围~~ | ✅ **已定论（成立）**（`VER-001` 文档 §6）：内核全执行路径汇入同一 `prepareExecution` → guard 派发期求值、全局层先查；实测 5/5 通过。`SEC-029`/`ENG-004` 被证实、无需收窄 |
| ~~2~~ | ~~面 2 主防线覆盖面：桥提供的 `ctx.tools` 是否确被 MCP 行与全部注册路径使用~~ | ~~`GATE-002` 条件 2~~ | ✅ **内核侧已定论（成立）**（`VER-001` 文档 §7）：`ctx.tools` 经 cordis DI 以服务名 `"tools"` 单点解析，`tools.insert` 仅存在于内核 `register()` 内，MCP 行唯一注册调用即 `ctx.tools.register`；组合层（桥代理挂为 `tools` 服务）仍由 `E-04`/`E-05` 在 P0 出口随域构建实测 |
| 3 | 面 4 的租约续期/过期阈值（无参考行为基线，须自定） | 面 4 P-3 | ENG |

---

## 变更记录

| 版本 | 变更 |
|---|---|
| 1.1 | `VER-002` 定论（成立）与 `GATE-002` 条件 2 内核侧定论收口（§8 第 1/2 项）：全局 `guard()` 覆盖 PTC `run_code` 内调用、子代理、嵌套派发；注册路径单一漏斗成立。详见 `docs/bridge-defense-in-depth.md` §6/§7 |
| 1.0 | 初版：四个反转面的签名、责任边界、错误语义、disposer 生命周期、语义级契约；纳入 `VER-001` 的 `restrict`/`guard` 定论；补 `SessionPersistence` 8 个错误类全集与"格式不受支持 ≠ 损坏"的方向性要求 |
