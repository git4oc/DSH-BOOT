/**
 * 反向网关桩（`ENG-043`；设计 §6.3 反向 I/O 契约）。
 *
 * 端点清单与设计 §6.3 表格逐条对齐（`ENG-043` 判据①：路由表条目数 == 10）：
 *   1.  POST /internal/kernel/llm/stream        硬   模型调用（流式，显式终止帧）
 *   2.  POST /internal/kernel/llm/models        缓存 模型目录（TTL）
 *   3.  POST /internal/kernel/llm/resolve-model 硬   模型解析
 *   4.  POST /internal/kernel/llm/prepare-call  硬   调用准备
 *   5.  POST /internal/kernel/approval/request  硬   审批（须携带 sessionId/turnId/callId）
 *   6.  POST /internal/kernel/tool-audit        软   副作用台账 + 工具审计
 *   7.  POST /internal/kernel/skills/resolve    缓存 Skill 解析
 *   8.  POST /internal/kernel/usage             软   用量与一般审计
 *   9.  POST /internal/kernel/attest            硬（门禁） 域启动 attest；响应含降级级别
 *   10. ALL  /internal/egress/{kind}/{name}     硬   凭证代理出站
 *
 * 统一要求：缺归因头的请求返回 400（`ENG-008` 判据③）；protocolVersion 不兼容返回 426；
 * 硬端点 fail-closed；不存在 `/internal/kernel/tools/resolve`（工具强制已在挂载期完成）。
 * 故障旋钮（`ENG-043` 判据②）：TTFB 延迟、aborted、adapter error、审批不响应、端点不可达。
 */

import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createAttestStub, } from "./attest.ts";
import type { AttestStub } from "./attest.ts";
import type { FaultKnobs, StubOptions } from "./types.ts";

/** 设计 §6.3 的 10 个端点（方法 + 路径；egress 为 ALL + 参数化路径）。 */
export const GATEWAY_ROUTES: readonly { method: string; path: string; level: string }[] = [
  { method: "POST", path: "/internal/kernel/llm/stream", level: "硬" },
  { method: "POST", path: "/internal/kernel/llm/models", level: "缓存" },
  { method: "POST", path: "/internal/kernel/llm/resolve-model", level: "硬" },
  { method: "POST", path: "/internal/kernel/llm/prepare-call", level: "硬" },
  { method: "POST", path: "/internal/kernel/approval/request", level: "硬" },
  { method: "POST", path: "/internal/kernel/tool-audit", level: "软" },
  { method: "POST", path: "/internal/kernel/skills/resolve", level: "缓存" },
  { method: "POST", path: "/internal/kernel/usage", level: "软" },
  { method: "POST", path: "/internal/kernel/attest", level: "硬（门禁）" },
  { method: "ALL", path: "/internal/egress/{kind}/{name}", level: "硬" },
];

const PROTOCOL_VERSION = "1.0";

export interface GatewayStub {
  readonly server: http.Server;
  readonly port: number;
  readonly attest: AttestStub;
  /** 路由表条目数断言（`ENG-043` 判据①）。 */
  routeCount(): number;
  /** 应用故障旋钮。 */
  applyKnobs(knobs: FaultKnobs): void;
  /** 桩自检：路由条目数 + 缺归因头 400 + protocolVersion 426 + 端点不可达 503。 */
  selfCheck(): Promise<{ verdict: "pass" | "fail"; problems: readonly string[] }>;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c: Buffer) => {
      data += c.toString("utf8");
    });
    req.on("end", () => resolve(data));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

