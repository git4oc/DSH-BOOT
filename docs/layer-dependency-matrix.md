# 层依赖方向矩阵

| 项 | 值 |
|---|---|
| 文档编号 | `LAYER-001` |
| 版本 | 1.1 |
| 上游依据 | `SPEC-03` `ENG-020`（包划分）、`ENG-021`（依赖方向）、`ENG-022`（循环检测） |
| 消费方 | `tools/check-deps.mjs`（`SPEC-03` `D-6`）、CI 任务 `spec:deps` |
| 用途 | 层间依赖的**白名单矩阵**。`check-deps.mjs` 逐条比对；违规即 CI 非零退出 |

---

## 1. 包清单（`ENG-020`）

| 包 / 目录 | 职责 | 类别 |
|---|---|---|
| `packages/protocol` | Profile JSON Schema、反向 I/O 类型、事件类型。**仅类型与 schema，无运行期依赖** | 叶 |
| `packages/domain-bridge` | 工具注册桥、`LlmAdapter` 适配器、审批应答者、`SessionPersistence` 提供方 | 反转面实现 |
| `packages/reverse-gateway` | 反向 I/O 端点与桩共用的接口定义与实现 | 服务 |
| `packages/control-plane` | Profile 生成与校验、Session Router 接口、域就绪判定 | 服务 |
| `packages/sdk` | OpenAPI 生成物，**不手写** | 生成物 |
| `apps/domain` | 域镜像入口与 Cordis Profile 装配 | 应用 |
| `apps/control` | 控制面应用入口 | 应用 |
| `tools/snapshot` | `.d.ts` 快照生成与 diff | 工具 |
| `tests/contract` | 契约测试套件 | 测试 |

---

## 2. 允许的依赖边（`ENG-021` 原文）

> 层间依赖**只允许**：`apps/* → packages/control-plane → packages/reverse-gateway / packages/domain-bridge → packages/protocol`；
> `packages/protocol` **不得**依赖任何其他 `@dsh-boot/*` 包。

```
apps/*  ──►  packages/control-plane  ──►  packages/reverse-gateway  ──►  packages/protocol
                                       └►  packages/domain-bridge     ──►  packages/protocol
```

---

## 3. 白名单矩阵

行 = **源包**（依赖发起方）；列 = **目标包**（被依赖方）。✅ = 允许，❌ = **禁止**（CI 违规）。

