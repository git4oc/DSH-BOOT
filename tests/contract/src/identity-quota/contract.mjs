/**
 * 控制面身份、配额与计费契约（设计 §5.1/§5.2/§5.2.1；`PRD-020`–`PRD-042`；`REL-052`–`REL-059`）。
 *
 * 直跑入口（进程内 test()，与既有契约套件同一模式）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  signUserToken,
  verifyUserToken,
  rbacCheck,
  authorizeWorkspace,
  TokenRevocationRegistry,
  HARD_REJECTION_CODES,
} from "../../../../packages/control-plane/src/identity-quota/identity.ts";
import {
  QUOTA_DIMENSIONS,
  SOFT_DIMENSIONS,
  FairScheduler,
  HardQuotaService,
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
  // JWT 加固（SEC-023 fail-closed 口径）：载荷非法 / exp 缺失 / exp 类型错误 → 拒绝而非异常或永不过期
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf8").toString("base64url");
  const badPayload = Buffer.from("{not-json", "utf8").toString("base64url");
  const badSig = createHmac("sha256", "secret").update(`${header}.${badPayload}`).digest("base64url");
  assert.equal(verifyUserToken(`${header}.${badPayload}.${badSig}`, "secret").reason, "JWT_MALFORMED"); // 签名合法但载荷非法
  const noExp = verifyUserToken(signUserToken({ ...claims, exp: undefined }, "secret"), "secret");
  assert.equal(noExp.ok, false);
  assert.equal(noExp.reason, "JWT_MALFORMED");
  const stringExp = verifyUserToken(signUserToken({ ...claims, exp: "soon" }, "secret"), "secret");
  assert.equal(stringExp.ok, false);
  assert.equal(stringExp.reason, "JWT_MALFORMED");
  // 停用吊销（PRD-055）：停用后令牌 ≤ 5 分钟失效（JWT_REVOKED）
  const revocations = new TokenRevocationRegistry();
  revocations.revoke("u-1", Date.now() - 6 * 60 * 1000); // 停用于 6 min 前 → 已过 5 min 宽限
  const revoked = verifyUserToken(token, "secret", revocations);
  assert.equal(revoked.ok, false);
  assert.equal(revoked.reason, "JWT_REVOKED");
  // RBAC：场景/插件/工具/MCP/沙箱上限逐类
  assert.equal(rbacCheck(policy, "admin", { scenario: "coding" }).allowed, true);
  assert.equal(rbacCheck(policy, "viewer", { scenario: "coding" }).reason, "RBAC_SCENARIO_DENIED");
  assert.equal(rbacCheck(policy, "viewer", { tool: "shell" }).reason, "RBAC_TOOL_DENIED");
  assert.equal(rbacCheck(policy, "viewer", { mcpConnector: "github" }).reason, "RBAC_MCP_DENIED");
  // 沙箱模式上限（C38/SEC-023）：viewer 上限 read-only，workspace-write 超限
  assert.equal(rbacCheck(policy, "viewer", { sandboxMode: "workspace-write" }).reason, "RBAC_SANDBOX_CEILING");
  assert.equal(rbacCheck(policy, "admin", { sandboxMode: "workspace-write" }).allowed, true);
  // 沙箱模式未知值一律拒绝（fail-closed，SEC-023/C38）：danger-full-access 与 never 不可达
  assert.equal(rbacCheck(policy, "viewer", { sandboxMode: "danger-full-access" }).reason, "RBAC_SANDBOX_CEILING");
  assert.equal(rbacCheck(policy, "admin", { sandboxMode: "danger-full-access" }).reason, "RBAC_SANDBOX_CEILING");
  assert.equal(rbacCheck(policy, "admin", { sandboxMode: "never" }).reason, "RBAC_SANDBOX_CEILING");
  assert.equal(rbacCheck(policy, "admin", { sandboxMode: "read-only" }).allowed, true);
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
  const record = { tenantId: "tenant-a", turnId: "t-1", workspaceId: "ws-1", userId: "u-1", scenario: "coding", connector: "github", inputTokens: 100, outputTokens: 50, cacheHitTokens: 20 };
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
  ledger.ingest({ tenantId: "tenant-a", turnId: "t-2", workspaceId: "ws-1", userId: "u-1", scenario: "coding", connector: "github", inputTokens: 10, outputTokens: 5, cacheHitTokens: 0 });
  const afterTombstone = ledger.usage("connector", ["github"]);
  assert.equal(afterTombstone[0].reconciled, false);
  assert.equal(afterTombstone[0].underCounted, 1);
  // workspace 维度 + 导出
  assert.equal(ledger.usage("workspace", ["ws-1"]).length, 1);
  assert.ok(ledger.exportAll("workspace", ["ws-1"]).includes("generatedAt"));
  // user 维度（PRD-036）：按 userId 归集——另一用户的用量不计入
  ledger.ingest({ tenantId: "tenant-a", turnId: "t-3", workspaceId: "ws-1", userId: "u-2", scenario: "coding", connector: "github", inputTokens: 500, outputTokens: 0, cacheHitTokens: 0 });
  const byUser = ledger.usage("user", ["u-1"]);
  assert.equal(byUser.length, 1);
  assert.equal(byUser[0].inputTokens, 110);
  // scenario 维度（PRD-036）：按 scenario 归集——其他 scenario 键返回空
  const byScenario = ledger.usage("scenario", ["coding"]);
  assert.equal(byScenario.length, 1);
  assert.equal(byScenario[0].inputTokens, 610);
  assert.equal(ledger.usage("scenario", ["nonexistent"]).length, 0);
});

test("P3-6: 硬配额拒绝（PRD-040 同租户不连坐）——超限发射 QUOTA_HARD_EXCEEDED / QUOTA_WORKSPACE_SHARE_EXCEEDED", () => {
  const hard = new HardQuotaService();
  // 硬维度：达到上限即拒绝新 turn，发射 QUOTA_HARD_EXCEEDED
  assert.deepEqual(hard.admitHard({ dimension: "domainSlots", usage: 3, limit: 3 }), { allowed: false, reason: "QUOTA_HARD_EXCEEDED" });
  assert.equal(hard.admitHard({ dimension: "modelConcurrency", usage: 2, limit: 4 }).allowed, true);
  // 负值/非有限输入拒绝（fail-closed）
  assert.throws(() => hard.admitHard({ dimension: "cpu", usage: -1, limit: 4 }), /QUOTA_INPUT_INVALID/);
  assert.throws(() => hard.admitHard({ dimension: "cpu", usage: Number.NaN, limit: 4 }), /QUOTA_INPUT_INVALID/);
  // workspace 份额：某 workspace 超限只拒绝该 workspace，同租户其他 workspace 不受影响（PRD-040）
  assert.deepEqual(hard.admitWorkspace({ workspaceId: "ws-1", current: 5, shareLimit: 5 }), { allowed: false, reason: "QUOTA_WORKSPACE_SHARE_EXCEEDED" });
  assert.equal(hard.admitWorkspace({ workspaceId: "ws-2", current: 1, shareLimit: 5 }).allowed, true);
  assert.throws(() => hard.admitWorkspace({ workspaceId: "ws-1", current: 1, shareLimit: -1 }), /QUOTA_INPUT_INVALID/);
  // 原因码在硬拒绝码全集内（验收：不含软依赖原因码）
  assert.ok(HARD_REJECTION_CODES.includes("QUOTA_HARD_EXCEEDED"));
  assert.ok(HARD_REJECTION_CODES.includes("QUOTA_WORKSPACE_SHARE_EXCEEDED"));
});
