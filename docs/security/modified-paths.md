# Windows 已修改路径清单 + 卸载复原流程 + 责任人（交付物 12）

| 项 | 值 |
|---|---|
| 文档编号 | `SEC-DOC-11` |
| 交付物 | `SPEC-01` §3 交付物 12 |
| 版本 | 1.0 |
| 状态 | 生效（清单为模板，待容器内实测回填实际路径） |
| 上游依据 | 设计文档 v2.6 §8.4（披露行：硬链接别名可写 + 永久改写客户目录 DACL 含 DELETE 语义变化 + 三件套要求）；`SEC-DOC-10` §2.4/§3；`SPEC-00` §7.1 `GATE-002` 条件 9 |
| 落实的 `SEC-*` | `SEC-091`、`SEC-092`、`SEC-093`、`SEC-098` |
| 判定纪律 | 清单完整性 = 授权过程中实际被写的对象集合 ⊇ 清单条目集合；复原后 DACL 与基线一致（除已披露按设计保留项） |

---

## 1. 已修改路径清单（`SEC-DOC-10` §3.1 模板；每次挂载必须逐路径填写）

> **当前状态：未回填**——Windows 域内挂载模块（`P1-B`）未落地，实际被修改路径集合
> 须在 Windows 容器内实测（`GATE-002` 条件 9，`tools/windows-acl-probe.mjs`）后按
> 实测回填。**实测未通过前，Windows 不参与多租户隔离。**

| 列 | 必填 | 说明 |
|---|---|---|
| `path` | 是 | 被修改的绝对路径（目录树用 `…\**` 表示整树） |
| `modificationType` | 是 | `ACE-grant` / `deny-entry` / `low-integrity-label` / `workspace-security-descriptor-edit` / `hardlink-inheritance` |
| `appliedAt` | 是 | UTC |
| `appliedBy` | 是 | 组件名与版本 |
| `revertible` | 是 | `dispose-revertible` / `retained-by-design` |
| `baselineRef` | 是 | 挂载**前**采集的 DACL/标签基线工件路径与哈希 |
| `postMountHash` | 是 | 挂载后同对象的安全描述符哈希 |
| `restoreAction` | 是 | `dispose` / `restore-from-baseline` / `destroy-volume` / `none(by design)` |
| `evidenceRef` | 是 | 记录文件路径 |

| # | path | modificationType | appliedAt | appliedBy | revertible | baselineRef | postMountHash | restoreAction | evidenceRef |
|---|---|---|---|---|---|---|---|---|---|
| 1 | （待容器内实测回填） | `low-integrity-label` | — | — | `dispose-revertible` | — | — | `dispose` | — |
| 2 | （待容器内实测回填） | `workspace-security-descriptor-edit` | — | — | `retained-by-design` | — | — | `restore-from-baseline` | — |
| 3 | （待容器内实测回填） | `hardlink-inheritance` | — | — | `retained-by-design` | — | — | `none(by design)` | — |

---

## 2. 卸载与复原流程（`SEC-DOC-10` §3.2 固定步骤，逐步骤断言）

| 步 | 动作 | 断言（不通过即阻断） |
|---|---|---|
| R-1 | 停写：拒绝该域新轮次，排空在途轮次 | 无在途写句柄 |
| R-2 | 由模块调用 `dispose()`，撤销临时授权与 Low 标签 | 返回成功；记录返回码 |
| R-3 | 对 `retained-by-design` 项：按 §1 的 `restoreAction` 从基线恢复安全描述符 | 恢复后 DACL 哈希 == `baselineRef` 哈希（除已披露的按设计保留项） |
| R-4 | 复算修改路径集合与基线快照比对 | 差异集合 == 已披露保留项集合；出现未披露差异 ⇒ 不通过 |
| R-5 | 域卷处置：物理擦除或密钥销毁，并记录方式 | 记录含 `{method, at, evidenceRef}` |
| R-6 | 判定：手工 `icacls` 不参与复原 | 复原流程中**不得**出现手工 `icacls` 作为唯一手段 |
| R-7 | 留证归档 | 七项工件齐备（§3） |

**实测门禁**：在测试环境完成一次「挂载 → 卸载」完整循环；复原后 DACL 与基线一致（除已披露保留项）。该实测是 `GATE-002` 条件 9 的证据，探针见 `tools/windows-acl-probe.mjs`。

---

## 3. 留证清单（`SEC-098` 判据，七件套）

```
① 已修改路径清单（填毕）
② 基线 DACL/标签快照（含哈希）
③ 挂载后安全描述符快照（含哈希）
④ dispose() 调用记录与返回码
⑤ 复原后快照与基线比对报告
⑥ 域卷处置记录（方式/时间/证据引用）
⑦ 责任人签署记录（§4）
```

---

## 4. 责任人（必填，不得为空——签署前 GATE-002 条件 9 不得通过）

| 角色 | 职责 | 字段 |
|---|---|---|
| 平台责任人 | 清单维护、复原流程执行、发布前门禁签署 | `name`、`role`、`contact`、`signedAt` |
| 客户现场责任人 | 客户侧目录授权确认、知情同意书签署 | `name`、`role`、`contact`、`signedAt` |
| 升级路径 | 复原失败时的升级对象与时限 | `escalationTarget`、`responseSla` |
| 客户配置附录字段 | 所选部署形态 | `deploymentShape: independent-volume \| microvm`；`recordedAt` |

> **当前状态：未签署**——责任人由组织指派（本文件不代填）。签署记录齐备前，
> `GATE-002` 条件 9 不通过，Windows 不参与多租户隔离。
