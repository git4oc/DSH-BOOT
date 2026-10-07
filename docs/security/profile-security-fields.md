# Profile 安全字段规范

| 项 | 值 |
|---|---|
| 文档编号 | `SEC-DOC-02` |
| 交付物 | `SPEC-01` §3 交付物 2 |
| 版本 | 1.0 |
| 状态 | 生效 |
| 上游依据 | 设计文档 v2.6 §4.1.2 / §4.5.1 / §4.6 / §4.8.1 / §5.3.1 / §6.2 / §8.2；`SPEC-00` §7.1 `GATE-002`；`SEC-00` §1.2 |
| 机器可读契约 | `contracts/profile.schema.json`（本文件**不得**另立一套；冲突以该 schema 为机器判据，语义缺口以 `x-ov-semanticChecks` 承载） |
| 落实的 `SEC-*` | `SEC-006`、`SEC-013`、`SEC-014`、`SEC-015`、`SEC-023`、`SEC-025`、`SEC-030`、`SEC-031`、`SEC-032`、`SEC-033`、`SEC-034`、`SEC-036`、`SEC-046`、`SEC-049`、`SEC-050`、`SEC-051`、`SEC-055`、`SEC-062`、`SEC-068`、`SEC-094` |
| 实现落点（引用） | `ENG-025`、`ENG-029`、`ENG-030`、`ENG-040`、`ENG-045`、`ENG-062`、`ENG-026`、`ENG-027` |

---

## 1. 校验落点与判定顺序

| 顺序 | 落点 | 输入 | 失败结果 | 依据 |
|---|---|---|---|---|
| 1 | 域外 Profile 生成器（唯一强制力产生点） | 租户/场景/隔离组 + Registry 台账 | **拒绝签发**，输出 `{field, rule, reason}` | `SEC-010`、`SEC-003` |
| 2 | 制品加载器包装层（挂载前） | `pluginSet[].integrity` | 拒载该行且**拒绝 ready** | `SEC-011` |
| 3 | 域启动自检（域内，仅交叉核验） | 实际加载结果 | 产出 `{item, ok, detail}`；**不得单独决定 ready** | `ENG-040`、`SEC-DOC-04` §2 |
| 4 | Session Router 就绪门禁（域外，唯一判定者） | 域外事实 + 自检交叉核验 | **拒绝 ready**；域不进入 `active` | `SEC-044` |

**禁止**：任何字段缺省时"静默用默认值补齐"（`ENG-029` 判据③）。缺字段 = 拒绝。

---

## 2. 安全字段总表

「拒绝规则」列给的是**可判定谓词**，不是描述。`schema 路径` 与 `contracts/profile.schema.json` 逐字一致。

