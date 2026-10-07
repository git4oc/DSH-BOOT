# 审批参数通道规范

| 项 | 值 |
|---|---|
| 文档编号 | `SEC-DOC-06` |
| 交付物 | `SPEC-01` §3 交付物 6 |
| 版本 | 1.0 |
| 状态 | 生效 |
| 上游依据 | 设计文档 v2.6 `C1` / `C8` / `C9` / `C40` / §4.4.1 / §4.5.1（审批参数通道）/ §6.1 / §6.3 / §6.4；`CTR-001` §4（面 3 审批应答者）§4.2 / §4.3 / §4.5 / §4.6 |
| 落实的 `SEC-*` | `SEC-058`、`SEC-059`、`SEC-060`、`SEC-061`、`SEC-062`；配套 `SEC-023`、`SEC-024`、`SEC-063`、`SEC-064`、`SEC-065`、`SEC-066`、`SEC-067`、`SEC-068` |
| 实现落点（引用） | `ENG-009`、`ENG-011`、`ENG-012`；`CTR-001` §4 的签名与状态机（本文件不重写签名） |
| 边界 | 用户可见文案的最终措辞以 `PRD-DOC-01`（`COPY-*`，如 `COPY-006`/`COPY-007`/`COPY-013`/`COPY-014`）为唯一基线；本文件只给**必须逐字包含**的语义文本（标注「PRD 承接」）与判定方法 |

---

## 1. 十字段载荷（唯一合法形态）

**投递方向**：域内桥 → 域外（`POST /internal/kernel/tool-audit`，审批判定**之前**）。
**强制谓词**：十项齐备且满足下表约束，否则审批**不得**成立（`SEC-063` 口径：`unavailable`）。

| # | 字段 | 类型 | 必填 | 约束（可判定） | 缺失/违规结果 |
|---|---|---|---|---|---|
| 1 | `tenantId` | string | 是 | 与域令牌一致（`SEC-007`） | `unavailable` + 硬审计 |
| 2 | `isolationGroupId` | string | 是 | 非空 | `unavailable` |
| 3 | `workspaceId` | string | 是 | 属该会话 `cwd` 投影的 workspace | `unavailable` |
| 4 | `sessionId` | string | 是 | 由域内应答者补齐（内核载荷不含，`C9`） | `unavailable` |
| 5 | `turnId` | string | 是 | 未结束轮次（`C1`）；轮次外到达 ⇒ 判崩溃残留，不执行 | 记录但不执行 |
| 6 | `callId` | string | 是 | 与内核 `ApprovalRequestEvent.callId` 一致 | `unavailable` |
| 7 | `toolName` | string | 是 | 与内核载荷 `toolName` **逐字相同** | `unavailable` |
| 8 | `argsDigest` | string | 是 | `sha256:` + 小写十六进制；输入 = 参数对象的 **JCS（RFC 8785）规范序列化** | `unavailable`，且该工具**不得进入** `requireApproval` |
| 9 | `argsPreview` | string | 是 | §2 脱敏后、§3 体积约束内的 JSON 文本 | 超限即截断；截断不可行 ⇒ `unavailable` |
| 10 | `redacted` | boolean | 是 | 发生**任一**脱敏/截断/不可序列化 ⇒ `true`；否则 `false` | 缺失即视为 `true` 并告警 |

**摘要稳定性验收**：同一参数两次调用 `argsDigest` **相同**；改动一个字节 `argsDigest` **变化**（`SEC-058` 判据）。

**禁止字段**：载荷中不得出现原始参数全文、原始凭证、令牌、`displayReason`（`CTR-001` §4.2：`displayReason` 绝不持久化）。违者按 `SEC-DOC-07` §5 拒绝写入。

---

## 2. 键级脱敏规则（确定性算法）

### 2.1 键规范化与敏感键集合

```
normalizeKey(k) = lowercase( 删除所有非 [a-z0-9] 字符 )
sensitiveKey(k) =  normalizeKey(k) ∈ EXACT_SET
                ∨ normalizeKey(k) 包含 任一 SUFFIX_SET 成员
```

