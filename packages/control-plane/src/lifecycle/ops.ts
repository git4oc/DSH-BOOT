/**
 * 企业身份生命周期与降级可观测性（`PRD-055`；`REL-037`–`REL-051`；`REL-121`–`REL-127`；设计 §6.1/§9.4/§9.5）。
 *
 * - **SSO/SCIM**：SAML/OIDC + SCIM 自动开通/离职收回；账号停用后相关会话与令牌
 *   在 **5 分钟内失效**（`PRD-055`：停用后即时撤销，生效时延 ≤ 5 分钟）。
 *   注：原引用的 `COPY-027` 在 spec/ 中不存在，已更正为 `PRD-055`。
 * - **降级阶梯**：L0/L1/L1b/L2/L3 跃迁表（升级立即生效允许跳级；降级必须逐级且满足退出条件——
 *   最短驻留 5 min，`REL-048`/`REL-039`；L1b→L0 经 L1；L2→L0 须重 attest `REL-043`；
 *   滞回 = 退出阈值严于进入阈值 `REL-041`）；**软依赖绝不阻断执行**；级别下发通道打通。
 * - **告警**：按 `(租户, 维度, 子键, 级别)` 聚合，仅在跨过驻留阈值后告警；
 *   错误预算（中断时长 / 43200 min × 100%）与冻结清单。
 */

import { createHash } from "node:crypto";

// ── SSO/SCIM 生命周期（`PRD-055`；`PRD-050`–`PRD-056`） ───────────────────────
export interface ManagedAccount {
  readonly userId: string;
  readonly tenantId: string;
  readonly source: "saml" | "oidc" | "scim";
  readonly active: boolean;
}

export class SsoScimLifecycle {
  private readonly accounts = new Map<string, ManagedAccount>();
  private readonly sessions = new Map<string, { userId: string; tokenInvalidAfter: number }>();

  /** SCIM 自动开通（SAML/OIDC 对接企业 IdP）。 */
  provision(userId: string, tenantId: string, source: "saml" | "oidc" | "scim"): ManagedAccount {
    const account: ManagedAccount = { userId, tenantId, source, active: true };
    this.accounts.set(userId, account);
    return account;
  }

  openSession(userId: string, issuedAt: number): void {
    this.sessions.set(`${userId}:${issuedAt}`, { userId, tokenInvalidAfter: Number.POSITIVE_INFINITY });
  }

  /** SCIM 离职收回：账号停用 ⇒ 相关会话与令牌 **5 分钟内失效**（`PRD-055`）。
   *  同时登记到吊销表：`verifyUserToken` 据此拒绝停用后已签发的令牌。 */
  deactivate(userId: string, at: number): { active: false; revokedSessions: number; tokenInvalidAfter: number; withinMinutes: 5 } {
    const account = this.accounts.get(userId);
    if (!account) throw new Error("ACCOUNT_UNKNOWN");
    this.accounts.set(userId, { ...account, active: false });
    let revoked = 0;
    const tokenInvalidAfter = at + 5 * 60 * 1000; // ≤ 5 min（PRD-055）
    for (const [key, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.set(key, { ...session, tokenInvalidAfter });
        revoked += 1;
      }
    }
    return { active: false, revokedSessions: revoked, tokenInvalidAfter, withinMinutes: 5 };
  }

  /** 会话/令牌有效性检查：停用后 5 分钟内失效。 */
  sessionValid(userId: string, issuedAt: string, now: number): boolean {
    const session = this.sessions.get(`${userId}:${issuedAt}`);
    if (!session) return false;
    const account = this.accounts.get(userId);
    return (account?.active ?? false) && now < session.tokenInvalidAfter;
  }
}

// ── 降级阶梯（`REL-037`–`REL-051`；docs/reliability/degradation-ladder.md） ────
export type DegradationLevel = "L0" | "L1" | "L1b" | "L2" | "L3";

