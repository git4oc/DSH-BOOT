# 凭证拒绝清单与例外登记表

| 项 | 值 |
|---|---|
| 文档编号 | `SEC-DOC-05` |
| 交付物 | `SPEC-01` §3 交付物 5 |
| 版本 | 1.0 |
| 状态 | 生效 |
| 上游依据 | 设计文档 v2.6 `C14` / `C46` / `D11` / `G1` / §4.8.1 / §4.8.2 / §8.2；`SPEC-00` §7.1 `GATE-002` 条件 4 |
| 落实的 `SEC-*` | `SEC-045`、`SEC-046`、`SEC-047`、`SEC-048`、`SEC-049`、`SEC-050`、`SEC-051`、`SEC-052`、`SEC-053`、`SEC-054`、`SEC-055`、`SEC-056`、`SEC-057`；就绪联动 `SEC-041`；门禁检查项 `GATE-002-C12` |
| 实现落点（引用） | `contracts/profile.schema.json`（`connectors[].hosting` / `credentialException` / `credentialRef`）、`PC-009`；`SEC-DOC-02` §2 P-10…P-15 |

---

## 1. 平台规则（判定基准）

| 规则 | 判定 |
|---|---|
| R-1 | 默认**任何凭证不得进入域内**。域内出现的 secret 形态（有效期 > 24 h）数量必须为 0，唯一例外按 §3 登记 |
| R-2 | 需要凭证的 connector 一律数据面托管（含 stdio）；域内只保留无凭证薄桥或无桥 |
| R-3 | 域内**不得**挂载任何 credential provider 插件（§2） |
| R-4 | 域容器环境**白名单构造**；内核环境清洗为"已知启发式、非控制"，不得作为控制依据 |
| R-5 | 一律 `credentialRef` 引用；Profile 与 Registry 记录中**不得**出现内联凭证值 |
| R-6 | 例外唯一形态：持有凭证 **且** 必须读写域内工作区文件；其余场景不得申请例外 |

---

## 2. credential provider 拒绝清单（包名）

### 2.1 精确名单（exact match，判定为拒绝）

| # | 包名 | 说明 |
|---|---|---|
| 1 | `dsh-credentials` | credential provider seam |
| 2 | `dsh-credentials-local` | 本地 credential provider 实现 |
| 3 | `dsh-web-search-deepseek` | 自带 key 的检索插件 |

### 2.2 通配条目（模式匹配，判定为拒绝）

| # | 模式 | 覆盖 |
|---|---|---|
| 4 | `dsh-llm-*-api-key` | 各模型厂商 API key provider（如 `dsh-llm-openai-api-key`、`dsh-llm-deepseek-api-key`） |
| 5 | `dsh-deepseek-account*` | DeepSeek 账号类 provider（如 `dsh-deepseek-account-oauth`） |

### 2.3 匹配语义（唯一合法实现）

```
normalize(name) = lowercase( 去掉前缀 "@<scope>/" 后的 name )
pattern 中 "*" 等价于正则 [^/]*（不跨 "/"）；除此之外**不得**解释任何正则元字符
denied(name) = ∃ e ∈ exactList: normalize(name) == e
             ∨ ∃ p ∈ patternList: regex(escape(p) 中 "*" → "[^/]*").test(normalize(name))
```

- 匹配**不做**前缀模糊（`dsh-credentialsX` 不因后缀相似被拒，但若命中任一模式条目则拒）。
- 拒绝清单是**域外代码常量**，受快照保护（`GATE-002-C12`）；变更须走 `SEC-00` §8 变更控制。
- 清单存在性本身是门禁检查项：清单文件缺失/为空 ⇒ `GATE-002-C12` 不通过。

### 2.4 强制落点（三级，逐级独立）

| 落点 | 动作 | 失败码 |
|---|---|---|
| L1 域外 Profile 生成器 | 命中任一清单项 ⇒ **拒绝签发** | `credential_provider.forbidden: <name>` |
| L2 桥 / 插件行装配 | 命中项不进 `pluginSet`，进 `toolAllowlist` 也不可能注册 | 无（不可达） |
| L3 就绪判据 RC-5 | `pluginSet ∩ denylist ≠ ∅` ⇒ **拒绝 ready** | `ready.denied.credential_provider_present` |

---

## 3. 例外登记表结构

### 3.1 硬上限

