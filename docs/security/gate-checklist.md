# 安全门禁检查单（`GATE-002` / `GATE-003` / `GATE-005`）

| 项 | 值 |
|---|---|
| 文档编号 | `SEC-DOC-13` |
| 交付物 | `SPEC-01` §3 交付物 13 |
| 版本 | 1.0 |
| 状态 | 生效 |
| 上游依据 | `SPEC-00` §7.1 / §7.2 / §7.4 / §11.3；设计文档 v2.6 §4.1.2 / §5.5 / §7.5；`SPEC-01` §4 |
| 落实的 `SEC-*` | 全部（逐条索引）；重点 `SEC-005`、`SEC-007`、`SEC-012`、`SEC-019`、`SEC-020`、`SEC-029`、`SEC-036`、`SEC-037`–`SEC-044`、`SEC-045`–`SEC-057`、`SEC-058`、`SEC-062`、`SEC-063`、`SEC-069`、`SEC-070`、`SEC-072`、`SEC-073`、`SEC-074`、`SEC-075`、`SEC-078`–`SEC-088`、`SEC-094`、`SEC-098`、`SEC-104` |
| 交叉文档 | `SEC-DOC-03`（拦截点）、`SEC-DOC-04`（就绪判据）、`SEC-DOC-06`（审批通道）、`SEC-DOC-07`（审计字典）、`SEC-DOC-09`（DSR）、`SEC-DOC-10`（Windows 实测） |

---

## 1. 使用规则（先读，再做）

| # | 规则 | 判定 |
|---|---|---|
| G-R1 | **证据只接受域外事实**：镜像摘要、挂载摘要、运行时配置快照、Profile 生成摘要、域外控制点自身日志。域内上报（selfcheck、attest 自报、桥自测）只能作交叉核验，**不得**单独作为通过依据 | 证据记录必须含 `source.authority` 字段且 ∈ 域外组件白名单 |
| G-R2 | **禁止"能启动即通过"**：任一条的通过谓词未逐条求值 ⇒ 该条记 `fail` | 判定输出必须逐条给 `verdict` |
| G-R3 | **禁止签字放行**：无原始工件（可复算的 JSON/日志/链校验输出）的条件一律记 `fail`；不接受截图、会议纪要、口头确认 | 每条必须有 `artifactRef` + `artifactHash` |
| G-R4 | 判定人 ≠ 该条件的实现者；采样类证据的抽检率 ≥ 10% 且 ≥ 20 条 | 签署表含 `checker` 与 `implementer` 两列 |
| G-R5 | 任一条 `fail` ⇒ **门禁不通过**，停止推进；**不得**以"后续补"跳过 | 门禁结论只有 `pass` / `fail` |
| G-R6 | 证据留证并被哈希固定；`GATE-002` 条件 4 要求"每次域创建留证"与本节一致 | 见 §5 |

---

## 2. `GATE-002`（P0 出口）逐项核对表

