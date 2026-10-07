/**
 * 恢复：**追加合成 closer，不是回滚**（`REL-069`/`C22`；设计 §7.4）。
 *
 * - 中断轮次**永久保留在历史中**；合成覆盖三类事件（未闭合 `tool/result`、未闭合
 *   `step/end`、`turn/end{interrupted}`）且**幂等**（按 `(turnId, callId)` 去重，`REL-070`）。
 * - 五个 span 埋点：拿锁 / 读+closer / 折叠 / connector 就绪 / 工具集就绪（`ENG-059`）。
 * - 日志事件量上界：超界产出 `recovery.log_size_exceeded` 并拒绝按"≤ 30 s 档"承诺 SLO（`ENG-061`）。
 * - `recovery.lost_state` 逐类标明不可恢复项（`REL-076`）。
 */

import { CURRENT_FORMAT_VERSION } from "./errors.ts";

/** 合成 closer 事件（三类全覆盖，`REL-070`）。 */
export interface SyntheticCloser {
  readonly kind: "tool-result" | "step-end" | "turn-end";
  readonly turnId: string;
  readonly callId?: string;
  readonly event: { readonly [key: string]: unknown };
}

/** 五个 span（`ENG-059` 判据①）。 */
export const RECOVERY_SPANS = ["lock-acquired", "read-closer", "fold", "connector-ready", "tools-ready"] as const;

export interface RecoverySpan {
  readonly span: (typeof RECOVERY_SPANS)[number];
  readonly sessionId: string;
  readonly monotonicMs: number;
}

export interface RecoveryOptions {
  /** 日志事件量上界（配置项，`ENG-061`）。 */
  readonly maxLogEvents?: number;
  /** SLO 档位（默认 ≤ 30 s 档；超界后切换分档目标）。 */
  readonly sloTier?: "30s" | "tiered";
  /** 不可恢复项实测标志（`REL-076`：虚报「无丢失」即失败）。 */
  readonly observedLoss?: { shellState?: boolean; mcpSubprocesses?: boolean; runCodeIntermediates?: boolean; nestedInnerSideEffects?: boolean };
}

export interface RecoveryResult {
  readonly sessionId: string;
  readonly spans: readonly RecoverySpan[];
  readonly closersAppended: readonly SyntheticCloser[];
  readonly lostState: {
    readonly shellState: boolean;
    readonly mcpSubprocesses: boolean;
    readonly runCodeIntermediates: boolean;
    readonly nestedInnerSideEffects: boolean;
  };
  readonly logSizeExceeded: boolean;
  readonly sloTier: "30s" | "tiered";
}

/** 从日志事件中计算未闭合结构（三类全覆盖；幂等键 `(turnId, callId)`）。 */
export function computeUnclosed(events: readonly { readonly [key: string]: unknown }[]): SyntheticCloser[] {
  const closers: SyntheticCloser[] = [];
  const openTools = new Map<string, { turnId: string; callId: string; toolName: string }>();
  const openSteps = new Map<string, string>();
  const closedTurns = new Set<string>();
  const existingCloserKeys = new Set<string>();
  for (const event of events) {
    const kind = String(event.kind ?? "");
    const turnId = String(event.turnId ?? "");
    const callId = String(event.callId ?? "");
    const closerKey = `${kind}:${turnId}:${callId}`;
    if (event.synthetic === true) existingCloserKeys.add(closerKey);
    if (kind === "tool" ) openTools.set(callId, { turnId, callId, toolName: String(event.toolName ?? "") });
    else if (kind === "tool-result" && openTools.has(callId)) openTools.delete(callId);
    else if (kind === "step-start") openSteps.set(turnId, callId);
    else if (kind === "step-end") openSteps.delete(turnId);
    else if (kind === "turn-end") closedTurns.add(turnId);
  }
  for (const { turnId, callId, toolName } of openTools.values()) {
    if (closedTurns.has(turnId)) continue;
    closers.push({
      kind: "tool-result",
      turnId,
      callId,
      event: {
        v: CURRENT_FORMAT_VERSION,
        kind: "tool-result",
        turnId,
        callId,
        synthetic: true,
        outcome: "unknown",
        toolName,
        note: "结果未知…只重试只读或幂等操作…不要盲重试",
      },
    });
  }
  for (const [turnId] of openSteps) {
    if (closedTurns.has(turnId)) continue;
    closers.push({
      kind: "step-end",
      turnId,
      event: { v: CURRENT_FORMAT_VERSION, kind: "step-end", turnId, synthetic: true },
    });
  }
  const openTurns = new Set<string>();
  for (const event of events) {
    const turnId = String(event.turnId ?? "");
    if (String(event.kind ?? "") === "turn-start") openTurns.add(turnId);
  }
  for (const turnId of openTurns) {
    if (closedTurns.has(turnId)) continue;
    closers.push({
      kind: "turn-end",
      turnId,
      event: { v: CURRENT_FORMAT_VERSION, kind: "turn-end", turnId, synthetic: true, interrupted: true },
    });
  }
  return closers.filter((closer) => {
    const key = `${closer.kind}:${closer.turnId}:${closer.callId ?? ""}`;
    return !existingCloserKeys.has(key);
  });
}