| 集合 | 成员（固定） |
|---|---|
| `EXACT_SET` | `password`、`passwd`、`pwd`、`passphrase`、`secret`、`clientsecret`、`token`、`accesstoken`、`refreshtoken`、`idtoken`、`apikey`、`apitoken`、`authorization`、`auth`、`cookie`、`setcookie`、`credential`、`credentials`、`privatekey`、`accesskey`、`secretkey`、`sessiontoken`、`bearer`、`signature`、`signingkey`、`rootpassword` |
| `SUFFIX_SET` | `secret`、`token`、`password`、`passwd`、`apikey`、`privatekey`、`credential` |

### 2.2 值级规则（顺序固定：先键级，再值级）

| 顺序 | 规则 | 处理 |
|---|---|---|
| 1 | 键命中 `sensitiveKey` | 整个值替换为 `"[REDACTED]"`（**不看值类型**；对象/数组整体替换） |
| 2 | 值为字符串且匹配 PEM 私钥块（含 `-----BEGIN` 且含 `PRIVATE KEY`） | 替换为 `"[REDACTED:PEM]"` |
| 3 | 值为字符串且匹配 JWT 形态 `^eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*$` | 替换为 `"[REDACTED:JWT]"` |
| 4 | 值为字符串且匹配云厂商长期密钥形态 `^(AKIA\|ASIA)[0-9A-Z]{16}$`、`^gh[pousr]_[A-Za-z0-9]{20,}$`、`^xox[baprs]-[A-Za-z0-9-]{10,}$` | 替换为 `"[REDACTED:KEY]"` |
| 5 | 值为字符串、长度 ≥ 40、且同时含字母与数字、字符集为 `[A-Za-z0-9_\-+/=]` | 替换为 `"[REDACTED:HIGHENTROPY]"` |
| 6 | 其余 | 原样保留（受 §3 体积约束） |

**确定性要求**：同一输入必须产出逐字节相同的 `argsPreview`（不得依赖键顺序差异；输出前按键名升序排序）。

---

## 3. 体积上限

| 参数 | 取值 | 触发动作 |
|---|---|---|
| `ARGS_PREVIEW_MAX_BYTES` | **65536**（64 KiB，UTF-8 计） | 超限 ⇒ 截断并置 `redacted=true` |
| `ARGS_VALUE_MAX_BYTES` | **8192** | 单值超限 ⇒ 截断该值并置 `redacted=true` |
| `ARGS_MAX_DEPTH` | **8** | 超深 ⇒ 该子树替换为 `"[TRUNCATED:DEPTH]"`，置 `redacted=true` |
| `ARGS_MAX_ARRAY_ITEMS` | **100** | 超长 ⇒ 保留前 100 项 + `"[TRUNCATED:ITEMS:<n>]"`，置 `redacted=true` |
| `ARGS_MAX_KEYS` | **256** | 超键数 ⇒ 按键名升序保留前 256 + `"[TRUNCATED:KEYS]"`，置 `redacted=true` |
| 截断顺序（固定） | ① 单值 → ② 数组项 → ③ 键数 → ④ 深度 → ⑤ 总字节 | 每一步之后复检总字节 |
| 域外入站校验 | 域外审批服务对 `argsPreview` 复检上限：超 `ARGS_PREVIEW_MAX_BYTES` ⇒ **拒绝该请求**（HTTP 413），审批收敛为 `unavailable`，产生硬审计 `approval.payload_too_large` |
| 验收 | 以含 `password` 与 `token` 键的参数，以及 10 MB 文件内容参数各触发一次审批：敏感键值被掩码、超限被截断且 `redacted=true`、载荷体积不超上限 |

---

## 4. 定序约束

