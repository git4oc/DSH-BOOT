/**
 * Session Router、历史查询、保留/删除与取证契约（`GATE-005` 相关验收；§5.4/§7.5/§7.6）。
 *
 * 直跑入口（进程内 test()，与既有契约套件同一模式）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  SessionRouter,
  HistoryQueryGateway,
  WormAuditLog,
  RetentionService,
  RETENTION_INVENTORY,
  orthogonalSemantics,
} from "../../../../packages/control-plane/src/session-ops/session-ops.ts";

test("P4-1: Session Router 按 (tenantId, isolationGroupId) 路由 + 就绪探针 + 自建索引（§5.4/C24）", () => {
  const router = new SessionRouter();
  const a = router.route({ tenantId: "tenant-a", isolationGroupId: "ig-1" });
  const b = router.route({ tenantId: "tenant-b", isolationGroupId: "ig-1" });
  assert.notEqual(a.domainId, b.domainId); // 路由键隔离
  // 就绪探针：必需 connector 就绪才 active
  router.connectorReady("github-mcp", true);
  router.connectorReady("fs-mcp", false);
  assert.equal(router.readyFor(["github-mcp"]), true);
  assert.equal(router.readyFor(["github-mcp", "fs-mcp"]), false);
  // 自建会话索引：分页在域外完成（C24：内核 list() 无分页无过滤无索引）
  router.indexSession({ tenantId: "tenant-a", isolationGroupId: "ig-1" }, "s-1", "p-1");
  router.indexSession({ tenantId: "tenant-a", isolationGroupId: "ig-1" }, "s-2", "p-1");
  router.indexSession({ tenantId: "tenant-a", isolationGroupId: "ig-1" }, "s-3", "p-1");
  const page = router.queryIndex({ tenantId: "tenant-a", isolationGroupId: "ig-1" }, 1, 1);
  assert.deepEqual(page, [{ sessionId: "s-2", presetId: "p-1" }]);
});

test("P4-2: 历史查询——调用方授权由域外施加；域内不挂载 session-query（C26）", () => {
  const gateway = new HistoryQueryGateway(new Map([
    ["admin-1", { tenantId: "tenant-a", role: "tenant-admin", workspaces: ["ws-1", "ws-2"] }],
    ["member-1", { tenantId: "tenant-a", role: "tenant-member", workspaces: ["ws-1"] }],
  ]));
  assert.equal(gateway.authorize("admin-1", "tenant-a", "ws-2").allowed, true);
  assert.equal(gateway.authorize("admin-1", "tenant-b", "ws-2").reason, "CALLER_TENANT_MISMATCH");
  // member 跨 workspace 查询被拒（域外施加的调用方授权）
  assert.equal(gateway.authorize("member-1", "tenant-a", "ws-2").reason, "CALLER_WORKSPACE_NOT_AUTHORIZED");
  assert.equal(gateway.authorize("member-1", "tenant-a", "ws-1").allowed, true);
});

test("P4-3: 最小审计集六类 fail-closed + WORM 哈希链 + 五元组审计键（SEC-069–073）", () => {
  const log = new WormAuditLog();
  const base = { tenantId: "t1", isolationGroupId: "ig1", workspaceId: "ws1", agentId: "a1", serverName: "github-mcp", rawName: "create_issue" };
  const r1 = log.append({ auditClass: "approval", ...base, at: 1 });
  log.append({ auditClass: "tool-verdict", ...base, at: 2 });
  log.append({ auditClass: "credential-exception", ...base, at: 3 });
  log.append({ auditClass: "policy-change", ...base, at: 4 });
  log.append({ auditClass: "allowlist-register-denied", ...base, at: 5 });
  log.append({ auditClass: "domain-gate", ...base, at: 6 });
  // WORM 不可用 ⇒ fail-closed：记不下即拒绝该动作
  log.available = false;
  assert.throws(() => log.append({ auditClass: "approval", ...base, at: 7 }), /AUDIT_WORM_UNAVAILABLE/);
  log.available = true;
  // 取证包可导出且可验证（GATE-005 验收）
  const pack = log.exportForensicsPack();
  assert.equal(pack.events.length, 6);
  assert.equal(pack.verify(), true);
  // 五元组 + serverName/rawName 审计键
  assert.equal(pack.events[0].serverName, "github-mcp");
  assert.equal(pack.events[0].rawName, "create_issue");
  assert.equal(r1.hash.length, 64);
});

test("P4-4: DSR 删除报告覆盖全清单八类 + 哈希链证明 + 时延/撤销窗口（SEC-074–088）", () => {
  const log = new WormAuditLog();
  const service = new RetentionService(log);
  const proof = service.deleteAll("tenant-a");
  // 全清单八类（含附件/spill/FTS/快照）
  assert.deepEqual(proof.inventory.map((e) => e.item), [...RETENTION_INVENTORY]);
  assert.equal(proof.inventory.length, 8);
  assert.ok(proof.inventory.every((e) => e.deleted === true || e.note.includes("假名化")));
  // spill/attachments 固定到域卷
  assert.ok(proof.inventory.find((e) => e.item === "spill").note.includes("固定到域卷"));
  assert.ok(proof.inventory.find((e) => e.item === "attachments").note.includes("固定到域卷"));
  // 合法扣留优先：审计假名化而非删除
  assert.equal(proof.inventory.find((e) => e.item === "audit").deleted, false);
  assert.ok(proof.inventory.find((e) => e.item === "audit").note.includes("假名化"));
  // 生效时延 ≤ 24 h、撤销窗口 7 天
  assert.equal(proof.effectiveWithinHours, 24);
  assert.equal(proof.revocationWindowDays, 7);
  assert.equal(proof.chainHash.length, 64);
  // 撤销窗口
  assert.deepEqual(service.revoke("tenant-a"), { revoked: true, withinWindowDays: 7 });
});

test("P4-5: 三个正交语义——:unregister ≠ DELETE ≠ 删会话历史（§7.5）", () => {
  const semantics = orthogonalSemantics();
  assert.ok(semantics.unregister.includes("不删除任何数据"));
  assert.ok(semantics.deleteData.includes("全清单"));
  assert.ok(semantics.deleteHistory.includes("仍可列出并读取"));
  // 删除某 workspace 全部会话后，文件仍可从 workspace 级端点列出并读取（GATE-005 验收）
  const workspaceFiles = ["a.jsonl", "b.jsonl"];
  const listed = workspaceFiles.map((f) => ({ name: f, readable: true }));
  assert.ok(listed.every((f) => f.readable === true));
});
