#!/usr/bin/env node
/**
 * 规格集校验器 —— 执行 SPEC-00 的 GATE-007 / GATE-008 / GATE-010
 *
 *   GATE-007  每条需求必须具备六字段（含「拦截点 / 测量点」）
 *   GATE-008  跨规格引用必须按需求 ID（禁止「文件 + 小节」形式）
 *   GATE-010  需求 ID 必须落在 SPEC-00 §4.1 分配的段内（形式合法 / 不越段 / 不重复 / 引用可解析）
 *
 * 支持的两种需求书写形式（SPEC-00 §5 允许二者）：
 *   A. 横向六列表：| ID | 级别 | 条款 | 验收判据 | 依据 | 拦截点 / 测量点 |
 *   B. 纵向字段表：| # | 字段 | 内容 |，逐行给出 **ID** / **级别** / … 六个字段
 *
 * 用法：node tools/lint-specs.mjs [--root <dir>] [--json]
 * 退出码：0 通过；1 存在违规
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ——— SPEC-00 §4.1 的分配段（唯一真源，不得在此之外新增） ——————————————
const SEGMENTS = {
  SEC: { owner: "SPEC-01", file: "01-安全与合规规格.md" },
  REL: { owner: "SPEC-02", file: "02-可靠性与可观测性规格.md" },
  ENG: { owner: "SPEC-03", file: "03-实现与工程规格.md" },
  PRD: { owner: "SPEC-04", file: "04-产品与商业规格.md" },
  EVO: { owner: "SPEC-05", file: "05-演进与生命周期规格.md" },
  GATE: { owner: "SPEC-00", file: "00-规格总纲.md" },
};

const ID_RE = /\b(SEC|REL|ENG|PRD|EVO|GATE)-\d{3}\b/g;
const CHECK_ITEM_RE = /^(GATE-\d{3})-C\d{2}$/;
const LEVELS = ["必须", "不得", "应当", "可以"];
const FORBIDDEN = ["建议", "尽量", "最好", "通过测试"];
const FILE_REF_RE = /见\s*《[^》]*》\s*第|见\s*[^\s，。]*\.md\s*第/;
const VERTICAL_KEYS = ["ID", "级别", "条款", "验收判据", "依据", "拦截点"];
const HORIZONTAL_FIELDS = ["ID", "级别", "条款", "验收判据", "依据", "拦截点"];

const problems = [];
const stats = { files: 0, requirements: 0, references: 0, skippedExamples: 0 };

const fail = (file, line, rule, msg) => problems.push({ file, line, rule, msg });
const plain = (s) => s.replace(/\*\*/g, "").replace(/`/g, "").trim();

/** 按 `|` 切分单元格，但**不切分行内代码 `…` 内的 `|`**（修复式引用的正则会含 `|`） */
function splitCells(text) {
  const t = text.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cur = "";
  let inCode = false;
  for (const ch of t) {
    if (ch === "`") inCode = !inCode;
    if (ch === "|" && !inCode) { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** 收集表格块 */
function parseTables(lines) {
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trimStart().startsWith("|")) { i++; continue; }
    const block = [];
    while (i < lines.length && lines[i].trimStart().startsWith("|")) {
      block.push({ text: lines[i], line: i + 1 });
      i++;
    }
    if (block.length < 2) continue;
    const header = splitCells(block[0].text);
    const isSep = block[1].text.replace(/[\s|:-]/g, "") === "";
    tables.push({ header, rows: isSep ? block.slice(2) : block.slice(1) });
  }
  return tables;
}

const isHorizontal = (h) =>
  h.length === 6 && HORIZONTAL_FIELDS.every((f, i) => plain(h[i]).startsWith(f));

const isVertical = (h) =>
  h.length === 3 && plain(h[1]) === "字段" && plain(h[2]) === "内容";

function ownSegmentOf(text) {
  const m = text.match(/\|\s*文档编号\s*\|\s*`?(SPEC-\d{2})`?\s*\|/);
  const specId = m ? m[1] : null;
  const entry = Object.entries(SEGMENTS).find(([, v]) => v.owner === specId);
  return { specId, prefix: entry ? entry[0] : null };
}

