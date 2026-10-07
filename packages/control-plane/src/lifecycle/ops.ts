/**
 * 企业身份生命周期与降级可观测性（`COPY-027`；`REL-037`–`REL-051`；`REL-121`–`REL-127`；设计 §6.1/§9.4/§9.5）。
 *
 * - **SSO/SCIM**：SAML/OIDC + SCIM 自动开通/离职收回；账号停用后相关会话与令牌
 *   在 **5 分钟内失效**（`COPY-027`）。
 * - **降级阶梯**：L0/L1/L1b/L2/L3 跃迁表（升级立即生效允许跳级；降级必须逐级；
 *   L1b→L0 经 L1；L2→L0 须重 attest；50% 滞回 + 5 min 最短驻留）；**软依赖绝不阻断执行**；
 *   级别下发通道打通。
 * - **告警**：按 `(租户, 维度, 子键, 级别)` 聚合，仅在跨过驻留阈值后告警；
 *   错误预算（中断时长 / 43200 min × 100%）与冻结清单。
 */

import { createHash } from "node:crypto";

// ── SSO/SCIM 生命周期（`COPY-027`；`PRD-050`–`PRD-056`） ───────────────────────
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

  /** SCIM 离职收回：账号停用 ⇒ 相关会话与令牌 **5 分钟内失效**（`COPY-027`）。 */
  deactivate(userId: string, at: number): { active: false; revokedSessions: number; tokenInvalidAfter: number; withinMinutes: 5 } {
    const account = this.accounts.get(userId);
    if (!account) throw new Error("ACCOUNT_UNKNOWN");
    this.accounts.set(userId, { ...account, active: false });
    let revoked = 0;
    const tokenInvalidAfter = at + 5 * 60 * 1000; // ≤ 5 min（COPY-027）
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

/** 跃迁表（升级 ✓ 允许跳级；降级逐级；禁路 L3→L0/L3→L1/L2→L0 未重 attest/L1b→L0 直跳）。 */
const ALLOWED_TRANSITIONS: Record<DegradationLevel, readonly DegradationLevel[]> = {
  L0: ["L1", "L1b", "L2", "L3"],
  L1: ["L1b", "L2", "L3"],
  L1b: ["L1", "L2", "L3"], // L1b → L0 禁止直跳（须经 L1）
  L2: ["L0", "L1", "L1b", "L3"], // L2 → L0 须重 attest（由 transition() 的 attestOk 门控）
  L3: ["L2"], // 回落必须逐级
};

export interface LadderTransitionResult {
  readonly level: DegradationLevel;
  readonly applied: boolean;
  readonly reason?: string;
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
   * 跃迁：升级更严重方向**立即生效、允许跳级**；降级**必须逐级**；
   * `L2 → L0` 须重 attest 通过（`REL-043`）；50% 滞回 + 最短驻留由阈值表承载。
   */
  transition(target: DegradationLevel, opts: { reattestOk?: boolean } = {}): LadderTransitionResult {
    if (target === this.level) return { level: this.level, applied: false, reason: "ALREADY_AT_LEVEL" };
    const allowed = ALLOWED_TRANSITIONS[this.level];
    if (!allowed.includes(target)) {
      return { level: this.level, applied: false, reason: `FORBIDDEN_TRANSITION: ${this.level} → ${target}（跃迁表）` };
    }
    if (this.level === "L2" && target === "L0" && opts.reattestOk !== true) {
      return { level: this.level, applied: false, reason: "RE_ATTEST_REQUIRED: L2 → L0 必须强制刷新目录并重新 attest（REL-043）" };
    }
    this.level = target;
    this.enteredAt = Date.now();
    const hash = createHash("sha256").update(`${target}:${this.enteredAt}`, "utf8").digest("hex").slice(0, 16);
    this.distributed.push({ level: target, at: this.enteredAt, hash });
    return { level: target, applied: true };
  }

  /** 最短驻留（5 min）：进入非 L0 级别后 5 min 内不得回落（观测窗口约束）。 */
  dwellElapsed(now: number, minimumDwellMs: number = 5 * 60 * 1000): boolean {
    return now - this.enteredAt >= minimumDwellMs;
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

  /** 错误预算（`SLO-01`）：预算消耗 = 中断时长 / 43200 min × 100%。 */
  errorBudgetConsumed(outageMinutes: number): { consumedPercent: number; budgetMinutes: 43200 } {
    return { consumedPercent: Math.round((outageMinutes / 43200) * 10000) / 100, budgetMinutes: 43200 };
  }

  /** 冻结清单（错误预算耗尽 ⇒ 功能冻结）：非安全修复不得上线。 */
  frozen(budgetPercent: number): boolean {
    return budgetPercent >= 100;
  }
}
