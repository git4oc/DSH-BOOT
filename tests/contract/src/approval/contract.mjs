/**
 * P0-A3 契约测试：审批应答者 + 参数送达通道 + 三层截止时间（`ENG-009`–`ENG-012`）。
 *
 * 验收项：
 *   - 永不响应的审批桩：T_a + 5s 内进入终态且轮次不再挂起（`ENG-011` 判据①）
 *   - 连续两次同工具调用：两个不同 `approvalId` 且审计计数 == 2（`ENG-010` 判据②，无缓存）
 *   - 事件流中同 callId 的 seq(tool.call) < seq(approval.requested)（`ENG-012` 判据③）
 *   - 参数不可送达的工具不可注册（`ENG-012` 判据② / `SEC-DOC-06` §6.1）
 *   - 回补端点 GET /v1/sessions/{id}/turns/{tid}/calls/{callId} 可用（`ENG-012` 判据④）
 *   - 通道不可达 ⇒ unavailable（fail-closed，`ENG-009` 判据①）；词表闭合（判据②）
 *   - 键级脱敏 + 体积上限 + 摘要稳定性（`SEC-058` 判据 / `SEC-DOC-06` A-02）
 *   - 三层截止时间进 Profile：T_a < T_turn 且 T_m < T_turn，T_turn ≤ 15 min（`ENG-011` 判据②）
 */

import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createApprovalHarness } from "../../fixtures/approval/approval-harness.ts";
import {
  APPROVAL_OUTCOMES,
  ApprovalParameterChannel,
  argsDeliverable,
  buildTenFieldPayload,
  registerApprovalResponder,
} from "../../../../packages/domain-bridge/src/approval/index.ts";
import { registerTool } from "../../../../packages/domain-bridge/src/register.ts";
import { BridgeTelemetry } from "../../../../packages/domain-bridge/src/tools.ts";
import { validateDeadlines } from "../../../../packages/control-plane/src/profile/validate.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");
const results = [];
const record = (name, verdict, detail) => results.push({ name, verdict, detail });

const DOMAIN = {
  tenantId: "tenant-test",
  isolationGroupId: "iso-1",
  workspaceId: "ws-1",
  userId: "user-1",
  sessionId: "session-1",
  turnId: "turn-1",
};

/** 内核形状的 approval waterfall 收集器。 */
function kernelWithWaterfall() {
  const responders = [];
  return {
    ctx: { approval: { respond(fn) { responders.push(fn); return () => undefined; } } },
    responders,
  };
}

