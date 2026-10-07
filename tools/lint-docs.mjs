#!/usr/bin/env node
/**
 * 交付物文档校验器（docs/**）
 *
 * 校验各角色产出的交付物文档对规格集的**引用完整性**与**形态要求**：
 *   [ID]      文档中出现的每个需求 ID 必须能在 spec/ 中解析到定义
 *   [HEADER]  每份文档必须具备「文档编号」与「上游依据」头部字段
 *   [NORM]    规范性行（同时含「必须」或「不得」）中不得出现无约束力措辞
 *   [PHANTOM] 不得出现形如 XXX-NNN 但前缀不在 SPEC-00 §4.1 分配段内的编号
 *
 * 说明：定义识别采用与 tools/lint-specs.mjs 相同的口径（表格行首单元格为定义、
 * SPEC-00 的 GATE 标题为声明）。此处**有意复刻**该逻辑而非共享模块，避免改动
 * 已验证的 lint-specs.mjs；两处口径若不一致，以 lint-specs.mjs 为准。
 *
 * 用法：node tools/lint-docs.mjs [--root <dir>] [--json]
 * 退出码：0 通过；1 存在违规
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();
const AS_JSON = args.includes("--json");

const SEGMENTS = ["SEC", "REL", "ENG", "PRD", "EVO", "GATE"];
const ID_RE = /\b(SEC|REL|ENG|PRD|EVO|GATE)-\d{3}\b/g;
const CHECK_ITEM_RE = /^GATE-\d{3}-C\d{2}$/;
const FORBIDDEN = ["建议", "尽量", "最好"];
const NORMATIVE = ["必须", "不得"];

/**
 * 交付物文档可以自有的**产物内编号**命名空间。
 * 它们不是需求 ID，允许形如 `PREFIX-NNN`。
 *
 *   COPY  产品逐字文案基线（PRD-DOC-01），跨文档引用的文案唯一标识
 *   PC    Profile schema 的跨字段语义检查编号（contracts/profile.schema.json 的 x-ov-semanticChecks）
 */
const LOCAL_NAMESPACES = ["COPY", "PC"];

/** 编辑距离 ≤ 此值才视为「疑似把需求前缀写错」 */
const PREFIX_NEAR_MISS = 1;

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

const problems = [];
const stats = { files: 0, ids: 0, defined: 0 };
const fail = (file, line, rule, msg) => problems.push({ file, line, rule, msg });

/** 从 spec/ 收集「已定义」的 ID（表格行首单元格 / SPEC-00 的 GATE 标题） */
function collectDefinedIds() {
  const dir = join(ROOT, "spec");
  const defined = new Set();
  if (!existsSync(dir)) return defined;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const lines = readFileSync(join(dir, f), "utf8").split(/\r?\n/);
    for (const raw of lines) {
      const t = raw.trim();
      // 标题式声明：### 7.1 `GATE-002` — …
      const h = t.match(/^#{2,4}\s+.*?`((SEC|REL|ENG|PRD|EVO|GATE)-\d{3})`/);
      if (h) { defined.add(h[1]); continue; }
      // 表格行首单元格
      if (t.startsWith("|")) {
        const first = t.replace(/^\|/, "").split("|")[0].replace(/[*`]/g, "").trim();
        if (/^(SEC|REL|ENG|PRD|EVO|GATE)-\d{3}$/.test(first)) defined.add(first);
      }
    }
  }
  // GATE 的检查项编号：其所属门禁已定义即视为可解析
  return defined;
}

const defined = collectDefinedIds();
stats.defined = defined.size;

/** 递归收集 docs/ 下的 md 文件（跳过 spec/ 与工具目录） */
function collectDocs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectDocs(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

for (const file of collectDocs(join(ROOT, "docs"))) {
  stats.files++;
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

  // [HEADER] 头部字段
  const head = lines.slice(0, 30).join("\n");
  const hasDocId = /文档编号|`[A-Z]{3}-DOC-|\bVER-\d|\bCTR-\d|\bLAYER-\d/.test(head);
  const hasUpstream = /上游依据|依据\s*\|/.test(head);
  if (!hasDocId) fail(rel, 1, "HEADER", "缺「文档编号」头部字段");
  if (!hasUpstream) fail(rel, 1, "HEADER", "缺「上游依据」头部字段");

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    // [ID] 引用必须可解析
    for (const m of raw.matchAll(ID_RE)) {
      const id = m[0];
      stats.ids++;
      if (CHECK_ITEM_RE.test(id)) {
        const base = id.slice(0, 8);
        if (!defined.has(base)) fail(rel, lineNo, "ID", `检查项 ${id} 的所属门禁 ${base} 未定义`);
        continue;
      }
      if (!defined.has(id)) fail(rel, lineNo, "ID", `引用了未定义的 ID：${id}`);
    }
    // [NORM] 规范性行不得用无约束力措辞
    if (NORMATIVE.some((w) => raw.includes(w))) {
      for (const w of FORBIDDEN) {
        // 豁免：明显在列举禁用词或复述禁令的行
        if (raw.includes(w) && !/禁止|不得使用|禁用|反面|豁免|无效措辞/.test(raw)) {
          fail(rel, lineNo, "NORM", `规范性行含无约束力措辞「${w}」`);
        }
      }
    }
    // [PHANTOM] 仅对「与真实需求前缀近似」的编号报警。
    // 说明：真正的编号错字（如 SEC-999、ENG-063）由 [ID] 规则覆盖（前缀对但编号不存在）；
    // 本规则只补「前缀写错」这一类（如 SEK-001）。不做近似判定的通用 PREFIX-NNN 扫描
    // 会把 COPY-016 / PC-003 / SHA-256 / AES-256 等产物内编号与算法名全部误报。
    for (const m of raw.matchAll(/\b([A-Z]{2,6})-(\d{3})\b/g)) {
      const prefix = m[1];
      if (SEGMENTS.includes(prefix)) continue;
      if (LOCAL_NAMESPACES.includes(prefix)) continue;
      if (["SPEC", "VER", "CTR", "LAYER"].includes(prefix)) continue;
      const near = SEGMENTS.some((s) => editDistance(prefix, s) <= PREFIX_NEAR_MISS);
      if (near) {
        fail(rel, lineNo, "PHANTOM", `${m[0]}：前缀与需求段近似但不存在（是否为 ${SEGMENTS.join(" / ")} 之一的笔误？）`);
      }
    }
  });
}

if (AS_JSON) {
  console.log(JSON.stringify({ stats, problems }, null, 2));
  process.exit(problems.length ? 1 : 0);
}

console.log(`交付物文档校验：${stats.files} 份 / 引用需求 ID ${stats.ids} 处 / spec 已定义 ID ${stats.defined} 个`);
if (!problems.length) {
  console.log("✅ 全部通过（ID / HEADER / NORM / PHANTOM）");
} else {
  const g = {};
  for (const p of problems) (g[p.rule] ??= []).push(p);
  console.log(`\n❌ ${problems.length} 处违规：`);
  for (const [rule, list] of Object.entries(g)) {
    console.log(`\n  ── ${rule}（${list.length}）`);
    for (const p of list.slice(0, 25)) console.log(`     ${p.file}:${p.line}  ${p.msg}`);
    if (list.length > 25) console.log(`     … 另有 ${list.length - 25} 处`);
  }
}
process.exit(problems.length ? 1 : 0);