| 源 ＼ 目标 | protocol | domain-bridge | reverse-gateway | control-plane | sdk | apps/* | tools/snapshot |
|---|---|---|---|---|---|---|---|
| **packages/protocol** | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **packages/domain-bridge** | ✅ | — | ❌ | ❌ | ❌ | ❌ | ❌ |
| **packages/reverse-gateway** | ✅ | ❌ | — | ❌ | ❌ | ❌ | ❌ |
| **packages/control-plane** | ✅ | ✅ | ✅ | — | ❌ | ❌ | ❌ |
| **packages/sdk** | ✅ | ❌ | ❌ | ❌ | — | ❌ | ❌ |
| **apps/domain** | ✅ | ✅ | ✅ | ✅ | ❌（O-1） | ❌（应用间互不依赖） | ❌ |
| **apps/control** | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **tools/snapshot** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| **tests/contract** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |

### 三条硬规则（`check-deps.mjs` 必须逐条断言）

| # | 规则 | 依据 |
|---|---|---|
| R-1 | `packages/protocol` 的 `dependencies` 与 `peerDependencies` **不含**任何 `@dsh-boot/*`，也**不含**任何内核运行期包 | `ENG-020` 判据② |
| R-2 | 上表所有 ❌ 单元格在真实的 `package.json` 中**不得**出现 | `ENG-021` 判据① |
| R-3 | 依赖图**零环**（DFS 检测） | `ENG-021` 判据② |

### `packages/protocol` 的例外说明

`packages/protocol` **可以**含 `devDependencies`（如 `typescript`、`zod` 仅用于生成本身），但**不得**含运行期 `dependencies`。判定以 `dependencies` + `peerDependencies` 为准（`ENG-020` 判据②的原文口径）。

---

## 4. `ENG-020` / `ENG-021` 未覆盖的边（**已决策**）

下列边未被 `ENG-020` / `ENG-021` 覆盖。**已由架构评审裁定**，决策与理由记录于此；`check-deps.mjs` 按本表实现。

| # | 边 | **决策** | 理由 |
|---|---|---|---|
| O-1 | `apps/domain → packages/sdk` | ❌ **禁止** | `apps/domain` 消费的是**内部反向 I/O 契约**（`/internal/kernel/*`，见 `CTR-001`），不是对外 `/v1/*`。对外 SDK 的消费方是产品壳与 `apps/control`。域内引入 SDK 会把对外契约拖进域镜像，扩大攻击面与镜像体积 |
| O-2 | `tests/contract → tools/snapshot` | ✅ **允许** | 无架构风险。`ENG-031` 的 E 项（format 拒绝方向）需要与 pin 版本的快照对照，直接复用快照工具优于在测试内重写解析 |
| O-3 | `tools/snapshot → packages/protocol` | ✅ **允许** | 快照文件自身的 manifest schema 归 `packages/protocol`（`ENG-032` 要求快照含按包的 `exports[]` 与签名串）。工具读内核 `.d.ts`，但产出格式由我方定义 |
| O-4 | `apps/* → apps/*` | ❌ **禁止** | 应用之间共享代码**必须**下沉到 `packages/*`。应用间直接依赖会让部署单元边界随实现漂移，且与"一域一容器"的部署模型冲突 |

> **新增允许边的流程**：**必须**改本文件并说明理由，由架构评审签署。**不得**在 `check-deps.mjs` 里就地放宽。
>
> **保守默认**：本表与本文件 §3 未列为 ✅ 的边，一律按 ❌ 处理。

---

## 5. 反转面目录数断言（`ENG-024`）

`check-deps.mjs` 必须额外断言：`packages/domain-bridge` **恰好**含 4 个反转面子目录，与其一一对应：

| # | 目录 | 对应面 | 契约 |
|---|---|---|---|
| 1 | `packages/domain-bridge/src/llm/` | `ctx.llm` | `CTR-001` §2 |
| 2 | `packages/domain-bridge/src/{register,tools,guard}.ts` | `ctx.tools` | `CTR-001` §3 |
| 3 | `packages/domain-bridge/src/approval/` | `ctx.approval` | `CTR-001` §4 |
| 4 | `packages/domain-bridge/src/persistence/` | `SessionPersistence` | `CTR-001` §5 |

**反转面 ≤ 4 且 = 4**（设计 §4.2 硬上限；新增须架构审批）。

---

## 6. 与 `check-deps.mjs` 的对应

`SPEC-03` `D-6` 交付物：`tools/check-deps.mjs`。
它**尚未实现**（无代码仓结构可检查）。实现时必须覆盖：

1. 解析每个 `package.json` 的 `@dsh-boot/*` 依赖 → 与 §3 矩阵逐条比对
2. 违规输出格式：`包A → 包B 违反方向（依据 ENG-021 / LAYER-001 §3）` 并非零退出
3. R-3 的 DFS 零环检测
4. §5 的反转面目录数断言
5. 本文件 §4 的未定边按 ❌ 处理

---

## 变更记录

| 版本 | 变更 |
|---|---|
| 1.1 | **`check-deps.mjs` 已实现**（§6 五项全覆盖）；修正 §3 矩阵一处笔误：`apps/domain → packages/sdk` 单元格原误标 ✅，按 §4 `O-1`（❌ 禁止）更正为 ❌（`O-1` 为已裁定的更具体条目，且为 `check-deps.mjs` 的实现依据）。矩阵与脚本现完全一致 |
| 1.0 | 初版：包清单、允许边、白名单矩阵、三条硬规则、四条未定边（待决策）、反转面目录数断言 |
