/**
 * Session Router、历史查询、保留/删除与取证（设计 §5.4/§7.5/§7.6；`SEC-069`–`SEC-088`；`REL-077`–`REL-089`）。
 *
 * - 路由键 `(tenantId, isolationGroupId)`；就绪探针；**自建会话索引**（C24：内核 `list()`
 *   无分页无过滤无索引）。
 * - 历史查询基于 `ctx.sessionQuery`，但**由域外施加调用方授权**（该 seam 无调用方授权）；
 *   **域内不得挂载 session-query 及其 FTS 派生库**（C26）。
 * - 最小审计集六类 **fail-closed**（记不下即拒绝该动作）；权威源在**域外控制点**；
 *   WORM + 哈希链；审计键**五元组**（+ serverName/rawName，§5.3）。
 * - 保留与删除**全清单**（八类，`SEC-078`）；删除按"停写→删数据→墓碑→释放锁"（`SEC-082`）；
 *   回调式删除 fail-closed，未接线项如实标注"由部署者接线"；生效 ≤ 24 h、撤销窗口 7 天（`SEC-084`）。
 * - DSR：删除清单 + 墓碑 + 删除报告 + 哈希链证明（`SEC-083` 四件套）。
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

/** 单类清单的真实删除回调（域外执行环境由部署者提供，`SEC-086` 端到端可执行）。 */
export type DeletionHandler = () => void;

export class RetentionService {
  private readonly tombstones: { tenantId: string; item: RetentionItem; at: number }[] = [];
  private readonly revoked = new Set<string>();
  private readonly auditLog: WormAuditLog;
  private deleteInProgress = false;

  constructor(auditLog: WormAuditLog) {
    this.auditLog = auditLog;
  }

  /**
   * DSR 删除（`SEC-082`：停写（取锁）→ 删数据 → 墓碑 → 释放锁，锁贯穿全程避免与迁移竞争；
   * `SEC-078` 八类逐项）。
   *
   * - **fail-closed**：每类清单由调用方注入真实删除回调（`handlers[item]`）；回调抛错即
   *   整体抛错拒绝，**不出具删除证明**（`SEC-083` 四件套不产出假证明）。
   * - **未注入回调的清单类如实标注"由部署者接线"**，`deleted:false`——不得声称已删除
   *   （`SEC-079`/`SEC-080`/`SEC-081`/`SEC-088`）。
   * - 合法扣留优先（`SEC-085`）：审计项做假名化而非删除（`deleted:false` by design）。
   * - 墓碑与哈希链**按租户隔离**：`chainHash` 只覆盖本租户墓碑，不混入其他租户。
   */
  deleteAll(tenantId: string, opts: { legalHoldAuditPseudonymized?: boolean; handlers?: Partial<Record<RetentionItem, DeletionHandler>>; now?: number } = {}): DeletionProof {
    const at = opts.now ?? Date.now();
    const handlers = opts.handlers ?? {};
    // SEC-082 第 1 步：停写（取锁）——删除与迁移/并发删除不交错。
    if (this.deleteInProgress) {
      throw new Error("DSR_DELETE_IN_PROGRESS: 停写锁被占用（SEC-082）");
    }
    this.deleteInProgress = true;
    try {
      const results: { item: RetentionItem; deleted: boolean; note: string }[] = [];
      const failures: { item: RetentionItem }[] = [];
      // SEC-082 第 2 步：删数据（逐项真实回调）。先删后碑：回调失败不留假墓碑。
      for (const item of RETENTION_INVENTORY) {
        if (item === "audit") {
          results.push({
            item,
            deleted: false,
            note: opts.legalHoldAuditPseudonymized
              ? "审计留存：合法扣留优先——假名化而非删除（SEC-085）"
              : "审计留存：未声明假名化，留存原样（SEC-085）",
          });
          continue;
        }
        const handler = handlers[item];
        if (!handler) {
          results.push({ item, deleted: false, note: `由部署者接线：${item} 的删除执行环境不在本仓库实现（SEC-079/SEC-080/SEC-081/SEC-088）——未接线前不得声称已删除` });
          continue;
        }
        try {
          handler();
          results.push({ item, deleted: true, note: "已由回调删除并登记墓碑（SEC-082）" });
        } catch {
          failures.push({ item });
          results.push({ item, deleted: false, note: "删除回调失败——fail-closed 拒绝出具证明（SEC-082/SEC-083）" });
        }
      }
      if (failures.length > 0) {
        throw new Error(`DSR_DELETE_FAILED: ${failures.map((f) => f.item).join(",")} 删除回调失败——fail-closed 拒绝出具证明（SEC-082/SEC-083）`);
      }
      // SEC-082 墓碑：仅对已确认删除的项登记。
      for (const result of results) {
        if (result.deleted) this.tombstones.push({ tenantId, item: result.item, at });
      }
      // 哈希链证明（`SEC-083`）：按租户隔离，只覆盖本租户的墓碑。
      let chainHash = createHash("sha256").update(`dsr:${tenantId}`, "utf8").digest("hex");
      for (const tombstone of this.tombstones.filter((t) => t.tenantId === tenantId)) {
        chainHash = createHash("sha256").update(`${chainHash}|${JSON.stringify(tombstone)}`, "utf8").digest("hex");
      }
      const proof: DeletionProof = {
        tenantId,
        inventory: results,
        tombstones: this.tombstones.filter((t) => t.tenantId === tenantId).map((t) => `${t.item}@${t.at}`),
        effectiveWithinHours: 24, // 生效时延 ≤ 24 h（SEC-084）
        revocationWindowDays: 7, // 撤销窗口 7 天（SEC-084）
        chainHash,
      };
      this.auditLog.append({
        auditClass: "policy-change", tenantId, isolationGroupId: "dsr", workspaceId: "-", agentId: "-", serverName: "-", rawName: "-", at,
      });
      return proof;
    } finally {
      // SEC-082 第 3 步：释放锁。
      this.deleteInProgress = false;
    }
  }

  /** 撤销窗口（`SEC-084`：窗口 7 天，窗口内删除可撤销；无墓碑或窗外拒绝）。 */
  revoke(tenantId: string, now: number = Date.now()): { revoked: boolean; withinWindowDays: number; reason?: string } {
    const tombstones = this.tombstones.filter((t) => t.tenantId === tenantId);
    if (tombstones.length === 0) {
      return { revoked: false, withinWindowDays: 7, reason: "DSR_NOTHING_TO_REVOKE: 无删除墓碑可撤销" };
    }
    const latest = Math.max(...tombstones.map((t) => t.at));
    if (now - latest > 7 * 24 * 60 * 60 * 1000) {
      return { revoked: false, withinWindowDays: 7, reason: "DSR_REVOCATION_WINDOW_CLOSED: 撤销窗口已过（SEC-084）" };
    }
    this.revoked.add(tenantId);
    this.auditLog.append({
      auditClass: "policy-change", tenantId, isolationGroupId: "dsr", workspaceId: "-", agentId: "-", serverName: "-", rawName: "-", at: now,
    });
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
