/**
 * 域令牌绑定（设计 §4.2.1；`SEC-007`/`SEC-008`）。
 *
 * 域令牌必须绑定 **`(tenantId, isolationGroupId)`**，签发时固化；域外**必须**校验
 * 「请求中的租户 == 令牌中的租户」，不一致即拒绝并**硬审计**。租约粒度：会话级
 * （TTL ≤ 300 s，§4.2.1 上限）。令牌为 HMAC-SHA256 签名（域外自产、可复算）。
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface DomainTokenPayload {
  readonly tenantId: string;
  readonly isolationGroupId: string;
  /** 签发时刻（epoch ms，签发时固化）。 */
  readonly issuedAt: number;
  /** 过期时刻（epoch ms）；TTL ≤ 300 s（§4.2.1）。 */
  readonly expiresAt: number;
}

export interface DomainToken {
  /** `base64url(payload).sig`（HMAC-SHA256）。 */
  readonly token: string;
  readonly payload: DomainTokenPayload;
}

/** 硬审计记录（`SEC-008`：不一致即拒绝并硬审计）。 */
export interface TokenAudit {
  readonly event: "token.cross_tenant_rejected" | "token.issued" | "token.expired_rejected" | "token.signature_rejected";
  readonly claimedTenantId: string;
  readonly boundTenantId: string | null;
  readonly at: string;
}

const audits: TokenAudit[] = [];

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** 签发域令牌：绑定 `(tenantId, isolationGroupId)`，签发时固化（TTL ≤ 300 s）。 */
export function issueDomainToken(options: {
  tenantId: string;
  isolationGroupId: string;
  /** 会话租约 TTL（秒）；上限 300（§4.2.1）。 */
  ttlSeconds: number;
  secret: string;
  now?: () => number;
}): DomainToken {
  if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds < 1 || options.ttlSeconds > 300) {
    throw new Error("tokenTtlSeconds 必须为 1–300 的整数（会话租约 TTL 上限 300 s，§4.2.1）");
  }
  const now = (options.now ?? Date.now)();
  const payload: DomainTokenPayload = {
    tenantId: options.tenantId,
    isolationGroupId: options.isolationGroupId,
    issuedAt: now,
    expiresAt: now + options.ttlSeconds * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  audits.push({ event: "token.issued", claimedTenantId: options.tenantId, boundTenantId: options.tenantId, at: new Date(now).toISOString() });
  return { token: `${encoded}.${hmac(encoded, options.secret)}`, payload };
}

/** 域外校验：请求声称的租户 == 令牌里的租户（不一致即拒绝 + 硬审计，`SEC-008`）。 */
export function verifyDomainToken(
  token: string,
  claimedTenantId: string,
  options: { secret: string; now?: () => number },
): { ok: boolean; reason?: string } {
  const now = (options.now ?? Date.now)();
  const dot = token.lastIndexOf(".");
  if (dot < 0) {
    audits.push({ event: "token.signature_rejected", claimedTenantId, boundTenantId: null, at: new Date(now).toISOString() });
    return { ok: false, reason: "token 格式非法：拒绝（SEC-008）" };
  }
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = hmac(encoded, options.secret);
  const provided = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
    audits.push({ event: "token.signature_rejected", claimedTenantId, boundTenantId: null, at: new Date(now).toISOString() });
    return { ok: false, reason: "token 签名校验失败：拒绝（SEC-008）" };
  }
  let payload: DomainTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as DomainTokenPayload;
  } catch {
    audits.push({ event: "token.signature_rejected", claimedTenantId, boundTenantId: null, at: new Date(now).toISOString() });
    return { ok: false, reason: "token 载荷不可解析：拒绝（SEC-008）" };
  }
  if (payload.expiresAt < now) {
    audits.push({ event: "token.expired_rejected", claimedTenantId, boundTenantId: payload.tenantId, at: new Date(now).toISOString() });
    return { ok: false, reason: "token 已过期：拒绝（SEC-008）" };
  }
  if (payload.tenantId !== claimedTenantId) {
    // 不一致即拒绝并硬审计（`SEC-008`：防域冒充其他租户）。
    audits.push({ event: "token.cross_tenant_rejected", claimedTenantId, boundTenantId: payload.tenantId, at: new Date(now).toISOString() });
    return { ok: false, reason: `请求租户 ${claimedTenantId} != 令牌租户 ${payload.tenantId}：拒绝（§4.2.1 域令牌绑定）` };
  }
  return { ok: true };
}

/** 硬审计记录（最小审计集口径，`SEC-069`/`SEC-070`）。 */
export function getTokenAudits(): readonly TokenAudit[] {
  return audits;
}
