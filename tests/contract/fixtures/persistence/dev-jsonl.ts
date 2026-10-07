/**
 * 持久化夹具的最小 JSONL 会话日志基底（`ENG-046` 夹具专用）。
 *
 * 这不是 `SessionPersistence` L1 实现（P1-B 交付）；它是夹具注入故障的可编程基底：
 * 帧格式为「一行一个 JSON 对象」，`flush()` 写 manifest（list 的可见性边界）。
 * A–F 契约测试（`ENG-031`）以此基底先行复现故障条件，实现落地后换绑。
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface DevJsonlLog {
  readonly path: string;
  append(frame: Record<string, unknown>): void;
  read(): readonly Record<string, unknown>[];
  flush(): void;
}

export interface DevJsonlOptions {
  readonly dir: string;
  readonly sessionId: string;
}

export function sessionPaths(dir: string, sessionId: string): { logPath: string; manifestPath: string } {
  const logPath = `${dir.replace(/\\/g, "/")}/${sessionId}.jsonl`;
  const manifestPath = `${dir.replace(/\\/g, "/")}/manifest.json`;
  return { logPath, manifestPath };
}

export function createDevJsonl(options: DevJsonlOptions): DevJsonlLog {
  const logPath = `${options.dir.replace(/\\/g, "/")}/${options.sessionId}.jsonl`;
  return {
    path: logPath,
    append(frame: Record<string, unknown>) {
      const previous = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
      writeFileSync(logPath, previous + `${JSON.stringify(frame)}\n`, "utf8");
    },
    read(): readonly Record<string, unknown>[] {
      if (!existsSync(logPath)) return [];
      return readFileSync(logPath, "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    flush() {
      const manifestPath = `${options.dir.replace(/\\/g, "/")}/manifest.json`;
      const manifest = existsSync(manifestPath)
        ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { sessions?: string[] })
        : { sessions: [] as string[] };
      const sessions = manifest.sessions ?? [];
      if (!sessions.includes(options.sessionId)) sessions.push(options.sessionId);
      writeFileSync(manifestPath, JSON.stringify({ sessions }, null, 2), "utf8");
    },
  };
}