| # | 条件 | 归口 | 通过谓词（可判定） | 证据工件 | 采集方式 | 判定者 | `SEC-*` / 联读 |
|---|---|---|---|---|---|---|---|
| 1 | E1 强制可验证：域内工具集 == `toolAllowlist`，且含负向用例（受控恶意 MCP 推送新工具 → 永不进入模型可见集） | SEC + ENG | `set(observations) == set(toolAllowlist)` ∧ 负向用例中 `evil__pwn` 不出现在 `GET /v1/sessions/{id}/tools` 与模型 tools 数组 ∧ 最小审计集出现该注册尝试 | `neg-mcp.json`、`toolset-diff.json`、`A5-register-denied.ndjson` | 域外观测量 + 受控 MCP 注入（`SEC-DOC-03` E-04） | SEC（安全）+ ENG | `SEC-005`、`SEC-012`、`SEC-019`、`SEC-020` |
| 2 | 工具注册桥覆盖面已实测：桥提供的 `ctx.tools` 代理确被 MCP 行与全部注册路径使用 | ENG | 源码 `.tools.register(` 命中数 == 1（桥内）∧ 运行期仅桥路径生效 ∧ `tools/change` 指纹与推送前一致 | `bridge-coverage.json`、`grep-report.txt`、`fingerprint-diff.json` | 源码检查 + 运行期实测 | ENG（SEC 复核） | `SEC-019`；`ENG-001`、`ENG-003` |
| 3 | 域就绪判据 7 条全部可执行，且**每条证据来源都是域外事实**；存在 `disabled` 关键行时域拒绝 ready | ENG + SEC | RC-1…RC-7 各有一个可执行检查与失败注入记录；证据 `source.authority` ∈ 域外；`disabled` 注入 ⇒ `ready=false` | `ready-deny-RC1..RC7.json`、`ready-evidence-<domainId>.json` | 七种失败态逐条注入（`SEC-DOC-04` §4） | ENG + SEC | `SEC-037`–`SEC-044` |
| 4 | 平台能产出并留存域就绪所需的域外证据，且**每次域创建留证** | ENG | 四类摘要非空 ∧ 每次域创建有一条证据记录 ∧ 留存期 ≥ 366 天 ∧ 记录在哈希链内 | `domain-evidence/<domainId>/<ts>.json` + 链校验输出 | 域创建流水线自动产出 | ENG（SEC 抽检） | `SEC-DOC-04` §3.2 |
| 5 | 域内无长期凭证；唯一例外已登记且**进程隔离** | SEC | 域内 secret 形态扫描命中数 == 0（除登记例外）∧ 例外条目字段齐备 ∧ 进程隔离类型 ∈ {independent-uid, namespace, AppContainer} ∧ 例外令牌四项拒绝用例全过 | `cred-scan.json`、`exception-registry.json`、`token-reject-X1..X4.json` | 扫描 + 例外用例（`SEC-DOC-05` §3.3） | SEC | `SEC-045`–`SEC-057` |
| 6 | 四个 LLM 端点 fail-closed；域令牌绑定 `(tenantId, isolationGroupId)` 且域外校验通过 | SEC | 端点不可用时轮次被拒（无本地直连）∧ 跨租户冒用用例被拒并产生硬审计 ∧ 同租户重放正常 | `llm-failclosed.json`、`token-cross-tenant.json`、`egress-audit.ndjson` | 域外网关配置 + 冒用用例 | SEC | `SEC-007`、`SEC-008`、`SEC-063`、`SEC-070` |
| 7 | 轮次三层截止时间生效（`T_a` / `T_m` / `T_turn`） | REL | 三档超时各自在预算内收敛到规定终态；缺字段/`null` 的 Profile 被拒 | `deadline-inject.json` | 超时注入（`ENG-041`） | REL（SEC 复核） | `SEC-064`；`REL-102` |
| 8 | 纵深防御为全局 `guard()` 且已安装（`restrict` 路线已废弃） | ENG | 启动断言 `bridge.guard.installed=true` ∧ 全仓无宿主上下文 `.tools.restrict(` ∧ 移除 guard 后 scoped 注册的清单外工具**可被调用** | `guard-installed.json`、`restrict-grep.txt`、`guard-scope-diff.json` | 启动断言 + 源码检索 + 对照测试 | ENG | `SEC-029`；`ENG-004`；`VER-001` |
| 9 | Windows 容器内 ACL 行为实测通过；未通过则禁止 Windows 参与多租户隔离 | SEC | 挂载/卸载循环完成 ∧ 复原后 DACL 与基线一致（除已披露保留项）∧ 修改路径清单完整 ∧ 责任人非空 | `windows-acl-<env>.json`、`modified-paths.md`、`restore-report.json`、签署记录 | 容器内实测（`SEC-DOC-10` §3） | SEC | `SEC-094`、`SEC-098` |
| 10 | API 快照 diff 范围已收敛到 4 个反转面 | ENG | 快照报告含「反转面签名变更: 是/否」一行，且仅覆盖 4 个面（非全量包） | `snapshot-report.json` | CI 任务 | ENG | `ENG-032`、`ENG-033`；`SEC-029` 相邻 |

---

## 3. `GATE-003`（P1 出口）中归口本角色的条件

