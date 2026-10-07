/**
 * 契约测试夹具：审批参数通道的域外侧（`SEC-DOC-06` §5 回补端点 + 全局收件箱）。
 *
 * - `POST /internal/kernel/tool-audit`：通道上报端点（202 收讫）。
 * - `GET /v1/sessions/{id}/turns/{tid}/calls/{callId}`：回补端点（§5 全部必返字段；
 *   请求者租户 ≠ 资源租户 ⇒ 403）。
 * - `GET /v1/approvals?status=pending&user={userId}`：全局收件箱（按用户维度聚合）。
 */

import { createServer } from "node:http";
import type { Server } from "node:http";
import { ApprovalParameterChannel } from "../../../../packages/domain-bridge/src/approval/parameter-channel.ts";

export interface ApprovalHarness {
  channel: ApprovalParameterChannel;
  url: string;
  close: () => Promise<void>;
}

/** 异步构造：等待 listening 后再读端口（`server.address()` 在 listening 前为 null）。 */
export async function createApprovalHarness(options: { tenantId?: string } = {}): Promise<ApprovalHarness> {
  const tenantId = options.tenantId ?? "tenant-test";
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1`);
    if (request.method === "POST" && url.pathname === "/internal/kernel/tool-audit") {
      response.statusCode = 202;
      response.end();
      return;
    }
    const backfill = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/turns\/([^/]+)\/calls\/([^/]+)$/);
    if (request.method === "GET" && backfill) {
      const [, sessionId, turnId, callId] = backfill;
      const requesterTenant = request.headers["x-tenant-id"];
      if (requesterTenant !== tenantId) {
        response.statusCode = 403; // 越权租户不泄露存在性
        response.end();
        return;
      }
      const record = channel.getBackfill(sessionId, turnId, callId);
      if (!record) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        sessionId: record.payload.sessionId,
        turnId: record.payload.turnId,
        callId: record.payload.callId,
        toolName: record.payload.toolName,
        argsDigest: record.payload.argsDigest,
        argsPreview: record.payload.argsPreview,
        redacted: record.payload.redacted,
        callSeq: record.callSeq,
        approvalSeq: record.approvalSeq,
        approvalStatus: record.approvalStatus,
        decidedAt: record.decidedAt,
        decidedByRole: record.decidedByRole, // 仅角色，不含自然人标识
        outcomeReasonCode: record.outcomeReasonCode,
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/approvals") {
      const status = url.searchParams.get("status");
      const user = url.searchParams.get("user") ?? "";
      const records = status === "pending"
        ? channel.listPending(user)
        : [];
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        approvals: records.map((r) => ({
          sessionId: r.payload.sessionId,
          turnId: r.payload.turnId,
          callId: r.payload.callId,
          toolName: r.payload.toolName,
          approvalStatus: r.approvalStatus,
        })),
      }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  server.listen(0); // 随机端口
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;
  const channel = new ApprovalParameterChannel({ auditEndpoint: `${url}/internal/kernel/tool-audit` });

  return {
    channel,
    url,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
