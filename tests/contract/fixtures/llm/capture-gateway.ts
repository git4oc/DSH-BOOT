/**
 * 契约测试夹具：捕获型反向网关（P0-A1 `LlmAdapter` 契约测试）。
 *
 * 实现四个 LLM 端点的**归因头入站校验**（缺头 400，`ENG-008` 判据①），
 * 捕获每个请求的 body/headers/连接关闭时机，并提供故障旋钮：
 * `ttfbMs`（TTFB 延迟）、`sustainedStatus`（持续注入状态码，如 429）、
 * `failResolve` / `failPrepare`（resolve-model / prepare-call 失败）。
 */

import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface CaptureKnobs {
  ttfbMs?: number;
  sustainedStatus?: number;
  failResolve?: boolean;
  failPrepare?: boolean;
}

export interface CapturedRequest {
  body: string;
  headers: Record<string, unknown>;
  /** 服务端观测到请求连接关闭的时刻（相对测试起点）；响应完成前关闭即被客户端取消。 */
  closedBeforeResponse: boolean;
}

export interface CaptureGateway {
  readonly url: string;
  /** 按端点取最近一次捕获的请求。 */
  lastRequest(path: string): CapturedRequest | undefined;
  /** 按端点取请求计数。 */
  requestCount(path: string): number;
  applyKnobs(knobs: CaptureKnobs): void;
  close(): Promise<void>;
}

const ATTRIBUTION = ["x-ov-turn-id", "x-ov-attribution"];

export async function createCaptureGateway(initialKnobs: CaptureKnobs = {}): Promise<CaptureGateway> {
  const knobs: CaptureKnobs = { ...initialKnobs };
  const captured = new Map<string, CapturedRequest>();
  const counts = new Map<string, number>();

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const pathname = (req.url ?? "/").split("?")[0];
    const chunks: Buffer[] = [];
    let closed = false;
    req.on("data", (c: Buffer) => chunks.push(c));
    // 客户端 abort 会触发 req 的 close——在响应完成前即连接取消（网关侧上游连接取消）。
    req.on("close", () => {
      if (res.writableEnded) return;
      closed = true;
      const existing = captured.get(pathname);
      if (existing) captured.set(pathname, { ...existing, closedBeforeResponse: true });
    });

    const finish = () => {
      const body = Buffer.concat(chunks).toString("utf8");
      captured.set(pathname, { body, headers: { ...req.headers }, closedBeforeResponse: closed });
      counts.set(pathname, (counts.get(pathname) ?? 0) + 1);

      // 归因头入站校验（`ENG-008` 判据①：缺头 400）。
      const missing = ATTRIBUTION.filter((h) => !req.headers[h] || String(req.headers[h]).length === 0);
      if (missing.length > 0) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "ATTRIBUTION_MISSING", missing }));
        return;
      }

      if (pathname === "/internal/kernel/llm/stream") {
        if (knobs.sustainedStatus !== undefined) {
          res.writeHead(knobs.sustainedStatus, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "INJECTED" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/x-ndjson", "request-id": "cap-1" });
        setTimeout(() => {
          res.write(`${JSON.stringify({ kind: "delta", text: "captured" })}\n`);
          res.write(`${JSON.stringify({ kind: "done", reason: "completed" })}\n`);
          res.end();
        }, knobs.ttfbMs ?? 0);
        return;
      }

      if (pathname === "/internal/kernel/llm/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          models: [
            { provider: "stub", model: "stub-small", contextWindow: 128000 },
            { provider: "stub", model: "stub-large", contextWindow: 200000 },
          ],
        }));
        return;
      }

      if (pathname === "/internal/kernel/llm/resolve-model") {
        if (knobs.failResolve) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "INJECTED" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ provider: "stub", model: "stub-small", contextWindow: 128000 }));
        return;
      }

      if (pathname === "/internal/kernel/llm/prepare-call") {
        if (knobs.failPrepare) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "INJECTED" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ prepared: true, callId: "cap-call-1", streamPath: "/internal/kernel/llm/stream" }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "NOT_FOUND", path: pathname }));
    };

    req.on("end", finish);
  });

  server.listen(0, "127.0.0.1");
  // listening 事件前 server.address() 返回 null——必须等待后再求值端口。
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));

  return {
    get url() {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      return `http://127.0.0.1:${port}`;
    },
    lastRequest(path: string): CapturedRequest | undefined {
      return captured.get(path);
    },
    requestCount(path: string): number {
      return counts.get(path) ?? 0;
    },
    applyKnobs(next: CaptureKnobs): void {
      Object.assign(knobs, next);
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
