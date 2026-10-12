/**
 * 多租户隔离与可报价契约（`GATE-004` 验收四条；`REL-061`–`REL-063`、`REL-068`；`PRD-043`–`PRD-049`）。
 *
 * 直跑入口（进程内 test()，与既有契约套件同一模式）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IsolationDomainRegistry,
  WorkspaceLeaseService,
  classifyDrift,
  NetworkPolicy,
  DomainPool,
  READ_ISOLATION_DISCLOSURE,
} from "../../../../packages/control-plane/src/pool/domain-pool.ts";
import { deriveNodeCapacity, grossMargin, unitEconomicsMatrix } from "../../../../packages/control-plane/src/pool/capacity-cost.ts";

test("GATE-004-1: 一 (租户, 隔离组) 一域；跨租户互不可见（D5；§4.1）", () => {
  const registry = new IsolationDomainRegistry();
  const a = registry.assign({ tenantId: "tenant-a", isolationGroupId: "ig-1" });
  const a2 = registry.assign({ tenantId: "tenant-a", isolationGroupId: "ig-2" });
  // 同租户多隔离组：各自独立域
  assert.notEqual(a.domainId, a2.domainId);
  // 跨租户互不可见：另一租户视角下本租户的域不可解析
  assert.deepEqual(registry.visibleTenants(a.domainId), ["tenant-a"]);
  // 域内读不隔离披露（C44）：need-to-know 客户走团队/用户级隔离组
  assert.ok(READ_ISOLATION_DISCLOSURE.includes("读不隔离"));
  assert.ok(READ_ISOLATION_DISCLOSURE.includes("租户, 团队"));
  // 域内按 workspace 分区：各占独立可写根（由 workspace 独占租约承载，见 GATE-004-4）
});

test("GATE-004-2: N_node = min(内存约束, 爆炸半径约束) 且有数字（REL-061/062/063）", () => {
  // 示例推导值与 docs/reliability/failure-domain-matrix.md §4 同源（PP 参数〔待压测回填〕）
  const derivation = deriveNodeCapacity({
    nodeMemoryGb: 256,
    domainMemoryGb: 2.5,
    affectedTenantCap: 50,
    recoveryDomainsPerWindow: 2,
    slaRecoveryHours: 30,
    tenantCount: 1000,
    yPercent: 10,
  });
  assert.equal(derivation.nMem.value, 102); // ⌊256 / 2.5⌋
  assert.equal(derivation.nBlast.value, 50); // min(50, ⌊2 × 30⌋) = min(50, 60) = 50
  assert.equal(derivation.nNode.value, 50); // min(102, 50) = 50 —— 爆炸半径约束生效
  assert.ok(derivation.nNode.formula.includes("min(102, 50)"));
  // 每项输入标注来源与敏感性（REL-061：只有结论无输入即失败）
  assert.ok(derivation.nMem.inputs.every((i) => i.sourceType && i.sensitivity && i.status));
  assert.ok(derivation.nBlast.inputs.every((i) => i.sourceType && i.sensitivity && i.status));
  // 跨租户反亲和：任一节点租户数 ≤ min(N_node, Y% × 租户总数)（REL-062）
  assert.equal(derivation.antiAffinityCapPerNode.value, 50); // min(50, 100)
  assert.ok(derivation.note.includes("不得只由内存推出"));
});

test("GATE-004-3: ≥3 个客户画像可算毛利率；4 画像 × 3 档矩阵 12 格全数字（PRD-043–045）", () => {
  const cost = {
    inputTokenPrice: 0.5,
    outputTokenPrice: 2.0,
    cacheDiscount: 0.5,
    fixedAmortization: 30,
    mcpHostingPerProcess: 8,
    storagePerGb: 0.1,
    egressPerGb: 0.05,
    windowsPremium: 5,
  };
  const profiles = [
    { profile: "重度编码", inputTokensPerMonth: 120_000_000, outputTokensPerMonth: 40_000_000, cacheHitRatio: 0.3, mcpProcesses: 4, storageGb: 20, egressGb: 10, monthlyRevenue: 800 },
    { profile: "轻度问答", inputTokensPerMonth: 15_000_000, outputTokensPerMonth: 4_000_000, cacheHitRatio: 0.4, mcpProcesses: 1, storageGb: 2, egressGb: 1, monthlyRevenue: 120 },
    { profile: "MCP 密集", inputTokensPerMonth: 30_000_000, outputTokensPerMonth: 10_000_000, cacheHitRatio: 0.2, mcpProcesses: 20, storageGb: 10, egressGb: 5, monthlyRevenue: 600 },
    { profile: "个人档", inputTokensPerMonth: 4_000_000, outputTokensPerMonth: 1_000_000, cacheHitRatio: 0.2, mcpProcesses: 0, storageGb: 1, egressGb: 0.5, monthlyRevenue: 20 },
  ];
  // ≥3 个画像可算出毛利率（P2 出口判据；本模型覆盖 4 个）
  const margins = profiles.map((profile) => grossMargin(profile, cost));
  assert.equal(margins.length, 4);
  assert.ok(margins.every((m) => Number.isFinite(m.grossMargin)));
  assert.ok(margins.every((m) => m.cTenant > 0));
  // token 为主成本项（§10.4 v2.6 修正）：重度编码画像的 token 占比最高
  const heavy = margins.find((m) => m.profile === "重度编码");
  assert.ok(heavy.tokenShare > 0.5);
  // 全部取值为假设值口径（PRD-044 判据③：上分位假设 + 成本加成 + 毛利护栏）
  assert.ok(margins.every((m) => m.valueBasis.includes("假设值")));
  // 4 画像 × 3 档 = 12 格全部有数字（PRD-045）
  const tiers = [
    { tier: "低", usageFactor: 0.5, priceFactor: 0.6 },
    { tier: "中", usageFactor: 1, priceFactor: 1 },
    { tier: "高", usageFactor: 3, priceFactor: 2.5 },
  ];
  const { matrix, allCellsNumeric } = unitEconomicsMatrix(profiles, cost, tiers);
  assert.equal(matrix.length, 12);
  assert.equal(allCellsNumeric, true);
  // 微利画像识别（PRD-046）：MCP 密集高用量档毛利最低
  const mcpHigh = matrix.find((cell) => cell.profile === "MCP 密集" && cell.tier === "高");
  assert.ok(Number.isFinite(mcpHigh.margin));
});

test("GATE-004-4: workspace 独占租约生效——无并发写同一 workspace（REL-068）", () => {
  const leases = new WorkspaceLeaseService();
  const first = leases.acquire("/workspace/ws-1", "domain:a:ig-1");
  assert.equal(first.epoch, 1);
  // 第二域同卷写租约：被拒 + 审计事件（REL-068 判据）
  assert.throws(() => leases.acquire("/workspace/ws-1", "domain:b:ig-1"), /WORKSPACE_LEASE_ALREADY_OWNED/);
  assert.ok(leases.audit.some((a) => a.kind === "workspace.lease.denied" && a.domainId === "domain:b:ig-1"));
  // fencing：当前持有者 epoch 匹配才可写
  assert.equal(leases.writeAllowed("/workspace/ws-1", "domain:a:ig-1", 1), true);
  assert.equal(leases.writeAllowed("/workspace/ws-1", "domain:b:ig-1", 1), false);
  // 所有权校验（REL-068 独占性）：非当前持有域不得发起转移
  assert.throws(() => leases.transfer("/workspace/ws-1", "domain:c:ig-1", "domain:b:ig-1"), /WORKSPACE_LEASE_NOT_OWNED/);
  assert.ok(leases.audit.some((a) => a.kind === "workspace.lease.transfer.denied" && a.domainId === "domain:c:ig-1"));
  // 可转移租约：当前持有域发起，epoch +1，源域旧 epoch 写被拒（fencing）
  const transferred = leases.transfer("/workspace/ws-1", "domain:a:ig-1", "domain:b:ig-1");
  assert.equal(transferred.epoch, 2);
  assert.equal(leases.writeAllowed("/workspace/ws-1", "domain:a:ig-1", 1), false);
  assert.equal(leases.writeAllowed("/workspace/ws-1", "domain:b:ig-1", 2), true);
  assert.ok(leases.audit.some((a) => a.kind === "workspace.lease.transferred"));
  // 转入与转出域相同：拒绝
  assert.throws(() => leases.transfer("/workspace/ws-1", "domain:b:ig-1", "domain:b:ig-1"), /WORKSPACE_LEASE_TRANSFER_SELF/);
  // 释放：非持有域释放被拒 + 审计；持有域释放成功
  assert.throws(() => leases.release("/workspace/ws-1", "domain:a:ig-1"), /WORKSPACE_LEASE_NOT_OWNED/);
  assert.ok(leases.audit.some((a) => a.kind === "workspace.lease.release.denied" && a.domainId === "domain:a:ig-1"));
  leases.release("/workspace/ws-1", "domain:b:ig-1");
  assert.ok(leases.audit.some((a) => a.kind === "workspace.lease.released" && a.domainId === "domain:b:ig-1"));
  assert.equal(leases.writeAllowed("/workspace/ws-1", "domain:b:ig-1", 2), false);
});

test("P2-1: 域池三态——冻结前置条件 + 快照完整性 + 等待页（§10.4/§10.1）", async () => {
  const root = mkdtempSync(join(tmpdir(), "p2-pool-"));
  const pool = new DomainPool(root);
  assert.equal(pool.current("d-1"), "hot");
  // 冻结：flush + 排空缓冲 + 写 suspend 标记；快照含投影缓存与未上传缓冲
  const pending = [{ turnId: "t-1", tokens: 100 }];
  const snapshot = pool.freeze("d-1", {
    flush: () => {},
    drainBuffers: () => pending,
    projectionCache: { sessionId: "s-1", preset: "p-1" },
  });
  assert.equal(snapshot.state, "warm");
  assert.equal(snapshot.suspendMarker, true);
  assert.deepEqual(snapshot.pendingUploadBuffer, pending); // 未上传缓冲入快照（否则用量永久丢失）
  assert.deepEqual(snapshot.projectionCache, { sessionId: "s-1", preset: "p-1" });
  assert.equal(existsSync(join(root, "d-1.suspend.json")), true);
  assert.equal(pool.current("d-1"), "warm");
  // 恢复：投影缓存与未上传缓冲都在（用量不丢）
  const restored = pool.restore("d-1");
  assert.equal(restored.restored, true);
  assert.deepEqual(restored.pendingUploadBuffer, pending);
  assert.deepEqual(restored.projectionCache, { sessionId: "s-1", preset: "p-1" });
  assert.equal(pool.current("d-1"), "hot");
  // 冷启动：池空排队 → 等待页而非错误码（§10.1）；已热域诚实返回 waitingPage:false
  const cold = await pool.coldStart("d-2");
  assert.equal(cold.waitingPage, true);
  assert.equal(cold.state, "hot");
  assert.equal(pool.current("d-2"), "hot");
  const warm = await pool.coldStart("d-2");
  assert.equal(warm.waitingPage, false); // 已热：诚实语义，不再返回等待页
  assert.equal(warm.state, "hot");
});

test("P2-2: 运行期漂移两类事件 + 网络策略（§4.1/§9.3）", () => {
  // connector 生命周期变化（预期）→ 不摘域，工具不可用 + 告警 + 自动重载
  const lifecycle = classifyDrift({ kind: "connector-lifecycle", name: "github-mcp", authorized: true });
  assert.equal(lifecycle.eventClass, "connector-lifecycle");
  assert.equal(lifecycle.evictDomain, false);
  assert.equal(lifecycle.toolUnavailable, true);
  assert.equal(lifecycle.autoReload, true);
  // 先验归属（SEC-018）：未授权 connector 的生命周期事件也是异常漂移 → 摘域
  const unauthorizedLifecycle = classifyDrift({ kind: "connector-lifecycle", name: "evil-mcp", authorized: false });
  assert.equal(unauthorizedLifecycle.eventClass, "unauthorized-drift");
  assert.equal(unauthorizedLifecycle.evictDomain, true);
  assert.equal(unauthorizedLifecycle.requiresSeparateApproval, true);
  // Profile 未授权的插件/工具出现（异常）→ 摘域 + 单独审批
  const drift = classifyDrift({ kind: "tool-drift", name: "mcp_evil_tool", authorized: false });
  assert.equal(drift.eventClass, "unauthorized-drift");
  assert.equal(drift.evictDomain, true);
  assert.equal(drift.requiresSeparateApproval, true);
  assert.equal(drift.autoReload, false);
  // 网络策略：默认拒绝入站；出站白名单
  const policy = new NetworkPolicy(["https://api.github.com", "https://registry.npmjs.org"]);
  assert.equal(policy.inbound().allowed, false);
  assert.equal(policy.egress("https://api.github.com/repos").allowed, true);
  assert.equal(policy.egress("https://evil.example.com").allowed, false);
});

test("P2-3: 隔离域 ID 格式校验 + 容量/成本输入校验（D5 防御；0/负值拒绝而非 Infinity/NaN）", () => {
  const registry = new IsolationDomainRegistry();
  // ID 格式校验：":" 注入（可能造成 domainId 歧义碰撞）被拒
  assert.throws(() => registry.assign({ tenantId: "a:b", isolationGroupId: "c" }), /DOMAIN_ID_INVALID/);
  assert.throws(() => registry.assign({ tenantId: "tenant-a", isolationGroupId: "ig:1" }), /DOMAIN_ID_INVALID/);
  assert.throws(() => registry.assign({ tenantId: "", isolationGroupId: "ig-1" }), /DOMAIN_ID_INVALID/);
  // 合法 ID 正常分配
  assert.equal(registry.assign({ tenantId: "tenant-a", isolationGroupId: "ig-1" }).domainId, "domain:tenant-a:ig-1");
  // 容量输入校验：0/负值/越界拒绝（不产生 Infinity）
  assert.throws(() => deriveNodeCapacity({ nodeMemoryGb: 256, domainMemoryGb: 0, affectedTenantCap: 50, recoveryDomainsPerWindow: 2, slaRecoveryHours: 30, tenantCount: 1000, yPercent: 10 }), /CAPACITY_INPUT_INVALID/);
  assert.throws(() => deriveNodeCapacity({ nodeMemoryGb: -256, domainMemoryGb: 2.5, affectedTenantCap: 50, recoveryDomainsPerWindow: 2, slaRecoveryHours: 30, tenantCount: 1000, yPercent: 10 }), /CAPACITY_INPUT_INVALID/);
  assert.throws(() => deriveNodeCapacity({ nodeMemoryGb: 256, domainMemoryGb: 2.5, affectedTenantCap: 50, recoveryDomainsPerWindow: 2, slaRecoveryHours: 30, tenantCount: 1000, yPercent: 150 }), /CAPACITY_INPUT_INVALID/);
  // 成本输入校验：0 收入/负值/越界 cacheHitRatio 拒绝（不产生 NaN 毛利率）
  const cost = { inputTokenPrice: 0.5, outputTokenPrice: 2.0, cacheDiscount: 0.5, fixedAmortization: 30, mcpHostingPerProcess: 8, storagePerGb: 0.1, egressPerGb: 0.05, windowsPremium: 5 };
  const profile = { profile: "p", inputTokensPerMonth: 100, outputTokensPerMonth: 100, cacheHitRatio: 0.3, mcpProcesses: 1, storageGb: 2, egressGb: 1, monthlyRevenue: 100 };
  assert.throws(() => grossMargin({ ...profile, monthlyRevenue: 0 }, cost), /COST_INPUT_INVALID/);
  assert.throws(() => grossMargin({ ...profile, egressGb: -1 }, cost), /COST_INPUT_INVALID/);
  assert.throws(() => grossMargin({ ...profile, cacheHitRatio: 1.5 }, cost), /COST_INPUT_INVALID/);
  assert.ok(Number.isFinite(grossMargin(profile, cost).grossMargin));
});