| # | 条件 | 通过谓词 | 证据工件 | `SEC-*` |
|---|---|---|---|---|
| 2 | 副作用台账可用；恢复后非幂等调用**由产品策略禁止自动重试** | 台账条目字段完整且**执行前**写入 ∧ 台账写入失败 ⇒ 该调用被拒（无"先执行后记台账"）∧ 恢复后 UI 显示参数并要求确认，无自动重试路径 | `ledger-schema.json`、`ledger-failclosed.json`、`recovery-no-retry.json` | `SEC-069`、`SEC-070`、`SEC-071`；`REL-072`、`REL-073` |
| 3 | 审计服务故障 6 小时不阻断执行（有界丢弃 + 墓碑生效） | 6 h 内新 turn 受理率 100% ∧ L3 计数 == 0 ∧ `buffer.discard.tombstone.count > 0` ∧ 墓碑可对账 ∧ **最小审计集动作仍 fail-closed**（被拒动作数 > 0） | `audit-outage-6h.json`、`tombstone-report.json`、`minimal-set-refusals.ndjson` | `SEC-075`；`REL-040`、`REL-116` |
| — | 审计键完整性（缺维度即拒绝写入）【`GATE-003` 检查项】 | 六字段键按事件类要求缺失 ⇒ schema 拒绝写入 | `audit-key-schema.json` | `SEC-073` |

---

## 4. `GATE-005`（P3 出口）中归口本角色的条件

| # | 条件 | 通过谓词 | 证据工件 | `SEC-*` |
|---|---|---|---|---|
| 1 | 取证包可导出且可验证（哈希链 + WORM） | 按 `(tenantId, 时间窗)` 导出成功 ∧ 隔离主机独立校验通过并输出 `{recordCount, chainHead, chainTail}` ∧ 篡改 1 byte 后校验失败 ∧ 无就地修改/删除接口 | `forensics-export.zip`、`verify-ok.txt`、`verify-tampered-fail.txt`、`worm-api-audit.json` | `SEC-072`、`SEC-074` |
| 2 | DSR 可出具删除报告（覆盖全清单，含附件 / spill / FTS / 快照） | 八类均有条目与状态 ∧ D7 状态为「已假名化」∧ 四件套齐备 ∧ 逐副本含区域标识 ∧ `completedAt − acceptedAt ≤ 24 h` | `deletion-report.json`、`proof-P1..P4/`、`replica-rows.json` | `SEC-078`–`SEC-088`、`SEC-104` |

---

## 5. 门禁内检查项编号（`GATE-002-C11` … `C17`）

| 编号 | 检查项 | 实际对端门禁 | 判据 | `SEC-*` |
|---|---|---|---|---|
| `GATE-002-C11` | FTS 派生库存在性检查 | `GATE-002` 条件 3 | 域内无 `dsh-session-query-sqlite` 行、无 FTS 数据库文件 | `SEC-032` |
| `GATE-002-C12` | credential provider 拒绝清单存在性检查 | `GATE-002` 条件 3 | 清单文件存在且非空；`pluginSet ∩ denylist == ∅` | `SEC-046`、`SEC-041` |
| `GATE-002-C13` | 最小审计集六类事件可逐类演示 fail-closed | `GATE-002` | 停审计后逐类触发，六类动作全部未发生 + 告警 | `SEC-069`、`SEC-070` |
| `GATE-002-C14` | 升权上限与单一预设不可达性 | `GATE-002` | 超上限调用被拒且目标文件未创建；`reachable` 恰一元素 | `SEC-023`、`SEC-025`、`SEC-040` |
| `GATE-002-C15` | 审批参数通道端到端可用；无法送参数的工具有审批需求即被拒 | `GATE-002` | 十字段齐备 ∧ `seq(tool.call) < seq(approval.requested)` ∧ 回补端点 200 ∧ 生成器拒签 F-1/F-2 工具 | `SEC-058`、`SEC-062` |
| `GATE-002-C16` | 生产态 `toolAllowlist` 拒绝 `*`；开发态逃生门在生产构建不可启用 | **实为 `GATE-001`** | `OV_ENV=prod` 下 `["*"]`/`[]`/缺省/通配全部拒绝；生产构建无开关 | `SEC-036` |
| `GATE-002-C17` | 审计键完整性（缺维度即拒绝写入） | **实为 `GATE-003`** | 见 §3 末行 | `SEC-073` |