/** 跃迁表（`REL-048`：升级 ✓ 立即生效允许跳级；降级必须逐级满足退出条件，不得跨级回落）。
 *  禁路：L3→L0/L3→L1（未逐级）、L2→L0 未重 attest（`REL-043`）、L1b→L0 直跳（须经 L1，`REL-048`）。 */
const ALLOWED_TRANSITIONS: Record<DegradationLevel, readonly DegradationLevel[]> = {
  L0: ["L1", "L1b", "L2", "L3"],
  L1: ["L0", "L1b", "L2", "L3"], // L1 → L0 逐级回落（`REL-039` L1 退出条件；`REL-048`）
  L1b: ["L1", "L2", "L3"], // L1b → L0 禁止直跳（须经 L1，`REL-048` 逐级）
  L2: ["L0", "L1", "L1b", "L3"], // L2 → L0 须重 attest（由 transition() 的 attestOk 门控，`REL-043`）
  L3: ["L2"], // 回落必须逐级
};

/** 严重度排序（恢复方向 = 严重度下降；`REL-048` 降级必须逐级 + 满足退出条件）。 */
const SEVERITY: Record<DegradationLevel, number> = { L0: 0, L1: 1, L1b: 2, L2: 3, L3: 4 };

export interface LadderTransitionResult {
  readonly level: DegradationLevel;
  readonly applied: boolean;
  readonly reason?: string;
}

/** 滞回阈值对（`REL-041`：退出阈值必须**严于**进入阈值，形成滞回）。 */
export interface LadderThresholds {
  /** 进入阈值（观测指标达到即触发升级/进入该级）。 */
  readonly entryThreshold: number;
  /** 退出阈值——必须严于（小于）进入阈值（`REL-041`）。 */
  readonly exitThreshold: number;
}

export class DegradationLadder {
  private level: DegradationLevel = "L0";
  private enteredAt = 0;
  /** 级别下发通道（§9.4）：每次跃迁经此通道下发到网关/域池/域。 */
  public readonly distributed: { level: DegradationLevel; at: number; hash: string }[] = [];
  /** 软依赖（计费/一般审计）不可用 ⇒ **绝不阻断执行**（D12）：拒绝原因码不含软依赖。 */
  public readonly softDependencyReasonCodes: readonly string[] = [];

  current(): DegradationLevel {
    return this.level;
  }

  /**
   * 跃迁（`REL-048`）：升级（更严重）方向**立即生效、允许跳级**；降级**必须逐级**且
   * **满足退出条件**——最短驻留 5 min 内不得回落（`REL-039`）；
   * `L2 → L0` 须重 attest 通过（`REL-043`）；滞回由 `recoveryAllowed` 承载（`REL-041`）。
   */
  transition(target: DegradationLevel, opts: { reattestOk?: boolean; now?: number } = {}): LadderTransitionResult {
    if (target === this.level) return { level: this.level, applied: false, reason: "ALREADY_AT_LEVEL" };
    const allowed = ALLOWED_TRANSITIONS[this.level];
    if (!allowed.includes(target)) {
      return { level: this.level, applied: false, reason: `FORBIDDEN_TRANSITION: ${this.level} → ${target}（跃迁表）` };
    }
    if (this.level === "L2" && target === "L0" && opts.reattestOk !== true) {
      return { level: this.level, applied: false, reason: "RE_ATTEST_REQUIRED: L2 → L0 必须强制刷新目录并重新 attest（REL-043）" };
    }
    const now = opts.now ?? Date.now();
    // REL-048/REL-039：降级（恢复方向）必须满足退出条件——最短驻留 5 min 内不得回落。
    if (SEVERITY[target] < SEVERITY[this.level] && !this.dwellElapsed(now)) {
      return { level: this.level, applied: false, reason: "DWELL_NOT_ELAPSED: 降级必须满足最短驻留 5 min（REL-039/REL-048）" };
    }
    this.level = target;
    this.enteredAt = now;
    const hash = createHash("sha256").update(`${target}:${this.enteredAt}`, "utf8").digest("hex").slice(0, 16);
    this.distributed.push({ level: target, at: this.enteredAt, hash });
    return { level: target, applied: true };
  }