| 参数 | 取值规则 |
|---|---|
| `credentialExceptionMaxPerDomain` | 平台配置常量，**默认 1**；可为 ≥ 1 的整数；**不得**配置为"无上限"或 `0` 之外的哨兵值。该值本身必须在合规清单中登记 |
| 超限行为 | 登记第 `N+1` 条 ⇒ **拒绝登记** + 硬告警 `credential_exception.limit_exceeded`；**不得**排队、不得自动扩容 |
| 校验落点 | `PC-009`（生成器）；`SEC-DOC-02` T-12 |

### 3.2 登记表字段（每条例外一行；缺失任一必填字段 ⇒ 拒绝登记）

| # | 字段 | 类型 | 必填 | 取值/判定 |
|---|---|---|---|---|
| E-01 | `exceptionId` | string | 是 | 全局唯一，形如 `EXC-<tenantId>-<seq>` |
| E-02 | `tenantId` | string | 是 | 与域令牌一致 |
| E-03 | `isolationGroupId` | string | 是 | 例外登记粒度即域粒度 |
| E-04 | `connectorName` | string | 是 | 匹配 `^[A-Za-z0-9_-]{1,32}$`；单域内唯一 |
| E-05 | `credentialRef` | string | 是 | 仅引用，不得内联 |
| E-06 | `workspaceAccessReason` | string | 是 | 必须说明"为何必须读写域内工作区文件"（非空、≥ 20 字符） |
| E-07 | `securityReviewTicket` | string | 是 | 安全评审单号；无单号 ⇒ 拒绝 |
| E-08 | `approvedBy` | string | 是 | 安全评审签署人 |
| E-09 | `effectiveFrom` / `effectiveTo` | date | 是 | 有效期；到期未续 ⇒ 自动失活并告警 |
| E-10 | `tokenBinding` | string[] | 是 | 固定六元组 `(tenantId, isolationGroupId, sessionId, turnId, callId, connectorName)` |
| E-11 | `tokenTtlSeconds` | integer | 是 | `≤ 300` |
| E-12 | `audience` | string | 是 | 固定为数据面代理标识；令牌对上游无效 |
| E-13 | `processIsolation` | enum | 是 | `independent-uid` / `namespace` / `AppContainer` 三选一；**不得**为空或 `same-uid` |
| E-14 | `trust` | const | 是 | 固定 `untrusted` |
| E-15 | `perTurnIssueCap` | integer | 是 | 每轮次预签发硬上限；超限 ⇒ 告警且不再签发 |
| E-16 | `renewalAllowed` | const | 是 | 固定 `false`（域内自触发续签一律拒绝） |
| E-17 | `complianceListed` | boolean | 是 | 必须 `true` 才可签发 |
| E-18 | `registeredAt` | timestamp | 是 | UTC |

### 3.3 例外令牌的四项拒绝（验收用例）

| 用例 | 构造 | 期望 |
|---|---|---|
| X-1 | 同一张例外令牌**二次使用** | 拒绝 |
| X-2 | 同令牌换 `callId` 使用 | 拒绝（六元组比对失败） |
| X-3 | 用该令牌**直接请求上游**（audience 不符） | 拒绝 |
| X-4 | TTL 到期后使用 | 拒绝 |
| X-5（附加） | 域内发起一次续签请求 | 拒绝 + 硬审计 |
| X-6（附加） | 单轮次签发数超过 `perTurnIssueCap` | 告警 + 后续签发被拒 |

四项（X-1…X-4）全通过才计入 `GATE-002` 条件 4 的证据。

---

## 4. 环境构造白名单（`SEC-047`）

| 项 | 规则 |
|---|---|
| 构造方式 | 域容器环境**白名单构造**：只注入下表变量，其余一律不注入 |
| 白名单模板 | `PATH`、`HOME`、`LANG`、`LC_ALL`、`TZ`、`DSH_HOME`、`DSH_PERMISSION_MODE`（固定 `read-only`）、`OV_ENV`（生产固定 `prod`）、`OV_DOMAIN_ID`、`OV_TENANT_ID`、`OV_ISOLATION_GROUP_ID`、`OV_GATEWAY_ENDPOINT`、`OV_PROFILE_PATH`（只读挂载点） |
| 禁止注入 | 任何以 `*_KEY` / `*_SECRET` / `*_TOKEN` / `*_PASSWORD` / `*_DSN` / `*_URL`（含内嵌凭据）结尾或内含凭据的变量；`GOOGLE_APPLICATION_CREDENTIALS`；`AWS_*`；`DATABASE_URL`；`APP_DSN` |
| 探针用例（必做） | 宿主注入 `DATABASE_URL=postgres://u:p@h/db`、`GOOGLE_APPLICATION_CREDENTIALS=/k.json`、`APP_DSN=…` 后启动域；断言三者在域内子进程环境中**均不存在**；出现任一 ⇒ 不通过 |
| 内核启发式定性 | `dsh-subprocess` 的名称启发式（`/KEY\|PASSWORD\|SECRET\|TOKEN/i`）登记为「**已知启发式、非控制**」，不得作为任何凭证控制的依据 |
| 验收 | 白名单模板以代码常量形式存在，并逐项单测；探针用例结果作为 `GATE-002` 条件 4 证据之一 |

