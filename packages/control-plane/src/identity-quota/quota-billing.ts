/**
 * 配额、公平调度与计费（设计 §5.2/§5.2.1；`PRD-034`–`PRD-042`；`REL-052`–`REL-059`）。
 *
 * - 配额分级：令牌/工具调用/存储 = **软**（超限拒绝新 turn 或降级）；域槽位/CPU/内存/
 *   模型并发/每 workspace 份额 = **硬**。
 * - **公平调度**：域池水位超阈值时对**超额租户**按比例限速，**不是所有租户平等 503**；
 *   不得把某租户的用量失控转化为其他租户的不可用（§5.2.1）。
 * - 计费：用量归集到 `turnId`，区分输入/输出/缓存命中；MCP 按 connector 归集；
 *   真源 = 日志 + 上传确认水位，按 `(tenantId, turnId)` **幂等去重**（§7.6）。
 */

export type QuotaLevel = "soft" | "hard";

export interface QuotaDimension {
  readonly dimension: "tokens" | "toolCalls" | "storage" | "domainSlots" | "cpu" | "memory" | "modelConcurrency" | "workspaceShare";
  readonly level: QuotaLevel;
  readonly meter: string;
}

/** 配额分级表（§5.2）。 */
export const QUOTA_DIMENSIONS: readonly QuotaDimension[] = [
  { dimension: "tokens", level: "soft", meter: "域外（消费域内缓冲）" },
  { dimension: "toolCalls", level: "soft", meter: "域外" },
  { dimension: "storage", level: "soft", meter: "保留与删除服务" },
  { dimension: "domainSlots", level: "hard", meter: "域池" },
  { dimension: "cpu", level: "hard", meter: "域池 + 网关" },
  { dimension: "memory", level: "hard", meter: "域池 + 网关" },
  { dimension: "modelConcurrency", level: "hard", meter: "网关" },
  { dimension: "workspaceShare", level: "hard", meter: "域内 + 域外" },
];

/** 软配额维度集合（软依赖不可用 ⇒ 不阻断执行；拒绝原因码中不含软依赖）。 */
export const SOFT_DIMENSIONS: readonly string[] = QUOTA_DIMENSIONS.filter((d) => d.level === "soft").map((d) => d.dimension);

// ── 硬配额（设计 §5.2 配额维度 + `PRD-040` workspace 份额硬约束/同租户不连坐） ──
export type HardQuotaDimension = "domainSlots" | "cpu" | "memory" | "modelConcurrency";

export interface HardQuotaUsage {
  readonly dimension: HardQuotaDimension;
  /** 当前用量（达到上限即拒绝新 turn 的准入语义）。 */
  readonly usage: number;
  readonly limit: number;
}

export interface WorkspaceShareUsage {
  readonly workspaceId: string;
  /** 该 workspace 当前并发/份额用量。 */
  readonly current: number;
  readonly shareLimit: number;
}

/**
 * 硬配额检查（设计 §5.2：domainSlots/cpu/memory/modelConcurrency = **硬**）：
 * 超限拒绝并发射 `QUOTA_HARD_EXCEEDED`；workspace 份额超限只拒绝**该 workspace**
 * 并发射 `QUOTA_WORKSPACE_SHARE_EXCEEDED`——同租户其他 workspace 不受影响（`PRD-040` 同租户不连坐）。
 */
export class HardQuotaService {
  admitHard(usage: HardQuotaUsage): { allowed: boolean; reason?: string } {
    if (!Number.isFinite(usage.usage) || !Number.isFinite(usage.limit) || usage.usage < 0 || usage.limit < 0) {
      throw new Error("QUOTA_INPUT_INVALID: 硬配额用量与上限必须为非负有限数值");
    }
    if (usage.usage >= usage.limit) {
      return { allowed: false, reason: "QUOTA_HARD_EXCEEDED" };
    }
    return { allowed: true };
  }

  /** workspace 份额硬检查：某 workspace 超限只拒绝该 workspace 的新轮次（`PRD-040`）。 */
  admitWorkspace(usage: WorkspaceShareUsage): { allowed: boolean; reason?: string } {
    if (!Number.isFinite(usage.current) || !Number.isFinite(usage.shareLimit) || usage.current < 0 || usage.shareLimit < 0) {
      throw new Error("QUOTA_INPUT_INVALID: workspace 份额用量与上限必须为非负有限数值");
    }
    if (usage.current >= usage.shareLimit) {
      return { allowed: false, reason: "QUOTA_WORKSPACE_SHARE_EXCEEDED" };
    }
    return { allowed: true };
  }
}

// ── 公平调度（§5.2.1） ───────────────────────────────────────────────────────
export interface FairSchedulingDecision {
  readonly tenantId: string;
  readonly overQuota: boolean;
  /** 限速比例：超额租户按超限比例限速；未超额租户 0（不受影响）。 */
  readonly throttleRatio: number;
  readonly decision: "admit" | "throttle";
  readonly reason?: string;
}

