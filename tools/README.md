# 规格集与契约工具

执行 `SPEC-00` 的机器可判定条款。**无外部依赖**，只需 Node ≥ 22。

## 用法

```bash
node tools/lint-specs.mjs               # 规格集校验（GATE-007 / 008 / 010）
node tools/lint-specs.mjs --json        # 机器可读明细（含 perSegment 统计）
node tools/check-gates.mjs              # 门禁引用完整性（孤立门禁检测）
node tools/validate-contracts.mjs       # 契约校验（contracts/**）
node tools/validate-contracts.mjs --trace <json>   # JSON 括号失衡定位
node tools/lint-docs.mjs                # 交付物文档校验（docs/**）
node tools/lint-docs.mjs --json
node tools/check-deps.mjs               # 层依赖方向 + 反转面目录数（LAYER-001 §6 五项）
node tools/check-deps.mjs --json
node tools/check-id-format.mjs          # 需求 ID 正则校验（ENG-048，代码/测试/配置）
node tools/check-id-format.mjs --json
```

CI：`.github/workflows/spec-lint.yml`（4 个 job，各自独立失败）+ `.github/workflows/repo-gates.yml`（`spec:deps` / `spec:id-format` 两个 job）。

---

## 1. `lint-specs.mjs` —— 规格集校验

| 规则 | 内容 |
|---|---|
| `GATE-007` | 每条需求具备六字段（ID / 级别 / 条款 / 验收判据 / 依据 / **拦截点 / 测量点**）；级别取值合法；条款与验收判据**不得**含「建议 / 尽量 / 最好 / 通过测试」 |
| `GATE-008` | 跨规格引用**必须**按需求 ID；禁止「见《…》第 N 节」（总纲自身的禁令反例已豁免） |
| `GATE-010` | ID 形式合法；**不越段**；**不重复定义**；**引用可解析**；段内 ID 连续 |

**支持的两种需求书写形式**（`SPEC-00` §5 允许二者）：

**A. 横向六列表**
```markdown
| ID | 级别 | 条款 | 验收判据 | 依据 | 拦截点 / 测量点 |
|---|---|---|---|---|---|
| `SEC-001` | 必须 | … | … | … | … |
```

**B. 纵向字段表**
```markdown
| # | 字段 | 内容 |
|---|---|---|
| **ID** | `EVO-001` | |
| **级别** | 必须 | |
| **条款** | … | |
| **验收判据** | … | |
| **依据** | … | |
| **拦截点 / 测量点** | … | |
```

---

## 2. `check-gates.mjs` —— 门禁引用完整性

断言 `SPEC-00` §7 的六个阶段门禁（`GATE-001`…`GATE-006`）每一个都至少被一条需求引用。
孤立门禁（只在定义处出现）判失败——**无人引用的门禁不构成开发约束**。

---

## 3. `validate-contracts.mjs` —— 契约校验

| 规则 | 检查 |
|---|---|
| `REF` | 所有 `$ref` 可解析；JSON Schema 的 `$defs` 无孤儿 |
| `SCHEMA` | 根级 `required` 的每个键在 `properties` 中存在 |
| `OAS` | OpenAPI 3.1；`operationId` 唯一；tag 已声明；每个操作有 `responses`；路径以 `/v1/` 开头；**不得**出现模型直连端点（D9）；**每个操作必须声明 `x-ov-requirements`** |
| `REQ` | `x-ov-requirements` 的 ID 至少出现在 `spec/` 中（抓编号错字；**弱校验**，定义级校验由 `lint-specs.mjs` 负责） |

`--trace <json>`：打印每行前后括号深度，只在浅层与异常行输出——用于定位大型 JSON 的括号失衡。

---

## 4. `lint-docs.mjs` —— 交付物文档校验

| 规则 | 检查 |
|---|---|
| `ID` | `docs/**` 中出现的每个需求 ID **必须**能在 `spec/` 中解析到定义 |
| `HEADER` | 每份文档具备「文档编号」与「上游依据」头部字段 |
| `NORM` | 规范性行（含「必须」/「不得」）**不得**出现无约束力措辞 |
| `PHANTOM` | 仅对**与真实需求前缀近似**（编辑距离 ≤ 1）的编号报警 |

---

## 设计说明（踩过的坑）

这些校验器初版都报出过大量**自身造成的误报**。记录在此，避免重蹈：

| 工具 | 初版缺陷 | 修正 |
|---|---|---|
| `lint-specs` | 只认横向六列表 → 把 `SPEC-05` 的纵向表（36 条）全判为"未定义"，**391 处误报** | 增加纵向字段表解析 |
| `lint-specs` | 朴素按 `\|` 切单元格 → `ENG-048` 的正则含 `\|`，一条需求被切成 11 列 | 切分时跟踪行内代码 |
| `lint-specs` | 直接扫描区间声明 `REL-001 – REL-999` 的端点 | 先剥离区间表达式 |
| `lint-specs` | 门禁 ID 只从需求表注册 → `SPEC-00` 的标题式声明未登记 | 门禁进独立注册表 `declared`（同文档内重复声明不算重复定义） |
| `lint-specs` | 对「拦截点」列做关键字白名单 → `SPEC-02` 的"网关访问日志 + 责任方分类器"被判不合格 | **删除语义匹配**，只校验非空（该列语义不可机器判定） |
| `validate-contracts` | 对嵌套/allOf 分支也断言 `required ⊆ properties` → 2 处假错 | 仅在根级断言（分支的 `required` 可引用组合定义的属性） |
| `validate-contracts` | `--json` 在重写中丢失，而 README 与 CI 都依赖它 | 补回并加 `perSegment` |
| `lint-docs` | 通用 `PREFIX-NNN` 扫描 → `COPY-016`（文案基线）、`PC-003`（schema 检查项）、`SHA-256`/`AES-256`（算法名）共 152+41 处误报 | 改为**编辑距离 ≤ 1 的前缀近似**判定；真正的编号错字（如 `SEC-999`）由 `[ID]` 规则覆盖 |
| `validate-contracts` | JSON 解析失败时只给出 `JSON.parse` 的位置，指向"多余内容"而非真正的失衡处 | `jsonStructureHint()` 报告括号终态深度与结构提前闭合的行号 |

**一条通用教训**：校验器的第一版报出的问题，**先怀疑校验器自己**。本项目 391 → 8 → 0 与 153 → 41 → 0 两轮，最终 0 违规中**没有一条**是数据本身的缺陷。

---

## 已知不校验的

| 项 | 原因 |
|---|---|
| `GATE-009`（不得两份规格对同一约束各写一份正文） | 需要语义比对，**当前为人工评审项** |
| 「拦截点」是否**真的**有对应实现 | 属实现阶段门禁（`GATE-002`） |
| 需求与设计文档之间的一致性 | 属架构评审 |
| `tools/check-deps.mjs` 的层依赖校验 | **待实现**：依赖代码仓结构；矩阵已产出（`docs/layer-dependency-matrix.md`），实现须覆盖其 §6 五项 |
| `tools/snapshot`（`.d.ts` API 快照 diff） | **待实现**：`SPEC-03` `D-4`，P0 交付物 |
