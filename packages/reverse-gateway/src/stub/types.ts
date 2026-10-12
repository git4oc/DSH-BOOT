/**
 * 反向网关桩的共享类型（`ENG-043` / `ENG-044`；设计 §6.3 反向 I/O 契约）。
 * 桩仅在开发态使用（`ENG-044` 判据③：开发态桩的结果不得进入生产判定路径）。
 */

/** 降级级别（设计 §8.4：L0–L3 / L1b）。 */
export type DegradationLevel = "L0" | "L1" | "L1b" | "L2" | "L3";

/** attest 触发原因枚举（设计 §6.3：`boot｜tools-change｜heartbeat`）。 */
export type AttestTrigger = "boot" | "tools-change" | "heartbeat";

/** attest 四值响应（设计 §6.3）。 */
export type AttestVerdict = "accept" | "deny" | "resync-profile" | "drain-domain";

/** 实际加载的插件行与版本（`ENG-028` 的上报形状）。 */
export interface LoadedRow {
  readonly name: string;
  readonly version: string;
  readonly disabled?: boolean;
}

/** `tools[]`：名称 + schema 哈希（设计 §6.3 attest 请求）。 */
export interface AttestedTool {
  readonly name: string;
  readonly schemaHash: string;
}

/** `/internal/kernel/attest` 请求体（设计 §6.3 契约）。 */
export interface AttestRequest {
  readonly profileId: string;
  readonly trainVersion: string;
  readonly protocolVersion: string;
  readonly trigger: AttestTrigger;
  readonly rows?: readonly LoadedRow[];
  readonly tools?: readonly AttestedTool[];
  readonly fibers?: readonly string[];
}

/** `/internal/kernel/attest` 响应体：四值 + 当前降级级别。 */
export interface AttestResponse {
  readonly verdict: AttestVerdict;
  readonly degradation: DegradationLevel;
  readonly reasons: readonly string[];
  readonly requestId: string;
}

/** 故障旋钮（`ENG-043` ②：每个旋钮有对应测试）。 */
export interface FaultKnobs {
  /** 模型流首字节前延迟（ms）→ 触发 `T_m` 路径。 */
  ttfbMs?: number;
  /** 流模式：normal / aborted（显式终止帧）/ adapter-error（错误帧 + 终止帧）/ bad-frame（坏 JSON 帧 → 客户端须定性 adapter-error）。 */
  streamMode?: "normal" | "aborted" | "adapter-error" | "bad-frame";
  /** 固定 chunk 序列覆盖（逐字段透传给客户端）。 */
  fixedChunks?: readonly string[];
  /** `/internal/kernel/approval/request` 不响应（挂起）→ 触发 `T_a`。 */
  approvalNoResponse?: boolean;
  /** 审批结果覆盖（默认 allowed-once）。 */
  approvalOutcome?: "allowed-once" | "rejected" | "cancelled" | "unavailable";
  /** 置为不可达的端点前缀（返回 503）。 */
  unreachable?: readonly string[];
  /** attest 强制返回值（缺省时按契约判定）。 */
  attestForceVerdict?: AttestVerdict;
  /** 下发的降级级别覆盖。 */
  degradationLevel?: DegradationLevel;
}

/** 桩的装配选项。 */
export interface StubOptions {
  /** 监听端口（0 = 临时端口）。 */
  readonly port?: number;
  /** 种子 Profile（`ENG-042`：种子 Profile）。 */
  readonly seedProfile: Record<string, unknown>;
  /** 归因头集合（`ENG-008`：缺任一头 → 400；P0-A2 接内核 `attributionHeaders()` 的真实头名）。 */
  readonly attributionHeaderNames?: readonly string[];
  /** 初始故障旋钮。 */
  readonly initialKnobs?: FaultKnobs;
}
