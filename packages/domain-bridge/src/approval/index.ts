/**
 * 反转面 3：`ctx.approval`（审批应答者 + 参数送达通道）。
 * 契约：`CTR-001` §4（`ENG-009`–`ENG-012`）；`SEC-DOC-06`（十字段载荷 / 键级脱敏 /
 * 体积上限 / 定序 / 回补端点）。
 */
export const APPROVAL_FACE = "approval" as const;

export { registerApprovalResponder, APPROVAL_OUTCOMES } from "./responder.ts";
export type { ApprovalOutcome, ApprovalDecision, ApprovalResponderOptions } from "./responder.ts";

export {
  ApprovalParameterChannel,
  argsDeliverable,
  buildTenFieldPayload,
  argsDigestOf,
  canonicalSerialize,
  DEFAULT_REDACTION_RULES,
  ARGS_PREVIEW_MAX_BYTES,
  ARGS_VALUE_MAX_BYTES,
  ARGS_MAX_DEPTH,
  ARGS_MAX_ARRAY_ITEMS,
  ARGS_MAX_KEYS,
} from "./parameter-channel.ts";
export type { ApprovalPayload, ApprovalDomainContext, BackfillRecord, RedactionRules } from "./parameter-channel.ts";
