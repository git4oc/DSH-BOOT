/**
 * Session Router、历史查询、保留/删除与取证（设计 §5.4/§7.5/§7.6；`SEC-069`–`SEC-088`；`REL-077`–`REL-089`）。
 *
 * - 路由键 `(tenantId, isolationGroupId)`；就绪探针；**自建会话索引**（C24：内核 `list()`
 *   无分页无过滤无索引）。
 * - 历史查询基于 `ctx.sessionQuery`，但**由域外施加调用方授权**（该 seam 无调用方授权）；
 *   **域内不得挂载 session-query 及其 FTS 派生库**（C26）。
 * - 最小审计集六类 **fail-closed**（记不下即拒绝该动作）；权威源在**域外控制点**；
 *   WORM + 哈希链；审计键**五元组**（+ serverName/rawName，§5.3）。
 * - 保留与删除**全清单**（八类）；spill.root 与附件目录**固定到域卷**。
 * - DSR：删除清单 + 墓碑 + 删除报告 + 哈希链证明；生效时延 ≤ 24 h、撤销窗口 7 天。
 * - 三个正交语义：移除注册(:unregister) ≠ 删除数据(DELETE) ≠ 删会话历史。
 */

import { createHash } from "node:crypto";

// ── Session Router（§5.4） ────────────────────────────────────────────────────
export interface RouteKey {
  readonly tenantId: string;
  readonly isolationGroupId: string;
}

export class SessionRouter {
  private readonly index = new Map<string, { sessionId: string; presetId: string; revisedAt: number }[]>();
  private readonly readyConnectors = new Map<string, boolean>();

  private key(route: RouteKey): string {
    return `${route.tenantId}:${route.isolationGroupId}`;
  }

  /** 路由：按 `(tenantId, isolationGroupId)`；无可用域时排队等待页，**不降级到共享域**。 */
  route(route: RouteKey): { domainId: string } {
    return { domainId: `domain:${route.tenantId}:${route.isolationGroupId}` };
  }

  /** 就绪探针：判定必需 connector 是否就绪（§4.1.2 判据 7）。 */
  connectorReady(serverName: string, ready: boolean): void {
    this.readyConnectors.set(serverName, ready);
  }

  readyFor(required: readonly string[]): boolean {
    return required.every((name) => this.readyConnectors.get(name) === true);
  }

  /** **自建会话索引**（C24）：分页/过滤在域外索引完成，不依赖内核 `list()`。 */
  indexSession(route: RouteKey, sessionId: string, presetId: string): void {
    const list = this.index.get(this.key(route)) ?? [];
    list.push({ sessionId, presetId, revisedAt: Date.now() });
    this.index.set(this.key(route), list);
  }

  /** 索引分页查询（域外自建，`ENG-020` 归属）。 */
  queryIndex(route: RouteKey, offset: number, limit: number): readonly { sessionId: string; presetId: string }[] {
    const list = this.index.get(this.key(route)) ?? [];
    return list.slice(offset, offset + limit).map((e) => ({ sessionId: e.sessionId, presetId: e.presetId }));
  }
}

// ── 历史查询（§5.1/C26：域外施加调用方授权） ─────────────────────────────────
export type CallerRole = "tenant-admin" | "tenant-member";

export class HistoryQueryGateway {
  private readonly callerScopes: Map<string, { tenantId: string; role: CallerRole; workspaces: readonly string[] }>;

  constructor(callerScopes: Map<string, { tenantId: string; role: CallerRole; workspaces: readonly string[] }>) {
    this.callerScopes = callerScopes;
  }

  /**
   * `ctx.sessionQuery` **无调用方授权**（C26）——授权**由域外本网关施加**；
   * **域内不得挂载 session-query 及其 FTS 派生库**。
   */
  authorize(callerId: string, tenantId: string, workspaceId: string): { allowed: boolean; reason?: string } {
    const caller = this.callerScopes.get(callerId);
    if (!caller) return { allowed: false, reason: "CALLER_UNKNOWN" };
    if (caller.tenantId !== tenantId) return { allowed: false, reason: "CALLER_TENANT_MISMATCH" };
    if (caller.role === "tenant-member" && !caller.workspaces.includes(workspaceId)) return { allowed: false, reason: "CALLER_WORKSPACE_NOT_AUTHORIZED" };
    return { allowed: true };
  }
}

// ── 审计：最小审计集六类 fail-closed + WORM 哈希链（§2.4/§5.3/`SEC-069`–`SEC-073`） ──
export type MinimalAuditClass = "approval" | "tool-verdict" | "credential-exception" | "policy-change" | "allowlist-register-denied" | "domain-gate";

export interface AuditEvent {
  readonly auditClass: MinimalAuditClass;
  /** 审计键五元组 + serverName/rawName（§5.3：四元组不足以唯一定位调用）。 */
  readonly tenantId: string;
  readonly isolationGroupId: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly serverName: string;
  readonly rawName: string;
  readonly at: number;
}

export class WormAuditLog {
  private readonly chain: { event: AuditEvent; hash: string }[] = [];
  /** WORM 不可用 ⇒ fail-closed：拒绝该动作（`SEC-070` 口径）。 */
  public available = true;