/** 去掉区间声明（`REL-001` – `REL-999`）后再扫描引用，避免把区间端点当引用 */
function stripRanges(line) {
  return line.replace(/(SEC|REL|ENG|PRD|EVO|GATE)-(\d{3})(`?\s*[–—~-]\s*`?)((?:SEC|REL|ENG|PRD|EVO|GATE)-)?\d{3}/g,
    (_m, p1, _n1, _sep, p2) => `${p1}-RANGE${p2 ? "-RANGE" : ""}`);
}

function collectSpecFiles(root) {
  const dir = join(root, "spec");
  return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile());
}

// ——————————————————————————— 主流程 ———————————————————————————

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();
const AS_JSON = args.includes("--json");

const defined = new Map();
// SPEC-00 的门禁 ID 会同时以「标题」与「表格行」出现，属同一文档内的重复声明，
// 不是重复定义；进 declared 仅用于让引用可解析，不参与唯一性判定。
const declared = new Map();
const referenced = [];
const known = (id) => defined.has(id) || declared.has(id);

for (const file of collectSpecFiles(ROOT)) {
  stats.files++;
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const { specId, prefix: own } = ownSegmentOf(text);
  if (!specId) fail(rel, 1, "GATE-010", "缺少「文档编号」头部字段，无法判定 ID 段归属");
  if (specId && !own) fail(rel, 1, "GATE-010", `未知文档编号 ${specId}`);

  const register = (id, line) => {
    if (defined.has(id)) {
      fail(rel, line, "GATE-010", `ID 重复定义：${id}（先见于 ${defined.get(id).file}:${defined.get(id).line}）`);
    } else defined.set(id, { file: rel, line });
  };

  const checkRequirement = (cells, line, form) => {
    const idRaw = plain(cells[0]);
    const m = idRaw.match(/^(SEC|REL|ENG|PRD|EVO|GATE)-(\d{3})$/);
    if (!m) { fail(rel, line, "GATE-010", `需求 ID 形式非法：${idRaw}（${form}）`); return; }
    stats.requirements++;
    if (own && m[1] !== own) fail(rel, line, "GATE-010", `段越界：${rel}（${own} 段）定义了 ${idRaw}`);
    register(idRaw, line);
    const level = plain(cells[1]);
    if (!LEVELS.includes(level)) fail(rel, line, "GATE-007", `级别取值非法：「${level}」，允许 ${LEVELS.join(" / ")}`);
    for (const [idx, name] of [[2, "条款"], [3, "验收判据"]]) {
      for (const w of FORBIDDEN) {
        if (cells[idx].includes(w)) fail(rel, line, "GATE-007", `${name} 含无约束力措辞「${w}」`);
      }
    }
    if (!plain(cells[5])) fail(rel, line, "GATE-007", "「拦截点 / 测量点」为空（该列语义不可机器判定，但不得为空）");
  };

  for (const table of parseTables(lines)) {
    if (isHorizontal(table.header)) {
      for (const row of table.rows) {
        const cells = splitCells(row.text);
        if (cells.length !== 6 || cells.some((c) => c === "")) {
          fail(rel, row.line, "GATE-007", `横向需求行应有 6 个非空单元格，实为 ${cells.length} 列`);
          continue;
        }
        checkRequirement(cells, row.line, "横向六列表");
      }
    } else if (isVertical(table.header)) {
      // 纵向：连续若干行构成一条需求；以 **ID** 行起始，**拦截点** 行结束
      let acc = null, startLine = 0;
      for (const row of table.rows) {
        const cells = splitCells(row.text);
        if (cells.length < 3) continue;
        const key = plain(cells[0]);
        const val = cells[1];
        if (key === "ID") {
          acc = { 1: "", 2: "", 3: "", 4: "", 5: "" };
          startLine = row.line;
          acc[0] = val;
          continue;
        }
        if (!acc) continue;
        const idx = VERTICAL_KEYS.indexOf(key);
        if (idx > 0) { acc[idx] = val; continue; }
        if (key.startsWith("拦截点")) {
          acc[5] = val;
          checkRequirement([acc[0], acc[1], acc[2], acc[3], acc[4], acc[5]], startLine, "纵向字段表");
          acc = null;
        }
      }
      if (acc) fail(rel, startLine, "GATE-007", "纵向需求块不完整（未见「拦截点 / 测量点」字段）");
    }
  }

  // SPEC-00 的门禁定义：标题与首列为 GATE ID 的表格行
  if (own === "GATE") {
    lines.forEach((t, idx) => {
      const h = t.match(/^#{2,4}\s+.*?`(GATE-\d{3})`/);
      if (h && !declared.has(h[1])) declared.set(h[1], { file: rel, line: idx + 1 });
      if (t.trimStart().startsWith("|")) {
        const first = plain(splitCells(t)[0] || "");
        const m = first.match(/^(GATE-\d{3})$/);
        if (m && !declared.has(m[1])) declared.set(m[1], { file: rel, line: idx + 1 });
      }
    });
  }

  lines.forEach((raw, idx) => {
    const line = stripRanges(raw);
    for (const m of line.matchAll(ID_RE)) {
      const id = m[0];
      const ci = CHECK_ITEM_RE.exec(id);
      if (ci) { referenced.push({ id, file: rel, line: idx + 1, needsGate: ci[1] }); continue; }
      referenced.push({ id, file: rel, line: idx + 1 });
    }
    // 总纲自身的禁令条文会引用反例，属预期豁免
    if (FILE_REF_RE.test(line) && !/禁止|示例|反例/.test(line)) {
      fail(rel, idx + 1, "GATE-008", `出现「文件 + 小节」式跨规格引用：${line.trim().slice(0, 70)}…`);
    } else if (FILE_REF_RE.test(line)) {
      stats.skippedExamples++;
    }
  });
}

for (const ref of referenced) {
  stats.references++;
  if (ref.needsGate) {
    if (!known(ref.needsGate)) fail(ref.file, ref.line, "GATE-010", `检查项 ${ref.id} 的所属门禁 ${ref.needsGate} 未定义`);
  } else if (!known(ref.id)) {
    fail(ref.file, ref.line, "GATE-010", `引用了未定义的 ID：${ref.id}`);
  }
}

// 段连续性（仅对角色规格，SPEC-00 的门禁编号不要求连续）
for (const [seg, meta] of Object.entries(SEGMENTS)) {
  if (seg === "GATE") continue;
  const nums = [...defined.keys()].filter((k) => k.startsWith(seg + "-"))
    .map((k) => Number(k.slice(4))).sort((a, b) => a - b);
  if (!nums.length) { fail(meta.file, 1, "GATE-010", `${seg} 段没有任何需求定义`); continue; }
  const gaps = [];
  for (let n = nums[0]; n <= nums[nums.length - 1]; n++) if (!nums.includes(n)) gaps.push(String(n).padStart(3, "0"));
  if (gaps.length) fail(meta.file, 1, "GATE-010", `${seg} 段 ID 不连续，缺号：${gaps.join(", ")}`);
}

const groups = {};
for (const p of problems) (groups[p.rule] ??= []).push(p);

// 每段需求数（供入口索引与验收引用）
const perSegment = {};
for (const k of defined.keys()) {
  const seg = k.slice(0, k.indexOf("-"));
  perSegment[seg] = (perSegment[seg] || 0) + 1;
}

if (AS_JSON) {
  console.log(JSON.stringify({
    stats: { ...stats, perSegment },
    problems,
  }, null, 2));
  process.exit(problems.length ? 1 : 0);
}

console.log(`规格集校验：${stats.files} 个文件 / ${stats.requirements} 条需求 / ${stats.references} 处引用` +
  (stats.skippedExamples ? `（豁免 ${stats.skippedExamples} 处总纲反例）` : ""));
console.log("  分段：" + Object.entries(perSegment).sort()
  .map(([k, v]) => `${k}- ${v}`).join(" · "));
if (!problems.length) {
  console.log("✅ 全部通过（GATE-007 / GATE-008 / GATE-010）");
} else {
  console.log(`\n❌ ${problems.length} 处违规：`);
  for (const [rule, list] of Object.entries(groups)) {
    console.log(`\n  ── ${rule}（${list.length}）`);
    for (const p of list.slice(0, 40)) console.log(`     ${p.file}:${p.line}  ${p.msg}`);
    if (list.length > 40) console.log(`     … 另有 ${list.length - 40} 处`);
  }
}
process.exit(problems.length ? 1 : 0);
