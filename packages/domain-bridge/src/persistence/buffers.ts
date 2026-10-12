/**
 * 软事件分缓冲与墓碑（设计 §5.2/§7.6；`docs/reliability/buffer-and-tombstone.md`）。
 *
 * - 计费与审计各自**独立判定级别**（审计 = 硬、计费 = 软），互不共享容量。
 * - 按时间定容（`bufferSeconds`）+ 条目上限；超限走**有界丢弃 + 墓碑（`reconciled: false`）**
 *   + 硬告警；**绝不阻断执行**（不拒绝新写入，不抛错）。
 */

export type BufferLevel = "audit" | "billing";

export interface BufferEntry {
  readonly tenantId: string;
  readonly turnId: string;
  readonly payload: { readonly [key: string]: unknown };
  readonly enqueuedAt: number;
}

export interface Tombstone {
  readonly kind: "buffer.dropped";
  readonly level: BufferLevel;
  readonly tenantId: string;
  readonly dropped: number;
  readonly reconciled: false;
  readonly at: number;
}

export interface SplitBufferOptions {
  readonly level: BufferLevel;
  /** 按时间定容：条目在缓冲内的最长停留（ms）。 */
  readonly bufferSeconds: number;
  /** 条目上限；超限有界丢弃（最旧优先）。 */
  readonly maxEntries: number;
  /** 硬告警出口（审计级丢弃必告警）。 */
  onAlert?: (tombstone: Tombstone) => void;
}

export class SplitBuffer {
  private readonly queue: BufferEntry[] = [];
  private readonly tombstones: Tombstone[] = [];
  private readonly onAlert?: (tombstone: Tombstone) => void;
  private readonly options: SplitBufferOptions;

  constructor(options: SplitBufferOptions) {
    this.options = options;
    this.onAlert = options.onAlert;
  }

  /** 入队：**绝不阻断执行**——超限走有界丢弃 + 墓碑 + 硬告警，不拒绝、不抛错。 */
  enqueue(tenantId: string, turnId: string, payload: { readonly [key: string]: unknown }): void {
    const now = Date.now();
    this.queue.push({ tenantId, turnId, payload, enqueuedAt: now });
    this.evictExpired(now);
    while (this.queue.length > this.options.maxEntries) {
      this.queue.shift(); // 有界丢弃：最旧优先
      const tombstone: Tombstone = {
        kind: "buffer.dropped",
        level: this.options.level,
        tenantId,
        dropped: 1,
        reconciled: false,
        at: now,
      };
      this.tombstones.push(tombstone);
      this.onAlert?.(tombstone);
    }
  }

  /** 出队全部（上传/落库时调用）。 */
  drain(): readonly BufferEntry[] {
    this.evictExpired(Date.now());
    return this.queue.splice(0, this.queue.length);
  }

  /** 墓碑清单（对账输入：`reconciled: false` 的丢弃段）。 */
  getTombstones(): readonly Tombstone[] {
    return this.tombstones;
  }

  private evictExpired(now: number): void {
    const cutoff = now - this.options.bufferSeconds * 1000;
    while (this.queue.length > 0 && this.queue[0].enqueuedAt < cutoff) {
      // 墓碑归属被驱逐条目**自身**的租户（先取后删，不得错位到下一条）
      const evicted = this.queue.shift()!;
      const tombstone: Tombstone = {
        kind: "buffer.dropped",
        level: this.options.level,
        tenantId: evicted.tenantId,
        dropped: 1,
        reconciled: false,
        at: now,
      };
      this.tombstones.push(tombstone);
      this.onAlert?.(tombstone);
    }
  }
}
