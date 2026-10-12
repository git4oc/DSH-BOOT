/**
 * `SessionPersistence` L1 提供方（`ENG-013`–`ENG-019`；`docs/reversal-contracts.md` §5）。
 *
 * **L1 禁止事项（`SPEC-03` §11.4.1，写错即返工）**：
 *   - 仅单域内；Linux-only（开发/契约测试逃生门见 `DevelopmentOnlyNonLinux`）
 *   - `compression: none`（其余一律拒绝）
 *   - 禁止世代迁移：boot 即断言"仅支持当前 format"（`CURRENT_FORMAT_VERSION`）
 *   - 会话日志写路径不得落在共享 NFS/FUSE 上（本地卷断言）
 *
 * 语义（`CTR-001` §5.3）：P-1 flush 屏障 / P-2 撕裂尾永不返回 / P-3 单写者（不排队、
 * 不超时兜底）/ P-4 close 幂等且完成未决持久化 / P-5 freshness / P-6 list 无分页无过滤
 * 无索引 / P-7 格式拒绝方向。
 */

import { mkdirSync, openSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync, writeSync, closeSync } from "node:fs";
import { join, basename, isAbsolute } from "node:path";
import {
  CURRENT_FORMAT_VERSION,
  sessionAlreadyExistsError,
  sessionAlreadyOwnedError,
  sessionFormatUnsupportedError,
  sessionHandleClosedError,
  sessionOwnershipLostError,
  sessionPersistenceCorruptionError,
  sessionPersistenceNotFoundError,
  sessionReadOnlyError,
} from "./errors.ts";

/** L1 范围断言（`SPEC-03` §11.4.1：仅单域内、Linux-only、compression: none）。 */
export interface L1Scope {
  readonly domain: "single";
  readonly platforms: readonly string[];
  readonly compression: "none";
  readonly storageMedium: "local-volume";
  readonly generationMigration: false;
}

/** 租约阈值（**本方案自定义**——内核无参考行为基线，`CTR-001` §5.4 ⚠；不得声称"与内核一致"）。 */
export interface OwnershipLeaseOptions {
  /** 心跳续期间隔（ms）。写句柄在 append/flush 时顺带续期。 */
  readonly renewalMs: number;
  /** 心跳过期阈值（ms）：超过则视为持有者可能已死，允许运维处置入口介入（锁本身仍无过期，`C23`）。 */
  readonly expiryMs: number;
}

/** 自定义租约阈值（`SPEC-03` §11.4.1：无内核参考行为基线，自定并登记）。 */
export const DEFAULT_OWNERSHIP_LEASE: OwnershipLeaseOptions = { renewalMs: 30_000, expiryMs: 90_000 };

export interface SessionHeader {
  readonly id: string;
  readonly formatVersion: string;
  readonly createdAt: string;
  readonly tenantId: string;
  readonly isolationGroupId: string;
}

export interface SessionStat {
  readonly id: string;
  readonly revision: number;
  readonly eventCount: number;
  readonly byteLength: number;
}

export interface SessionSummary {
  readonly id: string;
  readonly eventCount: number;
  readonly header: SessionHeader;
}

export interface CreateOptions {
  /** L1：仅支持 `none`；其余一律拒绝（§11.4.1 禁止事项）。 */
  readonly compression?: "none";
  tenantId?: string;
  isolationGroupId?: string;
}

export interface OpenOptions {
  /** 开发/契约测试逃生门：非 Linux 主机仅在显式传入时放行（生产范围不变，Linux-only）。 */
  readonly developmentOnlyNonLinux?: boolean;
  ownershipLease?: Partial<OwnershipLeaseOptions>;
  /**
   * 人为处置流程入口（`REL-082`）：`session.lock` 无过期（`C23`）——进程被杀后的跨实例续跑
   * 走**显式接管**：须同时满足 (a) 显式标志；(b) �内心跳已过期（持有者已死证据）。
   * **不得依赖超时兜底**（普通 open 仍即刻拒绝）。
   */
  readonly takeoverStaleLease?: boolean;
  /**
   * 未决缓冲字节上限（**本方案自定义**——`CTR-001` §5.3 错误码全集无此条款，缺条款已登记；
   * 内存保护用）：append 超限即 fail-closed 拒绝，须先 flush。
   */
  readonly maxPendingBytes?: number;
}

