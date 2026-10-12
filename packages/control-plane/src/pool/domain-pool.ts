/**
 * 多租户隔离与域池（`GATE-004`；设计 §4.1/§5.4.1/§9.5/§10.4；`REL-068`；`PRD-043`–`PRD-049`）。
 *
 * - 一 (tenantId, isolationGroupId) 一域，**跨租户永不共享**（D5）；域内按 workspace 分区，
 *   各占独立可写根；**域内读不隔离**（C44）——need-to-know 客户走团队/用户级隔离组。
 * - 域池三态（热/温/零）：冻结前 **flush + 排空缓冲 + 写 suspend 标记**；快照**必须含
 *   投影缓存与未上传缓冲**，否则恢复后用量永久丢失（§10.4）。
 * - workspace 独占租约：fencing epoch，可转移；第二域拒绝 + 审计（`REL-068`）。
 * - 运行期漂移与 connector 生命周期**拆成两类事件**：生命周期变化（预期）→ 不摘域；
 *   Profile 未授权的插件/工具出现（异常）→ 摘域且摘域单独审批。
 * - 冷启动与池排队对用户表现为**等待页而非错误码**（§10.1）。
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── 隔离域归属（§4.1/§4.1.1；D5 跨租户永不共享） ─────────────────────────────
export interface DomainAssignment {
  readonly tenantId: string;
  readonly isolationGroupId: string;
}

/** 隔离组粒度（§4.1.1：need-to-know 客户必须选团队/用户级——域内读不隔离）。 */
export type IsolationGroupGranularity = "tenant" | "tenant-team" | "tenant-user";

/** 域内读不隔离（C44）披露：需要 need-to-know 的客户必须走后两档。 */
export const READ_ISOLATION_DISCLOSURE = "域内按 workspace 分区，各占独立可写根；但 workspace 之间不构成安全边界且读不隔离（C44）——需要 need-to-know 的客户必须选择 (租户, 团队) 或 (租户, 用户) 级隔离组";

export class IsolationDomainRegistry {
  private readonly domains = new Map<string, DomainAssignment>();

  assign(assignment: DomainAssignment): { domainId: string } {
    // ID 格式校验：拒绝 ":" 注入导致 domainId 歧义碰撞（D5 跨租户永不共享的防御前提）。
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(assignment.tenantId) || !/^[A-Za-z0-9_-]{1,64}$/.test(assignment.isolationGroupId)) {
      throw new Error("DOMAIN_ID_INVALID: tenantId/isolationGroupId 须为 [A-Za-z0-9_-]{1,64}（D5 防御）");
    }
    const domainId = `domain:${assignment.tenantId}:${assignment.isolationGroupId}`;
    const existing = this.domains.get(domainId);
    if (existing) {
      if (existing.tenantId !== assignment.tenantId) {
        throw new Error("CROSS_TENANT_SHARE_FORBIDDEN: 跨租户永不共享（D5）");
      }
      return { domainId };
    }
    this.domains.set(domainId, assignment);
    return { domainId };
  }

  /** 跨租户互不可见（`GATE-004` 判据①）：另一租户无法解析到本域。 */
  visibleTenants(domainId: string): readonly string[] {
    const assignment = this.domains.get(domainId);
    return assignment ? [assignment.tenantId] : [];
  }
}

// ── workspace 独占租约（`REL-068`；§5.4.1；fencing epoch） ────────────────────
export interface LeaseRecord {
  readonly workspaceRoot: string;
  readonly domainId: string;
  readonly epoch: number;
  readonly acquiredAt: number;
}

export class WorkspaceLeaseService {
  private readonly leases = new Map<string, LeaseRecord>();
  public readonly audit: { kind: string; workspaceRoot: string; domainId: string }[] = [];

  /** 取得写租约：已持即拒绝（第二域被拒 + 审计；`REL-068` 判据）。 */
  acquire(workspaceRoot: string, domainId: string): LeaseRecord {
    const existing = this.leases.get(workspaceRoot);
    if (existing) {
      this.audit.push({ kind: "workspace.lease.denied", workspaceRoot, domainId });
      throw new Error(`WORKSPACE_LEASE_ALREADY_OWNED: ${workspaceRoot} owned by ${existing.domainId}`);
    }
    const record: LeaseRecord = { workspaceRoot, domainId, epoch: 1, acquiredAt: Date.now() };
    this.leases.set(workspaceRoot, record);
    this.audit.push({ kind: "workspace.lease.acquired", workspaceRoot, domainId });
    return record;
  }

