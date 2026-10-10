# 交付物文档索引

| 项 | 值 |
|---|---|
| 文档编号 | `GOV-DOC-02` |
| 用途 | `docs/` 全部交付物文档的组织入口，按域分组 |
| 上游依据 | [工程手册](ENGINEERING-HANDBOOK.md)（`GOV-DOC-01`） |

## 架构与工程（根目录）

- [工程手册](ENGINEERING-HANDBOOK.md) — 权威顺序、门禁速查、缺口台账、变更记录（贡献者入口）
- [反转面契约](reversal-contracts.md) — 内核反转面的四面签名与错误语义
- [层依赖矩阵](layer-dependency-matrix.md) — 包间层间依赖的允许与禁止
- [桥的纵深防御](bridge-defense-in-depth.md) — 工具注册桥的防御层次与验证
- [工时台账](effort-actuals.md) — 各阶段实测工作量

## 可靠性（reliability/）

- [SLO 台账](reliability/slo-registry.md) · [轮次三层截止时间](reliability/turn-deadlines.md) · [故障域矩阵](reliability/failure-domain-matrix.md)
- [降级阶梯](reliability/degradation-ladder.md) · [缓冲与墓碑](reliability/buffer-and-tombstone.md) · [对账报告](reliability/reconciliation-report.md)
- [演练用例](reliability/drill-cases.md) · [迁移手册](reliability/migration-runbook.md) · [告警与错误预算](reliability/alert-rules-and-budget.md)
- [恢复路径埋点](reliability/recovery-span-spec.md) · [副作用台账规格](reliability/side-effect-ledger-spec.md) · [PP 参数台账](reliability/pending-params-ledger.md)

## 安全（security/）

- [威胁模型与 TCB](security/threat-model-tcb.md) · [强制链](security/enforcement-chain.md) · [审计事件词典](security/audit-event-dictionary.md)
- [审批参数通道](security/approval-parameter-channel.md) · [凭证拒绝清单](security/credential-denylist.md) · [DSR 清单与删除证明](security/dsr-inventory-and-proof.md)
- [披露清单](security/disclosure-checklist.md) · [加密与数据驻留基线](security/encryption-residency-baseline.md) · [门禁检查表](security/gate-checklist.md)
- [修改路径](security/modified-paths.md) · [Profile 安全字段](security/profile-security-fields.md) · [就绪判定](security/ready-checks.md)

## 产品（product/）

- [MVP 矩阵](product/mvp-matrix.md) · [定价模板](product/pricing-template.md) · [计费说明](product/billing-explainer.md)
- [成本与单位经济学](product/cost-and-unit-economics.md) · [删除与撤销](product/deletion-and-undo.md) · [审批面板规格](product/approval-panel-spec.md)
- [用户可见文案基线](product/user-visible-copy.md) · [签约要件](product/signing-prerequisites.md) · [合规材料检查表](product/compliance-materials-checklist.md) · [SKU 与租户映射](product/sku-and-tenant-mapping.md)

## 演进（evolution/）

- [版本台账](evolution/version-ledger.md) · [presetId 注册表](evolution/preset-id-registry.md) · [弃用台账](evolution/deprecation-ledger.md)
- [升级流水线规格](evolution/upgrade-pipeline-spec.md) · [变更 Runbook](evolution/change-runbooks.md) · [依赖生命周期](evolution/dependency-lifecycle.md)
- [格式版本与备份](evolution/format-version-and-backup.md) · [混合版本报告](evolution/mixed-version-report.md) · [模型降级矩阵](evolution/model-degrade-matrix.md)
- [事件映射台账](evolution/event-mapping-ledger.md) · [工具名历史](evolution/tool-name-history.md) · [区域驻留台账](evolution/region-residency-ledger.md)