export function createGatewayStub(options: StubOptions): GatewayStub {
  const attributionHeaderNames = options.attributionHeaderNames ?? ["x-ov-turn-id", "x-ov-attribution"];
  let attest = createAttestStub(options.seedProfile, options.initialKnobs ?? {});
  let knobs: FaultKnobs = { ...(options.initialKnobs ?? {}) };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (pathname === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }

    // 开发态控制面（非 §6.3 端点，仅桩基础设施）。
    if (pathname === "/__routes") {
      sendJson(res, 200, { routes: GATEWAY_ROUTES, count: GATEWAY_ROUTES.length });
      return;
    }
    if (pathname === "/__knobs" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}") as FaultKnobs;
      knobs = { ...knobs, ...parsed };
      attest.applyKnobs(parsed); // attest 覆盖（forceVerdict / degradationLevel）同步给 attest 桩
      sendJson(res, 200, { knobs });
      return;
    }
    if (pathname === "/__reset" && req.method === "POST") {
      knobs = {};
      attest = createAttestStub(options.seedProfile, {}); // 复位 attest 的强制覆盖
      sendJson(res, 200, { knobs });
      return;
    }

    const isInternal = pathname.startsWith("/internal/");
    if (!isInternal) {
      sendJson(res, 404, { error: "NOT_FOUND", path: pathname });
      return;
    }

    // 端点不可达旋钮（`ENG-043` 判据②；夹具 8：反向网关各端点不可达）。
    for (const prefix of knobs.unreachable ?? []) {
      if (pathname.startsWith(prefix)) {
        sendJson(res, 503, { error: "ENDPOINT_UNREACHABLE", path: pathname, knob: true });
        return;
      }
    }

    // `ENG-008` 判据③：缺归因头的请求返回 400。
    const missingHeaders = attributionHeaderNames.filter(
      (h) => !req.headers[h] || String(req.headers[h]).length === 0,
    );
    if (missingHeaders.length > 0) {
      sendJson(res, 400, { error: "ATTRIBUTION_MISSING", missing: missingHeaders });
      return;
    }

    let body: Record<string, unknown> = {};
    if (req.method === "POST" || req.method === "PUT") {
      const raw = await readBody(req);
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        sendJson(res, 400, { error: "BAD_JSON" });
        return;
      }
    }

    // 设计 §6.3：反向通道须带 protocolVersion，不兼容返回 426。
    const version = (body.protocolVersion as string) ?? req.headers["x-ov-protocol-version"];
    if (version !== undefined && version !== PROTOCOL_VERSION) {
      sendJson(res, 426, { error: "PROTOCOL_VERSION_UNSUPPORTED", got: version });
      return;
    }

    // 1. POST /internal/kernel/llm/stream —— 流式：逐 chunk 透传 + 显式终止帧。
    if (pathname === "/internal/kernel/llm/stream" && req.method === "POST") {
      if (!body.options) {
        sendJson(res, 400, { error: "MISSING_OPTIONS" });
        return;
      }
      const mode = knobs.streamMode ?? "normal";
      const deltas = knobs.fixedChunks ?? [
        "Hello",
        " ",
        "from",
        " ",
        "the",
        " ",
        "stub",
        " ",
        "model",
        ".",
      ];
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-ov-stream-mode": mode,
        "request-id": `stream-${Date.now()}`,
      });
      const writeFrame = (frame: unknown) => res.write(`${JSON.stringify(frame)}\n`);
      const ttfb = knobs.ttfbMs ?? 0;
      setTimeout(() => {
        if (mode === "adapter-error") {
          writeFrame({ kind: "error", message: "injected adapter error", code: "ADAPTER_ERROR" });
          writeFrame({ kind: "done", reason: "adapter-error" });
          res.end();
          return;
        }
        if (mode === "aborted") {
          writeFrame({ kind: "done", reason: "aborted" });
          res.end();
          return;
        }
        for (const text of deltas) writeFrame({ kind: "delta", text });
        writeFrame({ kind: "done", reason: "completed" });
        res.end();
      }, ttfb);
      return;
    }

    // 2. POST /internal/kernel/llm/models —— 模型目录（TTL 缓存）。
    if (pathname === "/internal/kernel/llm/models" && req.method === "POST") {
      sendJson(res, 200, {
        models: [
          { provider: "stub", model: "stub-small", contextWindow: 128000 },
          { provider: "stub", model: "stub-large", contextWindow: 200000 },
        ],
        "x-ov-cache-ttl": 60,
      });
      return;
    }

    // 3. POST /internal/kernel/llm/resolve-model —— 模型解析（fail-closed）。
    if (pathname === "/internal/kernel/llm/resolve-model" && req.method === "POST") {
      const provider = String(body.provider ?? "");
      const model = String(body.model ?? "");
      if (provider.length === 0 || model.length === 0) {
        sendJson(res, 400, { error: "MISSING_PROVIDER_OR_MODEL" });
        return;
      }
      sendJson(res, 200, { provider, model, contextWindow: 128000 });
      return;
    }

    // 4. POST /internal/kernel/llm/prepare-call —— 调用准备（fail-closed）。
    if (pathname === "/internal/kernel/llm/prepare-call" && req.method === "POST") {
      if (!body.options) {
        sendJson(res, 400, { error: "MISSING_OPTIONS" });
        return;
      }
      sendJson(res, 200, {
        prepared: true,
        callId: `call-${Date.now()}`,
        streamPath: "/internal/kernel/llm/stream",
      });
      return;
    }

    // 5. POST /internal/kernel/approval/request —— 审批（四态；旋钮：不响应 → T_a）。
    if (pathname === "/internal/kernel/approval/request" && req.method === "POST") {
      for (const field of ["sessionId", "turnId", "callId"]) {
        if (!body[field]) {
          sendJson(res, 400, { error: "MISSING_FIELD", field });
          return;
        }
      }
      if (knobs.approvalNoResponse) {
        return; // 挂起不响应 → 客户端 T_a 超时收敛（`ENG-043` 判据②）。
      }
      const outcome = knobs.approvalOutcome ?? "allowed-once";
      sendJson(res, 200, { outcome, requestId: `appr-${Date.now()}` });
      return;
    }

    // 6. POST /internal/kernel/tool-audit —— 软端点（本地缓冲语义）。
    if (pathname === "/internal/kernel/tool-audit" && req.method === "POST") {
      sendJson(res, 202, { buffered: true });
      return;
    }

    // 7. POST /internal/kernel/skills/resolve —— Skill 解析（TTL 缓存）。
    if (pathname === "/internal/kernel/skills/resolve" && req.method === "POST") {
      const name = String(body.name ?? "");
      sendJson(res, 200, { resolved: name.length > 0, name, reason: name.length > 0 ? undefined : "not-found" });
      return;
    }

    // 8. POST /internal/kernel/usage —— 软端点（缓冲/有界丢弃）。
    if (pathname === "/internal/kernel/usage" && req.method === "POST") {
      sendJson(res, 202, { buffered: true });
      return;
    }

    // 9. POST /internal/kernel/attest —— 门禁：四值响应 + 当前降级级别。
    if (pathname === "/internal/kernel/attest" && req.method === "POST") {
      sendJson(res, 200, attest.attest(body as unknown as Parameters<AttestStub["attest"]>[0]));
      return;
    }

    // 10. ALL /internal/egress/{kind}/{name} —— 凭证代理出站（fail-closed）。
    if (pathname.startsWith("/internal/egress/")) {
      const parts = pathname.split("/").filter(Boolean); // ["internal","egress",kind,name]
      const kind = parts[2] ?? "";
      const name = parts[3] ?? "";
      if (kind !== "http" && kind !== "mcp") {
        sendJson(res, 403, { error: "EGRESS_KIND_NOT_ALLOWED", kind });
        return;
      }
      sendJson(res, 200, { allowed: true, kind, name });
      return;
    }

    sendJson(res, 404, { error: "NOT_FOUND", path: pathname });
  });

  const port = options.port ?? 0;

  return {
    server,
    port,
    get attest() {
      return attest;
    },
    routeCount: () => GATEWAY_ROUTES.length,
    applyKnobs(next: FaultKnobs) {
      knobs = { ...knobs, ...next };
    },
    async selfCheck() {
      const problems: string[] = [];
      if (GATEWAY_ROUTES.length !== 10) {
        problems.push(`route table must have exactly 10 entries, got ${GATEWAY_ROUTES.length}`);
      }
      const base = `http://127.0.0.1:${this.port}`;

      // 缺归因头 → 400（`ENG-008` 判据③）。
      const noAttribution = await fetch(`${base}/internal/kernel/llm/models`, { method: "POST" });
      if (noAttribution.status !== 400) {
        problems.push(`missing attribution must yield 400, got ${noAttribution.status}`);
      }
      // protocolVersion 不兼容 → 426。
      const badVersion = await fetch(`${base}/internal/kernel/llm/models`, {
        method: "POST",
        headers: { "x-ov-turn-id": "t", "x-ov-attribution": "a" },
        body: JSON.stringify({ protocolVersion: "9.9" }),
      });
      if (badVersion.status !== 426) {
        problems.push(`incompatible protocolVersion must yield 426, got ${badVersion.status}`);
      }
      // 端点不可达旋钮 → 503，随后复位。
      this.applyKnobs({ unreachable: ["/internal/kernel/usage"] });
      const unreachable = await fetch(`${base}/internal/kernel/usage`, {
        method: "POST",
        headers: { "x-ov-turn-id": "t", "x-ov-attribution": "a" },
        body: "{}",
      });
      if (unreachable.status !== 503) {
        problems.push(`knobbed-unreachable endpoint must yield 503, got ${unreachable.status}`);
      }
      this.applyKnobs({ unreachable: [] });
      const recovered = await fetch(`${base}/internal/kernel/usage`, {
        method: "POST",
        headers: { "x-ov-turn-id": "t", "x-ov-attribution": "a" },
        body: "{}",
      });
      if (recovered.status !== 202) {
        problems.push(`usage must return 202 after knob reset, got ${recovered.status}`);
      }
      return { verdict: problems.length === 0 ? "pass" : "fail", problems };
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** 监听并返回实际端口。 */
export function listenStub(stub: GatewayStub): Promise<number> {
  return new Promise((resolve, reject) => {
    stub.server.once("error", reject);
    stub.server.listen(stub.port, "127.0.0.1", () => {
      const address = stub.server.address();
      resolve(typeof address === "object" && address ? address.port : stub.port);
    });
  });
}
