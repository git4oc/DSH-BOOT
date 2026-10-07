/**
 * llm 反转面夹具：模型流故障注入（`ENG-043` 判据②的三个旋钮）。
 * TTFB 延迟 → 触发 `T_m` 路径；aborted → 触发轮次中断；adapter-error → 显式错误帧。
 * 旋钮经桩的控制端点 `/__knobs` 下发（JSON 体）。
 */

export type StreamFault = { ttfbMs: number } | { mode: "aborted" } | { mode: "adapter-error" };

export function streamFaultKnobs(fault: StreamFault): Record<string, unknown> {
  if ("ttfbMs" in fault) return { ttfbMs: fault.ttfbMs };
  return { streamMode: fault.mode };
}

/** 复位全部旋钮的请求体。 */
export function resetKnobs(): Record<string, unknown> {
  return {};
}
