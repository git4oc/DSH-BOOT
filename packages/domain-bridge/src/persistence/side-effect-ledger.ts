/**
 * 副作用台账（`REL-072`–`REL-075`；设计 §7.4.1）。
 *
 * - 对标记为**非幂等**的工具，**执行前**把九字段条目落到**域外**；写入为**硬**
 *   （属最小审计集，`SEC-069`）：写入失败 ⇒ 工具调用被拒绝（fail-closed）。
 * - 恢复后对"结果未确认"的调用，由**产品策略（而非模型判断）禁止自动重试**（`REL-074`）。
 * - 嵌套派发复用外层持久调用（`C43`）：此类工具必须显式声明二选一，未声明者不得注册（`REL-075`）。
 */

export interface LedgerEntry {
  readonly tenantId: string;
  readonly isolationGroupId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly paramDigest: string;
  readonly targetResource: string;
  readonly outcome: "unconfirmed" | "confirmed";
}

/** 台账条目九字段完整性（`REL-073`）。 */
export function entryComplete(entry: LedgerEntry): boolean {
  return (
    entry.tenantId !== undefined && entry.isolationGroupId !== undefined && entry.workspaceId !== undefined &&
    entry.sessionId !== undefined && entry.turnId !== undefined && entry.callId !== undefined &&
    entry.toolName !== undefined && entry.paramDigest !== undefined && entry.targetResource !== undefined
  );
}

export class SideEffectLedger {
  private readonly entries: LedgerEntry[] = [];
  /** 注入口（`ENG-046` 夹具）：令台账写入失败 ⇒ 调用被拒（fail-closed）。 */
  public failWrites = false;

  /**
   * 执行前写台账（硬）：写入失败即抛（fail-closed，`REL-072`），调用方必须拒绝工具执行。
   * 时机与检查点对齐（外层副作用前已 flush）。
   */
  recordBeforeExecution(entry: Omit<LedgerEntry, "outcome"> & { outcome?: LedgerEntry["outcome"] }): LedgerEntry {
    if (this.failWrites) {
      throw new Error("SESSION_SIDECFFECT_LEDGER_WRITE_FAILED: ledger write is hard (fail-closed, REL-072)");
    }
    const full: LedgerEntry = { ...entry, outcome: entry.outcome ?? "unconfirmed" };
    this.entries.push(full);
    return full;
  }

  /** 按 `(sessionId, turnId)` 查询未确认调用（`REL-073`）。 */
  queryUnconfirmed(sessionId: string, turnId: string): readonly LedgerEntry[] {
    return this.entries.filter((entry) => entry.sessionId === sessionId && entry.turnId === turnId && entry.outcome === "unconfirmed");
  }

  /** 恢复后由产品策略禁止自动重试（`REL-074`）：拦截点在发出调用**之前**命中台账。 */
  policyGuard(input: { sessionId: string; turnId: string; callId: string }): { allowed: boolean; requiresConfirmation: boolean; reason?: string } {
    const hit = this.entries.find((entry) => entry.sessionId === input.sessionId && entry.turnId === input.turnId && entry.callId === input.callId && entry.outcome === "unconfirmed");
    if (hit) {
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: "产品策略禁止自动重试：台账中存在结果未确认的同调用（UI 显示参数并要求确认，PRD-007）",
      };
    }
    return { allowed: true, requiresConfirmation: false };
  }
}

/** 嵌套派发声明（`REL-075`/`C43`）：未声明者不得注册（注册桥入口拦截）。 */
export type NestedSideEffectPolicy = "inner-effects-ledgered-first" | "forbid-non-idempotent" ;

export function nestedPolicyDeclared(tool: { nestedSideEffectPolicy?: NestedSideEffectPolicy }): boolean {
  return tool.nestedSideEffectPolicy === "inner-effects-ledgered-first" || tool.nestedSideEffectPolicy === "forbid-non-idempotent";
}