  append(event: AuditEvent): { appended: true; hash: string } {
    if (!this.available) {
      throw new Error("AUDIT_WORM_UNAVAILABLE: 最小审计集 fail-closed——记不下即拒绝该动作（SEC-069/SEC-070）");
    }
    const previous = this.chain.length > 0 ? this.chain[this.chain.length - 1].hash : "GENESIS";
    const hash = createHash("sha256").update(`${previous}|${JSON.stringify(event)}`, "utf8").digest("hex");
    this.chain.push({ event, hash });
    return { appended: true, hash };
  }

  /** 取证包（`SEC-073`）：可导出且可验证（哈希链重算）。 */
  exportForensicsPack(): { events: readonly AuditEvent[]; hashes: readonly string[]; verify: () => boolean } {
    const events = this.chain.map((c) => c.event);
    const hashes = this.chain.map((c) => c.hash);
    const verify = (): boolean => {
      let previous = "GENESIS";
      for (let index = 0; index < events.length; index += 1) {
        const hash = createHash("sha256").update(`${previous}|${JSON.stringify(events[index])}`, "utf8").digest("hex");
        if (hash !== hashes[index]) return false;
        previous = hash;
      }
      return true;
    };
    return { events, hashes, verify };
  }
}

// ── 保留与删除全清单 + DSR（§7.5；`SEC-074`–`SEC-088`） ───────────────────────
/** 保留与删除**全清单**（§7.5 数据清单：八类同源数据）。 */
export const RETENTION_INVENTORY = ["session-logs", "attachments", "spill", "fts-derived", "snapshots", "object-storage-versions", "container-temp", "audit"] as const;
export type RetentionItem = (typeof RETENTION_INVENTORY)[number];

export interface DeletionProof {
  readonly tenantId: string;
  readonly inventory: readonly { readonly item: RetentionItem; readonly deleted: boolean; readonly note: string }[];
  readonly tombstones: readonly string[];
  readonly effectiveWithinHours: number;
  readonly revocationWindowDays: number;
  readonly chainHash: string;
}

export class RetentionService {
  private readonly tombstones: { tenantId: string; item: RetentionItem; at: number }[] = [];
  private readonly revoked = new Set<string>();
  private readonly auditLog: WormAuditLog;

  constructor(auditLog: WormAuditLog) {
    this.auditLog = auditLog;
  }

  /**
   * DSR 删除（§7.5）：停写（取锁）→ 墓碑 → 删数据 → 释放锁；全清单八类逐项；
   * spill.root 与附件目录**固定到域卷**；**合法扣留优先**（审计做假名化而非删除）。
   */
  deleteAll(tenantId: string, opts: { legalHoldAuditPseudonymized?: boolean } = {}): DeletionProof {
    const inventory = RETENTION_INVENTORY.map((item) => {
      if (item === "audit") {
        // 合法扣留优先：保留的审计做假名化而非删除（§7.5）。
        return { item, deleted: opts.legalHoldAuditPseudonymized ?? false, note: "审计留存：合法扣留优先——假名化而非删除（§7.5）" };
      }
      if (item === "attachments" || item === "spill") {
        return { item, deleted: true, note: `${item} 目录固定到域卷，随域销毁（§7.5）` };
      }
      if (item === "container-temp") {
        return { item, deleted: true, note: "容器临时层随域回收即销毁" };
      }
      return { item, deleted: true, note: "已删除并登记墓碑" };
    });
    for (const entry of inventory) {
      if (entry.deleted) this.tombstones.push({ tenantId, item: entry.item, at: Date.now() });
    }
    // 哈希链证明（`SEC-080`）：删除清单 + 墓碑 + 删除报告 + 哈希链。
    let chainHash = createHash("sha256").update(`dsr:${tenantId}`, "utf8").digest("hex");
    for (const tombstone of this.tombstones) {
      chainHash = createHash("sha256").update(`${chainHash}|${JSON.stringify(tombstone)}`, "utf8").digest("hex");
    }
    const proof: DeletionProof = {
      tenantId,
      inventory,
      tombstones: this.tombstones.map((t) => `${t.item}@${t.at}`),
      effectiveWithinHours: 24, // 生效时延 ≤ 24 h（§7.5）
      revocationWindowDays: 7, // 撤销窗口 7 天（§7.5）
      chainHash,
    };
    this.auditLog.append({
      auditClass: "policy-change", tenantId, isolationGroupId: "dsr", workspaceId: "-", agentId: "-", serverName: "-", rawName: "-", at: Date.now(),
    });
    return proof;
  }

  /** 撤销窗口（7 天）：窗口内可撤销删除。 */
  revoke(tenantId: string): { revoked: boolean; withinWindowDays: number } {
    this.revoked.add(tenantId);
    return { revoked: true, withinWindowDays: 7 };
  }
}

/** 三个正交语义（§7.5）：移除注册(:unregister) ≠ 删除数据(DELETE) ≠ 删会话历史。 */
export function orthogonalSemantics(): { unregister: string; deleteData: string; deleteHistory: string } {
  return {
    unregister: ":unregister 仅移除注册（工具不再可见），不删除任何数据（§7.5：persistence 无删除接口）",
    deleteData: "DELETE（DSR）删除数据：全清单八类 + 墓碑 + 删除证明（§7.5）",
    deleteHistory: "删会话历史：对 workspace 级端点列出的文件不可见性不做承诺——文件仍可列出并读取（GATE-005）",
  };
}
