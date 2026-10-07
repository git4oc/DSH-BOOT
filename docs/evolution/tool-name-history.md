# 工具名历史清单（D5）

| 项 | 值 |
|---|---|
| 文档编号 | `EVO-DOC-05` |
| 版本 | 1.0 |
| 状态 | 生效（可填写清单模板） |
| 角色 | 演进 / 反脆弱架构师 |
| 交付物 | `SPEC-05` §3 D5 |
| 上游依据 | `SPEC-05` §2.3；设计文档 v2.6 §10.2 永久兼容面（`toolAllowlist` 工具名行）、§5.6 Connector Registry 策略行、§4.5.1 工具强制、§11.1 MCP 行、§6.2 `toolAllowlist` |
| 落实的 `EVO-*` | `EVO-015`（主）；引用 `EVO-018`（审批规则悬挂处置） |
| 写作用域 | `docs/evolution/tool-name-history.md`（排他） |

**硬性事实**：已发布工具名**不得**静默改名；改名只能作为"新增名 + 保留旧名（别名或同时注册）"发布。**MCP 重连耗尽后工具被永久注销**直到重载——注销属于"运行期不可达"，**不**等同于"改名"，两者在审计上必须分列。

---

## 1. 清单形态

| 项 | 规定 |
|---|---|
| 人工可读渲染 | §3 表 A（工具名全量）、§5 表 B（改名记录）、§6 表 C（旧名解析验证） |
| 结构化真源 | `docs/evolution/tool-name-history.jsonl`、`docs/evolution/tool-rename-log.jsonl`、`docs/evolution/legacy-name-resolution.jsonl` |
| 可 diff | 表 A 行**只增**；`state` 可改、行不可删；`aliases` 只能追加 |
| CI 解析契约 | 表 A 列名逐字匹配；相邻两次提交出现"`canonicalName` 消失且无 `aliases` / `renamedTo` 记录"即 `EVO_TOOL_NAME_SILENT_RENAME` 阻断发布 |
| 实现归属 | Registry 发布校验与 CI 校验的实现归 `ENG-###`；判据归本文件 |

---

## 2. 列定义

| # | 列名 | 类型 / 取值域 | 必填 | 语义 |
|---|---|---|---|---|
| 1 | `canonicalName` | string | 是 | 当前规范工具名。MCP 工具名是 `(serverName, rawName)` 的纯函数：`mcp__<serverName>__<rawName>` |
| 2 | `nameKind` | `native` / `mcp` | 是 | 命名来源；`mcp` 行的 `serverName` / `rawName` 必填 |
| 3 | `serverName` | string（`[A-Za-z0-9_-]{1,32}`） | 条件必填 | `nameKind = mcp` 必填；同注册作用域内唯一 |
| 4 | `rawName` | string | 条件必填 | `nameKind = mcp` 必填；connector 服务端升级**不得**改变它 |
| 5 | `state` | `active` / `aliased` / `retired` | 是 | `aliased` = 规范名已迁移，旧名仍注册或别名解析 |
| 6 | `aliases` | string 列表 | 是（可为空） | 该规范名历史上用过的全部名字；**只增** |
| 7 | `renamedFrom` | string | 条件必填 | `canonicalName` 的前身 |
| 8 | `renamedTo` | string | 条件必填 | 后继规范名 |
| 9 | `renameEffectiveTrainVersion` | string | 条件必填 | 改名生效列车号（整列车单值） |
| 10 | `legacyWindowEndTrainVersion` | string | 条件必填 | 旧名解析窗口截止列车号；**不得**早于"一个完整列车周期" |
| 11 | `approvalRuleRefCount` | 整数 ≥ 0 | 是 | 引用该工具名的 `requireApproval` 规则数 |
| 12 | `sessionHistoryRefCount` | 整数 ≥ 0 | 是 | 历史会话与历史审批记录中的引用数 |
| 13 | `lastReferencedAt` | RFC3339 UTC | 是 | 最近一次被引用时间 |
| 14 | `registryPublishedAt` | RFC3339 UTC | 是 | 首次进入 Registry 的时间 |

---

## 3. 表 A：已发布工具名清单（示例行）