  /** 可转移租约（§5.4.1；`REL-068`）：仅当前持有域可发起转移，epoch +1，源域在提升后的写入被 fencing 拒绝。 */
  transfer(workspaceRoot: string, fromDomainId: string, toDomainId: string): LeaseRecord {
    const existing = this.leases.get(workspaceRoot);
    if (!existing) {
      this.audit.push({ kind: "workspace.lease.transfer.denied", workspaceRoot, domainId: fromDomainId });
      throw new Error(`WORKSPACE_LEASE_NOT_HELD: ${workspaceRoot}`);
    }
    if (existing.domainId !== fromDomainId) {
      // 所有权校验：非当前持有域不得转移（`REL-068` 独占性）。
      this.audit.push({ kind: "workspace.lease.transfer.denied", workspaceRoot, domainId: fromDomainId });
      throw new Error(`WORKSPACE_LEASE_NOT_OWNED: ${workspaceRoot} owned by ${existing.domainId}, transfer denied for ${fromDomainId}`);
    }
    if (fromDomainId === toDomainId) {
      throw new Error(`WORKSPACE_LEASE_TRANSFER_SELF: ${workspaceRoot} 转入与转出域相同`);
    }
    const record: LeaseRecord = { workspaceRoot, domainId: toDomainId, epoch: existing.epoch + 1, acquiredAt: Date.now() };
    this.leases.set(workspaceRoot, record);
    this.audit.push({ kind: "workspace.lease.transferred", workspaceRoot, domainId: toDomainId });
    return record;
  }

  /** fencing：某域的 epoch 落后于当前租约 ⇒ 写被拒。 */
  writeAllowed(workspaceRoot: string, domainId: string, epoch: number): boolean {
    const current = this.leases.get(workspaceRoot);
    return current !== undefined && current.domainId === domainId && current.epoch === epoch;
  }

  /** 释放：仅当前持有域可释放；不匹配/不存在时报错 + 审计（`REL-068`，不静默吞掉）。 */
  release(workspaceRoot: string, domainId: string): void {
    const current = this.leases.get(workspaceRoot);
    if (!current || current.domainId !== domainId) {
      this.audit.push({ kind: "workspace.lease.release.denied", workspaceRoot, domainId });
      throw new Error(`WORKSPACE_LEASE_NOT_OWNED: ${workspaceRoot} not held by ${domainId}`);
    }
    this.leases.delete(workspaceRoot);
    this.audit.push({ kind: "workspace.lease.released", workspaceRoot, domainId });
  }
}

// ── 运行期漂移：两类事件（预期生命周期 vs 异常漂移） ─────────────────────────
export type DriftEventClass = "connector-lifecycle" | "unauthorized-drift";

export interface DriftOutcome {
  readonly eventClass: DriftEventClass;
  readonly evictDomain: boolean;
  readonly requiresSeparateApproval: boolean;
  readonly toolUnavailable: boolean;
  readonly autoReload: boolean;
  readonly alert: boolean;
}

/** 漂移分类（`SEC-018`）：**先验归属**——Profile 未授权的插件/工具/connector（无论事件类型）一律
 *  异常漂移，摘域且单独审批；已授权的 connector 生命周期变化（预期）不摘域。 */
export function classifyDrift(observed: { kind: string; name: string; authorized: boolean }): DriftOutcome {
  if (!observed.authorized) {
    return { eventClass: "unauthorized-drift", evictDomain: true, requiresSeparateApproval: true, toolUnavailable: true, autoReload: false, alert: true };
  }
  if (observed.kind === "connector-lifecycle") {
    return { eventClass: "connector-lifecycle", evictDomain: false, requiresSeparateApproval: false, toolUnavailable: true, autoReload: true, alert: true };
  }
  return { eventClass: "connector-lifecycle", evictDomain: false, requiresSeparateApproval: false, toolUnavailable: false, autoReload: false, alert: false };
}

// ── 容器网络策略（§4.1 网络：默认拒绝入站；出站白名单） ─────────────────────
export class NetworkPolicy {
  private readonly egressAllowlist: readonly string[];

  constructor(egressAllowlist: readonly string[]) {
    this.egressAllowlist = egressAllowlist;
  }

  inbound(): { allowed: false; reason: string } {
    return { allowed: false, reason: "默认拒绝入站（§4.1：容器网络策略承担）" };
  }

  egress(target: string): { allowed: boolean; reason?: string } {
    const allowed = this.egressAllowlist.some((entry) => target === entry || target.startsWith(`${entry}/`) || target.endsWith(`.${entry}`));
    return allowed ? { allowed: true } : { allowed: false, reason: `出站白名单外：${target}` };
  }
}

// ── 域池三态（§10.4：热/温/零；冻结前置条件 + 快照完整性） ───────────────────
export type DomainState = "hot" | "warm" | "zero";

export interface DomainSnapshot {
  readonly domainId: string;
  readonly state: DomainState;
  readonly suspendMarker: boolean;
  readonly projectionCache: { readonly [key: string]: unknown };
  readonly pendingUploadBuffer: readonly { readonly [key: string]: unknown }[];
  readonly flushed: boolean;
  readonly buffersDrained: boolean;
}