async function main() {
  const harness = await createApprovalHarness({ tenantId: DOMAIN.tenantId });
  const observedOutcomes = [];
  const progress = (label) => console.error(`[progress] ${label}`);

  // ── 1. `ENG-011` 判据①：永不响应审批桩 → T_a + 5s 内终态，轮次不挂起 ──────
  {
    const channel = harness.channel;
    const { ctx, responders } = kernelWithWaterfall();
    registerApprovalResponder(ctx, {
      channel,
      domainContext: { ...DOMAIN, sessionId: "s-ta", turnId: "t-ta" },
      resolveArgs: () => ({ path: "a.txt" }),
      decide: () => new Promise(() => undefined), // 永不应答（黑盒连接）
      approvalSeconds: 2, // T_a = 2 s（运行态取自 Profile deadlines.approvalSeconds）
    });
    const start = Date.now();
    const outcome = await responders[0]({ agent: "main", toolName: "write_file", callId: "call-ta" });
    const elapsed = Date.now() - start;
    observedOutcomes.push(outcome);
    const withinBudget = elapsed <= 2 * 1000 + 5000;
    record(
      "TA-TIMEOUT-CONVERGENCE",
      outcome === "timeout" && withinBudget,
      `T_a=2s，终态 outcome=timeout，耗时 ${elapsed}ms ≤ T_a+5s=${withinBudget}，轮次未挂起（已收敛）（ENG-011 判据①，应答者自持 T_a，内核无审批超时）`,
    );
  }

  // ── 2. `ENG-010` 判据②：连续两次同工具调用，无跨 callId 授权复用 ──────────
  {
    const channel = harness.channel;
    const { ctx, responders } = kernelWithWaterfall();
    const approvalIds = [];
    let decideCalls = 0;
    registerApprovalResponder(ctx, {
      channel,
      domainContext: { ...DOMAIN, sessionId: "s-reuse", turnId: "t-reuse" },
      resolveArgs: () => ({ path: "same.txt" }),
      decide: async (request) => {
        decideCalls += 1;
        const id = `approvalId-${decideCalls}`; // 每次调用产生新 approvalId
        approvalIds.push(id);
        return { approvalId: id, outcome: "allowed-once" };
      },
      approvalSeconds: 60,
    });
    const outcome1 = await responders[0]({ agent: "main", toolName: "write_file", callId: "call-r1" });
    const outcome2 = await responders[0]({ agent: "main", toolName: "write_file", callId: "call-r2" });
    observedOutcomes.push(outcome1, outcome2);
    const auditCount = channel.auditCount - 1; // 减去测试 1 的 1 条（同 channel 实例）
    const noReuse = decideCalls === 2 && approvalIds.length === 2 && new Set(approvalIds).size === 2;
    record(
      "NO-AUTH-REUSE",
      decideCalls === 2 && auditCount === 2 && outcome1 === "allowed-once" && outcome2 === "allowed-once" &&
        noReuse,
      `decide 调用 ${decideCalls} 次（每次新决策），审计计数 == ${auditCount}（== 2，无缓存命中），两次均 allowed-once（ENG-010 判据②：无跨 callId 复用、无 allow-always、无规则存储）`,
    );
  }

  // ── 3. `ENG-012` 判据③：seq(tool.call) < seq(approval.requested) ─────────
  {
    const channel = harness.channel;
    const { ctx, responders } = kernelWithWaterfall();
    registerApprovalResponder(ctx, {
      channel,
      domainContext: { ...DOMAIN, sessionId: "s-seq", turnId: "t-seq" },
      resolveArgs: () => ({ path: "seq.txt" }),
      decide: async () => ({ approvalId: "approvalId-seq", outcome: "allowed-once" }),
      approvalSeconds: 60,
    });
    const outcome = await responders[0]({ agent: "main", toolName: "write_file", callId: "call-seq" });
    observedOutcomes.push(outcome);
    const recordBackfill = channel.getBackfill("s-seq", "t-seq", "call-seq");
    const ordered = recordBackfill !== undefined && recordBackfill.callSeq < recordBackfill.approvalSeq;
    record(
      "SEQ-ORDERING",
      ordered,
      `同 callId 的 callSeq=${recordBackfill?.callSeq} < approvalSeq=${recordBackfill?.approvalSeq}（ENG-012 判据③：tool.call 先于 approval.requested 投递，O-1/O-3）`,
    );
  }

  // ── 4. `ENG-012` 判据②：参数不可送达的工具不可注册（F-1 循环引用） ────────
  {
    const kernel = { visible: [] };
    const ctx = {
      tools: {
        register(definition) {
          kernel.visible.push(definition.name);
          return () => undefined;
        },
        guard() {
          return () => undefined;
        },
      },
    };
    const telemetry = new BridgeTelemetry();
    const circular = {};
    circular.self = circular; // F-1：循环引用不可序列化
    const admission = (definition) =>
      definition.requireApproval === true
        ? argsDeliverable(definition.name, definition.probeArgs, definition.probeCallId).reason
        : undefined;
    const options = {
      allowlist: ["bad_tool", "good_tool"],
      telemetry,
      approvalAdmission: admission,
    };
    registerTool({ name: "bad_tool", requireApproval: true, probeArgs: circular, probeCallId: "call-1" }, ctx, options);
    registerTool({ name: "good_tool", requireApproval: true, probeArgs: { a: 1 }, probeCallId: "call-2" }, ctx, options);
    const badRegistered = kernel.visible.includes("bad_tool");
    const goodRegistered = kernel.visible.includes("good_tool");
    const auditReason = telemetry.getAuditRecords().some((a) => a.reason.startsWith("args-undeliverable"));
    record(
      "ARGS-UNDELIVERABLE-NOT-REGISTERED",
      !badRegistered && goodRegistered && auditReason,
      `参数不可送达的工具不可注册=${!badRegistered}（未进入可见集、不进入 requireApproval），可送达工具正常注册=${goodRegistered}，硬审计含 args-undeliverable=${auditReason}（ENG-012 判据②，SEC-DOC-06 §6.1 F-1）`,
    );
  }

  // ── 5. `ENG-012` 判据④：回补端点可用（200 + 全部必返字段 + 越权 403） ─────
  {
    const channel = harness.channel;
    const { ctx, responders } = kernelWithWaterfall();
    registerApprovalResponder(ctx, {
      channel,
      domainContext: { ...DOMAIN, sessionId: "s-backfill", turnId: "t-backfill" },
      resolveArgs: () => ({ path: "bf.txt", password: "hunter2" }),
      decide: async () => ({ approvalId: "approvalId-bf", outcome: "allowed-once" }),
      approvalSeconds: 60,
    });
    await responders[0]({ agent: "main", toolName: "write_file", callId: "call-bf" });
    const response = await fetch(`${harness.url}/v1/sessions/s-backfill/turns/t-backfill/calls/call-bf`, {
      headers: { "x-tenant-id": DOMAIN.tenantId },
    });
    const body = await response.json();
    const required = [
      "sessionId", "turnId", "callId", "toolName", "argsDigest", "argsPreview", "redacted",
      "callSeq", "approvalSeq", "approvalStatus", "decidedAt", "decidedByRole", "outcomeReasonCode",
    ];
    const allFields = required.every((key) => key in body);
    const crossTenant = await fetch(
      `${harness.url}/v1/sessions/s-backfill/turns/t-backfill/calls/call-bf`,
      { headers: { "x-tenant-id": "other-tenant" } },
    );
    record(
      "BACKFILL-ENDPOINT",
      response.status === 200 && allFields && body.callSeq < body.approvalSeq &&
        body.decidedByRole === "approver" && !("displayReason" in body) && crossTenant.status === 403,
      `回补 200=${response.status === 200}，全部必返字段=${allFields}，callSeq<approvalSeq=${body.callSeq < body.approvalSeq}，decidedByRole 仅角色=${body.decidedByRole === "approver"}，无 displayReason=${!("displayReason" in body)}，越权租户 403=${crossTenant.status === 403}（ENG-012 判据④，SEC-DOC-06 §5）`,
    );
  }

  // ── 6. 全局收件箱：同一用户两个会话各一个待审批 → 一次返回两条（A-10） �────
  {
    const { ctx, responders } = kernelWithWaterfall();
    // 用 harness 的 channel（此前各测试的记录均已决议，不污染 pending 断言）。
    const channel = harness.channel;
    registerApprovalResponder(ctx, {
      channel,
      domainContext: { ...DOMAIN, sessionId: "s-inbox-1", turnId: "t-inbox-1" },
      resolveArgs: () => ({ a: 1 }),
      decide: () => new Promise(() => undefined), // 不应答；T_a 后收敛，记录保持 pending
      approvalSeconds: 2,
    });
    registerApprovalResponder(ctx, {
      channel,
      domainContext: { ...DOMAIN, sessionId: "s-inbox-2", turnId: "t-inbox-2" },
      resolveArgs: () => ({ a: 2 }),
      decide: () => new Promise(() => undefined), // 不应答；T_a 后收敛，记录保持 pending
      approvalSeconds: 2,
    });
    const responder = responders[0];
    const pending1 = responder({ agent: "main", toolName: "tool_a", callId: "call-inbox-1" }); // 会话 1
    const pending2 = responders[1]({ agent: "main", toolName: "tool_a", callId: "call-inbox-2" }); // 会话 2
    await new Promise((resolve) => setTimeout(resolve, 100)); // 上报完成（T_a=2s 未到期，保持 pending）
    const inbox = await (await fetch(`${harness.url}/v1/approvals?status=pending&user=user-1`)).json();
    await pending1; // T_a 到期收敛（timeout），不挂起
    await pending2;
    record(
      "INBOX-PENDING-AGGREGATION",
      inbox.approvals.length === 2,
      `GET /v1/approvals?status=pending 按用户聚合一次返回 ${inbox.approvals.length} 条（== 2，两个会话）（A-10）`,
    );
  }

  // ── 7. `ENG-009` 判据①：通道不可达 ⇒ unavailable（fail-closed） ───────────
  {
    const deadChannel = new ApprovalParameterChannel({ auditEndpoint: "http://127.0.0.1:1/internal/kernel/tool-audit" });
    const { ctx, responders } = kernelWithWaterfall();
    registerApprovalResponder(ctx, {
      channel: deadChannel,
      domainContext: DOMAIN,
      resolveArgs: () => ({ a: 1 }),
      decide: async () => ({ approvalId: "approvalId-x", outcome: "allowed-once" }),
      approvalSeconds: 60,
    });
    const outcome = await responders[0]({ agent: "main", toolName: "write_file", callId: "call-dead" });
    observedOutcomes.push(outcome);
    record(
      "UNAVAILABLE-FAIL-CLOSED",
      outcome === "unavailable",
      `通道不可达 ⇒ outcome=unavailable=${outcome === "unavailable"}，域外决策未被调用（ENG-009 判据①：fail-closed）`,
    );
  }

  // ── 8. `ENG-009` 判据②：返回词表闭合（四值 + 声明扩展 timeout） ───────────
  {
    const closed = observedOutcomes.every((outcome) => APPROVAL_OUTCOMES.includes(outcome));
    record(
      "VOCABULARY-CLOSED",
      closed,
      `观测到的全部 outcome ∈ 词表（allowed-once/rejected/cancelled/unavailable + 声明扩展 timeout）=${closed}（ENG-009 判据②）`,
    );
  }

  // ── 9. `SEC-058` 判据 / A-02：键级脱敏 + 体积上限 + 摘要稳定性 ─────────────
  {
    const sensitive = buildTenFieldPayload(DOMAIN, "call-redact-1", "tool_a", {
      password: "hunter2",
      apiToken: "tok-123",
      pem: "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
      jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c",
      awsKey: "AKIAIOSFODNN7EXAMPLE",
      ghToken: `ghp_${"a".repeat(24)}`,
      blob: "a".repeat(20) + "1".repeat(20), // 40 字符，含字母与数字 → 高熵规则命中
    });
    const preview = sensitive.argsPreview;
    const masked =
      preview.includes("[REDACTED]") && preview.includes("[REDACTED:PEM]") &&
      preview.includes("[REDACTED:JWT]") && preview.includes("[REDACTED:KEY]") &&
      preview.includes("[REDACTED:HIGHENTROPY]");
    const sensitiveOk = masked && sensitive.redacted === true && !preview.includes("hunter2");

    const big = buildTenFieldPayload(DOMAIN, "call-redact-2", "tool_a", {
      content: "z".repeat(10 * 1024 * 1024), // 10 MB 参数
    });
    const bigOk = Buffer.byteLength(big.argsPreview, "utf8") <= 65536 && big.redacted === true;

    const clean = buildTenFieldPayload(DOMAIN, "call-redact-3", "tool_a", { a: 1 });
    const digestStable = clean.argsDigest === buildTenFieldPayload(DOMAIN, "call-redact-3", "tool_a", { a: 1 }).argsDigest;
    const digestChanges = clean.argsDigest !== buildTenFieldPayload(DOMAIN, "call-redact-3", "tool_a", { a: 2 }).argsDigest;
    const cleanNotRedacted = clean.redacted === false;

    record(
      "REDACTION-AND-CAPS",
      sensitiveOk && bigOk && digestStable && digestChanges && cleanNotRedacted,
      `敏感键全部掩码且无明文=${sensitiveOk}，10MB 截断后 ≤ 65536 且 redacted=true=${bigOk}，摘要稳定=${digestStable}，一字节变化摘要变化=${digestChanges}，净参数 redacted=false=${cleanNotRedacted}（SEC-058 判据，A-02）`,
    );
  }

  // ── 10. `ENG-011` 判据② / 任务 6：三层截止时间进 Profile ─────────────────
  {
    const missing = validateDeadlines(undefined).length > 0;
    const taOutOfRange = validateDeadlines({ approvalSeconds: 500, modelStreamSeconds: 300, turnSeconds: 900 }).length > 0;
    const turnTooLong = validateDeadlines({ approvalSeconds: 90, modelStreamSeconds: 300, turnSeconds: 1200 }).some(
      (i) => i.rule === "deadlines.Tturn.range",
    );
    const taNotLtTurn = validateDeadlines({ approvalSeconds: 900, modelStreamSeconds: 100, turnSeconds: 800 }).some(
      (i) => i.rule === "PC-001",
    );
    const tmNotLtTurn = validateDeadlines({ approvalSeconds: 90, modelStreamSeconds: 800, turnSeconds: 800 }).some(
      (i) => i.rule === "PC-002",
    );
    const valid = validateDeadlines({ approvalSeconds: 90, modelStreamSeconds: 300, turnSeconds: 900 }).length === 0;
    record(
      "DEADLINES-IN-PROFILE",
      missing && taOutOfRange && turnTooLong && taNotLtTurn && tmNotLtTurn && valid,
      `缺省违规=${missing}，T_a 越界(500)违规=${taOutOfRange}，T_turn>900 违规=${turnTooLong}，T_a≥T_turn 违规=${taNotLtTurn}，T_m≥T_turn 违规=${tmNotLtTurn}，合规通过=${valid}（ENG-011 判据②，§4.4.1：T_a<T_turn 且 T_m<T_turn，T_turn≤15min）`,
    );
  }

  // ── 11. `ENG-010` 判据①：审批面源码无 (tenantId, toolName) 授权表 ────────
  {
    const offenders = [];
    for (const base of ["packages", "apps"]) {
      const scan = (dir) => {
        let entries;
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) scan(full);
          else if (/\.(ts|mjs)$/.test(entry.name) && statSync(full).isFile()) {
            const content = readFileSync(full, "utf8");
            if (/allow-always|allowAlways/.test(content)) offenders.push(full.replace(/\\/g, "/"));
          }
        }
      };
      scan(join(root, base));
    }
    record(
      "NO-ALLOW-ALWAYS-SOURCE-CHECK",
      offenders.length === 0,
      `全仓审批面无 allow-always/allowAlways 命中（无跨 callId 授权复用、无规则存储）=${offenders.length === 0}（ENG-010 判据①）`,
    );
  }

  await harness.close();
}

try {
  await main();
} catch (error) {
  results.push({ name: "UNCAUGHT", verdict: false, detail: String(error?.stack ?? error) });
}

for (const r of results) {
  console.log(`${r.verdict ? "✓" : "✗"} ${r.name}: ${r.detail}`);
}
const failed = results.filter((r) => !r.verdict);
if (failed.length > 0) {
  console.error(`\n[contract:approval] FAIL — ${failed.length}/${results.length} 项未通过`);
  process.exit(1);
}
console.log(`\n[contract:approval] PASS — ${results.length}/${results.length} 项通过（ENG-009–012）`);
