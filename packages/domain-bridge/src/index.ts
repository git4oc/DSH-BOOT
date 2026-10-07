/**
 * `@dsh-boot/domain-bridge` — 四个反转面的实现包（`ENG-020`）。
 * 反转面硬上限 4（`ENG-024`）：llm / tools / approval / persistence。
 */
export type { DomainBridgeFace } from "./llm/index.ts";
export { REVERSAL_FACE_LIMIT } from "./llm/index.ts";
export { APPROVAL_FACE } from "./approval/index.ts";
export { PERSISTENCE_FACE } from "./persistence/index.ts";

// 面 1：ctx.llm（LlmAdapter，P0-A1）
export { GatewayLlmAdapter, DSH_LLM_RETRY_MOUNTED, attributionHeaders } from "./llm/index.ts";
export type { GatewayLlmAdapterOptions } from "./llm/index.ts";

// 面 2：ctx.tools（工具注册桥 + 纵深防御，P0-A2，`ENG-001`–`ENG-004`）
export {
  registerTool,
  installToolBridge,
  convergeProfileSecurity,
  resolveSandboxPermissions,
} from "./register.ts";
export { installGuard } from "./guard.ts";
export { BridgeTelemetry, isToolAllowed } from "./tools.ts";
export type { ToolBridgeOptions, ClientContext } from "./register.ts";
export type { KernelToolsContext, ToolDefinition, ToolGuard, RegistrationDeniedAudit } from "./tools.ts";
