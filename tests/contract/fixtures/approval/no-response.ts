/**
 * approval 反转面夹具：审批不响应注入（`ENG-043` 判据②）。
 * `/internal/kernel/approval/request` 挂起 → 客户端 `T_a` 超时收敛。
 * 旋钮经桩的控制端点 `/__knobs` 下发（JSON 体）。
 */

export function approvalNoResponseKnob(): Record<string, unknown> {
  return { approvalNoResponse: true };
}

export function approvalOutcomeKnob(
  outcome: "allowed-once" | "rejected" | "cancelled" | "unavailable",
): Record<string, unknown> {
  return { approvalOutcome: outcome };
}