> **编号口径不符，需总纲维护者裁定**：`SPEC-00` §11.3 把这 5 项统一并入 `GATE-002-C13`…`C17`，但其中 `C16` 的对端门禁是 `GATE-001`、`C17` 是 `GATE-003`。本表按**实际对端门禁**标注；在裁定前，`C16` 的证据随 `GATE-001` 归档，`C17` 的证据随 `GATE-003` 归档，**不得**被 `GATE-002` 的通过结论"顺带"覆盖。

---

## 6. 证据索引规范

### 6.1 目录与命名（强制）

```
evidence/<GATE>/<检查号>/<scopeId>/<UTC ISO8601 基本格式>.json
例：evidence/GATE-002/C15/tenant-acme-ig-finance/20261006T031500Z.json
    evidence/GATE-002/RC-1/tenant-acme-ig-finance/20261006T031500Z.json
```

### 6.2 每条证据记录的必需字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `gate` / `check` | 是 | 如 `GATE-002` / `C15` |
| `scopeId` | 是 | `domainId` 或 `(tenantId, isolationGroupId)` |
| `case` | 是 | 用例 ID（`SEC-DOC-03` E-xx、`SEC-DOC-04` RC-x-F、本文件 §2 行号） |
| `input` | 是 | 注入/构造的可复现描述（含参数） |
| `observation` | 是 | 原始观测（**不得**只写结论） |
| `verdict` | 是 | `pass` / `fail` |
| `source.authority` | 是 | 域外组件名（判定输入来源） |
| `crossCheck` | 否 | 域内上报的交叉核验值（标注 `detective`） |
| `artifactHashes[]` | 是 | 原始工件路径 + 哈希 |
| `implementer` / `checker` | 是 | 两人不同 |
| `ranAt` | 是 | UTC；含时钟源与偏差上界 |

### 6.3 留存与完整性

| 项 | 规定 |
|---|---|
| 留存期 | ≥ 366 天（与 `SEC-076` 一致） |
| 防篡改 | 证据记录进哈希链（`SEC-DOC-07` §6）；导出物含链首尾摘要 |
| 复算 | 任一 `pass` 必须可由 `input` + 工件在隔离环境复算出同一 `observation` |
| 抽检 | 门禁后抽检 ≥ 10% 且 ≥ 20 条；抽检失败 ⇒ 门禁结论回退为 `fail` |

---

## 7. 门禁结论签署表（模板）

| 门禁 | 条件/检查号 | 结论 | 证据引用 | 判定人 | 日期 | 备注（偏差项与补偿） |
|---|---|---|---|---|---|---|
| `GATE-002` | 条件 1 | pass/fail | `evidence/GATE-002/…` | | | |
| `GATE-002` | 条件 2 | | | | | |
| `GATE-002` | … | | | | | |
| `GATE-002` | `C13`–`C17` | | | | | |
| `GATE-003` | 条件 2 / 3 / `C17` | | | | | |
| `GATE-005` | 条件 1 / 2 | | | | | |
| **总判定** | — | **pass 当且仅当全部行 pass** | — | — | — | 存在任一 `fail` ⇒ 停止推进 |

---

## 8. 本文件不覆盖

| # | 内容 | 去向 |
|---|---|---|
| 1 | `GATE-002`/`003`/`005` 中归口 `REL`、`ENG`、`PRD` 的条件的判定细节 | 对应角色交付物（`docs/reliability/`、`docs/product/`） |
| 2 | `GATE-001`、`GATE-004`、`GATE-006` 的完整检查表 | `SPEC-03` / `SPEC-04`；本文件只标注 `C16` 的对端门禁 |
| 3 | 演练门禁（6 项最小演练集） | `SPEC-02`（`REL-111`–`REL-120`） |
