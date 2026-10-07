/**
 * dsh-boot 反转面 wire 契约类型（`@dsh-boot/protocol`）。
 *
 * 本包只含类型与 schema，无运行期依赖（`ENG-020` 判据②）。
 * 签名来源：`docs/reversal-contracts.md`（`CTR-001`）§2/§3/§4，逐字段对应内核
 * 发行包 `.d.ts` 实证（`VER-001` 文档方法）。运行期实现归 `packages/domain-bridge`
 * （面 1/2/3/4，`ENG-020`），本文件只声明跨包共享的 wire 类型。
 */

/** 反向网关 `POST /internal/kernel/llm/stream` 的请求体（`CTR-001` §2.4 流式契约）。 */
export interface LlmStreamRequest {
  /** 逐字段保真转发的内核模型调用意图（`ENG-007`：不得重组、重命名、增删字段）。 */
  readonly options: LlmGenerateOptions;
  /** 归因头（模块级 `attributionHeaders` 产物，`ENG-008` 判据）。 */
  readonly attribution: Record<string, string>;
  /** 域令牌绑定的租户（`CTR-001` C-3）。 */
  readonly tenantId: string;
}

/** 内核 `GenerateOptions` 的透传形状：内容是会话日志的纯函数（`CTR-001` §2.3 深冻结）。 */
export type LlmGenerateOptions = Readonly<Record<string, unknown>>;

/** 反向网关流式响应的下行分片（`CTR-001` §2.4：显式终止帧区分正常结束 / adapter error / aborted）。 */
export type LlmStreamChunk =
  | { readonly kind: "delta"; readonly text: string }
  | { readonly kind: "error"; readonly message: string; readonly code?: string }
  | { kind: "done"; readonly reason: "completed" | "adapter-error" | "aborted" };

/** 模型解析结果（`CTR-001` §2.2 `resolveModel` 的 wire 形状，域外 `resolve-model` 返回）。 */
export interface ModelRef {
  readonly provider: string;
  readonly model: string;
  readonly contextWindow: number;
}

/** 重试策略（`CTR-001` §2.4：`T_m` = 含重试总预算，由域外计时）。 */
export interface RetryPolicy {
  readonly retryableCodes: readonly string[];
  readonly maxAttempts: number;
  readonly backoffMs: readonly number[];
}

/** 审批应答 wire 请求（`CTR-001` §4.2 载荷：每个请求必须携带 `turnId`，响应携带 `requestId`）。 */
export interface ApprovalRequestEvent {
  readonly requestId: string;
  readonly turnId: string;
  readonly tenantId: string;
  readonly isolationGroupId: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly toolName: string;
  readonly rawName?: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}
