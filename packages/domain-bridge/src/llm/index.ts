/**
 * 反转面 1：`ctx.llm`（`LlmAdapter`）— 模型调用经反向网关出域。
 * 契约：`CTR-001` §2（`ENG-005`–`ENG-008`）；实现归 `packages/domain-bridge`（`ENG-020`）。
 * 依赖方向：本包只允许依赖 `packages/protocol`（`ENG-021` / `LAYER-001` §3）。
 */
export type DomainBridgeFace = "llm" | "tools" | "approval" | "persistence";

/** 反转面硬上限 4（`ENG-024`：第 5 个面必须先过架构审批并同步规格与设计文档）。 */
export const REVERSAL_FACE_LIMIT = 4 as const;

export { GatewayLlmAdapter, DSH_LLM_RETRY_MOUNTED } from "./gateway-adapter.ts";
export type { GatewayLlmAdapterOptions } from "./gateway-adapter.ts";
export { LlmAdapter } from "./types.ts";
export type {
  AdapterRegistrationHandle,
  CallConfig,
  GenerateOptions,
  ImagePricing,
  ModelInfo,
  PreparedLlmCall,
  ProviderInfo,
  StreamChunk,
  RetryPolicy,
  ModelRef,
} from "./types.ts";
export {
  InvalidPreparedCallError,
  PrepareCallFailedError,
  ResolveModelFailedError,
} from "./types.ts";
export {
  attributionHeaders,
  clearCurrentTurnContext,
  setCurrentTurnContext,
} from "./attribution.ts";
