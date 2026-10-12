/**
 * 反转面 3：`ctx.approval` 审批应答者（`ENG-009` / `ENG-010` / `ENG-011` / `ENG-012`）。
 *
 * 返回词表闭合：`allowed-once | rejected | cancelled | unavailable`（本方案扩展 `timeout`，
 * `SEC-DOC-06` §5 `approvalStatus` 词表含 `timeout`）。通道不可达、参数补全失败 ⇒ `unavailable`
 * （fail-closed）。应答者**自持 `T_a` 超时**（取自 Profile `deadlines.approvalSeconds`）：
 * 内核**无审批超时**（`C40`），只有 abort 才 `cancelled`——不得依赖内核 signal 收敛。
 * **禁止**任何跨 `callId` 的授权复用（无永久授权缓存、无规则存储，`ENG-010`）。
 */

import type { ApprovalDomainContext, ApprovalParameterChannel, ApprovalPayload } from "./parameter-channel.ts";

/** 返回词表（闭合；`timeout` 为本方案扩展，`SEC-DOC-06` §5）。 */
export const APPROVAL_OUTCOMES = [
  "allowed-once",
  "rejected",
  "cancelled",
  "unavailable",
  "timeout",
] as const;

export type ApprovalOutcome = (typeof APPROVAL_OUTCOMES)[number];

/** 内核 `ApprovalRequestEvent` 形状（`CTR-001` §4；`C9` 载荷只有这些字段——无参数、无 `sessionId`）。 */
export interface KernelApprovalEvent {
  readonly agent: string;
  readonly toolName: string;
  readonly callId?: string;
  readonly reason?: string;
  readonly displayReason?: string;
  readonly signal?: AbortSignal;
}

/** 域外审批决策：每次调用必须产生**新** `approvalId`（`ENG-010` 判据②）。 */
export interface ApprovalDecision {
  readonly approvalId: string;
  readonly outcome: "allowed-once" | "rejected";
}

/** 内核 `ctx.approval` 形状（waterfall 应答者注册）。 */
export interface KernelApprovalContext {
  respond(responder: (event: KernelApprovalEvent) => Promise<ApprovalOutcome>): () => void;
}

export interface ApprovalResponderOptions {
  /** 参数通道（审批判定**之前**上报十字段载荷，`O-3`）。 */
  channel: ApprovalParameterChannel;
  /** 域内调用上下文（`C9`：`sessionId` 等由域内应答者补齐）。 */
  domainContext: ApprovalDomainContext;
  /** 参数解析（桥的工具包装层按 `callId` 提供参数；无法解析 ⇒ `unavailable`）。 */
  resolveArgs: (event: KernelApprovalEvent) => unknown;
  /** 域外审批决策（waterfall 的下一环；每次调用新 `approvalId`，`ENG-010`）。 */
  decide: (request: { callId: string; toolName: string; payload: ApprovalPayload }) => Promise<ApprovalDecision>;
  /** `T_a` 审批应答预算（秒），取自 Profile `deadlines.approvalSeconds`（默认 90）。 */
  approvalSeconds?: number;
}

/**
 * 注册为 `approval/request` waterfall 应答者（`ENG-009`）。
 * 流程：参数上报（`O-3`）→ 标记 `approval.requested`（`O-1`）→ 自持 `T_a` 等待域外决策。
 * 无任何跨 `callId` 授权复用（`ENG-010`：无永久授权缓存、无规则存储）。
 */
export function registerApprovalResponder(
  ctx: { approval: KernelApprovalContext },
  options: ApprovalResponderOptions,
): () => void {
  const approvalSeconds = options.approvalSeconds ?? 90; // `T_a` 默认 90（范围 60–120 由 Profile 校验，`ENG-039`）

  const responder = async (event: KernelApprovalEvent): Promise<ApprovalOutcome> => {
    // 内核 abort ⇒ cancelled（`C40`：只有 abort 才 cancelled；不依赖内核 signal 做超时收敛）。
    if (event.signal?.aborted) return "cancelled";
    const callId = event.callId;
    if (callId === undefined || callId === "") return "unavailable"; // F-3：无 `callId` ⇒ 不可送达

    // ① 审批判定**之前**上报十字段载荷（`O-3`；`ENG-012` 判据①）。
    const args = options.resolveArgs(event);
    const delivered = await options.channel.deliver(
      options.domainContext,
      callId,
      event.toolName,
      args,
    );
    if (!delivered) return "unavailable"; // 参数无法送达 ⇒ fail-closed（`ENG-009` 判据①）

    // ② `approval.requested` 的 `approvalSeq`（`O-1`：晚于 `tool.call` 的 `callSeq`）。
    options.channel.markApprovalRequested(
      options.domainContext.sessionId,
      options.domainContext.turnId,
      callId,
    );

    // ③ 自持 `T_a` 超时（`C40`：内核无审批超时；黑盒连接必须靠超时收敛，`ENG-011`）。
    const payload = options.channel.getBackfill(
      options.domainContext.sessionId,
      options.domainContext.turnId,
      callId,
    )?.payload;
    if (payload === undefined) {
      // 上报已成功但回补记录缺失：fail-closed（`ENG-009` 判据①，`SEC-DOC-06` §6.2 判据 1）。
      options.channel.markDecided(
        options.domainContext.sessionId,
        options.domainContext.turnId,
        callId,
        "unavailable",
        "responder",
        "backfill-missing",
      );
      return "unavailable";
    }
    let decisionPromise: Promise<ApprovalDecision>;
    try {
      decisionPromise = options.decide({ callId, toolName: event.toolName, payload });
    } catch (error) {
      // decide 同步抛出：fail-closed ⇒ unavailable（`CTR-001` §4.3 词表，不盲批）。
      options.channel.markDecided(
        options.domainContext.sessionId,
        options.domainContext.turnId,
        callId,
        "unavailable",
        "responder",
        "decide-error",
      );
      void error;
      return "unavailable";
    }
    const timeoutMs = approvalSeconds * 1000;
    let clearT_a: () => void = () => undefined;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      // 应答者自持 `T_a`（`C40`：内核无审批超时）；不 unref——它就是收敛机制本身。
      const timer = setTimeout(() => resolve("timeout"), timeoutMs);
      clearT_a = () => clearTimeout(timer);
    });
    const outcome = await Promise.race([
      decisionPromise.then((d) => d.outcome, () => {
        // decide 拒绝（域外决策通道失败）：fail-closed ⇒ unavailable（`ENG-009` 判据①）。
        options.channel.markDecided(
          options.domainContext.sessionId,
          options.domainContext.turnId,
          callId,
          "unavailable",
          "responder",
          "decide-error",
        );
        return "unavailable" as const;
      }),
      timeoutPromise,
    ]);
    clearT_a(); // 决策先到：释放 T_a 定时器（不阻塞进程退出）
    if (outcome === "allowed-once" || outcome === "rejected") {
      options.channel.markDecided(
        options.domainContext.sessionId,
        options.domainContext.turnId,
        callId,
        outcome,
        "approver",
        outcome === "allowed-once" ? "approved-once" : "rejected",
      );
    } else if (outcome === "timeout") {
      // `T_a` 到期（应答者自持）：终态落库（`SEC-DOC-06` §5 `approvalStatus` 词表含 timeout）。
      options.channel.markDecided(
        options.domainContext.sessionId,
        options.domainContext.turnId,
        callId,
        "timeout",
        "responder",
        "ta-timeout",
      );
    }
    return outcome;
  };

  return ctx.approval.respond(responder); // 内核 waterfall 应答者注册（`CTR-001` §4）
}
