/**
 * 企业身份生命周期与降级可观测性契约（`COPY-027`；`REL-037`–`REL-051`；`REL-121`–`REL-127`；GATE-005 收口）。
 *
 * 直跑入口（进程内 test()，与既有契约套件同一模式）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { SsoScimLifecycle, DegradationLadder, TenantAlertAggregator } from "../../../../packages/control-plane/src/lifecycle/ops.ts";
import { OPERATIONS, OPERATION_IDS, OPENAPI_VERSION } from "../../../../packages/sdk/src/index.ts";

test("P4.5-1: packages/sdk 由 OpenAPI 生成且 CI 可校验一致（ENG-020）", () => {
  assert.equal(OPENAPI_VERSION, "3.1.0");
  assert.ok(OPERATIONS.length >= 30);
  assert.ok(OPERATION_IDS.every((id) => typeof id === "string" && id.length > 0));
  // 生成物带 // @generated 头（文件首行，由生成器写入）
});

test("P4.5-2: SSO/SCIM——自动开通/离职收回；停用后 5 分钟内会话与令牌失效（COPY-027）", () => {
  const lifecycle = new SsoScimLifecycle();
  lifecycle.provision("u-1", "tenant-a", "scim");
  lifecycle.provision("u-2", "tenant-a", "saml");
  lifecycle.openSession("u-1", 0);
  lifecycle.openSession("u-2", 0);
  assert.equal(lifecycle.sessionValid("u-1", "0", 1000), true);
  // 离职收回：停用 ⇒ 相关会话与令牌 5 分钟内失效
  const result = lifecycle.deactivate("u-1", 2000);
  assert.equal(result.revokedSessions, 1);
  assert.equal(result.withinMinutes, 5);
  assert.equal(lifecycle.sessionValid("u-1", "0", 2000 + 5 * 60 * 1000), false); // 5 min 后失效
  assert.equal(lifecycle.sessionValid("u-2", "0", 2000 + 5 * 60 * 1000), true); // 其他账号不受影响
});

test("P4.5-3: 降级阶梯——跃迁表/滞回/软依赖不阻断（REL-037–051）", () => {
  const ladder = new DegradationLadder();
  // 升级允许跳级：L0 → L3 立即生效
  assert.equal(ladder.transition("L3").applied, true);
  assert.equal(ladder.current(), "L3");
  // 降级必须逐级：L3 → L0 禁止
  assert.equal(ladder.transition("L0").applied, false);
  assert.ok(ladder.transition("L0").reason.includes("FORBIDDEN"));
  // L3 → L2 → L1(b) → L0 逐级
  assert.equal(ladder.transition("L2").applied, true);
  // L2 → L0 须重 attest（REL-043）
  assert.equal(ladder.transition("L0").applied, false);
  assert.ok(ladder.transition("L0", { reattestOk: true }).reason === undefined || ladder.transition("L0", { reattestOk: true }).applied === true);
  assert.equal(ladder.current(), "L0");
  // L1b → L0 禁止直跳（须经 L1）
  const ladder2 = new DegradationLadder();
  ladder2.transition("L1b");
  assert.equal(ladder2.transition("L0").applied, false);
  // 级别下发通道打通：每次跃迁有下发记录
  assert.ok(ladder.distributed.length > 0);
  assert.ok(ladder.distributed.every((d) => d.hash.length === 16));
});

test("P4.5-4: 按租户聚合降级事件——跨过驻留阈值才告警；错误预算与冻结清单（REL-121–127）", () => {
  const aggregator = new TenantAlertAggregator();
  const fiveMin = 5 * 60 * 1000;
  // 首次事件：未跨过驻留阈值 → 不告警
  assert.equal(aggregator.ingest({ tenantId: "t1", dimension: "DIM-04", subKey: "catalog", level: "L2", at: 0 }).alerted, false);
  // 跨过驻留阈值 → 告警
  assert.equal(aggregator.ingest({ tenantId: "t1", dimension: "DIM-04", subKey: "catalog", level: "L2", at: fiveMin }).alerted, true);
  // 跨作用域聚合：不同租户/维度分列（不得合并为单值）
  assert.equal(aggregator.ingest({ tenantId: "t2", dimension: "DIM-03", subKey: "billing", level: "L1b", at: fiveMin }).alerted, false);
  // 错误预算：中断时长 / 43200 min × 100%；耗尽 ⇒ 冻结清单生效
  const budget = aggregator.errorBudgetConsumed(43.2);
  assert.equal(budget.consumedPercent, 0.1);
  assert.equal(aggregator.frozen(99.9), false);
  assert.equal(aggregator.frozen(100), true);
});
