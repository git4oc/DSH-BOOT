#!/usr/bin/env node
/**
 * 门禁清单可解析性校验
 *
 * 断言 SPEC-00 §7 定义的六个阶段门禁（GATE-001…GATE-006）每一个都**至少被一条需求引用**
 * ——门禁若无人引用，说明它只是摆设，不构成开发约束。
 *
 * 用法：node tools/check-gates.mjs [--root <dir>]
 * 退出码：0 通过；1 存在孤立门禁
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();

const GATES = ["GATE-001", "GATE-002", "GATE-003", "GATE-004", "GATE-005", "GATE-006"];

const dir = join(ROOT, "spec");
const corpus = readdirSync(dir)
  .filter((f) => f.endsWith(".md"))
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .join("\n");

const counts = {};
for (const g of GATES) counts[g] = (corpus.match(new RegExp(`\\b${g}\\b`, "g")) || []).length;

// 门禁在 SPEC-00 §7 的定义表里至少出现 1 次；被引用则 ≥2
const orphans = GATES.filter((g) => counts[g] < 2);

console.log("门禁引用统计：");
for (const g of GATES) console.log(`  ${g}  ${counts[g]} 次${counts[g] < 2 ? "   ← 孤立" : ""}`);

if (orphans.length) {
  console.error(`\n❌ 以下门禁仅在定义处出现、未被任何需求引用：${orphans.join(", ")}`);
  console.error("   门禁无人引用 ⇒ 不构成开发约束。请在对应规格中加入引用，或从 SPEC-00 §7 移除该门禁。");
  process.exit(1);
}
console.log("\n✅ 六个阶段门禁均被需求引用");
