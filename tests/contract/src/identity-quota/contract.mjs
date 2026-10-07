/**
 * 控制面身份、配额与计费契约（设计 §5.1/§5.2/§5.2.1；`PRD-020`–`PRD-042`；`REL-052`–`REL-059`）。
 *
 * 直跑入口（进程内 test()，与既有契约套件同一模式）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  signUserToken,
  verifyUserToken,
  rbacCheck,
  authorizeWorkspace,
  HARD_REJECTION_CODES,
} from "../../../../packages/control-plane/src/identity-quota/identity.ts";
import {
  QUOTA_DIMENSIONS,
  SOFT_DIMENSIONS,
  FairScheduler,
  BillingLedger,
} from "../../../../packages/control-plane/src/identity-quota/quota-billing.ts";

const policy = {
  roles: {
    admin: { scenarios: ["coding", "qa"], plugins: ["dsh-base"], tools: ["shell", "fs"], mcpConnectors: ["github"], sandboxModeCeiling: "workspace-write" },
    viewer: { scenarios: ["qa"], plugins: ["dsh-base"], tools: ["fs"], mcpConnectors: [], sandboxModeCeiling: "read-only" },
  },
};

test("P3-1: JWT（OIDC）+ RBAC 按租户/角色控制场景/插件/工具/MCP/沙箱上限（§5.1）", () => {
  const claims = { sub: "u-1", tenantId: "tenant-a", role: "admin", workspaceIds: ["ws-1", "ws-2"], isolationGroupId: "ig-1", exp: Math.floor(Date.now() / 1000) + 300 };
  const token = signUserToken(claims, "secret");
  const verified = verifyUserToken(token, "secret");
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.claims.workspaceIds, ["ws-1", "ws-2"]);
  // 签名篡改/过期/畸形拒绝
  assert.equal(verifyUserToken(`${token}x`, "secret").ok, false);
  assert.equal(verifyUserToken("malformed", "secret").ok, false);
  const expired = verifyUserToken(signUserToken({ ...claims, exp: 1 }, "secret"), "secret");
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, "JWT_EXPIRED");
  // RBAC：场景/插件/工具/MCP/沙箱上限逐类
  assert.equal(rbacCheck(policy, "admin", { scenario: "coding" }).allowed, true);
  assert.equal(rbacCheck(policy, "viewer", { scenario: "coding" }).reason, "RBAC_SCENARIO_DENIED");
  assert.equal(rbacCheck(policy, "viewer", { tool: "shell" }).reason, "RBAC_TOOL_DENIED");
  assert.equal(rbacCheck(policy, "viewer", { mcpConnector: "github" }).reason, "RBAC_MCP_DENIED");
  // 沙箱模式上限（C38）：viewer 上限 read-only，workspace-write 超限
  assert.equal(rbacCheck(policy, "viewer", { sandboxMode: "workspace-write" }).reason, "RBAC_SANDBOX_CEILING");
  assert.equal(rbacCheck(policy, "admin", { sandboxMode: "workspace-write" }).allowed, true);
});

test("P3-2: workspace 授权时机——签令牌时固化允许集合 + 每次请求校验租户与隔离组（§5.1）", () => {
  const claims = { sub: "u-1", tenantId: "tenant-a", role: "admin", workspaceIds: ["ws-1"], isolationGroupId: "ig-1", exp: Math.floor(Date.now() / 1000) + 300 };
  // 允许集合在签令牌时固化：ws-1 允许、ws-9 不允许
  assert.equal(authorizeWorkspace(claims, { tenantId: "tenant-a", isolationGroupId: "ig-1", workspaceId: "ws-1" }).allowed, true);
  assert.equal(authorizeWorkspace(claims, { tenantId: "tenant-a", isolationGroupId: "ig-1", workspaceId: "ws-9" }).reason, "WORKSPACE_NOT_AUTHORIZED");
  // 每次请求校验租户与隔离组（硬依赖，网关本地）
  assert.equal(authorizeWorkspace(claims, { tenantId: "tenant-b", isolationGroupId: "ig-1", workspaceId: "ws-1" }).reason, "TENANT_MISMATCH");
  assert.equal(authorizeWorkspace(claims, { tenantId: "tenant-a", isolationGroupId: "ig-2", workspaceId: "ws-1" }).reason, "ISOLATION_GROUP_MISMATCH");
});

test("P3-3: 超额租户被按比例限速而其他租户不受影响（§5.2.1）", () => {
  const scheduler = new FairScheduler(0.8, (tenantId) => (tenantId === "tenant-a" ? 100 : 100));
  // 水位未超阈值：照常受理
  assert.equal(scheduler.admit("tenant-a", 200, 0.5).decision, "admit");
  // 水位超阈值：超额租户按超限比例限速（比例 = 1 − 100/300 ≈ 0.67）
  const over = scheduler.admit("tenant-a", 300, 0.9);
  assert.equal(over.decision, "throttle");
  assert.equal(over.throttleRatio, 0.67);
  // 未超额租户不受影响（不平等 503、不连坐）
  const other = scheduler.admit("tenant-b", 50, 0.9);
  assert.equal(other.decision, "admit");
  assert.equal(other.throttleRatio, 0);
});

test("P3-4: 软依赖不可用不阻断；拒绝原因码集合不含软依赖（验收）", () => {
  // 配额分级：令牌/工具调用/存储 = 软；域槽位/CPU/内存/模型并发/workspace 份额 = 硬
  assert.deepEqual(SOFT_DIMENSIONS, ["tokens", "toolCalls", "storage"]);
  assert.ok(QUOTA_DIMENSIONS.filter((d) => d.level === "hard").every((d) => ["domainSlots", "cpu", "memory", "modelConcurrency", "workspaceShare"].includes(d.dimension)));
  // 拒绝原因码集合不含任何软依赖原因码（计费/一般审计不可用不拒绝执行）
  assert.ok(HARD_REJECTION_CODES.every((code) => !code.includes("BILLING") && !code.includes("SOFT") && !code.includes("AUDIT_UNAVAILABLE")));
});

test("P3-5: 用量归集 turnId + 幂等去重 (tenantId, turnId) + reconciled 标记与分方向差异（§7.6）", () => {
  const ledger = new BillingLedger();
  const record = { tenantId: "tenant-a", turnId: "t-1", workspaceId: "ws-1", connector: "github", inputTokens: 100, outputTokens: 50, cacheHitTokens: 20 };
  assert.deepEqual(ledger.ingest(record), { accepted: true, duplicate: false });
  // 幂等去重：同 (tenantId, turnId) 重复上传只计一次
  assert.deepEqual(ledger.ingest(record), { accepted: false, duplicate: true });
  // MCP 按 connector 归集；区分输入/输出/缓存命中
  const usage = ledger.usage("connector", ["github"]);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].inputTokens, 100);
  assert.equal(usage[0].outputTokens, 50);
  assert.equal(usage[0].cacheHitTokens, 20);
  assert.equal(usage[0].reconciled, true);
  // 墓碑丢弃段 → reconciled:false + 少计分列（under）
  ledger.markTombstoned("tenant-a", "t-2");
  ledger.ingest({ tenantId: "tenant-a", turnId: "t-2", workspaceId: "ws-1", connector: "github", inputTokens: 10, outputTokens: 5, cacheHitTokens: 0 });
  const afterTombstone = ledger.usage("connector", ["github"]);
  assert.equal(afterTombstone[0].reconciled, false);
  assert.equal(afterTombstone[0].underCounted, 1);
  // workspace 维度 + 导出
  assert.equal(ledger.usage("workspace", ["ws-1"]).length, 1);
  assert.ok(ledger.exportAll("workspace", ["ws-1"]).includes("generatedAt"));
});
