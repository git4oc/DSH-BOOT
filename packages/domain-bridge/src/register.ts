/**
 * 反转面 2 注册入口：工具进入域内注册表的**唯一入口**（`ENG-001`；`SEC-DOC-03` 拦截点 3）。
 *
 * 全仓唯一的 `ctx.tools` register 调用点在本文件（`ENG-001` 判据①：源码检索 packages/apps
 * 仅允许命中桥内部的一处）。判定输入只来自只读 Profile 的 `toolAllowlist`；
 * 两道防线互相独立：本入口管**可见性**（能力不可达），`guard.ts` 管**执行期兜底**
 * （按最终工具名判定，覆盖 scoped 注册——`VER-001` §3.3 定论）。
 */

import { BridgeTelemetry, isToolAllowed } from "./tools.ts";
import type { ToolDefinition } from "./tools.ts";
import { installGuard } from "./guard.ts";

/** 内核 `ctx.tools` 形状（`CTR-001` §3.2）。 */
export interface KernelToolsContext {
  register(definition: ToolDefinition): () => void;
  guard(guard: ToolGuard): () => void;
}

/** Client Context 形状（内核把 `tools` 服务注入到 ctx 上）。 */
export interface ClientContext {
  tools: KernelToolsContext;
}

/** 派发期工具守卫：返回拒绝理由（只否），undefined 表示放行。 */
export type ToolGuard = (execution: Readonly<{ toolName: string }>) => string | undefined;

export interface ToolBridgeOptions {
  /** 只读 Profile 的 `toolAllowlist`（缺省或空数组 ⇒ 空集，`ENG-002` 判据②）。 */
  allowlist: readonly string[] | undefined;
  /** 遥测：`bridge_register_denied_total` 计数器 + 硬审计缓冲。 */
  telemetry: BridgeTelemetry;
  /**
   * 审批注册准入（`SEC-DOC-06` §6.1）：返回拒绝理由（如 `args-undeliverable:*`）则
   * **不予注册**且不得进入 `requireApproval`（`ENG-012` 判据②；F-1/F-2/F-3）。
   */
  approvalAdmission?: (definition: ToolDefinition) => string | undefined;
}

export interface ToolBridgeHandle {
  /** 唯一注册入口（MCP 发现与运行期动态注册同路，`ENG-003`）。 */
  registerTool(definition: ToolDefinition): () => void;
  /** 纵深防御已安装（`ENG-004` 判据①：bridge.guard.installed=true）。 */
  guardInstalled: true;
  /** 域销毁时释放内核 guard disposer（`CTR-001` §2.6）。 */
  dispose(): void;
}

/**
 * 唯一注册入口（`ENG-001` / `ENG-002`）：
 * 清单内 → 调内核 register 并**原样返回**内核 disposer（`CTR-001` §3.5）；
 * 清单外 → **不注册** + 硬审计 `bridge.register.denied` + `bridge_register_denied_total++` +
 * 告警，返回 no-op disposer（未注册即无资源可释放）。
 */
export function registerTool(
  definition: ToolDefinition,
  ctx: ClientContext,
  options: ToolBridgeOptions,
): () => void {
  // 审批注册准入（`SEC-DOC-06` §6.1）：参数无法送达 ⇒ 不予注册（`ENG-012` 判据②）。
  const admissionDenial = options.approvalAdmission?.(definition);
  if (admissionDenial !== undefined) {
    options.telemetry.incrementDenied({ toolName: definition.name, rawName: definition.rawName, reason: admissionDenial });
    console.warn(`[bridge] register denied: ${definition.name} ${admissionDenial}`);
    return () => undefined; // no-op disposer：未注册即无资源可释放
  }
  if (!isToolAllowed(definition.name, options.allowlist)) {
    options.telemetry.incrementDenied({
      toolName: definition.name,
      rawName: definition.rawName,
      reason: "not-in-toolAllowlist",
    });
    console.warn(`[bridge] register denied: ${definition.name} not in toolAllowlist`);
    return () => undefined; // no-op disposer：未注册即无资源可释放
  }
  return ctx.tools.register(definition); // 全仓唯一命中点（`ENG-001` 判据①）
}

/**
 * 组合面收敛（域启动期一次性装配，`CTR-001` §3.6）：
 * ① Profile 安全字段收敛校验（`SEC-DOC-03` 拦截点 4/5，违规即域启动失败）；
 * ② 安装纵深防御（全局 `guard()`，`ENG-004` 判据①）；
 * ③ 返回唯一注册入口。
 */