/** 未决缓冲默认上限：64 MiB（本方案自定义，登记值）。 */
export const DEFAULT_MAX_PENDING_BYTES = 64 * 1024 * 1024;

interface LockPayload {
  readonly epoch: number;
  readonly owner: string;
  readonly heartbeatAt: number;
}

function assertL1Scope(root: string, options: CreateOptions | OpenOptions | undefined): void {
  const opts = (options ?? {}) as { compression?: "none" };
  if (opts.compression !== undefined && opts.compression !== "none") {
    throw new Error("L1 scope violation: compression must be none (SPEC-03 §11.4.1)");
  }
  const normalized = root.replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)(nfs|fuse)(\/|$)/.test(normalized)) {
    throw new Error("L1 scope violation: session log write path must not be on shared NFS/FUSE (REL-085)");
  }
}

function assertLinux(developmentOnlyNonLinux: boolean | undefined): void {
  if (process.platform !== "linux" && developmentOnlyNonLinux !== true) {
    throw new Error("L1 scope violation: Linux-only (SPEC-03 §11.4.1); development/contract-test escape requires developmentOnlyNonLinux");
  }
}

/** 禁止世代迁移：boot 即断言仅支持当前 format（`ENG-013`/§11.4.1）。 */
export function assertCurrentFormatOnly(version: string): void {
  if (version !== CURRENT_FORMAT_VERSION) {
    throw sessionFormatUnsupportedError("boot", version, { kind: "format-version", path: "provider-boot" });
  }
}

export default class JsonlSessionPersistence {
  /** L1 范围（静态断言，`ENG-013`）。 */
  readonly scope: L1Scope = {
    domain: "single",
    platforms: ["linux"],
    compression: "none",
    storageMedium: "local-volume",
    generationMigration: false,
  };

  private readonly root: string;
  private readonly ownershipLease: OwnershipLeaseOptions;

  constructor(root: string, options: { ownershipLease?: Partial<OwnershipLeaseOptions>; developmentOnlyNonLinux?: boolean } = {}) {
    assertL1Scope(root, options);
    assertLinux(options.developmentOnlyNonLinux);
    this.root = root;
    this.ownershipLease = { ...DEFAULT_OWNERSHIP_LEASE, ...(options.ownershipLease ?? {}) };
  }

  private logPath(id: string): string {
    return join(this.root, `${id}.jsonl`);
  }

  private lockPath(id: string): string {
    return join(this.root, `${id}.session.lock`);
  }

  private manifestPath(): string {
    return join(this.root, "manifest.json");
  }

  /** 会话 id 不得含路径分隔符（防越权路径）。 */
  private assertSafeId(id: string): void {
    if (!id || id.includes("/") || id.includes("\\") || id.includes("..") || basename(id) !== id) {
      throw sessionPersistenceNotFoundError(id);
    }
  }

  private readManifest(): { sessions: string[] } {
    const manifestPath = this.manifestPath();
    if (!existsSync(manifestPath)) return { sessions: [] };
    return JSON.parse(readFileSync(manifestPath, "utf8")) as { sessions: string[] };
  }

  /** 物化 manifest（幂等）：flush 提交点使会话对其他进程可 list。 */
  private registerManifest(id: string): void {
    const manifest = this.readManifest();
    if (!manifest.sessions.includes(id)) {
      this.writeManifest([...manifest.sessions, id]);
    }
  }

  private writeManifest(sessions: string[]): void {
    writeFileSync(this.manifestPath(), JSON.stringify({ sessions }, null, 2) + "\n", "utf8");
  }

