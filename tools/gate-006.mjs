/**
 * `GATE-006`（持续，每次内核升级）的可重复执行 CI 任务（`ENG-035`；`SPEC-00` §7）。
 *
 * 通过条件 = ① 契约测试套件全绿（`ENG-031` 的 A–F 全覆盖）
 *           ② 快照 diff 空（`ENG-032`）
 *           ③ 无混版（`ENG-028` 的 fleet 只有一个 `trainVersion`）
 *
 * 输出三行状态 `contract=pass snapshot.diffLines=0 mixedVersions=0`；
 * 任一非通过值即非零退出并阻断该版本列车进入任何域的灰度。
 * 对同一列车号可重跑且结果稳定（幂等：无状态、只读源与快照）。
 */

import { runAF } from "../tests/contract/src/persistence/a2f.mjs";
import { computeDiff } from "./snapshot/diff.mjs";
import { collectMixedVersions } from "./check-mixed-versions.mjs";

// ① 契约测试套件全绿（A–F 全覆盖，`ENG-031` 判据①）。
const afResults = runAF();
const contractPass = afResults.every((r) => r.ok);
const failedItems = afResults.filter((r) => !r.ok).map((r) => r.item).join(",");

// ② 快照 diff 空（`ENG-032` 判据②）。
const snapshot = computeDiff();
let snapshotDiffLines;
let snapshotError = "";
if (snapshot.baselineMissing) {
  snapshotDiffLines = -1;
  snapshotError = `入库快照缺失（${snapshot.baselinePath}）——先 snapshot:generate`;
} else {
  snapshotDiffLines = snapshot.diffLines;
}

// ③ 无混版（`ENG-028` fleet 单一 trainVersion）。
const mixed = collectMixedVersions();
const mixedVersions = Math.max(0, mixed.count - 1);

console.log(`contract=${contractPass ? "pass" : `fail(${failedItems})`} snapshot.diffLines=${snapshotDiffLines}${snapshotError ? `（${snapshotError}）` : ""} mixedVersions=${mixedVersions}`);

const failures = [];
if (!contractPass) {
  failures.push(`契约测试套件未全绿：${failedItems}（ENG-031 A–F）`);
  for (const result of afResults.filter((r) => !r.ok)) {
    console.error(`  ${result.detail}`);
  }
}
if (snapshotDiffLines !== 0) {
  failures.push(`快照 diff 非空（${snapshotDiffLines} 处）${snapshotError}（ENG-032）`);
}
if (mixedVersions > 0) {
  failures.push(`混版：fleet 存在 ${mixed.count} 种 trainVersion（${mixed.trains.join(" | ")}）（ENG-035 判据③ / C33）`);
}

if (failures.length > 0) {
  console.error("[gate-006] FAIL——阻断该版本列车进入任何域的灰度：");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("[gate-006] PASS——契约测试 + 快照 diff + 无混版（幂等可重跑）");