export function installToolBridge(
  ctx: ClientContext,
  profile: {
    toolAllowlist?: readonly string[];
    removedRows?: readonly string[];
    hmr?: { enabled: boolean };
    sandboxMode?: string;
    sandboxModeCeiling?: string;
    permissionPresets?: { enabled?: readonly string[]; reachable?: readonly string[] };
  },
  telemetry: BridgeTelemetry,
): ToolBridgeHandle {
  const violations = convergeProfileSecurity(profile);
  if (violations.length > 0) {
    throw new Error(`域启动失败：Profile 安全字段收敛违规——${violations.join("；")}`);
  }

  const guardDispose = installGuard(ctx, profile.toolAllowlist); // 纵深防御
  console.log("[bridge] installed=true; bridge.guard.installed=true");

  const handle: ToolBridgeHandle = {
    registerTool(definition: ToolDefinition): () => void {
      return registerTool(definition, ctx, { allowlist: profile.toolAllowlist, telemetry });
    },
    guardInstalled: true,
    dispose(): void {
      guardDispose();
    },
  };
  return handle;
}

/**
 * Profile 安全字段收敛（`SEC-DOC-03` 拦截点 4/5；`SEC-013`/`SEC-014`/`SEC-020`/`SEC-021`）：
 * - `removedRows ⊇ {tool-plugin-manager, plugin-manager}` 且 `hmr.enabled === false`；
 * - `permissionPresets.reachable` 恰含一个元素且 ∉ {danger-full-access, never}；
 * - `sandboxMode <= sandboxModeCeiling`（序：read-only < workspace-write < danger-full-access）。
 */
export function convergeProfileSecurity(profile: {
  removedRows?: readonly string[];
  hmr?: { enabled: boolean };
  sandboxMode?: string;
  sandboxModeCeiling?: string;
  permissionPresets?: { enabled?: readonly string[]; reachable?: readonly string[] };
}): readonly string[] {
  const violations: string[] = [];
  const removed = new Set(profile.removedRows ?? []);
  for (const row of ["tool-plugin-manager", "plugin-manager"]) {
    if (!removed.has(row)) violations.push(`removedRows 缺少 ${row}（SEC-013/SEC-020/SEC-021）`);
  }
  if (profile.hmr?.enabled !== false) {
    violations.push("hmr.enabled 必须为 false（SEC-013）");
  }
  const reachable = profile.permissionPresets?.reachable ?? [];
  if (reachable.length !== 1) {
    violations.push("permissionPresets.reachable 必须收敛为单一预设（SEC-014/SEC-025）");
  } else if (reachable[0] === "danger-full-access" || reachable[0] === "never") {
    violations.push("permissionPresets.reachable 不得为 danger-full-access 或 never（SEC-014）");
  }
  const order: Record<string, number> = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 };
  const mode = order[profile.sandboxMode ?? "read-only"] ?? 0;
  const ceiling = order[profile.sandboxModeCeiling ?? "read-only"];
  if (ceiling === undefined) {
    violations.push("sandboxModeCeiling 无法解析（SEC-023）");
  } else if (mode > ceiling) {
    violations.push("sandboxMode 超过 sandboxModeCeiling（SEC-023）");
  }
  return violations;
}

/**
 * 升权上限（`SEC-023` / `SEC-024`）：解析单次调用的 `sandbox_permissions`，
 * 超过 `sandboxModeCeiling` 即拒绝；解析不到即 fail-closed（`C38`、§4.5.1 升权处置）。
 * 序：read-only < workspace-write < danger-full-access。
 */
export function resolveSandboxPermissions(
  requested: unknown,
  ceiling: string,
): { allowed: boolean; reason?: string } {
  const order: Record<string, number> = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 };
  const ceilingLevel = order[ceiling];
  if (ceilingLevel === undefined) {
    return { allowed: false, reason: "sandboxModeCeiling 无法解析：fail-closed" };
  }
  if (typeof requested !== "string" || requested.length === 0) {
    return { allowed: false, reason: "sandbox_permissions 缺失：fail-closed（SEC-024）" };
  }
  const requestedLevel = order[requested];
  if (requestedLevel === undefined) {
    return { allowed: false, reason: `sandbox_permissions 无法解析：fail-closed（${requested}）` };
  }
  if (requestedLevel > ceilingLevel) {
    return { allowed: false, reason: `sandbox_permissions ${requested} 超过上限 ${ceiling}（SEC-023）` };
  }
  return { allowed: true };
}