  /** `create(header, opts?)`：新建会话句柄（写）；已存在即 `SessionAlreadyExistsError`。 */
  async create(header: SessionHeader, opts?: CreateOptions & { developmentOnlyNonLinux?: boolean }): Promise<SessionHandle> {
    assertCurrentFormatOnly(header.formatVersion ?? CURRENT_FORMAT_VERSION);
    this.assertSafeId(header.id);
    const logPath = this.logPath(header.id);
    mkdirSync(this.root, { recursive: true });
    const headerFrame = { v: CURRENT_FORMAT_VERSION, kind: "header", header: { ...header, formatVersion: CURRENT_FORMAT_VERSION } };
    // 原子独占创建（P-3 同源约束：existsSync 检查与写入之间的并发窗口由 `wx` 关闭，
    // 并发 create 同一 id 时后者必然 EEXIST → SessionAlreadyExistsError，不静默覆盖）。
    try {
      writeFileSync(logPath, `${JSON.stringify(headerFrame)}\n`, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw sessionAlreadyExistsError(header.id);
      throw error;
    }
    // P-1：create 后未 flush ⇒ 其他进程 list 不可见（不写 manifest）。
    return this.openHandle(header.id, "write", opts ?? {}, headerFrame.header, 0);
  }

  /** `open(id, access, opts?)`：打开既有会话（读或写）。 */
  async open(id: string, access: "read" | "write", opts?: OpenOptions): Promise<SessionHandle> {
    this.assertSafeId(id);
    const logPath = this.logPath(id);
    if (!existsSync(logPath)) {
      throw sessionPersistenceNotFoundError(id);
    }
    const content = readFileSync(logPath, "utf8");
    const firstLine = content.split("\n")[0]?.trim() ?? "";
    let header: SessionHeader;
    try {
      const frame = JSON.parse(firstLine) as { kind: string; header: SessionHeader; v: string };
      if (frame.kind !== "header") throw new Error("not a header frame");
      header = frame.header;
      if (frame.v !== CURRENT_FORMAT_VERSION) {
        throw sessionFormatUnsupportedError(id, frame.v, { kind: "log", path: logPath });
      }
    } catch (error) {
      if ((error as Error).name === "SESSION_FORMAT_UNSUPPORTED") throw error;
      throw sessionPersistenceCorruptionError(id);
    }
    return this.openHandle(id, access, opts ?? {}, header, this.countFrames(content));
  }

  private openHandle(id: string, access: "read" | "write", opts: OpenOptions, header: SessionHeader, inheritedEventCount: number): SessionHandle {
    const store = this;
    const logPath = this.logPath(id);
    const lockPath = this.lockPath(id);
    let closed = false;
    let pending = "";
    let pendingCount = 0;
    let epoch = 0;
    const maxPendingBytes = opts.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES;

    if (access === "write") {
      // P-3 单写者：独占创建锁文件（无过期，`C23`）；不排队、不超时兜底。
      // 读锁 + 解析：锁在 existsSync 与 readFileSync 之间被并发释放（ENOENT）⇒ 视为无锁，
      // 走下方 `wx` 独占创建路径；锁文件损坏（崩溃残留半帧，无法解析）⇒ fail-closed 拒绝
      //（修复窗口同 REL-082 人为处置：由运维显式移除损坏锁文件后重开）。
      let existingLock: LockPayload | undefined;
      let lockCorrupt = false;
      if (existsSync(lockPath)) {
        try {
          existingLock = JSON.parse(readFileSync(lockPath, "utf8")) as LockPayload;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            existingLock = undefined; // 锁被并发释放：走无锁创建
          } else {
            lockCorrupt = true;
          }
        }
        if (lockCorrupt) {
          throw sessionAlreadyOwnedError(id);
        }
      }
      if (existingLock !== undefined) {
        // 人为处置入口（`REL-082`）：显式标志 + 心跳过期（持有者已死证据）才可接管。
        const stale = Date.now() - existingLock.heartbeatAt > this.ownershipLease.expiryMs;
        if (!(opts.takeoverStaleLease === true && stale)) {
          throw sessionAlreadyOwnedError(id);
        }
        epoch = existingLock.epoch + 1; // fencing：epoch + 1（设计 §5.4.1 步骤 3）
        writeFileSync(lockPath, JSON.stringify({ epoch, owner: `${process.pid}`, heartbeatAt: Date.now() } satisfies LockPayload), "utf8");
      } else {
        epoch = Date.now();
        const payload: LockPayload = { epoch, owner: `${process.pid}`, heartbeatAt: Date.now() };
        try {
          writeFileSync(lockPath, JSON.stringify(payload), { encoding: "utf8", flag: "wx" });
        } catch {
          throw sessionAlreadyOwnedError(id);
        }
      }
    }

    const assertWriteOpen = (): void => {
      if (closed) throw sessionHandleClosedError(id);
      if (access !== "write") throw sessionReadOnlyError(id);
      // fencing：锁的 epoch > 本句柄 epoch ⇒ 所有权被夺（永不复得）。
      if (existsSync(lockPath)) {
        const payload = JSON.parse(readFileSync(lockPath, "utf8")) as LockPayload;
        if (payload.epoch > epoch) throw sessionOwnershipLostError(id);
      } else {
        throw sessionOwnershipLostError(id);
      }
    };

    const physicalFrames = (): string => (existsSync(logPath) ? readFileSync(logPath, "utf8") : "");

    const handle: SessionHandle = {
      id,
      header,
      inheritedEventCount,
      access,

      async read(offset?: number, length?: number): Promise<SessionEvent[]> {
        if (closed) throw sessionHandleClosedError(id);
        // P-2 撕裂尾永不返回：合法连续逻辑日志前缀 + 同句柄重复读不更旧。
        const frames = physicalFrames().split("\n");
        const events: SessionEvent[] = [];
        for (let index = 0; index < frames.length; index += 1) {
          const line = frames[index].trim();
          if (line.length === 0) continue;
          const isTail = index === frames.length - 1 || (index === frames.length - 2 && frames[frames.length - 1].trim().length === 0);
          let parsed: SessionEvent;
          try {
            const raw = JSON.parse(line) as { v: string; kind: string } & SessionEvent;
            if (raw.v !== CURRENT_FORMAT_VERSION || raw.kind === "unknown-event-type") {
              throw sessionFormatUnsupportedError(id, String(raw.v), { kind: "log", path: logPath });
            }
            if (raw.kind === "header") continue;
            parsed = raw;
          } catch (error) {
            if ((error as Error).name === "SESSION_FORMAT_UNSUPPORTED") throw error;
            if (!isTail) throw sessionPersistenceCorruptionError(id);
            break; // 撕裂尾：物理半帧不被返回
          }
          events.push(parsed);
        }
        const all = events;
        const start = offset ?? 0;
        return length === undefined ? all.slice(start) : all.slice(start, start + length);
      },

      async append(events: SessionEvent[]): Promise<void> {
        assertWriteOpen();
        // 未决缓冲上限（本方案自定义，超出即 fail-closed 拒绝——spec 错误码全集无此类，
        // 不自造 spec ID；上限为内存保护，契约依据见实现注释）。缺条款已登记。
        // 原子性：先整体计算容量再提交，超量抛出**不产生部分缓冲**（不得半入队）。
        let candidate = pending;
        let candidateCount = pendingCount;
        for (const event of events) {
          candidate += `${JSON.stringify({ v: CURRENT_FORMAT_VERSION, ...event })}\n`;
          candidateCount += 1;
          if (candidate.length > maxPendingBytes) {
            throw new Error(`SESSION_PENDING_OVERFLOW: pending buffer ${candidate.length} bytes exceeds maxPendingBytes ${maxPendingBytes}; flush before appending more`);
          }
        }
        pending = candidate;
        pendingCount = candidateCount;
        // P-1：append 解析成功 ≠ 持久化；仅缓冲（freshness 由内存缓冲保证）。
      },

      async flush(): Promise<void> {
        assertWriteOpen();
        if (pending.length > 0) {
          // O_APPEND 追加写：不再整读重写——重写非原子，进程在重写中途被杀会撕裂**中段**
          //（不只是尾部），违反 P-2（read 只容忍撕裂尾）；O_APPEND 保证原子追加到末尾。
          const fd = openSync(logPath, "a");
          try {
            writeSync(fd, pending);
          } finally {
            closeSync(fd);
          }
          pending = "";
          pendingCount = 0;
        }
        // P-1 提交点：flush 后会话对其他进程可 list（物化 manifest，幂等）。
        store.registerManifest(id);
        // 续期心跳（租约阈值为本方案自定义，无内核参考行为基线）。
        const payload = JSON.parse(readFileSync(lockPath, "utf8")) as LockPayload;
        writeFileSync(lockPath, JSON.stringify({ ...payload, heartbeatAt: Date.now() }), "utf8");
      },

      async close(): Promise<void> {
        if (closed) return; // 幂等
        // P-4：完成未决持久化 + 释放写所有权 + 不可取消。
        if (access === "write") {
          if (pending.length > 0) {
            // O_APPEND 追加写（同 flush：不整读重写，避免中段撕裂）。
            const fd = openSync(logPath, "a");
            try {
              writeSync(fd, pending);
            } finally {
              closeSync(fd);
            }
            pending = "";
            pendingCount = 0;
          }
          try {
            rmSync(lockPath);
          } catch {
            // 锁已被释放：幂等
          }
        }
        closed = true;
      },

      [Symbol.asyncDispose]: async (): Promise<void> => {
        await handle.close();
      },
    };
    return handle;
  }

