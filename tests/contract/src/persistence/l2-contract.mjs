/**
 * SessionPersistence L2 契约（`ENG-036`/`ENG-037`；设计 §11.4.1）。
 *
 * 钉死（2026-10-12 修复后行为）：
 *   - `objectStoreDirectRead`：逐文件 sha256 + 清单摘要校验，校验不过拒绝直读（fail-closed）
 *   - `migrateGeneration`：显式 v1→v2 映射；gen2 输入如实返回 `migrated: false`（不虚报）
 *   - `windowsAllowed` 默认 false（本仓库无 Windows L2 provider，GATE-002 条件 9 如实 fail）；
 *     `withWindowsSupport` 无显式注入即抛
 *
 * 直跑入口（进程内 test()，与既有契约套件同一模式）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  L2,
  withWindowsSupport,
  migrateGeneration,
  objectStoreDirectRead,
} from "../../../../packages/domain-bridge/src/persistence/l2.ts";

function digestOf(parts) {
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}

test("L2-A: 能力开关如实——windowsAllowed 默认 false，无显式注入即抛（ENG-036 判据③）", () => {
  assert.equal(L2.generationMigration, true);
  assert.equal(L2.objectStoreDirectRead, true);
  // 本仓库无 Windows L2 provider（GATE-002 条件 9 实测 fail）：不得虚报 true
  assert.equal(L2.windowsAllowed, false);
  assert.throws(() => withWindowsSupport(), /requires an explicitly verified Windows provider/);
});

test("L2-B: 对象存储直读——完整性校验通过才放行，篡改即拒绝（ENG-036，fail-closed）", () => {
  const bodyA = "session-a-events";
  const bodyB = "session-b-events";
  const shaA = createHash("sha256").update(bodyA, "utf8").digest("hex");
  const shaB = createHash("sha256").update(bodyB, "utf8").digest("hex");
  const manifest = {
    files: [
      { name: "a.jsonl", sha256: shaA },
      { name: "b.jsonl", sha256: shaB },
    ],
    digest: digestOf([shaA, shaB]),
  };
  const fetchObject = (name) => (name === "a.jsonl" ? bodyA : bodyB);
  const ok = objectStoreDirectRead(manifest, fetchObject);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.verified, ["a.jsonl", "b.jsonl"]);

  // 文件体被篡改 ⇒ 拒绝直读（fail-closed，不返回部分内容）
  const tampered = objectStoreDirectRead(manifest, (name) => (name === "a.jsonl" ? `${bodyA}-tampered` : bodyB));
  assert.equal(tampered.ok, false);
  assert.ok(tampered.reason.includes("OBJECT_STORE_INTEGRITY_FAILED"));
  assert.ok(tampered.reason.includes("a.jsonl"));

  // 清单摘要不符 ⇒ 拒绝直读
  const badDigest = objectStoreDirectRead({ ...manifest, digest: digestOf([shaA]) }, fetchObject);
  assert.equal(badDigest.ok, false);
  assert.ok(badDigest.reason.includes("manifest digest mismatch"));
});

test("L2-C: 世代迁移——显式 v1→v2 映射；gen2 如实 migrated:false；未知世代拒绝（ENG-036/REL-086/P-7）", () => {
  const v1Payload = '{"v":"1","kind":"header","header":{"id":"s1"}}\n{"v":"1","kind":"turn-start","turnId":"t1"}\n';
  const result = migrateGeneration(1, v1Payload);
  // fail-closed 且映射显式：帧标记重写为 v2，其余字段逐字保留
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(result.generation, 2);
  assert.equal(result.frameCount, 2);
  const frames = result.payload.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
  assert.equal(frames[0].v, "2");
  assert.equal(frames[0].kind, "header"); // 其余字段逐字保留
  assert.equal(frames[1].turnId, "t1");
  // gen2 输入：原样返回，如实 migrated:false（不虚报）
  const alreadyV2 = migrateGeneration(2, result.payload);
  assert.equal(alreadyV2.ok, true);
  assert.equal(alreadyV2.migrated, false);
  assert.equal(alreadyV2.payload, result.payload);
  // 未知世代：fail-closed 拒绝（REL-086/P-7）
  const refused = migrateGeneration(1, '{"v":"3","kind":"x"}\n');
  assert.equal(refused.ok, false);
  assert.ok(refused.reason.includes("MIGRATION_REFUSED"));
  // 坏 JSON 帧：fail-closed 拒绝，不产出半迁移产物
  const badFrame = migrateGeneration(1, '{"v":"1","kind":"tu');
  assert.equal(badFrame.ok, false);
  assert.equal(badFrame.payload, "");
});
