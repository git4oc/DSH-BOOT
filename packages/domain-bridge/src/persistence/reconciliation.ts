/**
 * 一致性与对账（设计 §7.6；`REL-090`–`REL-101`）。
 *
 * - **真源 = 会话事件日志 + 上传确认水位**（水位界定"哪些已离开节点"）。
 * - **RPO 分层**：节点内 RPO = 0（已 flush）；跨节点 RPO = 复制滞后（P99 ≤ 30 s）。**不得笼统写 RPO 0**。
 * - 幂等扣减：派生视图按 `(tenantId, turnId)` 去重。
 * - 对账：`diff_rate = |log_derived − ledger| / log_derived`；**少计与多计分列**；
 *   差异以真源裁定并回写；**不阻断执行**；**不引入跨存储分布式事务**。
 */

export interface UploadWatermark {
  /** 已确认上传离开节点的最后逻辑序号（水位）。 */
  readonly lastUploadedSeq: number;
  readonly updatedAt: number;
  readonly tenantId: string;
}

export interface ReconcileInput {
  /** 真源侧：日志派生聚合（幂等扣减后），按 `(tenantId, turnId)` 键。 */
  readonly logDerived: readonly { readonly tenantId: string; readonly turnId: string; readonly amount: number }[];
  /** 派生视图侧：计费/账本聚合，按 `(tenantId, turnId)` 键。 */
  readonly ledger: readonly { readonly tenantId: string; readonly turnId: string; readonly amount: number }[];
  readonly tenantId: string;
}

export interface ReconcileResult {
  readonly tenantId: string;
  readonly logDerivedTotal: number;
  readonly ledgerTotal: number;
  /** `diff_rate = |log_derived − ledger| / log_derived`。 */
  readonly diffRate: number;
  /** 少计（收入漏损）：真源有、账本无。 */
  readonly underCounted: number;
  /** 多计（客户争议）：账本有、真源无。 */
  readonly overCounted: number;
  readonly withinThreshold: boolean;
  readonly threshold: number;
}

/** 对账阈值：差异率 ≤ 0.01%（`GATE-003` 验收）。 */
export const DIFF_RATE_THRESHOLD = 0.0001;

/** 幂等扣减：按 `(tenantId, turnId)` 去重（同 turnId 重复上传只计一次）。 */
export function dedupeByTurn(entries: readonly { readonly tenantId: string; readonly turnId: string; readonly amount: number }[]): Map<string, number> {
  const deduped = new Map<string, number>();
  for (const entry of entries) {
    deduped.set(`${entry.tenantId}:${entry.turnId}`, entry.amount);
  }
  return deduped;
}

/** 对账：差异率分列（少计/多计方向相反，必须分列统计）。 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const logDerived = dedupeByTurn(input.logDerived);
  const ledger = dedupeByTurn(input.ledger);
  let logTotal = 0;
  let ledgerTotal = 0;
  let underCounted = 0;
  let overCounted = 0;
  for (const [key, amount] of logDerived) {
    logTotal += amount;
    if (!ledger.has(key)) underCounted += amount;
  }
  for (const [key, amount] of ledger) {
    ledgerTotal += amount;
    if (!logDerived.has(key)) overCounted += amount;
  }
  const diffRate = logTotal === 0 ? (ledgerTotal === 0 ? 0 : 1) : Math.abs(logTotal - ledgerTotal) / logTotal;
  return {
    tenantId: input.tenantId,
    logDerivedTotal: logTotal,
    ledgerTotal,
    diffRate,
    underCounted,
    overCounted,
    withinThreshold: diffRate <= DIFF_RATE_THRESHOLD,
    threshold: DIFF_RATE_THRESHOLD,
  };
}

/** RPO 分层（设计 §7.6；`REL-094`）：节点内 0（已 flush）；跨节点 = 复制滞后（P99 ≤ 30 s）。 */
export function rpoLayering(watermark: UploadWatermark, lastLocalSeq: number): { inNodeRpo: 0; crossNodeRpoSeconds: number; unuploadedSeqs: number; definition: string } {
  // 未上传尾部量作为**独立指标**暴露（`REL-096`：不得通过缩小窗口规避未上传尾部）；
  // 跨节点 RPO 按复制滞后的墙钟口径计算（原实现 `* 0` 死代码已删）。
  const unuploadedSeqs = Math.max(0, lastLocalSeq - watermark.lastUploadedSeq);
  return {
    inNodeRpo: 0,
    crossNodeRpoSeconds: replicationLagSeconds(watermark),
    unuploadedSeqs,
    definition: "节点内 RPO = 0（已 flush）；跨节点 RPO = 复制滞后（P99 ≤ 30 s）；未上传尾部量独立暴露；不得笼统写 RPO 0",
  };
}

function replicationLagSeconds(watermark: UploadWatermark): number {
  return Math.max(0, (Date.now() - watermark.updatedAt) / 1000);
}