| # | 字段（schema 路径） | 必填 | 安全语义 | 拒绝规则（域外生成器） | `SEC-*` |
|---|---|---|---|---|---|
| P-1 | `trainVersion` | 是 | 版本列车单值 | `typeof !== 'string'`、空串、为数组、或 `new Set([trainVersion, ...pluginSet[].version]).size !== 1` ⇒ 拒绝，错误码 `EVO_TRAIN_VERSION_AMBIGUOUS` / `train.mixed: <行名>@<版本>` | `SEC-010` |
| P-2 | `pluginSet[].tier` | 是 | 分层标记合法性（域外判定） | `tier === 'platform'` 而该插件来源为租户自带 ⇒ 拒绝，错误码 `tier.tenant_as_platform: <name>` | `SEC-010` |
| P-3 | `pluginSet[].integrity` | 是 | 制品完整性 | 不匹配 `^sha512-`，或签名校验失败 ⇒ 拒载该行 | `SEC-011` |
| P-4 | `removedRows` | 是 | 管理行移除 | 集合**不含** `tool-plugin-manager` **或**不含 `plugin-manager` ⇒ 拒绝（`PC-005`） | `SEC-013` |
| P-5 | `hmr.enabled` | 是 | 运行期模块重载路径 | ≠ `false`（含缺省）⇒ 拒绝（`PC-005`） | `SEC-013` |
| P-6 | `toolAllowlist` | 是 | 工具可达性白名单（唯一强制依据） | 缺省 ⇒ 拒绝（**不得**解释为全集）；`[]` 在生产态 ⇒ 拒绝；元素含 `*`、glob、正则元字符 ⇒ 拒绝；元素无法解析到 `pluginSet` 内工具插件或已下发 connector 的 `mcp__<serverName>__<rawName>` ⇒ 拒绝（`PC-008`）；重复元素 ⇒ 拒绝（schema `uniqueItems`） | `SEC-006`、`SEC-036` |
| P-7 | `sandboxMode` | 是 | 部署默认模式 | 不在 `{read-only, workspace-write, danger-full-access}` ⇒ 拒绝；生产态取值 ≠ `read-only` ⇒ 拒绝 | `SEC-025` |
| P-8 | `sandboxModeCeiling` | 是 | 租户级升权上限 | 缺省 ⇒ 拒绝；`order(sandboxMode) > order(sandboxModeCeiling)` ⇒ 拒绝（`PC-003`） | `SEC-023` |
| P-9 | `permissionPresets.enabled` / `.reachable` | 是 | 预设收敛 | `reachable.length !== 1`、`reachable` 含 `danger-full-access` 或 `never`、`reachable ⊄ enabled` ⇒ 拒绝（`PC-004`） | `SEC-014`、`SEC-025` |
| P-10 | `connectors[].hosting` | 是 | 凭证归属 | 缺省 ⇒ 拒绝；`hosting === 'domain'` 而该 connector 声明 `credentialRef` ⇒ 拒绝，错误码 `credential.hosting_mismatch` | `SEC-050` |
| P-11 | `connectors[].credentialException` | 否（true 时强约束） | 唯一例外登记 | `credentialException === true` 且 `hosting !== 'exception'` ⇒ 拒绝；`exception` 条数 > `credentialExceptionMaxPerDomain` ⇒ 拒绝（`PC-009`）；例外 **无** 安全评审单号 ⇒ 拒绝 | `SEC-051`、`SEC-055` |
| P-12 | `connectors[].trust` | 是 | 信任级 | `hosting === 'exception'` 且 `trust !== 'untrusted'` ⇒ 拒绝；缺省 ⇒ 拒绝（默认值由生成器写入 `untrusted`，不由域内补） | `SEC-055` |
| P-13 | `connectors[].requireApproval[]` | 否 | 审批闸门 | 元素 ∉ `toolAllowlist` ⇒ 拒绝；元素对应工具**无法产出 `argsDigest`** ⇒ 拒绝（登记一致性校验） | `SEC-062` |
| P-14 | `connectors[].serverName` | 是 | 审计键维度 | 不匹配 `^[A-Za-z0-9_-]{1,32}$`；单 Profile 内重复 ⇒ 拒绝（`PC-006`） | `SEC-073` |
| P-15 | `credentialRef`（顶层与 connector 级） | 否 | 凭证引用 | 值形态不是引用（`vault://…` 等登记前缀）；或经正则/熵扫描命中内联 secret ⇒ 拒绝 | `SEC-049` |
| P-16 | `workspaces[].writable` | 是 | 只读共享工作区 | `false` 的根不得与任一 `writable:true` 的根重叠（同一路径）⇒ 拒绝 | `SEC-034` 相邻（单一可写根 `C27`） |
| P-17 | `deadlines`（`approvalSeconds` / `modelStreamSeconds` / `turnSeconds`） | 是 | 三层截止时间 | `approvalSeconds ∉ [60,120]`、`turnSeconds ∉ [1,900]`、`approvalSeconds ≥ turnSeconds`、`modelStreamSeconds ≥ turnSeconds` ⇒ 拒绝（`PC-001`、`PC-002`） | `SEC-064` |
| P-18 | `buffers.audit.retainHours` / `buffers.billing.retainHours` | 是 | 分缓冲、按时间定容 | 缺任一 ⇒ 拒绝；`retainHours < 24` ⇒ 拒绝；两 kind 共用同一实例标识 ⇒ 拒绝 | `SEC-075` |
| P-19 | `gateway.tokenTtlSeconds` | 是 | 域→域外会话租约 | `> 300` 或 `≤ 0` ⇒ 拒绝 | `SEC-008` |
| P-20 | `presetId` | 是 | preset 只增不删；会话创建后不可变 | 缺省 ⇒ 拒绝恢复（`C20`） | `SEC-028` |
| P-21 | `quota.toolCallsPerTurn` | 是 | 轮次内工具调用上界 | 缺省 ⇒ 拒绝；`0` 表示禁止调用（合法） | `SEC-068` 相邻 |
| P-22 | `domainEvidence`（`imageDigest` / `mountDigest` / `runtimeConfigDigest` / `profileGenerationDigest`） | 平台侧断言（`PC-007`） | 就绪判据的域外证据 | 任一项为空或未在域创建时留存 ⇒ **拒绝 ready**（不是拒绝签发） | `SEC-DOC-04` §2 |

