/**
 * 迁移状态机（设计 §5.4.1；`REL-077`–`REL-084`）。
 *
 * ```
 * PENDING ──► HANDOFF_ARMED ──► SOURCE_RELEASED ──> OWNED ──► (切换路由)
 *    │              │                 │              │
 *    └──────────────┴─────────────────┴──────────────┴──► FAILED ──► 可幂等重驱动
 * ```
 *
 * - 任一步失败进入 `FAILED`，**可幂等重驱动**（幂等键 `(migrationId, step)`）；不得停留在"无写者"状态。
 * - 回退边界：`HANDOFF_ARMED` **之前**允许回退；之后走 `FAILED` 重驱动（**禁止 `HANDOFF_ARMED → PENDING`**，`REL-078`）。
 * - 步骤 4：**`assert targetBaseSeq == sourceLastReplicatedSeq`**，不等即拒绝 handoff（`REL-079`）。
 * - 锁语义：`session.lock` **无过期**（`C23`）——显式释放 + 目标提交 epoch，**不得依赖超时**。
 * - 新增 SLO：**无写者会话持续时长 P99 ≤ 5 min**；迁移后事件数不减少（不变量）。
 */

export type MigrationState = "PENDING" | "HANDOFF_ARMED" | "SOURCE_RELEASED" | "OWNED" | "FAILED";

/** 允许的跃迁表（`REL-077`/`REL-078`：无 `HANDOFF_ARMED → PENDING`）。 */
const TRANSITIONS: Record<MigrationState, readonly MigrationState[]> = {
  PENDING: ["HANDOFF_ARMED", "FAILED"],
  HANDOFF_ARMED: ["SOURCE_RELEASED", "FAILED"],
  SOURCE_RELEASED: ["OWNED", "FAILED"],
  OWNED: [],
  FAILED: ["PENDING"],
};

export interface MigrationSnapshot {
  readonly migrationId: string;
  readonly state: MigrationState;
  readonly targetBaseSeq?: number;
  readonly sourceLastReplicatedSeq?: number;
  readonly epoch: number;
  readonly steps: readonly string[];
}

export class MigrationStateMachine {
  private state: MigrationState = "PENDING";
  private readonly steps: string[] = [];
  private epoch = 0;
  private targetBaseSeq?: number;
  private sourceLastReplicatedSeq?: number;
  private readonly migrationId: string;

  constructor(migrationId: string) {
    this.migrationId = migrationId;
  }

  /** 跃迁（失败注入由 `forceFail` 承载，进入 FAILED 而非抛出）。 */
  transition(next: MigrationState, input: { targetBaseSeq?: number; sourceLastReplicatedSeq?: number } = {}): MigrationSnapshot {
    const allowed = TRANSITIONS[this.state];
    if (!allowed.includes(next)) {
      throw new Error(`MIGRATION_INVALID_TRANSITION: ${this.state} → ${next} (allowed: ${allowed.join(", ")})`);
    }
    if (next === "OWNED") {
      // 步骤 4 断言（preventive，`REL-079`）：不等即拒绝 handoff（防丢尾）。
      if (this.targetBaseSeq !== this.sourceLastReplicatedSeq) {
        this.steps.push("handoff-rejected(targetBaseSeq != sourceLastReplicatedSeq)");
        this.state = "FAILED";
        return this.snapshot();
      }
      this.epoch += 1; // 目标域提交 epoch（步骤 6）；源在 epoch 提升后的 append 被拒（fencing）
    }
    this.steps.push(`${this.state}→${next}`);
    this.state = next;
    return this.snapshot();
  }

  /** 步骤 4 的前置：记录两侧序号。 */
  recordSeqs(targetBaseSeq: number, sourceLastReplicatedSeq: number): void {
    this.targetBaseSeq = targetBaseSeq;
    this.sourceLastReplicatedSeq = sourceLastReplicatedSeq;
  }

  /** FAILED 后幂等重驱动（`REL-080`）：同一迁移 ID，不得产生重复 closer/epoch/路由切换。 */
  redrive(): MigrationSnapshot {
    if (this.state !== "FAILED") {
      throw new Error("MIGRATION_REDRIVE_ONLY_FROM_FAILED");
    }
    this.steps.push("redrive");
    this.state = "PENDING";
    return this.snapshot();
  }

  /** 无写者时长 SLO（`REL-084`）：P99 ≤ 5 min；告警须含迁移 ID 与所在状态。 */
  noWriterAlert(noWriterMs: number): { breached: boolean; migrationId: string; state: MigrationState; sloMs: number } {
    return {
      breached: noWriterMs > 5 * 60 * 1000,
      migrationId: this.migrationId,
      state: this.state,
      sloMs: 5 * 60 * 1000,
    };
  }

  snapshot(): MigrationSnapshot {
    return {
      migrationId: this.migrationId,
      state: this.state,
      targetBaseSeq: this.targetBaseSeq,
      sourceLastReplicatedSeq: this.sourceLastReplicatedSeq,
      epoch: this.epoch,
      steps: [...this.steps],
    };
  }
}
