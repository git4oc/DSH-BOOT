#!/usr/bin/env node
/**
 * 需求 ID 格式校验器（SPEC-03 ENG-048 判据①，CI 任务 spec:id-format）。
 *
 * 扫描代码、测试与配置（packages/**、apps/**、tools/**、tests/**、.github/**，
 * 排除 node_modules）中形如需求 ID 的记号：
 *   - 合法形式：^(SEC|REL|ENG|PRD|EVO|GATE)-[0-9]{3}$（大写段前缀 + 恰好三位数字）
 *   - 违规：位数不足、位数超出、段前缀小写等形如段-数字的记号
 *   - 段前缀必须落在 SPEC-00 §4.1 的分配段（SEC/REL/ENG/PRD/EVO/GATE）内
 *
 * 每条违规按 `文件:行 违规ID` 报告；任一违规非零退出（ENG-048 判据③）。
 * 扫描范围限于代码、测试与配置：spec/** 与 docs/** 由 lint-specs / lint-docs 校验。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["packages", "apps", "tools", "tests", "dev", ".github"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".md"]);
const SKIP_DIRS = new Set(["node_modules", ".git"]);

/** 形如需求 ID 的记号（大小写不敏感以捕获段前缀小写；位数不限以捕获位数不足/超出）。 */
const ID_LIKE = /\b(SEC|REL|ENG|PRD|EVO|GATE)-(\d+)\b/gi;
/** 合法形式：大写段前缀 + 恰好三位数字。 */
const VALID = /^(SEC|REL|ENG|PRD|EVO|GATE)-[0-9]{3}$/;

/**
 * 规格自命名的非需求 ID 记号豁免（`ENG-035` 判据①：CI 任务名为 `gate-006`，
 * 小写为规格原文，非需求 ID；`ENG-034` 判据①同名引用）。不得用于自造需求 ID。
 */
const SPEC_NAMED_TOKENS = new Set(["gate-006"]);

const violations = [];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else if (EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      yield join(dir, entry.name);
    }
  }
}

function scanFile(path) {
  const rel = relative(ROOT, path).replaceAll(sep, "/");
  const lines = readFileSync(path, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const match of lines[i].matchAll(ID_LIKE)) {
      const token = match[0];
      if (!VALID.test(token) && !SPEC_NAMED_TOKENS.has(token.toLowerCase())) {
        violations.push({ file: rel, line: i + 1, token: `${match[1]}-${match[2]}` });
      }
    }
  }
}

function main() {
  for (const dir of SCAN_DIRS) {
    const full = join(ROOT, dir);
    try {
      readdirSync(full, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of walk(full)) {
      scanFile(file);
    }
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ verdict: violations.length === 0 ? "pass" : "fail", violations }, null, 2));
  } else {
    for (const v of violations) {
      console.error(`✗ ${v.file}:${v.line} ${v.token}`);
    }
  }

  if (violations.length > 0) {
    console.error(`\n需求 ID 格式校验：${violations.length} 项违规（依据 ENG-048；合法形式为段前缀 + 恰好三位数字）`);
    process.exit(1);
  }
  console.log("需求 ID 格式校验：代码 / 测试 / 配置全部符合 ENG-048 正则 — 通过");
}

main();
