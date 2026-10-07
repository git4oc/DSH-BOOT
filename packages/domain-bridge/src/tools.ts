/**
 * 反转面 2 主防线：工具注册判定与遥测（`ENG-002` / `ENG-003`；`SEC-DOC-03` 拦截点 3）。
 *
 * 判定输入：`definition.name` + **只读** Profile 的 `toolAllowlist`（`E-07`：判定源只来自只读
 * Profile）。`toolAllowlist` 缺省或空数组 ⇒ 可见工具集为**空集**，不是全集（`ENG-002` 判据②）。
 * 本文件**不**包含内核 register 调用——全仓唯一的 `ctx.tools` register 调用点在
 * `packages/domain-bridge/src/register.ts`（`ENG-001` 判据①）。
 */

/** 内核工具定义形状（`dsh-tools/lib/types` 的最小子集）。 */
export interface ToolDefinition {
  readonly name: string;
  readonly rawName?: string;
  readonly [key: string]: unknown;
}

/** 内核 `ctx.tools` 形状（`CTR-001` §3.2）。 */
export interface KernelToolsContext {
  register(definition: ToolDefinition): () => void;
  guard(guard: ToolGuard): () => void;
}

/** 派发期工具守卫：返回拒绝理由（只否），undefined 表示放行。 */
export type ToolGuard = (execution: Readonly<{ toolName: string }>) => string | undefined;

/** 最小审计集（`SEC-019`/`SEC-069`）：白名单外注册尝试。 */
export interface RegistrationDeniedAudit {
  readonly event: "bridge.register.denied";
  readonly toolName: string;
  readonly rawName?: string;
  readonly reason: string;
  readonly at: string;
}

/** 桥遥测：`bridge_register_denied_total` 计数器 + 硬审计缓冲（`ENG-002` 判据③）。 */
export class BridgeTelemetry {
  private deniedTotal = 0;
  private readonly auditBuffer: RegistrationDeniedAudit[] = [];

  incrementDenied(audit: Omit<RegistrationDeniedAudit, "event" | "at">): void {
    this.deniedTotal += 1;
    this.auditBuffer.push({ event: "bridge.register.denied", at: new Date().toISOString(), ...audit });
  }

  /** `bridge_register_denied_total`（`ENG-002` 判据③：指标自增可断言）。 */
  get bridgeRegisterDeniedTotal(): number {
    return this.deniedTotal;
  }

  /** 硬审计记录（域外台账的域内缓冲；P1-B 换绑域外台账通道）。 */
  getAuditRecords(): readonly RegistrationDeniedAudit[] {
    return this.auditBuffer;
  }
}

/**
 * 白名单判定（`ENG-002`）：缺省或空数组 ⇒ 空集；`["*"]` 仅为开发态逃生门（`ENG-045`）。
 * 判定源只来自只读 Profile 的 `toolAllowlist`。
 */
export function isToolAllowed(toolName: string, allowlist: readonly string[] | undefined): boolean {
  if (!allowlist || allowlist.length === 0) return false; // 空集，不是全集
  return allowlist.includes(toolName) || allowlist.includes("*");
}
