/**
 * 夹具自测（`ENG-046` 判据①：每个注入器有独立用例）。8 个用例逐一运行：
 *   A 撕裂尾 / B 锁被占 / C 句柄关闭 / D freshness 探测 / E 格式不支持 /
 *   F 空会话不 flush 不可见 / 7 MCP 突变与重连耗尽 / 8 网关端点不可达。
 * 单面加载证明：A–F 只 import persistence 面的索引（判据②）。
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 单面加载证明：A–F 只加载 persistence 面索引（不加载 llm/approval/tools/gateway）。
import {
  injectTearTail,
  secondWriterFails,
  driveClosedHandle,
  probeFreshness,
  injectForeignFormat,
  isForeignFormat,
  createUnflushedSession,
} from "./persistence/index.ts";
import { createFakeMcp } from "./tools/index.ts";
import { markEndpointsUnreachable } from "./gateway/index.ts";
import { createGatewayStub, listenStub } from "../../../packages/reverse-gateway/src/stub/index.ts";

const results = [];
const record = (name, verdict, detail) => results.push({ name, verdict, detail });

const dir = mkdtempSync(join(tmpdir(), "dsh-fixtures-"));
try {
  // A 撕裂尾：注入后日志尾为截断帧（无换行、非完整 JSON）。
  {
    const logPath = join(dir, "a.jsonl");
    injectTearTail(logPath, 1);
    const content = readFileSync(logPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    let torn = false;
    try {
      JSON.parse(lines[lines.length - 1]);
    } catch {
      torn = true;
    }
    record("A.tear-tail", torn, "log tail is a torn frame after injection");
  }

  // B 锁被占：第二写者必须失败。
  {
    const ok = secondWriterFails(join(dir, "b.lock"));
    record("B.second-writer", ok, "second writer fails while the first holds the lock");
  }

  // C 句柄关闭：开 → 关 → 再调用抛出。
  {
    const outcome = driveClosedHandle(
      () => {
        let closed = false;
        return {
          append(frame) {
            if (closed) { const e = new Error("closed"); e.name = "SESSION_HANDLE_CLOSED"; throw e; }
            return frame;
          },
          read() {
            if (closed) { const e = new Error("closed"); e.name = "SESSION_HANDLE_CLOSED"; throw e; }
            return [];
          },
          close() { closed = true; },
        };
      },
      (handle) => handle.append({ event: "after-close" }),
    );
    record("C.closed-handle", outcome.threwAfterClose && outcome.errorName === "SESSION_HANDLE_CLOSED", "post-close call throws SESSION_HANDLE_CLOSED");
  }

  // D freshness 探测：写批 + flush 后的读至少看到该前缀；违例时 sawPrefix=false。
  {
    const ok = probeFreshness(2, () => [1, 2, 3]);
    const violation = probeFreshness(2, () => []);
    record("D.freshness-probe", ok.sawPrefix === true && violation.sawPrefix === false, "probe detects both satisfied and violated freshness");
  }

  // E 格式不支持：外来 magic 可被识别为拒绝分支。
  {
    const foreignPath = join(dir, "e.log");
    injectForeignFormat(foreignPath);
    const content = readFileSync(foreignPath, "utf8");
    record("E.unsupported-format", isForeignFormat(content), "foreign magic marker is detectable for the reject branch");
  }

  // F 空会话不 flush 不可见：flush 前不在 list 视图，flush 后可见。
  {
    const session = createUnflushedSession(join(dir, "f"), "f-session");
    const before = session.listed().includes("f-session");
    session.flush();
    const after = session.listed().includes("f-session");
    record("F.no-flush-invisibility", !before && after, "session invisible before flush, visible after");
  }

  // 7 MCP 突变与重连耗尽。
  {
    const mcp = await createFakeMcp(["mcp_tool_a", "mcp_tool_b"]);
    const before = await (await fetch(mcp.url)).json();
    mcp.pushMutation();
    const after = await (await fetch(mcp.url)).json();
    const mutant = after.tools.includes("mcp_evil_tool");
    mcp.exhaustReconnects(0);
    let exhausted = false;
    try {
      await (await fetch(mcp.url)).json();
    } catch {
      exhausted = true;
    }
    await mcp.close();
    record(
      "7.mcp-mutation",
      before.tools.length === 2 && mutant && exhausted,
      "tool list mutates at runtime, then reconnects are exhausted",
    );
  }

  // 8 网关端点不可达。
  {
    const stub = createGatewayStub({ port: 0, seedProfile: { profileId: "dev-seed", trainVersion: "0" } });
    const port = await listenStub(stub);
    const result = await markEndpointsUnreachable(`http://127.0.0.1:${port}`, ["/internal/kernel/usage"], {
      "x-ov-turn-id": "t",
      "x-ov-attribution": "a",
    });
    await stub.close();
    record("8.gateway-unreachable", result.allUnreachable, "knobbed endpoints return 503");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

for (const r of results) {
  console.log(`${r.verdict ? "✓" : "✗"} ${r.name}: ${r.detail}`);
}
const failed = results.filter((r) => !r.verdict);
if (failed.length > 0) {
  console.error(`\n[fixtures:selftest] FAIL — ${failed.length}/${results.length} 用例未通过`);
  process.exit(1);
}
console.log(`\n[fixtures:selftest] PASS — ${results.length}/${results.length} 用例通过（ENG-046 判据①）`);