### 2.1 安全相关的**禁止字段**（出现即拒绝，`additionalProperties: false`）

| 字段 | 拒绝理由（错误文案给客户可见版本） | `SEC-*` |
|---|---|---|
| `policies.writeScopes` | 「该字段不是内核概念。需要限制写入时，请拆分隔离组或使用独立域。」 | `SEC-034` |
| `connectors[].failOnStartupError` | 「必需 connector 由就绪探针判定，不能由该字段表达。」 | `SEC-043` |
| `policies.sandboxMode` | 「请使用顶层 `sandboxMode` / `sandboxModeCeiling`。」 | `SEC-023` |
| 任何运行期 deny 字段（`toolPolicy.deny` 等） | 「平台无运行期 deny 语义。不需要的工具请从 `toolAllowlist` 移除。」 | `SEC-030` |
| 任何 credential provider 行（见 `SEC-DOC-05` §2） | 「域内不得挂载 credential provider。」 | `SEC-046` |
| `dsh-tool-web` / `web_fetch` 行（未按 `SEC-095` 登记时） | 「域内不提供公网访问工具。」 | `SEC-031`、`SEC-095` |
| `dsh-session-query`、`dsh-session-query-sqlite`、其 FTS 派生库 | 「域内不挂载会话全文检索插件。」 | `SEC-032` |

---

## 3. 语义检查项（`x-ov-semanticChecks`）归属

| 检查 ID | 规则 | 归属方 | 落在本文件的位置 |
|---|---|---|---|
| `PC-001` | `approvalSeconds < turnSeconds` | SEC（时限安全语义） | P-17 |
| `PC-002` | `modelStreamSeconds < turnSeconds` | REL | P-17（引用） |
| `PC-003` | `sandboxMode ≤ sandboxModeCeiling` | SEC | P-8 |
| `PC-004` | `reachable` 恰一元素且 ≠ `danger-full-access` | SEC | P-9 |
| `PC-005` | `removedRows` 含两行且 `hmr.enabled === false` | SEC | P-4、P-5 |
| `PC-006` | `serverName` 单 Profile 内唯一 | SEC（审计键唯一性） | P-14 |
| `PC-007` | 四项 `domainEvidence` 非空且留证 | SEC | P-22 |
| `PC-008` | `toolAllowlist` 每项可解析到 `pluginSet` 或已下发 connector | SEC | P-6 |
| `PC-009` | `hosting === 'exception'` 条数 ≤ 按域硬上限 | SEC | P-11、`SEC-DOC-05` §3 |

**归属纪律**：`PC-00x` 的实现落在 `packages/control-plane/src/profile/validate.ts`（表驱动，逐字段一个校验函数 + 一个失败用例，`ENG-029`）。本文件**不**复制该校验器代码，只给谓词。

---

## 4. 默认值与"缺省语义"表（易写错处）

| 字段 | 缺省语义 | 依据 |
|---|---|---|
| `toolAllowlist` | **空集**（不是全集） | `SEC-006`、`CTR-001` §3.4 |
| `connectors[].trust` | `untrusted` | `SEC-055` |
| `sandboxMode` | `read-only`（本方案显式下发，不依赖内核隐含默认） | `SEC-025` |
| `connectors[].required` | `false`（必需性不由该字段表达，由就绪探针判定） | `SEC-043` |
| `removedRows` / `hmr` / `deadlines` / `buffers` / `hosting` | **无缺省**；缺字段即拒绝 | `ENG-029` |

---

## 5. 开发态逃生门（`toolAllowlist: ["*"]`）

| 项 | 规则 |
|---|---|
| 开启条件 | 仅 `OV_ENV === 'dev'` |
| 生产态 | 拒绝 `*`、拒绝 `[]`、拒绝缺省、拒绝任何通配符（精确匹配，禁用 glob 与正则），错误码 `toolAllowlist.wildcard_forbidden` |
| 构建期 | 生产构建中逃生门开关**不存在或无效**；代码路径不装配生产校验分支以外的分支 |
| 开启时副作用 | 输出告警行 `ESCAPE_HATCH_ACTIVE`，并进审计 |
| 验收 | `OV_ENV=dev` + `["*"]` 接受；`OV_ENV=prod` + `["*"]` / `[]` / 缺省 / `["dsh-tool-*"]` 全部拒绝并给出具体原因（`ENG-045`） |
| `SEC-*` | `SEC-036` |

---

## 6. 非法 Profile 用例表（校验器单测必须逐行覆盖）