| # | 约束 | 判定 | 违反处置 |
|---|---|---|---|
| O-1 | 同 `callId` 的 `tool.call` 事件**必须**先于 `approval.requested` 投递 | 事件流中 `seq(tool.call) < seq(approval.requested)` | 反向网关**不得**投递 `approval.requested`；在**有界缓冲**（≤ 5 s）内等待 `tool.call`；超时 ⇒ 审批收敛 `unavailable` |
| O-2 | 单一 SSE 通道按 `seq` 单调投递；`seq` 作为 SSE `id` | 消费端按 `Last-Event-ID = seq+1` 续传 | 缺号 ⇒ `resync`，携带"已丢失区间 + 期间结论" |
| O-3 | 参数上报（§1）**必须**早于审批请求发起 | 域外审批入站存在对应 `(callId)` 的上报记录 | 无记录 ⇒ `unavailable`（**不得**盲批） |
| O-4 | 审批请求必须在未结束轮次内发起 | `turnId` 属开放轮次 | 轮次外到达 ⇒ 判崩溃残留，**不执行** |

---

## 5. 回补端点

```
GET /v1/sessions/{id}/turns/{tid}/calls/{callId}
```

| 项 | 规定 |
|---|---|
| 鉴权 | 域外 RBAC：请求者租户 ≠ 资源租户、或 `workspaceId ∉` 令牌允许集合 ⇒ `403`（不泄露存在性时用 `404`） |
| 响应字段（全部必返） | `sessionId`、`turnId`、`callId`、`toolName`、`argsDigest`、`argsPreview`、`redacted`、`callSeq`、`approvalSeq`、`approvalStatus`、`decidedAt`、`decidedByRole`（仅角色，不含自然人标识）、`outcomeReasonCode` |
| `approvalStatus` 取值 | `pending` / `allowed-once` / `rejected` / `cancelled` / `unavailable` / `timeout`（词表闭合，出现词表外取值即 CI 失败） |
| 一致性 | `callSeq < approvalSeq`；`argsDigest` 与 §1 上报值逐字节相同 |
| 用途 | 仅用于**重连后回补**；**不得**作为"重新申请审批"的入口 |
| 保留 | 与审计记录同策略（`SEC-076`，≥ 366 天）；`displayReason` 不出现在响应中 |

---

## 6. 兜底拒绝规则（`SEC-062`）

### 6.1 「参数无法送达域外」的判定（登记期）

工具满足下列**任一**条件 ⇒ 判为无法送达，**禁止**进入 `requireApproval`，**且不予注册**：

| # | 条件（可执行） | 检出方式 |
|---|---|---|
| F-1 | 参数对象不能 JCS 规范序列化（含函数、`BigInt`、循环引用、`Symbol`、`undefined` 作为根） | 生成器对工具 schema 做静态判定 + 注册期试算 `argsDigest` |
| F-2 | 参数在截断规则执行后仍无法在 65536 字节内产出 `argsPreview` | 生成器按 schema 上界推算 |
| F-3 | 工具调用不携带 `callId` | 注册期断言 |
| F-4 | 工具绕过桥（未经唯一入口） | 桥的注册准入（不可达） |

### 6.2 运行时兜底（判定顺序固定）

| 顺序 | 检查 | 失败动作 |
|---|---|---|
| 1 | 桥在审批判定前产出十项（§1） | 缺失 ⇒ 报 `unavailable`，工具**不执行**，写硬审计 `approval.params_missing` |
| 2 | 域外审批服务解析 `sandbox_permissions` 与 `justification` | 解析不到 ⇒ `rejected` 或 `unavailable`（**不得**盲批） |
| 3 | 域外审批服务在 `T_a` 内收到应答 | 超时 ⇒ 终态（`timeout`/`rejected`/`cancelled`），工具不执行 |
| 4 | 无最终应答者 | `unavailable`，fail-closed |
| 5 | 审批入站体积/字段校验 | 不通过 ⇒ 413 + `unavailable` + 硬审计 |

### 6.3 禁止项（出现即不通过）

| 禁止 | 依据 |
|---|---|
| allow-always / 规则存储 / 撤销语义 / 按工具名的授权缓存 | `SEC-065` |
| 依赖内核 `signal` 收敛超时（内核只有 abort ⇒ `cancelled`） | `SEC-064`、`C40` |
| 在审批落库或回补响应中持久化 `displayReason` | `CTR-001` §4.2 |
| 第三档风险配置（自研 allow-always 档） | `SEC-068` |