export class DomainPool {
  private readonly states = new Map<string, DomainState>();
  private readonly snapshots = new Map<string, DomainSnapshot>();
  private readonly queue: { domainId: string; resolve: (result: { waitingPage: boolean; state: DomainState }) => void }[] = [];
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  current(domainId: string): DomainState {
    return this.states.get(domainId) ?? "hot";
  }

  /**
   * 冻结前置条件（§10.4）：**flush + 排空缓冲 + 写 suspend 标记**；
   * 快照**必须含投影缓存与未上传缓冲**——否则恢复后用量永久丢失。
   */
  freeze(domainId: string, input: { flush: () => void; drainBuffers: () => readonly { readonly [key: string]: unknown }[]; projectionCache: { readonly [key: string]: unknown } }): DomainSnapshot {
    input.flush();
    const pendingUpload = input.drainBuffers();
    mkdirSync(this.root, { recursive: true });
    const markerPath = join(this.root, `${domainId}.suspend.json`);
    writeFileSync(markerPath, JSON.stringify({ domainId, suspended: true, at: new Date().toISOString() }, null, 2) + "\n", "utf8");
    const snapshot: DomainSnapshot = {
      domainId,
      state: "warm",
      suspendMarker: true,
      projectionCache: input.projectionCache,
      pendingUploadBuffer: pendingUpload,
      flushed: true,
      buffersDrained: true,
    };
    this.snapshots.set(domainId, snapshot);
    writeFileSync(join(this.root, `${domainId}.snapshot.json`), JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    this.states.set(domainId, "warm");
    return snapshot;
  }

  /** 快照完整性：不含投影缓存或未上传缓冲的快照被拒绝（用量会永久丢失）。 */
  private static assertComplete(snapshot: DomainSnapshot): void {
    if (!snapshot.suspendMarker || !snapshot.flushed || !snapshot.buffersDrained) {
      throw new Error("DOMAIN_SNAPSHOT_INCOMPLETE: 冻结前置条件不满足（flush + 排空缓冲 + suspend 标记）");
    }
    if (snapshot.projectionCache === undefined || snapshot.pendingUploadBuffer === undefined) {
      throw new Error("DOMAIN_SNAPSHOT_INCOMPLETE: 快照必须含投影缓存与未上传缓冲（否则用量永久丢失）");
    }
  }

  /** 恢复：温→热（快照完整 + suspend 标记在）。 */
  restore(domainId: string): { restored: true; projectionCache: { readonly [key: string]: unknown }; pendingUploadBuffer: readonly { readonly [key: string]: unknown }[] } {
    const snapshot = this.snapshots.get(domainId) ?? this.readSnapshotFromDisk(domainId);
    DomainPool.assertComplete(snapshot);
    if (!existsSync(join(this.root, `${domainId}.suspend.json`))) {
      throw new Error("DOMAIN_SNAPSHOT_SUSPEND_MARKER_MISSING");
    }
    this.states.set(domainId, "hot");
    return { restored: true, projectionCache: snapshot.projectionCache, pendingUploadBuffer: snapshot.pendingUploadBuffer };
  }

  private readSnapshotFromDisk(domainId: string): DomainSnapshot {
    return JSON.parse(readFileSync(join(this.root, `${domainId}.snapshot.json`), "utf8")) as DomainSnapshot;
  }

  /** 冷启动降级（§10.1）：池空按需创建，前端显示**等待页**（非错误码）；已热域诚实返回 waitingPage:false。 */
  async coldStart(domainId: string): Promise<{ waitingPage: boolean; state: DomainState }> {
    if (this.states.get(domainId) === "hot") {
      // 已热：无需等待页（诚实语义，§10.1）。
      return { waitingPage: false, state: "hot" };
    }
    this.states.set(domainId, "zero");
    // 池空：排队并在域就绪后返回等待页语义（不抛错码）。
    return new Promise((resolve) => {
      this.queue.push({ domainId, resolve: (result) => resolve(result) });
      // 域池预热完成（同步模拟）：回热态并只解锁**本域**的排队。
      this.states.set(domainId, "hot");
      const pending: { domainId: string; resolve: (result: { waitingPage: boolean; state: DomainState }) => void }[] = [];
      const remaining: { domainId: string; resolve: (result: { waitingPage: boolean; state: DomainState }) => void }[] = [];
      for (const item of this.queue) {
        (item.domainId === domainId ? pending : remaining).push(item);
      }
      this.queue.length = 0;
      this.queue.push(...remaining);
      for (const item of pending) item.resolve({ waitingPage: true, state: "hot" });
    });
  }
}