| canonicalName | nameKind | serverName | rawName | state | aliases | renamedFrom | renamedTo | renameEffectiveTrainVersion | legacyWindowEndTrainVersion | approvalRuleRefCount | sessionHistoryRefCount | lastReferencedAt | registryPublishedAt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `dsh-tool-fs` | `native` | — | — | `active` | — | — | — | — | — | 0 | 40219 | `2026-01-05T04:00:00Z` | `2026-01-05T00:00:00Z` |
| `mcp__corp-jira__get_issue` | `mcp` | `corp-jira` | `get_issue` | `active` | — | — | — | — | — | 0 | 8821 | `2026-01-05T03:59:00Z` | `2026-01-05T00:00:00Z` |
| `mcp__corp-jira__comment` | `mcp` | `corp-jira` | `comment` | `active` | — | — | — | — | — | 1 | 1204 | `2026-01-05T03:41:00Z` | `2026-01-05T00:00:00Z` |
| `mcp__corp-jira__comment_v2` | `mcp` | `corp-jira` | `comment_v2` | `active` | — | `mcp__corp-jira__comment` | — | `0.2.0-rc.2` | — | 0 | 0 | `—` | `2026-02-26T00:00:00Z` |
| `mcp__corp-jira__comment` | `mcp` | `corp-jira` | `comment` | `aliased` | — | — | `mcp__corp-jira__comment_v2` | `0.2.0-rc.2` | `0.2.0-rc.4` | 1 | 1204 | `2026-01-05T03:41:00Z` | `2026-01-05T00:00:00Z` |

第 4 / 5 行示例演示"新增名 + 保留旧名"的成对记录：**旧名行必须保留**（`state = aliased`），其 `legacyWindowEndTrainVersion` 决定解析窗口。

---

## 4. 发布校验（Registry 发布门禁）

| # | 校验项 | 判定 | 违反处置 | 需求 |
|---|---|---|---|---|
| P-1 | 旧名不得消失 | 相邻两次发布中 `canonicalName` 集合只能增大 | `EVO_TOOL_NAME_SILENT_RENAME`；拒绝发布 | `EVO-015` |
| P-2 | 改名必须成对 | 出现 `renamedTo` 时**必须**存在对应的 `renamedFrom` 行 | 拒绝发布 | `EVO-015` |
| P-3 | 别名必须登记 | 旧名不再作为规范名时，`aliases` 或独立别名行**必须**存在 | 拒绝发布 | `EVO-015` |
| P-4 | 窗口不得早于一个完整列车周期 | `legacyWindowEndTrainVersion` − `renameEffectiveTrainVersion` ≥ 一个完整列车周期 | 拒绝发布 | `EVO-015` |
| P-5 | 旧会话可恢复 | 改名后旧会话恢复**必须**能解析到同一工具面 | 拒绝发布（须附 §6 验证记录） | `EVO-015` |
| P-6 | MCP 命名纯函数 | `nameKind = mcp` 行的 `canonicalName == mcp__<serverName>__<rawName>` | 拒绝发布 | `EVO-015` |
| P-7 | 服务端升级不改模型可见名 | connector 服务端升级**不得**改变 `serverName` / `rawName` | 拒绝发布 | `EVO-015` |
| P-8 | 注销与改名分列 | 因重连耗尽产生的"工具不可达"**不得**登记为改名或别名 | 拒绝发布（登记口径错） | `EVO-015`、`EVO-017` |

---

## 5. 表 B：改名记录

| # | 列名 | 语义 |
|---|---|---|
| 1 | `changeId` | 变更唯一标识 |
| 2 | `fromName` / `toName` | 旧名 / 新名 |
| 3 | `changeKind` | `新增别名` / `双注册` / `新名发布` |
| 4 | `effectiveTrainVersion` | 生效列车号 |
| 5 | `legacyWindowEndTrainVersion` | 旧名解析窗口截止 |
| 6 | `approvalRuleAction` | 审批规则迁移动作：`重指向` / `双列` / `orphan+审计` |
| 7 | `affectedApprovalRuleCount` | 受影响审批规则条数 |
| 8 | `legacySessionRestoreVerificationId` | 旧会话恢复验证记录 id（表 C） |
| 9 | `auditRef` | 审计记录引用 |

**示例行**

| changeId | fromName | toName | changeKind | effectiveTrainVersion | legacyWindowEndTrainVersion | approvalRuleAction | affectedApprovalRuleCount | legacySessionRestoreVerificationId | auditRef |
|---|---|---|---|---|---|---|---|---|---|
| `tnc-0001` | `mcp__corp-jira__comment` | `mcp__corp-jira__comment_v2` | `双注册` | `0.2.0-rc.2` | `0.2.0-rc.4` | `双列` | 1 | `lnr-0001` | `audit://tnc-0001` |