export class FairScheduler {
  private readonly watermarkThreshold: number;
  private readonly committedQuota: (tenantId: string) => number;

  constructor(watermarkThreshold: number, committedQuota: (tenantId: string) => number) {
    this.watermarkThreshold = watermarkThreshold;
    this.committedQuota = committedQuota;
  }

  /**
   * 全局背压：水位超阈值时对**超额租户**（用量 > 承诺额度）**按超限比例**限速；
   * 未超额租户照常受理（不平等 503、不连坐）。
   */
  admit(tenantId: string, usage: number, poolWatermark: number): FairSchedulingDecision {
    if (poolWatermark <= this.watermarkThreshold) {
      return { tenantId, overQuota: usage > this.committedQuota(tenantId), throttleRatio: 0, decision: "admit" };
    }
    const quota = this.committedQuota(tenantId);
    if (usage > quota) {
      // 按超限比例限速（比例 = 1 − quota/usage），其余租户不受影响。
      const ratio = quota <= 0 ? 1 : 1 - quota / usage;
      return { tenantId, overQuota: true, throttleRatio: Math.round(ratio * 100) / 100, decision: "throttle", reason: "QUOTA_OVER_COMMITTED_PROPORTIONAL_THROTTLE" };
    }
    return { tenantId, overQuota: false, throttleRatio: 0, decision: "admit" };
  }
}

// ── 计费与归因（§5.2.1 末段；§7.6 真源；`PRD-036` dim 四维；`PRD-041` 幂等去重） ──
export interface UsageRecord {
  readonly tenantId: string;
  readonly turnId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly scenario: string;
  readonly connector: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheHitTokens: number;
}

export interface UsageAggregate {
  readonly tenantId: string;
  readonly dim: "workspace" | "user" | "scenario" | "connector";
  readonly key: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheHitTokens: number;
  /** 对账标记（`REL-055`/`REL-094`）：tombstone 丢弃段 → reconciled:false。 */
  readonly reconciled: boolean;
  readonly underCounted: number;
  readonly overCounted: number;
}

export class BillingLedger {
  private readonly records: UsageRecord[] = [];
  private readonly tombstonedTurns = new Set<string>();

  /** 幂等去重：按 `(tenantId, turnId)`（同 turnId 重复上传只计一次）。 */
  ingest(record: UsageRecord): { accepted: boolean; duplicate: boolean } {
    const key = `${record.tenantId}:${record.turnId}`;
    if (this.records.some((r) => `${r.tenantId}:${r.turnId}` === key)) {
      return { accepted: false, duplicate: true };
    }
    this.records.push(record);
    return { accepted: true, duplicate: false };
  }

  markTombstoned(tenantId: string, turnId: string): void {
    this.tombstonedTurns.add(`${tenantId}:${turnId}`);
  }

  /**
   * 对客用量端点（`PRD-036`：`GET /v1/usage?dim=workspace|user|scenario|connector`（T+1）、
   * `GET /v1/usage/export`）。含 `reconciled` 标记与**分方向差异**（少计/多计分列，`PRD-041`）。
   */
  usage(dim: "workspace" | "user" | "scenario" | "connector", keys: readonly string[]): readonly UsageAggregate[] {
    const result: UsageAggregate[] = [];
    for (const key of keys) {
      const matched = this.records.filter((r) => {
        if (dim === "workspace") return r.workspaceId === key;
        if (dim === "user") return r.userId === key;
        if (dim === "scenario") return r.scenario === key;
        return r.connector === key;
      });
      if (matched.length === 0) continue;
      const inputTokens = matched.reduce((sum, r) => sum + r.inputTokens, 0);
      const outputTokens = matched.reduce((sum, r) => sum + r.outputTokens, 0);
      const cacheHitTokens = matched.reduce((sum, r) => sum + r.cacheHitTokens, 0);
      const tenantId = matched[0].tenantId;
      // 分方向差异（`REL-056`/`PRD-041`）：墓碑丢弃段 = 少计（under）；
      // 派生视图多算由对账裁定（reconcile 报表分列，见 reconciliation.ts）。
      const underCounted = matched.filter((r) => this.tombstonedTurns.has(`${r.tenantId}:${r.turnId}`)).length;
      result.push({ tenantId, dim, key, inputTokens, outputTokens, cacheHitTokens, reconciled: underCounted === 0, underCounted, overCounted: 0 });
    }
    return result;
  }

  /** 导出（`GET /v1/usage/export`）。 */
  exportAll(dim: "workspace" | "user" | "scenario" | "connector", keys: readonly string[]): string {
    return JSON.stringify({ dim, generatedAt: new Date().toISOString(), rows: this.usage(dim, keys) }, null, 2);
  }
}
