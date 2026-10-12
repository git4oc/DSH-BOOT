/**
 * 控制面身份与多租户（设计 §5.1；`PRD-020`–`PRD-028`）。
 *
 * - 身份：JWT（OIDC 对接企业 IdP）；RBAC 按租户/角色控制场景、插件、工具、MCP、沙箱模式上限。
 * - 租户绑定：用户令牌绑定 `tenantId` 与**允许的 workspaceId 集合**。
 * - **workspace 授权时机**：允许集合**在签令牌时固化** + **每次请求校验一次租户与隔离组**
 *   （硬依赖，但在网关本地完成，不进模型热路径）。
 * - 域令牌绑定 `(tenantId, isolationGroupId)`（§4.2.1）。
 * - 沙箱模式上限未知模式一律拒绝（`SEC-023`/C38）；JWT 验签恒时比较 + 吊销表（`PRD-055`：停用后令牌 ≤ 5 分钟失效）。
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface RolePermissions {
  readonly scenarios: readonly string[];
  readonly plugins: readonly string[];
  readonly tools: readonly string[];
  readonly mcpConnectors: readonly string[];
  /** 沙箱模式上限（C38：单一预设使 danger-full-access 与 never 不可达）。 */
  readonly sandboxModeCeiling: "read-only" | "workspace-write";
}

export interface UserTokenClaims {
  readonly sub: string;
  readonly tenantId: string;
  readonly role: string;
  /** 允许的 workspaceId 集合（签令牌时固化）。 */
  readonly workspaceIds: readonly string[];
  readonly isolationGroupId: string;
  readonly exp: number;
}

export interface RbacPolicy {
  /** 按租户/角色的 RBAC 表（§5.1 授权行）。 */
  readonly roles: Record<string, RolePermissions>;
}

/** OIDC 企业 IdP 签发的 JWT（HS256 签名验证点；生产为非对称验签，接口同形）。 */
export function signUserToken(claims: UserTokenClaims, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** 验证 JWT：签名（恒时比较）+ 过期 + 吊销 + 返回 claims（OIDC 对接企业 IdP）。
 *  fail-closed：畸形载荷、缺失/非法 `exp`、签名不符、已吊销一律拒绝（`SEC-023` 判定 fail-closed 口径；
 *  吊销语义见 `PRD-055`：停用后令牌 ≤ 5 分钟失效）。 */
export function verifyUserToken(token: string, secret: string, revocations?: TokenRevocationRegistry): { ok: boolean; claims?: UserTokenClaims; reason?: string } {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "JWT_MALFORMED" };
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  const expectedBuf = Buffer.from(expected, "utf8");
  const givenBuf = Buffer.from(parts[2], "utf8");
  if (expectedBuf.length !== givenBuf.length || !timingSafeEqual(expectedBuf, givenBuf)) return { ok: false, reason: "JWT_SIGNATURE_INVALID" };
  let claims: UserTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as UserTokenClaims;
  } catch {
    return { ok: false, reason: "JWT_MALFORMED" };
  }
  if (claims === null || typeof claims !== "object" || Array.isArray(claims)) return { ok: false, reason: "JWT_MALFORMED" };
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) return { ok: false, reason: "JWT_MALFORMED" };
  if (claims.exp * 1000 < Date.now()) return { ok: false, reason: "JWT_EXPIRED" };
  if (revocations !== undefined) {
    const invalidAfter = revocations.invalidAfter(claims.sub);
    if (invalidAfter !== undefined && Date.now() >= invalidAfter) return { ok: false, reason: "JWT_REVOKED" };
  }
  return { ok: true, claims };
}

/**
 * 停用吊销表（`PRD-055`：SCIM 停用后**即时撤销**，既有令牌在 ≤ 5 分钟内失效）。
 * 停用时刻 T 的用户令牌在 T + 5min 后一律被 `verifyUserToken` 拒绝（`JWT_REVOKED`）。
 */
export class TokenRevocationRegistry {
  private readonly invalidAfterByUser = new Map<string, number>();

