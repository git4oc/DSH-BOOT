/**
 * 夹具 F（`ENG-046`）：空会话不 flush 的不可见性——会话在 `flush` 后才对其他进程可 `list`。
 * 注入器写数据文件但不写 manifest（list 视图的真源），返回可见性探测。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createDevJsonl } from "./dev-jsonl.ts";

export interface UnflushedSessionResult {
  readonly sessionId: string;
  /** manifest 视图中的会话集合（未 flush ⇒ 不含本会话）。 */
  listed(): readonly string[];
  /** 执行 flush 后 manifest 包含本会话。 */
  flush(): void;
}

export function createUnflushedSession(dir: string, sessionId: string): UnflushedSessionResult {
  mkdirSync(dir, { recursive: true });
  const log = createDevJsonl({ dir, sessionId });
  log.append({ event: "turn.started" });
  const manifestPath = `${dir.replace(/\\/g, "/")}/manifest.json`;

  return {
    sessionId,
    listed(): readonly string[] {
      if (!existsSync(manifestPath)) return [];
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { sessions?: string[] };
      return manifest.sessions ?? [];
    },
    flush() {
      log.flush();
    },
  };
}
