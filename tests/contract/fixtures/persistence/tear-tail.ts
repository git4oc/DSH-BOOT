/**
 * 夹具 A（`ENG-046`）：撕裂尾——物理半帧不被合法读取返回。
 * 注入后日志尾为「合法帧 + 截断帧（无换行、缺右括号）」。
 */

import { appendFileSync, writeFileSync, existsSync } from "node:fs";

export interface TearTailResult {
  readonly logPath: string;
  readonly validFrames: number;
  readonly tornBytes: number;
}

export function injectTearTail(logPath: string, validFrames = 2): TearTailResult {
  const lines: string[] = [];
  for (let i = 0; i < validFrames; i++) {
    lines.push(`${JSON.stringify({ seq: i, event: "tool/result" })}\n`);
  }
  const torn = JSON.stringify({ seq: validFrames, event: "tool/call", half: true }).slice(0, 20);
  if (existsSync(logPath)) {
    appendFileSync(logPath, torn, "utf8");
  } else {
    writeFileSync(logPath, lines.join("") + torn, "utf8");
  }
  return { logPath, validFrames, tornBytes: torn.length };
}