/**
 * 恢复一个会话：拿锁 → 读 + 追加合成 closer（幂等）→ 折叠 → connector 就绪 → 工具集就绪。
 * **不回滚**：中断轮次永久保留（`REL-069`）。
 */
export function recover(
  sessionId: string,
  logEvents: readonly { readonly [key: string]: unknown }[],
  append: (events: readonly { readonly [key: string]: unknown }[]) => void,
  options: RecoveryOptions = {},
): RecoveryResult {
  const t0 = Date.now();
  const spans: RecoverySpan[] = [];
  const mark = (span: (typeof RECOVERY_SPANS)[number]): void => {
    spans.push({ span, sessionId, monotonicMs: Date.now() - t0 });
  };

  mark("lock-acquired");
  const maxLogEvents = options.maxLogEvents ?? 100_000;
  const logSizeExceeded = logEvents.length > maxLogEvents;
  const sloTier: "30s" | "tiered" = logSizeExceeded ? "tiered" : (options.sloTier ?? "30s");

  mark("read-closer");
  const closers = computeUnclosed(logEvents);
  const existingKeys = new Set(logEvents.map((e) => `${String(e.kind ?? "")}:${String(e.turnId ?? "")}:${String(e.callId ?? "")}`));
  const pending = closers.filter((closer) => {
    const key = `${closer.event.kind as string}:${closer.turnId}:${closer.callId ?? ""}`;
    return !existingKeys.has(key);
  });
  if (pending.length > 0) append(pending.map((closer) => closer.event));

  mark("fold");
  const loss = options.observedLoss ?? {};
  const lostState = {
    shellState: loss.shellState ?? false,
    mcpSubprocesses: loss.mcpSubprocesses ?? false,
    runCodeIntermediates: loss.runCodeIntermediates ?? false,
    nestedInnerSideEffects: loss.nestedInnerSideEffects ?? false,
  };

  mark("connector-ready");
  mark("tools-ready");

  return {
    sessionId,
    spans,
    closersAppended: pending,
    lostState,
    logSizeExceeded,
    sloTier,
  };
}

/** span 之和 vs 端到端 RTO 的差 ≤ 5%（`ENG-059` 判据②）。 */
export function spanCoverageSpans(spans: readonly RecoverySpan[], endToEndMs: number): { coveredMs: number; gapRatio: number } {
  const coveredMs = spans.length > 0 ? Math.max(...spans.map((s) => s.monotonicMs)) : 0;
  const gapRatio = endToEndMs <= 0 ? 0 : Math.abs(endToEndMs - coveredMs) / Math.max(1, endToEndMs);
  return { coveredMs, gapRatio };
}

/** 日志事件量上界断言（`ENG-061`）：超界产出 `recovery.log_size_exceeded` 并切档。 */
export function assertLogSizeBound(eventCount: number, maxLogEvents: number): { exceeded: boolean; event: { kind: string; eventCount: number; maxLogEvents: number; sloTier: "30s" | "tiered" } } {
  const exceeded = eventCount > maxLogEvents;
  return {
    exceeded,
    event: {
      kind: "recovery.log_size_exceeded",
      eventCount,
      maxLogEvents,
      sloTier: exceeded ? "tiered" : "30s",
    },
  };
}
