#!/usr/bin/env node
/**
 * 升级流水线五道 gate（docs/evolution/upgrade-pipeline-spec.md；`EVO-011`–`EVO-020`；GATE-006）：
 * ① 契约测试报告 ② .d.ts 快照 diff 报告 ③ 列车一致性报告（trainVersion 单值）
 * ④ 灰度记录（§6.1 字段校验，部署者提供）⑤ 就绪复验记录（§7.1 的本拓扑内可判定部分 =
 * gate① 内 contract:ready 套件复验）；另含前提监控项 P-1/P-2/P-3 复核（`SPEC-00` §11.4）。
 *
 * 判定纪律：可机器判定的 gate 落实真实检查（任一失败 ⇒ 非零退出并阻断灰度）；不可机器
 * 判定的项显式标注 `attest-only`（不参与通过/失败判定，不伪造通过）。子进程 stderr 落盘
 * evidence/UPGRADE-P5/gate1-contract-suites.log（文件描述符，不经管道——沙箱禁管道捕获）。
 *
 * 用法：node tools/run-upgrade-pipeline.mjs [--root <dir>]
 * 仓库根：默认按本文件位置定位（tools/ 的上一级），--root 显式覆盖。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rootIdx = process.argv.indexOf("--root");
const ROOT = rootIdx >= 0 ? resolve(process.argv[rootIdx + 1]) : resolve(here, "..");

const evidenceDir = join(ROOT, "evidence", "UPGRADE-P5");
mkdirSync(evidenceDir, { recursive: true });
const results = [];

// 失败诊断落盘：子进程 stderr 直接写入日志文件（文件描述符继承，不经管道——沙箱
// 禁止跨进程管道捕获 EPERM）；pass/fail 仍以退出码判定，失败时在 output 中指认日志。
const diagLogPath = join(evidenceDir, "gate1-contract-suites.log");
const diagFd = openSync(diagLogPath, "a");

function run(name, command, args) {
  try {
    execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "ignore", diagFd], cwd: ROOT });
    results.push({ gate: name, status: "pass", output: "exit 0" });
    return true;
  } catch (error) {
    results.push({ gate: name, status: "fail", output: `exit ${error.status ?? "?"}（诊断见 evidence/UPGRADE-P5/gate1-contract-suites.log）` });
    return false;
  }
}

// ① 契约测试报告（全部套件）
const suites = [
  ["contract:llm", "tests/contract/src/llm-adapter/contract.mjs"],
  ["contract:tools", "tests/contract/src/tools-bridge/contract.mjs"],
  ["contract:approval", "tests/contract/src/approval/contract.mjs"],
  ["contract:ready", "tests/contract/src/ready/contract.mjs"],
  ["contract:persistence-l1", "tests/contract/src/persistence/l1-contract.mjs"],
  ["contract:pool", "tests/contract/src/pool/contract.mjs"],
  ["contract:identity-quota", "tests/contract/src/identity-quota/contract.mjs"],
  ["contract:registry", "tests/contract/src/registry/contract.mjs"],
  ["contract:session-ops", "tests/contract/src/session-ops/contract.mjs"],
  ["contract:lifecycle", "tests/contract/src/lifecycle/contract.mjs"],
  ["fixtures:selftest", "tests/contract/fixtures/selftest.mjs"],
];
let contractsOk = true;
for (const [label, script] of suites) {
  if (!run(`契约测试:${label}`, "node", [join(ROOT, script)])) contractsOk = false;
}

// ② .d.ts 快照 diff 报告
const snapshotOk = run("快照 diff", "node", [join(ROOT, "tools", "snapshot", "diff.mjs")]);

// ③ 列车一致性：trainVersion 单值（无混版）
let trainOk = true;
let trainDetail = "";
try {
  const openapi = JSON.parse(readFileSync(join(ROOT, "contracts", "openapi.json"), "utf8"));
  const trainVersions = new Set([openapi?.info?.version, openapi?.info?.["x-train-version"]].filter(Boolean));
  if (trainVersions.size > 1) {
    trainOk = false;
    trainDetail = `多个 trainVersion：${[...trainVersions].join(", ")}`;
  } else {
    trainDetail = `单值：${[...trainVersions][0] ?? "(info.version 未设)"}`;
  }
} catch (error) {
  trainOk = false;
  trainDetail = String(error);
}
results.push({ gate: "列车一致性", status: trainOk ? "pass" : "fail", output: trainDetail });

// 当前列车号（当前列车声明 = seed Profile 的 trainVersion，见 tools/check-mixed-versions.mjs 口径）。
let currentTrain = null;
const seedPath = join(ROOT, "dev", "seed", "profile.json");
if (existsSync(seedPath)) {
  try {
    currentTrain = JSON.parse(readFileSync(seedPath, "utf8")).trainVersion ?? null;
  } catch {
    // seed 不可解析时不做列车号交叉核对，由字段校验兜底
  }
}

// ④ 灰度记录（docs/evolution/upgrade-pipeline-spec.md §6.1 字段校验）：pipeline 不再
// 自写自验——灰度记录由灰度执行方在批次灰度时产出并签署；缺失或字段不全 ⇒ gate 失败，
// 不伪造通过（`EVO-005`/`EVO-032`：拒绝推进下一批次）。
const canaryPath = join(evidenceDir, "canary-record.json");
const CANARY_REQUIRED_FIELDS = [
  "rolloutId", "batchId", "batchTrainVersion", "domains", "tenantBatchReport",
  "cp2Conclusion", "drainedDomains", "startedAt", "endedAt", "verdict",
];
let canaryOk = false;
let canaryDetail = "";
if (!existsSync(canaryPath)) {
  canaryDetail = `灰度记录缺失（${canaryPath}）——灰度执行方按 upgrade-pipeline-spec §6.1 产出并签署后方可进入就绪复验（EVO-005/EVO-032）`;
} else {
  try {
    const record = JSON.parse(readFileSync(canaryPath, "utf8"));
    const missingFields = CANARY_REQUIRED_FIELDS.filter((field) => {
      const value = record[field];
      return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    });
    if (missingFields.length > 0) {
      canaryDetail = `灰度记录字段不全（缺 §6.1 必填：${missingFields.join(", ")}）——按 docs/evolution/upgrade-pipeline-spec.md §6.1 补全后重跑`;
    } else if (currentTrain && record.batchTrainVersion !== currentTrain) {
      canaryDetail = `灰度记录批次列车号 ${record.batchTrainVersion} != 当前列车 ${currentTrain}（§6.1 字段 3：批次列车号单值）`;
    } else {
      canaryOk = true;
      canaryDetail = `灰度记录校验通过（§6.1 十字段齐备）：rolloutId=${record.rolloutId}，batchTrainVersion=${record.batchTrainVersion}，cp2Conclusion=${record.cp2Conclusion}`;
    }
  } catch (error) {
    canaryDetail = `灰度记录不可解析（${canaryPath}）：${String(error?.message ?? error)}`;
  }
}
results.push({ gate: "灰度记录", status: canaryOk ? "pass" : "fail", output: canaryDetail });

// ⑤ 就绪复验记录（docs/evolution/upgrade-pipeline-spec.md §7.1 的本拓扑内可判定部分）：
// 从 gate① 的实际执行结果派生——contract:ready 套件（就绪判据七条逐条失败注入）复验通过。
// §7.1 完整记录（跨域域清单基线/实测、逐域域外证据）需多域拓扑，本单进程内不可机器判定，
// 显式标注 attest-only（不伪造通过）。
const readyResult = results.find((r) => r.gate === "契约测试:contract:ready");
const reverifyOk = readyResult?.status === "pass";
results.push({
  gate: "就绪复验记录",
  status: reverifyOk ? "pass" : "fail",
  output: reverifyOk
    ? "contract:ready 套件在 gate① 内复验通过（就绪七条逐条失败注入全检出；EVO-032/EVO-003/004 复验入口）"
    : "contract:ready 套件未通过——就绪复验失败（EVO-032）",
});
results.push({
  gate: "就绪复验记录(§7.1 跨域逐域证据)",
  status: "attest-only",
  output: "单进程拓扑无 G4 域清单基线/实测与逐域域外证据——不可机器判定（§7.1 字段 2–8），不伪造通过",
});

// 前提监控项 P-1/P-2/P-3 复核（SPEC-00 §11.4）：可机器判定的落实真实检查，不可判定的
// 显式标注 attest-only；任一真实复核失败 → 非零退出。
const p1Source = readFileSync(join(ROOT, "packages", "domain-bridge", "src", "register.ts"), "utf8");
const p1 = (p1Source.match(/tools\.register|registerTool/g) ?? []).length >= 1;
results.push({
  gate: "P-1 ctx.tools.register 唯一注册入口",
  status: p1 ? "pass" : "fail",
  output: p1 ? "注册入口仍在域内桥（复核通过；C49/SPEC-00 §11.4 P-1）" : "注册入口消失——按 SPEC-00 §11.4 重评",
});

// P-2（SPEC-00 §11.4：域镜像+只读 Profile 属 TCB，D15）：可机器判定部分 = dev/compose.yml
// 存在只读挂载声明（:ro）——TCB 挂载只读可复核。
const composePath = join(ROOT, "dev", "compose.yml");
if (!existsSync(composePath)) {
  results.push({ gate: "P-2 域镜像+只读 Profile 属 TCB", status: "fail", output: "dev/compose.yml 缺失——P-2 可判定部分失败（SPEC-00 §11.4 P-2/D15：挂载须只读）" });
} else {
  const roMounts = readFileSync(composePath, "utf8").split(/\r?\n/).filter((line) => line.includes(":ro")).length;
  if (roMounts > 0) {
    results.push({ gate: "P-2 域镜像+只读 Profile 属 TCB", status: "pass", output: `dev/compose.yml 存在 ${roMounts} 条只读挂载声明（:ro）——TCB 挂载只读可复核（D15/SPEC-00 §11.4 P-2）` });
  } else {
    results.push({ gate: "P-2 域镜像+只读 Profile 属 TCB", status: "fail", output: "dev/compose.yml 无只读挂载声明——P-2 可判定部分失败（挂载须只读，D15）" });
  }
}

// P-3（SPEC-00 §11.4：域内读不隔离，C44）：设计决策语义不可机器判定——显式标注
// attest-only（不伪造通过，也不参与失败判定）。
results.push({
  gate: "P-3 域内读不隔离",
  status: "attest-only",
  output: "attest：设计 C44 未变（need-to-know 走团队/用户级隔离组）——语义不可机器判定，显式标注 attest-only",
});

closeSync(diagFd);

const failed = results.filter((r) => r.status === "fail");
const attestOnly = results.filter((r) => r.status === "attest-only");
writeFileSync(join(evidenceDir, "upgrade-report.json"), `${JSON.stringify({ results, failedCount: failed.length, attestOnlyCount: attestOnly.length }, null, 2)}\n`, { encoding: "utf8" });
if (failed.length > 0) {
  console.error(`[upgrade-pipeline] FAIL——${failed.length} 道 gate 未通过：`);
  for (const gate of failed) console.error(`  - ${gate.gate}: ${gate.output}`);
  process.exit(1);
}
console.log(`[upgrade-pipeline] PASS——五道 gate 全通过 + P-1/P-2 复核通过（attest-only ${attestOnly.length} 项显式标注，不计入判定；evidence: ${evidenceDir}）`);