### 6.4 风险分档（只允许两档；逐档一致性校验）

| 档 | `requireApproval` | 沙箱 | 工具集 | 前置确认 | 校验（生成器） |
|---|---|---|---|---|---|
| 保守档 | 含写类与外发类 | ≤ `sandboxModeCeiling` | 白名单内 | 逐次审批 | 落档即一致性通过 |
| 敏捷档 | **空** | **`read-only`**（锁死） | 仅零副作用工具 | 发轮次前一次前置确认 | `sandboxModeCeiling != read-only` 或工具集含副作用工具 ⇒ **拒绝签发** |

---

## 7. 状态与文案

逐字文本的唯一基线是 `PRD-DOC-01`（`COPY-*`）。本表给**必须出现的语义与不可省略的"未执行"结论**。

| 状态 | 工具是否执行 | 文案基线 / 语义要求 |
|---|---|---|
| `allowed-once` | 是（仅该次） | — |
| `rejected` | 否 | 审批面板按钮文案见 `COPY-015`（「拒绝」）；结论用 `COPY-028`：「本次调用未执行（你已拒绝）。」 |
| `cancelled` | 否 | 结论用 `COPY-028`：「本次调用未执行（审批已取消）。」 |
| `unavailable`（含参数补全失败、通道不可达） | 否 | 参数上下文缺失场景用 `COPY-006`（「上下文缺失：本次调用未提供可核验的参数，无法批准」，批准按钮禁用）；其余 `unavailable` 用 `COPY-028`：「本次调用未执行（审批通道不可用）。」 |
| `timeout` | 否 | `COPY-007`：「审批已超时，本次调用未执行」（句末无句号，逐字） |

> **`COPY-028` 已登记**（`PRD-DOC-01` §3），三种场景共用词干「本次调用未执行」。**任一场景不得省略"未执行"**。

- 上述状态的**结论中不得省略"未执行"**；禁止文案：「请稍后重试」单独出现、承诺"超时后自动重试"、提供绕过批准的路径（`SPEC-04` `PRD-013`/`PRD-017` 的禁用清单）。
- 会话内**必须**可见：模式徽章、工具集、待审批数（设计 §7.3.5 第 5 条）。

---

## 8. 验收用例（对应 `GATE-002` 条件 5 与本文件 §1–§6）

| 用例 | 构造 | 断言 |
|---|---|---|
| A-01 | 触发一次需审批调用 | 十项齐备；`argsDigest` 稳定；`redacted` 取值正确 |
| A-02 | 含 `password`/`token` 键 + 10 MB 参数各一次 | 键级掩码；截断 + `redacted=true`；体积 ≤ 65536 |
| A-03 | 抓 SSE 事件序列 | `seq(tool.call) < seq(approval.requested)` |
| A-04 | 断开 SSE 后重连并调用回补端点 | 返回 `toolName`/`argsDigest`/`argsPreview`/审批状态；越权租户 `403`/`404` |
| A-05 | 域外审批方拿到缺 `sandbox_permissions` 的上报 | 收敛 `rejected`/`unavailable`；工具未执行 |
| A-06 | 断开全部审批应答端点 | `unavailable`；工具未执行；会话收到明确失败态 |
| A-07 | 发起审批后不应答，等待 > `T_a`（60–120 s） | 进入终态；工具未执行；轮次在 `T_turn` 内收尾 |
| A-08 | 批准一次后再次同名同参数调用 | 第二次仍产生**新** `approvalId`；不存在长期授权记录 |
| A-09 | Profile 把无法产出 `argsDigest` 的工具列入 `requireApproval` | 生成器拒签，或该工具不注册、不产生审批请求、不在可见集 |
| A-10 | 同一用户在两个会话各产生一个待审批 | `GET /v1/approvals?status=pending` 一次返回两条 |
| A-11 | 敏捷档 + `sandboxModeCeiling=workspace-write` | 生成器拒绝签发 |
| A-12 | 单次调用请求更宽 `sandbox_permissions` 超过上限 | 调用被拒、目标文件未创建、审计含请求与拒绝结论 |