| # | 输入构造 | 期望结果 | 断言点 |
|---|---|---|---|
| T-01 | 删除 `toolAllowlist` | 拒绝 | 错误含字段路径 `toolAllowlist`；域不 ready |
| T-02 | `toolAllowlist: ["*"]`（`OV_ENV=prod`） | 拒绝 | 错误码 `toolAllowlist.wildcard_forbidden` |
| T-03 | `removedRows: ["tool-plugin-manager"]` | 拒绝 | 缺 `plugin-manager` |
| T-04 | `hmr.enabled: true` | 拒绝 | 缺省/真值均拒绝 |
| T-05 | `permissionPresets.reachable: ["read-only","danger-full-access"]` | 拒绝 | `PC-004` |
| T-06 | `sandboxModeCeiling: "read-only"` 且 `sandboxMode: "workspace-write"` | 拒绝 | `PC-003` |
| T-07 | 加入 `dsh-credentials-local` 行 | 拒绝 | 命中拒绝清单（`SEC-DOC-05` §2） |
| T-08 | 加入 `dsh-session-query-sqlite` 行 | 拒绝 | `SEC-032` |
| T-09 | connector `hosting: "domain"` + `credentialRef` 非空 | 拒绝 | `credential.hosting_mismatch` |
| T-10 | 两个 connector 同 `serverName` | 拒绝 | `PC-006` |
| T-11 | `credentialException: true` 但 `hosting: "data-plane"` | 拒绝 | schema `allOf` 第三条 |
| T-12 | 例外条数 = `credentialExceptionMaxPerDomain + 1` | 拒绝 | `PC-009` |
| T-13 | `requireApproval: ["mcp__x__y"]` 而 `toolAllowlist` 不含该名 | 拒绝 | P-13 |
| T-14 | `requireApproval` 指向无法产出 `argsDigest` 的工具 | 拒绝 | `SEC-062` |
| T-15 | 出现 `policies.writeScopes` | 拒绝 | `additionalProperties: false` + 可读错误 |
| T-16 | `deadlines.approvalSeconds = 30` | 拒绝 | `PC-001` 区间 |
| T-17 | `deadlines.approvalSeconds = 120`、`turnSeconds = 60` | 拒绝 | `PC-001` 序关系 |
| T-18 | `buffers.billing` 缺省 | 拒绝 | `ENG-062` |
| T-19 | `trainVersion: ["0.2.0-rc.1","0.2.0-rc.2"]` | 拒绝 | `EVO_TRAIN_VERSION_AMBIGUOUS` |
| T-20 | `pluginSet[].version = "0.2.0-rc.2"` 而 `trainVersion = "0.2.0-rc.1"` | 拒绝 | `train.mixed` |
| T-21 | `domainEvidence` 四项全空 | 拒绝 ready（不是拒绝签发） | `PC-007`、`SEC-DOC-04` §2 |
| T-22 | Windows 域 + 挂载宿主共享目录 | 拒绝 ready | `SEC-094` |

---

## 7. 与其他规格的冲突登记（按 `SEC-00` §1.2 流程处理）

| # | 冲突 | 双方原文位置 | 现状 | 处置 |
|---|---|---|---|---|
| C-1 | `residencyRegion`：`SPEC-05` `EVO-026` 验收判据要求「Profile 含 `residencyRegion`」，但 `contracts/profile.schema.json` 为 `additionalProperties: false` 且**无该字段** ⇒ 含该字段的 Profile 会被拒绝 | `spec/05-演进与生命周期规格.md` `EVO-026`；`contracts/profile.schema.json` `properties` | **未闭合** | 记录冲突 → 提总纲维护者裁定：或在 schema 增 `residencyRegion`（并同步 `SEC-DOC-11` §6），或改 `EVO-026` 判据为"驻留绑定记录在域外台账" |
| C-2 | 审计键命名：设计 §5.5 与 `CTR-001` C-5 称「五元组」，实列**六个**字段 | 设计 §5.5；`CTR-001` §1 C-5 | 已按六字段执行 | 名称保留「五元组」，字段集合按六字段；见 `SEC-DOC-07` §3 |

---

## 8. 本文件不覆盖

| # | 内容 | 去向 |
|---|---|---|
| 1 | Profile 生成器的服务实现与部署 | `SPEC-03`（`ENG-025`/`ENG-029`） |
| 2 | 密钥/证书轮换与重叠期 | `SPEC-05` |
| 3 | `residencyRegion` 的最终归属（冲突 C-1） | 总纲维护者裁定 |