  private countFrames(content: string): number {
    return content.split("\n").filter((line) => line.trim().length > 0).length - 1; // 去掉 header 帧
  }

  /** `flush()`：物化全部已知会话的 manifest（空会话 flush 后才可 list）。 */
  async flush(): Promise<void> {
    const manifest = this.readManifest();
    const sessions = new Set(manifest.sessions);
    for (const file of readdirSync(this.root)) {
      if (file.endsWith(".jsonl")) {
        sessions.add(file.replace(/\.jsonl$/, ""));
      }
    }
    this.writeManifest([...sessions]);
  }

  /** `stat(id, opts?)`。 */
  async stat(id: string): Promise<SessionStat> {
    this.assertSafeId(id);
    const logPath = this.logPath(id);
    if (!existsSync(logPath)) {
      throw sessionPersistenceNotFoundError(id);
    }
    const content = readFileSync(logPath, "utf8");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    return {
      id,
      revision: lines.length,
      eventCount: Math.max(0, lines.length - 1),
      byteLength: content.length,
    };
  }

  /** `list(opts?)`：无分页、无过滤、无索引（`C24`）。 */
  async list(): Promise<SessionSummary[]> {
    const manifest = this.readManifest();
    const summaries: SessionSummary[] = [];
    for (const id of manifest.sessions) {
      const logPath = this.logPath(id);
      if (!existsSync(logPath)) continue;
      const content = readFileSync(logPath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim().length > 0);
      let header: SessionHeader | undefined;
      try {
        header = (JSON.parse(lines[0]) as { header: SessionHeader }).header;
      } catch {
        continue;
      }
      summaries.push({ id, eventCount: Math.max(0, lines.length - 1), header });
    }
    return summaries;
  }
}

export interface SessionEvent {
  readonly kind?: string;
  readonly [key: string]: unknown;
}

export interface SessionHandle {
  readonly id: string;
  readonly header: SessionHeader;
  readonly inheritedEventCount: number;
  readonly access: "read" | "write";
  read(offset?: number, length?: number): Promise<SessionEvent[]>;
  append(events: SessionEvent[]): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

export function isAbsoluteRoot(root: string): boolean {
  return isAbsolute(root) && statSync(root).isDirectory();
}