---

## 6. 表 C：旧名解析验证记录

| # | 列名 | 语义 |
|---|---|---|
| 1 | `verificationId` | 验证记录 id |
| 2 | `legacyName` | 被验证的旧名 |
| 3 | `canonicalName` | 解析到的规范名 |
| 4 | `sessionSample` | 抽样会话数（**必须** ≥ 10） |
| 5 | `replayErrors` | 回放解析错误数（**必须**为 0） |
| 6 | `eventLoss` | 事件丢失数（**必须**为 0） |
| 7 | `toolFaceEqual` | 解析后工具面与创建时是否一致（必须为「是」） |
| 8 | `beforeWindowEnd` | 验证是否发生在窗口内（必须为「是」） |
| 9 | `conclusion` | `通过` / `失败` |
| 10 | `executedBy` / `verifiedAt` | 执行人与时间 |

**示例行**

| verificationId | legacyName | canonicalName | sessionSample | replayErrors | eventLoss | toolFaceEqual | beforeWindowEnd | conclusion | executedBy | verifiedAt |
|---|---|---|---|---|---|---|---|---|---|---|
| `lnr-0001` | `mcp__corp-jira__comment` | `mcp__corp-jira__comment_v2` | 12 | 0 | 0 | 是 | 是 | `通过` | `<name>` | `2026-02-27T02:00:00Z` |

---

## 7. 旧名移除的前置条件

| # | 条件 | 判定 | 需求 |
|---|---|---|---|
| W-1 | 窗口期已结束（当前列车号 > `legacyWindowEndTrainVersion`） | 成立 | `EVO-015` |
| W-2 | 窗口期内旧名调用计数为 0 且已记录 | 成立（附计数证据） | `EVO-015` |
| W-3 | 历史会话与审批规则中的旧名引用已全部重指向或豁免 | 成立 | `EVO-015` |
| W-4 | 表 B 的 `approvalRuleAction` 不含未处置项 | 成立 | `EVO-018` |

**禁止**：窗口期内删除旧名解析；以"调用量很低"替代"计数为 0"。

---

## 8. 与审批规则的接口

| 情形 | 处置 | 记录位置 | 需求 |
|---|---|---|---|
| 工具名改名 | 审批规则**重指向**或**双列**，**不得**留下只引用旧名的规则 | 表 B `approvalRuleAction` | `EVO-015` |
| 工具从 `toolAllowlist` 消失 | 规则**必须**被移除或标记 `orphan` 并审计；**不得**悬挂、**不得**自动升级为"允许" | `docs/evolution/dependency-lifecycle.md` 表 B | `EVO-018` |
| 工具因重连耗尽不可达 | 调用**必须**因工具不可达在**不进入审批判决**的情况下被拒 | 域内注册桥入口拦截记录 | `EVO-018` |

---

## 9. 负例清单

| # | 负例 | 期望结果 |
|---|---|---|
| N-1 | 旧名直接消失、无别名记录 | 发布被拒（`EVO_TOOL_NAME_SILENT_RENAME`） |
| N-2 | 原地改名（同一行改 `canonicalName`） | 发布被拒 |
| N-3 | 窗口期 < 一个完整列车周期 | 发布被拒 |
| N-4 | 旧会话恢复解析失败 | 发布被拒 |
| N-5 | 把重连耗尽导致的工具注销登记为"改名" | 发布被拒 |
| N-6 | 删工具但留 `requireApproval` 规则且无 `orphan` 记录 | 产出 `orphan` 记录；调用因不可达被拒于审批之前 |

---

## 10. 不在本文件范围

| 项 | 归属 |
|---|---|
| Registry 发布校验、注册桥拦截、CI 校验的实现 | `ENG-###` |
| 白名单外注册尝试的审计与取证 | `SPEC-01`（`SEC-###`） |
| connector 下架后的用户可见原因文案 | `SPEC-04`（`PRD-###`） |
| connector / 工具 / 模型供应商的**状态机与退化处置** | `docs/evolution/dependency-lifecycle.md` |
| preset id 与别名 | `docs/evolution/preset-id-registry.md` |
