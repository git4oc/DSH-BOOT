/**
 * persistence 反转面夹具（`ENG-046` 判据②：单面夹具可单独加载，跑完 A–F）。
 */

export { createDevJsonl, sessionPaths } from "./dev-jsonl.ts";
export type { DevJsonlLog, DevJsonlOptions } from "./dev-jsonl.ts";
export { injectTearTail } from "./tear-tail.ts";
export type { TearTailResult } from "./tear-tail.ts";
export { holdExclusiveLock, secondWriterFails } from "./second-writer.ts";
export type { HoldLockResult } from "./second-writer.ts";
export { driveClosedHandle } from "./closed-handle.ts";
export type { MinimalHandle, ClosedHandleOutcome } from "./closed-handle.ts";
export { probeFreshness } from "./freshness-probe.ts";
export type { FreshnessProbe } from "./freshness-probe.ts";
export { injectForeignFormat, isForeignFormat, FOREIGN_MAGIC } from "./unsupported-format.ts";
export { createUnflushedSession } from "./no-flush-invisibility.ts";
export type { UnflushedSessionResult } from "./no-flush-invisibility.ts";
