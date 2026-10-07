/**
 * 控制面身份与多租户（设计 §5.1；`PRD-020`–`PRD-028`）。
 *
 * - 身份：JWT（OIDC 对接企业 IdP）；RBAC 按租户/角色控制场景、插件、工具、MCP、沙箱模式上限。
 * - 租户绑定：用户令牌绑定 `tenantId` 与**允许的 workspaceId 集合**。
 * - **workspace 授权时机**：允许集合**在签令牌时固化** + **每次请求校验一次租户与隔离组**
 *   （硬依赖，但在网关本地完成，不进模型热路径）。
 * - 域令牌绑定 `(tenantId, isolationGroupId)`（§4.2.1）。
 */

import { createHmac } from "node:crypto";

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

/** 验证 JWT：签名 + 过期 + 返回 claims（OIDC 对接企业 IdP）。 */
export function verifyUserToken(token: string, secret: string): { ok: boolean; claims?: UserTokenClaims; reason?: string } {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "JWT_MALFORMED" };
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  if (expected !== parts[2]) return { ok: false, reason: "JWT_SIGNATURE_INVALID" };
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as UserTokenClaims;
  if (claims.exp * 1000 < Date.now()) return { ok: false, reason: "JWT_EXPIRED" };
  return { ok: true, claims };
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

function modeWithinCeiling(mode: string, ceiling: string): boolean {
  const order = ["read-only", "workspace-write"];
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
export const HARD_REJECTION_CODES = ["TENANT_MISMATCH", "ISOLATION_GROUP_MISMATCH", "WORKSPACE_NOT_AUTHORIZED", "JWT_MALFORMED", "JWT_SIGNATURE_INVALID", "JWT_EXPIRED", "RBAC_ROLE_UNKNOWN", "RBAC_SCENARIO_DENIED", "RBAC_PLUGIN_DENIED", "RBAC_TOOL_DENIED", "RBAC_MCP_DENIED", "RBAC_SANDBOX_CEILING", "QUOTA_HARD_EXCEEDED", "QUOTA_WORKSPACE_SHARE_EXCEEDED"] as const;
