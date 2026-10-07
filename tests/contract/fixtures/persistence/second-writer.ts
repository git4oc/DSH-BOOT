/**
 * 夹具 B（`ENG-046`）：锁被占——第二个写者必须失败（`SESSION_ALREADY_OWNED` 条件）。
 * 开发态锁原语为互斥创建的锁文件（`wx`）；P1-B 的实现换绑真实锁原语。
 */

import { openSync, closeSync, unlinkSync } from "node:fs";

export interface HoldLockResult {
  readonly acquired: boolean;
  readonly lockPath: string;
  release(): void;
}

/** 持锁：`wx` 独占创建——同路径第二次调用必须失败（EEXIST）。 */
export function holdExclusiveLock(lockPath: string): HoldLockResult {
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch {
    return { acquired: false, lockPath, release: () => undefined };
  }
  return {
    acquired: true,
    lockPath,
    release() {
      closeSync(fd);
      // 释放 = 移除锁文件（否则同路径无法再次以 `wx` 创建，锁永不释放）。
      try {
        unlinkSync(lockPath);
      } catch {
        // 锁文件已被移除：幂等
      }
    },
  };
}

/** 第二写者：同路径再次持锁必须失败，返回 true 表示锁已被占（`SESSION_ALREADY_OWNED` 条件）。 */
export function secondWriterFails(lockPath: string): boolean {
  const first = holdExclusiveLock(lockPath);
  if (!first.acquired) return false; // 首个写者未持锁，无法构造场景
  try {
    const second = holdExclusiveLock(lockPath); // 同路径：必须失败
    return !second.acquired;
  } finally {
    first.release();
  }
}
