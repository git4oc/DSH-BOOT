/**
 * CI 路径过滤检查（`ENG-051` 判据①）。
 *
 * CI job `contract` 对 `packages/domain-bridge/src/persistence/**`、`tools/snapshot/**`、
 * `packages/control-plane/src/ready/**` 的改动**强制全量**（完整套件 + 快照 diff），
 * **不得**只跑受影响子集——路径过滤配置由本检查脚本断言（缺全量即失败）。
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workflowPath = join(root, ".github", "workflows", "contract.yml");

if (!existsSync(workflowPath)) {
  console.error("CI 路径过滤检查失败：.github/workflows/contract.yml 缺失（ENG-051 判据①）");
  process.exit(1);
}

const workflow = readFileSync(workflowPath, "utf8");
const problems = [];

// ① contract job 必须运行完整套件（全部契约脚本 + node --test 的 A–F），不得只跑子集。
const REQUIRED_STEPS = [
  "node --test tests/contract/src/persistence/contract.test.mjs",
  "pnpm contract:llm",
  "pnpm contract:tools",
  "pnpm contract:approval",
  "pnpm contract:ready",
  "pnpm fixtures:selftest",
];
const contractJobMatch = workflow.match(/jobs:([\s\S]*)/);
const contractJob = contractJobMatch ? contractJobMatch[1] : "";
for (const step of REQUIRED_STEPS) {
  if (!contractJob.includes(step)) {
    problems.push(`contract job 缺完整套件步骤：${step}（ENG-051 判据①：强制全量，不得只跑受影响子集）`);
  }
}

// ② 触发路径必须覆盖三条强制路径（persistence/snapshot/ready），不得被 paths 过滤裁掉。
const MANDATORY_PATHS = [
  "packages/domain-bridge/src/persistence/**",
  "packages/control-plane/src/ready/**",
  "tools/snapshot/**",
  "tests/contract/**",
];
for (const mandatory of MANDATORY_PATHS) {
  if (!workflow.includes(mandatory)) {
    problems.push(`contract job 触发路径缺少 ${mandatory}（ENG-051 判据①：该路径改动必须触发完整套件）`);
  }
}

// ③ contract job 不得声明任何收窄触发范围的 paths 过滤（如仅匹配单个目录的过滤项）。
const triggerMatch = workflow.match(/^on:([\s\S]*?)^permissions:/m);
if (triggerMatch) {
  const triggerBlock = triggerMatch[1];
  const pathItems = [...triggerBlock.matchAll(/^\s*-\s*"?(.+?)"?\s*$/gm)].map((m) => m[1]);
  const dangerousFilters = pathItems.filter((p) => !MANDATORY_PATHS.includes(p) && !["packages/**", "apps/**", "tools/**", "tests/**", "snapshots/**", "pnpm-workspace.yaml", "package.json", ".github/workflows/contract.yml"].includes(p));
  if (dangerousFilters.length > 0) {
    problems.push(`contract job 触发 paths 存在收窄过滤：${dangerousFilters.join(", ")}（ENG-051 判据①：缺全量即失败）`);
  }
}

// ④ snapshot job 必须只读校验（不得在 CI 中自动改写快照——改写须走评审 PR，ENG-052）。
if (!workflow.includes("pnpm snapshot:diff")) {
  problems.push("snapshot job 缺 pnpm snapshot:diff（ENG-052 判据①）");
}
if (/snapshot:generate/.test(workflow)) {
  problems.push("CI 中出现 snapshot:generate——CI 必须只读校验快照，不得自动改写（ENG-052 判据②）");
}

if (problems.length > 0) {
  console.error("CI 路径过滤检查失败：");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("CI 路径过滤检查通过：contract job 强制全量（完整套件 + 三条强制路径 + 只读快照校验）（ENG-051 判据① / ENG-052）");