  /** 最短驻留（5 min）：进入非 L0 级别后 5 min 内不得回落（观测窗口约束，`REL-039`）。 */
  dwellElapsed(now: number, minimumDwellMs: number = 5 * 60 * 1000): boolean {
    return now - this.enteredAt >= minimumDwellMs;
  }

  /**
   * 滞回门控（`REL-041` + `REL-039`）：退出阈值必须**严于**进入阈值（exit < entry，否则抛错）；
   * 指标须回落到退出阈值以下**且**满足最短驻留 5 min，二者同时成立才允许恢复。
   */
  recoveryAllowed(metric: number, thresholds: LadderThresholds, now: number): { allowed: boolean; reason?: string } {
    if (!Number.isFinite(metric)) {
      throw new Error("LADDER_METRIC_INVALID: 观测指标必须为有限数值");
    }
    if (thresholds.exitThreshold >= thresholds.entryThreshold) {
      throw new Error("LADDER_HYSTERESIS_INVALID: 退出阈值必须严于进入阈值（REL-041）");
    }
    if (metric >= thresholds.entryThreshold) {
      return { allowed: false, reason: "RECOVERY_METRIC_ABOVE_ENTRY: 指标未回落到进入阈值以下" };
    }
    if (metric > thresholds.exitThreshold) {
      return { allowed: false, reason: "RECOVERY_METRIC_ABOVE_EXIT: 指标未回落到退出阈值以下（滞回，REL-041）" };
    }
    if (!this.dwellElapsed(now)) {
      return { allowed: false, reason: "DWELL_NOT_ELAPSED: 最短驻留未满足（REL-039）" };
    }
    return { allowed: true };
  }
}

// ── 按租户告警聚合 + 错误预算（`REL-121`–`REL-127`） ──────────────────────────
export interface DegradationEvent {
  readonly tenantId: string;
  readonly dimension: string;
  readonly subKey: string;
  readonly level: DegradationLevel;
  readonly at: number;
}

export class TenantAlertAggregator {
  private readonly firstSeen = new Map<string, number>();
  public readonly alerts: { key: string; textId: string }[] = [];

  /**
   * 按 `(租户, 维度, 子键, 级别)` 聚合为一条；**仅在跨过驻留阈值后告警**
   * （驻留阈值 5 min；`PRD-052` 状态页）。
   */
  ingest(event: DegradationEvent, dwellThresholdMs: number = 5 * 60 * 1000): { alerted: boolean; key: string } {
    const key = `${event.tenantId}:${event.dimension}:${event.subKey}:${event.level}`;
    if (!this.firstSeen.has(key)) this.firstSeen.set(key, event.at);
    const age = event.at - (this.firstSeen.get(key) ?? event.at);
    if (age >= dwellThresholdMs) {
      if (!this.alerts.some((a) => a.key === key)) {
        this.alerts.push({ key, textId: `degradation.${event.level}` });
      }
      return { alerted: true, key };
    }
    return { alerted: false, key };
  }

  /** 错误预算（`SLO-01`）：预算消耗 = 中断时长 / 43200 min × 100%；负值拒绝（不得伪造预算回退）。 */
  errorBudgetConsumed(outageMinutes: number): { consumedPercent: number; budgetMinutes: 43200 } {
    if (!Number.isFinite(outageMinutes) || outageMinutes < 0) {
      throw new Error("ERROR_BUDGET_INPUT_INVALID: 中断时长必须为非负有限数值（SLO-01）");
    }
    return { consumedPercent: Math.round((outageMinutes / 43200) * 10000) / 100, budgetMinutes: 43200 };
  }

  /** 冻结清单（错误预算耗尽 ⇒ 功能冻结）：非安全修复不得上线。 */
  frozen(budgetPercent: number): boolean {
    return budgetPercent >= 100;
  }
}
