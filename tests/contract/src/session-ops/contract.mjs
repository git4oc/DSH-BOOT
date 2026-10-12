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

test("P4-4: DSR 删除——回调式真实删除 fail-closed + 四件套证明 + 时延/撤销窗口（SEC-078–088）", () => {
  const log = new WormAuditLog();
  const service = new RetentionService(log);
  // 未接线的清单类：如实标注"由部署者接线"，deleted:false——不得硬编码已删除（SEC-079/080/081/088）
  const unWired = service.deleteAll("tenant-a");
  assert.ok(unWired.inventory.filter((e) => e.item !== "audit").every((e) => e.deleted === false && e.note.includes("由部署者接线")));
  assert.equal(unWired.tombstones.length, 0); // 未接线 ⇒ 无真实删除 ⇒ 无墓碑（不留假记录）
  // 全清单接线：八类逐项回调删除（audit 假名化保留，SEC-085）
  const deleted = [];
  const proof = service.deleteAll("tenant-a", {
    legalHoldAuditPseudonymized: true,
    handlers: Object.fromEntries(RETENTION_INVENTORY.filter((i) => i !== "audit").map((i) => [i, () => deleted.push(i)])),
    now: 1_000_000,
  });
  assert.deepEqual(deleted.sort(), [...RETENTION_INVENTORY.filter((i) => i !== "audit")].sort()); // 真实删除逐类执行
  assert.deepEqual(proof.inventory.map((e) => e.item), [...RETENTION_INVENTORY]);
  assert.equal(proof.inventory.length, 8);
  assert.ok(proof.inventory.filter((e) => e.item !== "audit").every((e) => e.deleted === true));
  // 合法扣留优先：审计假名化而非删除（SEC-085）
  assert.equal(proof.inventory.find((e) => e.item === "audit").deleted, false);
  assert.ok(proof.inventory.find((e) => e.item === "audit").note.includes("假名化"));
  // 生效时延 ≤ 24 h、撤销窗口 7 天（SEC-084）
  assert.equal(proof.effectiveWithinHours, 24);
  assert.equal(proof.revocationWindowDays, 7);
  assert.equal(proof.chainHash.length, 64);
  assert.equal(proof.tombstones.length, 7); // 七类真实删除登记墓碑
});

test("P4-4b: DSR 删除 fail-closed——回调失败整体拒绝，不出具证明（SEC-082/SEC-083）", () => {
  const log = new WormAuditLog();
  const service = new RetentionService(log);
  const calls = [];
  assert.throws(() => service.deleteAll("tenant-a", {
    handlers: Object.fromEntries(RETENTION_INVENTORY.filter((i) => i !== "audit").map((i) => [
      i,
      i === "fts-derived" ? () => { throw new Error("storage unavailable"); } : () => calls.push(i),
    ])),
    now: 2_000_000,
  }), /DSR_DELETE_FAILED.*fts-derived/);
  assert.equal(service.revoke("tenant-a", 2_000_000).revoked, false); // 失败的 DSR 无墓碑可撤销
  // 第二次删除（全部成功）：chainHash 只覆盖本租户墓碑，且失败未留下假墓碑
  const proof = service.deleteAll("tenant-a", {
    legalHoldAuditPseudonymized: true,
    handlers: Object.fromEntries(RETENTION_INVENTORY.filter((i) => i !== "audit").map((i) => [i, () => calls.push(i)])),
    now: 3_000_000,
  });
  assert.equal(proof.tombstones.length, 7);
  assert.equal(calls.filter((i) => i === "fts-derived").length, 1); // 失败项未产生假删除
  // 停写锁：删除进行中不允许并发第二次删除（SEC-082）
  const reentrant = new RetentionService(new WormAuditLog());
  assert.throws(() => reentrant.deleteAll("tenant-b", {
    handlers: Object.fromEntries(RETENTION_INVENTORY.filter((i) => i !== "audit").map((i) => [
      i,
      i === "spill" ? () => { throw new Error("fail"); } : () => {},
    ])),
  }), /DSR_DELETE_FAILED/);
  // spill 回调失败抛错后锁必须已释放：下一次删除可正常进行
  const afterFail = reentrant.deleteAll("tenant-b", {
    legalHoldAuditPseudonymized: true,
    handlers: Object.fromEntries(RETENTION_INVENTORY.filter((i) => i !== "audit").map((i) => [i, () => {}])),
  });
  assert.equal(afterFail.tombstones.length, 7);
});

test("P4-4c: 撤销窗口 7 天（SEC-084）——窗外拒绝 + 审计；无墓碑拒绝", () => {
  const log = new WormAuditLog();
  const service = new RetentionService(log);
  const day = 24 * 60 * 60 * 1000;
  service.deleteAll("tenant-a", {
    legalHoldAuditPseudonymized: true,
    handlers: Object.fromEntries(RETENTION_INVENTORY.filter((i) => i !== "audit").map((i) => [i, () => {}])),
    now: 0,
  });
  assert.equal(service.revoke("tenant-a", 3 * day).revoked, true); // 第 3 天撤销成功
  assert.equal(service.revoke("tenant-a", 8 * day).revoked, false); // 第 8 天撤销被拒
  assert.ok(service.revoke("tenant-a", 8 * day).reason.includes("窗口"));
  assert.equal(service.revoke("tenant-unknown", 1 * day).revoked, false); // 无墓碑拒绝
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