---

## 5. 合规报表模板

### 5.1 报表列（每域每周期一行；缺列 ⇒ 报表不合格）

| 列 | 口径 | 允许值/断言 |
|---|---|---|
| `reportPeriod` | 周期 | `YYYY-MM` 或 `YYYY-MM-DD` |
| `tenantId` / `isolationGroupId` | 域标识 | 非空 |
| `connectorsTotal` | 该域 connector 总数 | ≥ 0 |
| `exceptionCount` | 例外条数（`SEC-051` 要求项 ①） | ≤ `credentialExceptionMaxPerDomain` |
| `exceptionRatio` | `exceptionCount / connectorsTotal`（`SEC-051` 要求项 ②） | 保留 4 位小数；`connectorsTotal = 0` 时记 `0.0000` |
| `credentialIssues` | 该周期例外令牌**签发次数**（`SEC-051` 要求项 ③） | ≥ 0；不得为估算值，须来自签名发路径计数 |
| `perTurnCapViolations` | 超 `perTurnIssueCap` 次数 | 必须与告警数一致 |
| `renewalAttempts` | 域内自触发续签尝试次数 | 期望 0；> 0 必须附事件 ID |
| `bindingCheckFailures` | 六元组/audience 校验失败次数 | ≥ 0 |
| `unregisteredExceptions` | 存在但未登记的例外数 | **必须为 0** |
| `domainSecretScanHits` | 域内 secret 形态扫描命中数 | **必须为 0**（除已登记例外） |
| `evidenceRef` | 原始计数工件路径（WORM） | 非空、可复算 |

### 5.2 样例（格式固定，数值为示例）

| reportPeriod | tenantId | isolationGroupId | connectorsTotal | exceptionCount | exceptionRatio | credentialIssues | perTurnCapViolations | renewalAttempts | bindingCheckFailures | unregisteredExceptions | domainSecretScanHits |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10 | tenant-acme | ig-finance | 7 | 1 | 0.1429 | 1,204 | 0 | 0 | 3 | 0 | 0 |

### 5.3 报表校验规则

1. `exceptionCount ≠ 合规清单中该域条目数` ⇒ 报表不通过。
2. `credentialIssues < exceptionCount` ⇒ 不通过（存在未签发的登记）。
3. `unregisteredExceptions ≠ 0` 或 `domainSecretScanHits ≠ 0` ⇒ 触发安全事件流程。
4. 报表与合规清单必须能给出**双向**差集为空。

---

## 6. 凭证访问的强制点（速查，防实现漏点）

| 场景 | 强制点 | 判定 | `SEC-*` |
|---|---|---|---|
| 域→域外凭证访问 | 域外凭证代理 | 以调用方已认证的域身份查表；绝不解析请求体中的凭证名；缺映射即拒绝 + 审计 | `SEC-048` |
| 域令牌 | 反向网关/代理入站 | 请求租户 == 令牌租户 | `SEC-007` |
| MCP 数据面代理 | MCP 出站代理 | 凭证绑定 `(tenantId, connectorName)`，按请求注入，不落域 | `SEC-057` |
| 例外子进程 | 容器/命名空间配置（挂载期） | 独立 uid / 命名空间 / AppContainer；其他进程读不到其环境 | `SEC-053` |
| 模型出站 | 容器网络策略 + 反向网关 | 唯一模型出站；禁止绕过轮次直连 | `SEC-056` |

---

## 7. 本文件不覆盖

| # | 内容 | 去向 |
|---|---|---|
| 1 | 密钥库/HSM 选型与轮换流程、重叠期 | `SPEC-05`（`EVO-030`） |
| 2 | 数据面代理的协议实现细节 | `SPEC-03`（`ENG-041` 相邻） |
| 3 | 例外审批的产品侧 UI 与工单流 | `SPEC-04` |