  /** 登记停用：返回该用户令牌的失效时点（停用时刻 + 5 min；`PRD-055`）。 */
  revoke(userId: string, deactivatedAt: number): number {
    const value = deactivatedAt + 5 * 60 * 1000;
    const existing = this.invalidAfterByUser.get(userId);
    // 重复停用取更早的失效点：先停用先失效，不放宽既有约束。
    this.invalidAfterByUser.set(userId, existing === undefined ? value : Math.min(existing, value));
    return this.invalidAfterByUser.get(userId) as number;
  }

  invalidAfter(userId: string): number | undefined {
    return this.invalidAfterByUser.get(userId);
  }
}

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** RBAC 授权检查：场景/插件/工具/MCP/沙箱模式上限逐类校验。 */
export function rbacCheck(policy: RbacPolicy, role: string, request: { scenario?: string; plugin?: string; tool?: string; mcpConnector?: string; sandboxMode?: string }): { allowed: boolean; reason?: string } {
  const permissions = policy.roles[role];
  if (!permissions) return { allowed: false, reason: "RBAC_ROLE_UNKNOWN" };
  if (request.scenario !== undefined && !permissions.scenarios.includes(request.scenario)) return { allowed: false, reason: "RBAC_SCENARIO_DENIED" };
  if (request.plugin !== undefined && !permissions.plugins.includes(request.plugin)) return { allowed: false, reason: "RBAC_PLUGIN_DENIED" };
  if (request.tool !== undefined && !permissions.tools.includes(request.tool)) return { allowed: false, reason: "RBAC_TOOL_DENIED" };
  if (request.mcpConnector !== undefined && !permissions.mcpConnectors.includes(request.mcpConnector)) return { allowed: false, reason: "RBAC_MCP_DENIED" };
  if (request.sandboxMode !== undefined && !modeWithinCeiling(request.sandboxMode, permissions.sandboxModeCeiling)) return { allowed: false, reason: "RBAC_SANDBOX_CEILING" };
  return { allowed: true };
}

/** 沙箱模式上限（`SEC-023`/C38）：未知模式一律拒绝（fail-closed），已列出模式按序比较。 */
function modeWithinCeiling(mode: string, ceiling: string): boolean {
  const order = ["read-only", "workspace-write"];
  if (!order.includes(mode) || !order.includes(ceiling)) return false;
  return order.indexOf(mode) <= order.indexOf(ceiling);
}

/**
 * workspace 授权（§5.1 决定）：允许集合**在签令牌时固化**；**每次请求校验租户与隔离组**
 * （硬依赖但网关本地完成）。返回拒绝原因码（不含任何软依赖原因码）。
 */
export function authorizeWorkspace(claims: UserTokenClaims, request: { tenantId: string; isolationGroupId: string; workspaceId: string }): { allowed: boolean; reason?: string } {
  if (claims.tenantId !== request.tenantId) return { allowed: false, reason: "TENANT_MISMATCH" };
  if (claims.isolationGroupId !== request.isolationGroupId) return { allowed: false, reason: "ISOLATION_GROUP_MISMATCH" };
  if (!claims.workspaceIds.includes(request.workspaceId)) return { allowed: false, reason: "WORKSPACE_NOT_AUTHORIZED" };
  return { allowed: true };
}

/** 拒绝原因码全集（验收：**不含任何软依赖原因码**——软依赖不可用不拒绝执行）。 */
export const HARD_REJECTION_CODES = ["TENANT_MISMATCH", "ISOLATION_GROUP_MISMATCH", "WORKSPACE_NOT_AUTHORIZED", "JWT_MALFORMED", "JWT_SIGNATURE_INVALID", "JWT_EXPIRED", "JWT_REVOKED", "RBAC_ROLE_UNKNOWN", "RBAC_SCENARIO_DENIED", "RBAC_PLUGIN_DENIED", "RBAC_TOOL_DENIED", "RBAC_MCP_DENIED", "RBAC_SANDBOX_CEILING", "QUOTA_HARD_EXCEEDED", "QUOTA_WORKSPACE_SHARE_EXCEEDED"] as const;
