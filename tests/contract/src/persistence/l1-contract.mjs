/**
 * SessionPersistence L1 语义级契约（`ENG-013`–`ENG-019`；`CTR-001` §5.3 P-1…P-7）
 * + `GATE-003` 验收五条 + 恢复/台账/分缓冲/对账/迁移（`REL-069`–`REL-084`、`ENG-059`）。
 *
 * 直跑入口（进程内 test()，与既有契约套件同一模式）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JsonlSessionPersistence, { DEFAULT_OWNERSHIP_LEASE, assertCurrentFormatOnly } from "../../../../packages/domain-bridge/src/persistence/jsonl-persistence.ts";
import {
  CURRENT_FORMAT_VERSION,
  sessionFormatVersionRefusal,
  sessionPersistenceCorruptionError,
  sessionFormatUnsupportedError,
} from "../../../../packages/domain-bridge/src/persistence/errors.ts";
import { computeUnclosed, recover, RECOVERY_SPANS, spanCoverageSpans, assertLogSizeBound } from "../../../../packages/domain-bridge/src/persistence/recovery.ts";
import { SideEffectLedger, nestedPolicyDeclared, entryComplete } from "../../../../packages/domain-bridge/src/persistence/side-effect-ledger.ts";
import { SplitBuffer } from "../../../../packages/domain-bridge/src/persistence/buffers.ts";
import { reconcile, dedupeByTurn, DIFF_RATE_THRESHOLD, rpoLayering } from "../../../../packages/domain-bridge/src/persistence/reconciliation.ts";
import { MigrationStateMachine } from "../../../../packages/domain-bridge/src/persistence/migration.ts";
import { DEFAULT_MAX_PENDING_BYTES } from "../../../../packages/domain-bridge/src/persistence/jsonl-persistence.ts";

function header(id) {
  return { id, formatVersion: CURRENT_FORMAT_VERSION, createdAt: new Date().toISOString(), tenantId: "t1", isolationGroupId: "ig1" };
}

function event(kind, extra = {}) {
  return { kind, ...extra };
}

const devOpts = () => ({ developmentOnlyNonLinux: true });

test("L1-A: 撕裂尾永不返回（ENG-015）", async () => {
  const root = mkdtempSync(join(tmpdir(), "l1-a-"));
  const store = new JsonlSessionPersistence(root, devOpts());
  const handle = await store.create(header("s-a"));
  await handle.append([event("turn-start", { turnId: "t1" }), event("tool", { turnId: "t1", callId: "c1", toolName: "x" })]);
  await handle.flush();
  // 故障注入：向日志尾写半帧/损坏帧
  appendFileSync(join(root, "s-a.jsonl"), '{"v":"1","kind":"tool-resu');
  const read1 = await handle.read();
  assert.equal(read1[read1.length - 1].kind, "tool"); // 半帧不被返回
  // 反复读不更旧
  const read2 = await handle.read();
  assert.ok(read2.length >= read1.length);
  // 恢复流程在该输入下正常终结
  const closers = computeUnclosed(read2);
  assert.ok(Array.isArray(closers));
  await handle.close();
  assert.ok(existsSync(join(root, "s-a.jsonl")));
});

test("L1-B: 单写者，第二个写句柄必须拒绝（ENG-016/P-3）", async () => {
  const root = mkdtempSync(join(tmpdir(), "l1-b-"));
  const store = new JsonlSessionPersistence(root, devOpts());
  const handle = await store.create(header("s-b"));
  await assert.rejects(() => store.open("s-b", "write", devOpts()), (error) => error.name === "SESSION_ALREADY_OWNED");
  // 不排队：拒绝即刻发生（无等待路径）；观察窗口内仍失败
  await new Promise((resolve) => setTimeout(resolve, 50));
  await assert.rejects(() => store.open("s-b", "write", devOpts()), (error) => error.name === "SESSION_ALREADY_OWNED");
  await handle.close();
  // 关闭后锁释放：可再次以写打开
  const reopened = await store.open("s-b", "write", devOpts());
  await reopened.close();
});

test("L1-C: close 幂等 + 关闭即持久化 + 锁释放（ENG-017）", async () => {
  const root = mkdtempSync(join(tmpdir(), "l1-c-"));
  const store = new JsonlSessionPersistence(root, devOpts());
  const handle = await store.create(header("s-c"));
  await handle.append([event("turn-start", { turnId: "t1" })]);
  await handle.close();
  await handle.close(); // 幂等：两次均 resolve
  // close 后无残留锁（flock 探针可获）：不存在残留锁
  assert.equal(existsSync(join(root, "s-c.session.lock")), false);
  const reopened = await store.open("s-c", "write", devOpts());
  const events = await reopened.read();
  assert.equal(events.length, 1); // 关闭即 flush：未决事件已持久化
  assert.equal(events[0].kind, "turn-start");
  await reopened.close();
  // close 后逐方法断言 SESSION_HANDLE_CLOSED
  await assert.rejects(() => reopened.read(), (error) => error.name === "SESSION_HANDLE_CLOSED");
  await assert.rejects(() => reopened.append([event("x")]), (error) => error.name === "SESSION_HANDLE_CLOSED");
  await assert.rejects(() => reopened.flush(), (error) => error.name === "SESSION_HANDLE_CLOSED");
  await reopened.close(); // 幂等
  assert.equal(existsSync(join(root, "s-c.session.lock")), false);
});

test("L1-D: flush 屏障 + 空会话 flush 后才可 list（ENG-014/P-1）", async () => {
  const root = mkdtempSync(join(tmpdir(), "l1-d-"));
  const store = new JsonlSessionPersistence(root, devOpts());
  const handle = await store.create(header("s-d"));
  // create 后未 flush：其他进程 list 不可见
  assert.equal((await store.list()).length, 0);
  await handle.flush();
  assert.equal((await store.list()).length, 1); // flush 后可见且可 open
  await handle.close(); // 释放写锁
  const writer = await store.open("s-d", "write", devOpts());
  // 杀进程语义：append 未 flush 的尾部允许丢失，已 flush 的事件必须全部存在
  await writer.append([event("turn-start", { turnId: "t1" })]);
  await writer.flush();
  await writer.append([event("tool", { turnId: "t1", callId: "c1", toolName: "x" })]); // 未 flush（模拟崩溃丢尾）
  // 进程被杀：锁无过期（C23），跨实例续跑走人为处置入口（REL-082）——显式标志 + 心跳过期
  await new Promise((resolve) => setTimeout(resolve, 30));
  const fresh = new JsonlSessionPersistence(root, { developmentOnlyNonLinux: true, ownershipLease: { renewalMs: 1, expiryMs: 10 } });
  // 未带显式接管标志：仍即刻拒绝（不依赖超时兜底）
  await assert.rejects(() => fresh.open("s-d", "write", devOpts()), (error) => error.name === "SESSION_ALREADY_OWNED");
  const reopened = await fresh.open("s-d", "write", { takeoverStaleLease: true });
  const events = await reopened.read();
  assert.equal(events.length, 1); // 已 flush 的存活
  assert.equal(events[0].kind, "turn-start");
  await reopened.close();
});

test("L1-E: freshness（ENG-018/P-5）", async () => {
  const root = mkdtempSync(join(tmpdir(), "l1-e-"));
  const store = new JsonlSessionPersistence(root, devOpts());
  const handle = await store.create(header("s-e"));
  await handle.append([event("turn-start", { turnId: "t1" }), event("tool", { turnId: "t1", callId: "c1", toolName: "x" })]);
  await handle.flush();
  // 写批 flush 后启动的任意读必须至少看到此前缀
  const fresh = new JsonlSessionPersistence(root, devOpts());
  const reader = await fresh.open("s-e", "read");
  const events = await reader.read();
  assert.equal(events.length, 2);
  // stat revision 同实例比较语义：相同即视为未变
  const stat1 = await fresh.stat("s-e");
  const stat2 = await fresh.stat("s-e");
  assert.equal(stat1.revision, stat2.revision);
  await reader.close();
  await handle.close();
});

test("L1-F: list 无分页无过滤无索引（ENG-019/C24）", async () => {
  const root = mkdtempSync(join(tmpdir(), "l1-f-"));
  const store = new JsonlSessionPersistence(root, devOpts());
  const handle = await store.create(header("s-f"));
  await handle.close();
  await store.flush();
  const summaries = await store.list();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].id, "s-f");
  // 类型层断言：list() 不接受 limit/cursor（参数元数 == 0）
  assert.equal(store.list.length, 0);
  await handle.close();
});

test("L1-G: 格式拒绝方向——7 与 8 分开；文案含升级 harness，绝无 corrupt（P-7）", async () => {
  // 8：格式不受支持（日志完好但无法忠实解释）→ 升级 harness
  const refusal = sessionFormatVersionRefusal("s-g", "9", { kind: "log", path: "/x/s-g.jsonl" });
  assert.ok(refusal.includes("upgrade the harness"));
  assert.ok(!refusal.toLowerCase().includes("corrupt"));
  const formatError = sessionFormatUnsupportedError("s-g", "9", { kind: "log", path: "/x/s-g.jsonl" });
  assert.equal(formatError.name, "SESSION_FORMAT_UNSUPPORTED");
  assert.ok(formatError.message.includes("upgrade the harness"));
  // 7：损坏（内容校验失败）→ 独立错误类
  const corruption = sessionPersistenceCorruptionError("s-g");
  assert.equal(corruption.name, "SESSION_PERSISTENCE_CORRUPTION");
  // 禁止世代迁移：boot 断言仅支持当前 format
  assert.throws(() => assertCurrentFormatOnly("9"), (error) => error.name === "SESSION_FORMAT_UNSUPPORTED");
});

test("L1-H: L1 禁止事项——compression none、NFS/FUSE 拒绝、租约阈值自定（§11.4.1）", () => {
  // compression !== none 必须拒绝
  assert.throws(() => {
    const store = new JsonlSessionPersistence(join(tmpdir(), "l1-h-"), devOpts());
    void store;
    new JsonlSessionPersistence(join(tmpdir(), "l1-h2-"), { ...devOpts(), compression: "gzip" });
  }, /compression must be none/);
  // 共享 NFS/FUSE 写路径必须拒绝（REL-085）
  assert.throws(() => {
    void new JsonlSessionPersistence("/mnt/nfs/domains", devOpts());
  }, /NFS\/FUSE/);
  // 租约阈值为本方案自定义（内核无参考行为基线）：登记值并断言非内核口径
  assert.equal(DEFAULT_OWNERSHIP_LEASE.renewalMs, 30_000);
  assert.equal(DEFAULT_OWNERSHIP_LEASE.expiryMs, 90_000);
  // scope 断言：单域/Linux-only/none/本地卷/禁止世代迁移
  const store = new JsonlSessionPersistence(mkdtempSync(join(tmpdir(), "l1-h3-")), devOpts());
  assert.deepEqual(store.scope, { domain: "single", platforms: ["linux"], compression: "none", storageMedium: "local-volume", generationMigration: false });
});

test("GATE-003-1: 进程被杀后另一实例续跑；closer 收尾且不回滚（REL-069/070）", async () => {
  const root = mkdtempSync(join(tmpdir(), "g3-1-"));
  const first = new JsonlSessionPersistence(root, devOpts());
  const handle = await first.create(header("s-g1"));
  await handle.append([event("turn-start", { turnId: "t1" }), event("step-start", { turnId: "t1", callId: "st1" }), event("tool", { turnId: "t1", callId: "c1", toolName: "shell" })]);
  await handle.flush();
  await handle.close(); // 进程"被杀"：日志留在 tool 未闭合
  // 另一实例续跑：恢复 = 读 + 追加合成 closer（不是回滚）
  const second = new JsonlSessionPersistence(root, devOpts());
  const reopened = await second.open("s-g1", "write", devOpts());
  const before = await reopened.read();
  const closers = computeUnclosed(before);
  assert.equal(closers.length, 3); // tool-result + step-end + turn-end{interrupted}
  assert.ok(closers.some((c) => c.kind === "tool-result" && c.callId === "c1"));
  assert.ok(closers.some((c) => c.kind === "turn-end"));
  await reopened.append(closers.map((c) => c.event));
  await reopened.flush();
  // 中断轮次永久保留在历史中：事件数单调不减（不回滚）
  const after = await reopened.read();
  assert.ok(after.length > before.length);
  assert.ok(after.some((e) => e.kind === "tool" && e.callId === "c1")); // 原 tool 事件仍在
  assert.ok(after.some((e) => e.synthetic === true && e.interrupted === true));
  // closer 幂等：再次恢复不得产生重复 closer（按 (turnId, callId) 去重）
  const closers2 = computeUnclosed(after);
  assert.equal(closers2.length, 0);
  await reopened.close();
});

test("GATE-003-1b: 恢复五 span 埋点 + 覆盖率 ≤ 5% + 上界断言（ENG-059/061）", () => {
  const events = [event("turn-start", { turnId: "t1" }), event("step-start", { turnId: "t1", callId: "st1" }), event("tool", { turnId: "t1", callId: "c1", toolName: "x" })];
  const appended = [];
  const result = recover("s-r", events, (batch) => appended.push(...batch));
  assert.deepEqual(result.spans.map((s) => s.span), [...RECOVERY_SPANS]); // 五 span 齐备
  const monotonic = result.spans.every((s, index) => index === 0 || s.monotonicMs >= result.spans[index - 1].monotonicMs);
  assert.ok(monotonic); // 时间戳单调
  const { gapRatio } = spanCoverageSpans(result.spans, result.spans[result.spans.length - 1].monotonicMs);
  assert.ok(gapRatio <= 0.05); // span 之和 vs 端到端 RTO ≤ 5%
  assert.equal(result.closersAppended.length, 3);
  assert.equal(appended.length, 3);
  // 日志事件量上界：超界产出事件并切档
  const bound = assertLogSizeBound(101, 100);
  assert.equal(bound.exceeded, true);
  assert.equal(bound.event.kind, "recovery.log_size_exceeded");
  assert.equal(bound.event.sloTier, "tiered");
});

test("GATE-003-2: 副作用台账——执行前写、fail-closed、产品策略禁自动重试（REL-072/073/074/075）", () => {
  const ledger = new SideEffectLedger();
  // 执行前写（硬）：九字段完整
  const entry = ledger.recordBeforeExecution({
    tenantId: "t1", isolationGroupId: "ig1", workspaceId: "ws1", sessionId: "s1", turnId: "t-1",
    callId: "c1", toolName: "shell", paramDigest: "sha512-x", targetResource: "/workspace/deploy.sh",
  });
  assert.equal(entry.outcome, "unconfirmed");
  assert.ok(entryComplete(entry));
  // 台账写入失败 ⇒ 调用被拒（fail-closed）
  const failing = new SideEffectLedger();
  failing.failWrites = true;
  assert.throws(() => failing.recordBeforeExecution({ tenantId: "t", isolationGroupId: "i", workspaceId: "w", sessionId: "s", turnId: "t", callId: "c", toolName: "x", paramDigest: "p", targetResource: "r" }));
  // 恢复后：产品策略（非模型判断）禁止自动重试
  const guard = ledger.policyGuard({ sessionId: "s1", turnId: "t-1", callId: "c1" });
  assert.equal(guard.allowed, false);
  assert.equal(guard.requiresConfirmation, true);
  assert.ok(guard.reason.includes("产品策略禁止自动重试"));
  // 嵌套派发：未声明者不得注册
  assert.equal(nestedPolicyDeclared({}), false);
  assert.equal(nestedPolicyDeclared({ nestedSideEffectPolicy: "inner-effects-ledgered-first" }), true);
  assert.equal(nestedPolicyDeclared({ nestedSideEffectPolicy: "forbid-non-idempotent" }), true);
});

test("GATE-003-3: 审计服务故障 6 小时不阻断执行（有界丢弃 + 墓碑生效）", () => {
  const alerts = [];
  const auditBuffer = new SplitBuffer({ level: "audit", bufferSeconds: 21600, maxEntries: 10, onAlert: (t) => alerts.push(t) });
  // 审计服务故障 6 小时：持续入队 50 条（远超上限）——执行不阻断、不抛错
  for (let index = 0; index < 50; index += 1) {
    auditBuffer.enqueue("t1", `turn-${index}`, { seq: index });
  }
  assert.equal(alerts.length >= 40, true); // 有界丢弃 + 硬告警
  assert.ok(alerts.every((t) => t.reconciled === false && t.kind === "buffer.dropped"));
  assert.equal(auditBuffer.drain().length, 10); // 仅保留上限内条目
  // 计费与审计各自独立判定级别：互不共享容量
  const billingBuffer = new SplitBuffer({ level: "billing", bufferSeconds: 21600, maxEntries: 5 });
  billingBuffer.enqueue("t1", "turn-x", { cost: 1 });
  assert.equal(billingBuffer.drain().length, 1);
});

test("GATE-003-4: 对账差异率 ≤ 0.01%，少计与多计分列（REL-090/095/096）", () => {
  const logDerived = [
    { tenantId: "t1", turnId: "a", amount: 100 },
    { tenantId: "t1", turnId: "b", amount: 50 },
  ];
  // 幂等扣减：同 turnId 重复上传只计一次
  const deduped = dedupeByTurn([...logDerived, { tenantId: "t1", turnId: "a", amount: 100 }]);
  assert.equal(deduped.size, 2);
  const result = reconcile({ logDerived, ledger: [{ tenantId: "t1", turnId: "a", amount: 100 }], tenantId: "t1" });
  assert.equal(result.underCounted, 50); // 少计（收入漏损）
  assert.equal(result.overCounted, 0); // 多计（客户争议）分列
  assert.ok(Math.abs(result.diffRate - 50 / 150) < 1e-9);
  assert.equal(result.withinThreshold, false);
  // 收敛样本：差异率 ≤ 0.01%
  const converged = reconcile({ logDerived, ledger: [{ tenantId: "t1", turnId: "a", amount: 100 }, { tenantId: "t1", turnId: "b", amount: 50 }], tenantId: "t1" });
  assert.equal(converged.diffRate, 0);
  assert.equal(converged.withinThreshold, true);
  assert.equal(DIFF_RATE_THRESHOLD, 0.0001);
});

test("GATE-003-5: 迁移状态机五态 + seq 断言 + FAILED 幂等重驱动（REL-077/078/079/080/083）", () => {
  const migration = new MigrationStateMachine("m-1");
  migration.transition("HANDOFF_ARMED");
  // 回退边界：HANDOFF_ARMED 之后禁止回退 PENDING（REL-078）
  assert.throws(() => migration.transition("PENDING"), /MIGRATION_INVALID_TRANSITION/);
  migration.transition("SOURCE_RELEASED");
  // 步骤 4 断言：targetBaseSeq != sourceLastReplicatedSeq ⇒ 拒绝 handoff → FAILED
  migration.recordSeqs(10, 12);
  migration.transition("OWNED");
  assert.equal(migration.snapshot().state, "FAILED");
  assert.ok(migration.snapshot().steps.some((step) => step.includes("handoff-rejected")));
  // FAILED 幂等重驱动
  migration.redrive();
  assert.equal(migration.snapshot().state, "PENDING");
  // 正常路径：seq 相等 → OWNED，epoch +1（fencing）
  migration.transition("HANDOFF_ARMED");
  migration.transition("SOURCE_RELEASED");
  migration.recordSeqs(12, 12);
  migration.transition("OWNED");
  const final = migration.snapshot();
  assert.equal(final.state, "OWNED");
  assert.equal(final.epoch, 1); // epoch 提升：源在提升后的 append 被拒（fencing，REL-083）
});

// ── 2026-10-12 修复钉死（阻断#2/#3/#4/#5、建议#10/13/15/17 对应行为）──────────

test("FIX-2: 迁移 seq 断言——未 recordSeqs 即迁移 ⇒ FAILED（REL-079 防空洞通过）", () => {
  const migration = new MigrationStateMachine("m-fix2");
  migration.transition("HANDOFF_ARMED");
  migration.transition("SOURCE_RELEASED");
  // 未调用 recordSeqs：断言必须失败（不得因 undefined !== undefined 为 false 而空洞通过）
  migration.transition("OWNED");
  assert.equal(migration.snapshot().state, "FAILED");
  assert.ok(migration.snapshot().steps.some((step) => step.includes("seqs not asserted")));
  // FAILED 可重驱动（REL-080），补记序号后正常 handoff
  migration.redrive();
  assert.equal(migration.snapshot().state, "PENDING");
  migration.transition("HANDOFF_ARMED");
  migration.transition("SOURCE_RELEASED");
  // transition 直传 input 序号：相等即放行（不依赖 recordSeqs）
  migration.transition("OWNED", { targetBaseSeq: 7, sourceLastReplicatedSeq: 7 });
  assert.equal(migration.snapshot().state, "OWNED");
  assert.equal(migration.snapshot().epoch, 1);
  // transition 直传不等序号 ⇒ FAILED（步骤 4 断言仍然生效）
  const m2 = new MigrationStateMachine("m-fix2b");
  m2.transition("HANDOFF_ARMED");
  m2.transition("SOURCE_RELEASED");
  m2.transition("OWNED", { targetBaseSeq: 1, sourceLastReplicatedSeq: 2 });
  assert.equal(m2.snapshot().state, "FAILED");
});

test("FIX-3: 分缓冲超时驱逐——墓碑归属被驱逐条目自身的租户（审计归属不错位）", () => {
  const alerts = [];
  const buffer = new SplitBuffer({ level: "audit", bufferSeconds: 1, maxEntries: 100, onAlert: (t) => alerts.push(t) });
  buffer.enqueue("tenant-A", "turn-a", { seq: 1 });
  buffer.enqueue("tenant-B", "turn-b", { seq: 2 });
  // 等过 bufferSeconds 使全部条目过期（超时驱逐路径）
  return new Promise((resolve) => setTimeout(resolve, 1100)).then(() => {
    buffer.drain(); // 触发 evictExpired
    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].tenantId, "tenant-A"); // 归属被驱逐条目自身，不是下一条
    assert.equal(alerts[1].tenantId, "tenant-B"); // 不是 "unknown"
  });
});

test("FIX-4: create 并发原子性——已存在即 SessionAlreadyExistsError（flag:wx，不静默覆盖）", async () => {
  const root = mkdtempSync(join(tmpdir(), "fix4-"));
  const store = new JsonlSessionPersistence(root, devOpts());
  const handle = await store.create(header("s-fix4"));
  await handle.append([event("turn-start", { turnId: "t1" })]);
  // 并发 create 同一 id：必须被拒（EEXIST → SessionAlreadyExistsError），不得覆盖首写
  await assert.rejects(() => store.create(header("s-fix4")), (error) => error.name === "SESSION_ALREADY_EXISTS");
  await handle.flush();
  const reopened = await store.open("s-fix4", "read");
  const events = await reopened.read();
  assert.equal(events.length, 1); // 首写未被覆盖
  await reopened.close();
  await handle.close();
  assert.equal(DEFAULT_MAX_PENDING_BYTES, 64 * 1024 * 1024); // 未决缓冲默认上限：64 MiB（自定义登记值）
});

test("FIX-5: flush/close O_APPEND 追加写 + 未决缓冲上限 fail-closed（P-2/P-3；上限为自定义登记）", async () => {
  const root = mkdtempSync(join(tmpdir(), "fix5-"));
  const store = new JsonlSessionPersistence(root, devOpts());
  const handle = await store.create(header("s-fix5"));
  // 未决缓冲上限：超限即拒绝（fail-closed），flush 后可继续
  const tiny = await store.create(header("s-fix5b"), { maxPendingBytes: 1024 });
  await assert.rejects(
    () => tiny.append([{ kind: "big", blob: "x".repeat(2048) }]),
    /SESSION_PENDING_OVERFLOW/,
  );
  await tiny.flush();
  await tiny.append([{ kind: "after-flush", ok: true }]); // flush 后缓冲清零，可继续 append
  await tiny.flush();
  await tiny.close();
  const checkTiny = await store.open("s-fix5b", "read");
  assert.equal((await checkTiny.read()).length, 1);
  await checkTiny.close();
  // O_APPEND 追加写：多次 flush 数据全部落盘且顺序正确（不整读重写）
  await handle.append([event("turn-start", { turnId: "t1" })]);
  await handle.flush();
  await handle.append([event("tool", { turnId: "t1", callId: "c1" })]);
  await handle.flush();
  await handle.append([event("turn-end", { turnId: "t1" })]);
  await handle.flush();
  const reader = await store.open("s-fix5", "read");
  const events = await reader.read();
  assert.deepEqual(events.map((e) => e.kind), ["turn-start", "tool", "turn-end"]);
  await reader.close();
  await handle.close();
});

test("FIX-6: 锁文件损坏 ⇒ fail-closed 拒绝（SessionAlreadyOwnedError，修复走 REL-082 处置）", async () => {
  const root = mkdtempSync(join(tmpdir(), "fix6-"));
  const store = new JsonlSessionPersistence(root, devOpts());
  const handle = await store.create(header("s-fix6"));
  writeFileSync(join(root, "s-fix6.session.lock"), '{"epoch":'); // 崩溃残留半帧锁文件
  await assert.rejects(() => store.open("s-fix6", "write", devOpts()), (error) => error.name === "SESSION_ALREADY_OWNED");
  await handle.close();
});

test("FIX-7: 副作用台账域外落盘——durablePath 逐条落盘，写失败即抛（REL-072 fail-closed）", async () => {
  const durablePath = join(mkdtempSync(join(tmpdir(), "fix7-")), "ledger.jsonl");
  const ledger = new SideEffectLedger({ durablePath });
  const entry = ledger.recordBeforeExecution({
    tenantId: "t1", isolationGroupId: "ig1", workspaceId: "ws1", sessionId: "s1", turnId: "t-1",
    callId: "c1", toolName: "shell", paramDigest: "sha512-x", targetResource: "/workspace/deploy.sh",
  });
  assert.ok(entryComplete(entry));
  // 域外落盘已发生：JSONL 可独立读出（真源在域外，不只在内存）
  const lines = readFileSync(durablePath, "utf8").split("\n").filter((line) => line.length > 0);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).callId, "c1");
  // 目录不存在（域外卷不可写）⇒ fail-closed 抛错
  const failing = new SideEffectLedger({ durablePath: join(tmpdir(), "fix7-nonexistent-dir", "l.jsonl") });
  assert.throws(() => failing.recordBeforeExecution({ tenantId: "t", isolationGroupId: "i", workspaceId: "w", sessionId: "s", turnId: "t", callId: "c", toolName: "x", paramDigest: "p", targetResource: "r" }), /SESSION_SIDECFFECT_LEDGER_WRITE_FAILED/);
});

test("FIX-8: rpoLayering——未上传尾部量独立暴露（REL-096），无死代码", () => {
  const result = rpoLayering({ lastUploadedSeq: 5, updatedAt: Date.now(), tenantId: "t1" }, 12);
  assert.equal(result.inNodeRpo, 0);
  assert.equal(result.unuploadedSeqs, 7); // 序号差独立暴露，不被 *0 丢弃
  assert.ok(result.crossNodeRpoSeconds >= 0);
});
