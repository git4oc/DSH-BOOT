#!/usr/bin/env node
/**
 * 契约产物校验器
 *
 * 校验 contracts/ 下的机器可读契约：
 *   - contracts/profile.schema.json   Profile JSON Schema
 *   - contracts/openapi.json          OpenAPI 3.1（对外 API）
 *
 * 检查项：
 *   [REF]     所有 `$ref` 必须可解析
 *   [SCHEMA]  JSON Schema：required 的每个键必须在 properties 中存在
 *   [OAS]     OpenAPI：version / operationId 唯一 / tag 已声明 / 每个操作有 responses / 路径以 /v1/ 开头
 *   [REQ]     x-ov-requirements 引用的需求 ID 必须至少出现在 spec/ 中（**弱校验**，见下）
 *
 * 弱校验说明：[REQ] 只断言 ID 至少出现在 spec/ 的某处，不区分「定义」与「引用」。
 * 它用来抓错别字（如 ENG-063 这种不存在的编号）。严格的定义级校验由 tools/lint-specs.mjs 负责。
 *
 * 用法：node tools/validate-contracts.mjs [--root <dir>]
 * 退出码：0 通过；1 存在违规
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();

const problems = [];
const fail = (file, rule, msg) => problems.push({ file, rule, msg });

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/**
 * 解析失败时给出结构提示。
 * JSON.parse 的错误位置常常指向「结构提前闭合」之后的多余内容，而非真正的失衡处；
 * 括号计数能直接指出结构在哪里提前归零。
 */
function jsonStructureHint(text) {
  let depth = 0, inStr = false, esc = false, firstZero = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0 && firstZero < 0) firstZero = i;
    }
  }
  const parts = [];
  if (inStr) parts.push("字符串未闭合");
  parts.push(`括号终态深度=${depth}（应为 0）`);
  if (firstZero >= 0 && firstZero < text.length - 1) {
    const line = text.slice(0, firstZero + 1).split(/\r?\n/).length;
    parts.push(`结构在第 ${line} 行提前闭合，其后有多余内容`);
  }
  return parts.join("；");
}

/** 收集 spec/ 全文，供 ID 弱校验 */
function specCorpus() {
  const dir = join(ROOT, "spec");
  if (!existsSync(dir)) return "";
  return readdirSync(dir).filter((f) => f.endsWith(".md"))
    .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
}

/** 递归收集对象里的全部 $ref 字符串 */
function collectRefs(node, out = []) {
  if (Array.isArray(node)) { for (const v of node) collectRefs(v, out); return out; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

/** 解析本地 JSON Pointer（仅支持 #/... 形式） */
function resolvePointer(doc, ref) {
  if (!ref.startsWith("#/")) return { ok: false, reason: "仅支持文档内 #/ 引用" };
  const parts = ref.slice(2).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur = doc;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return { ok: false, reason: `路径段 "${p}" 不存在` };
  }
  return { ok: true, value: cur };
}

/** 递归遍历所有对象，对每个 $ref 调用 check */
function walkRefs(node, check) {
  if (Array.isArray(node)) { node.forEach((v) => walkRefs(v, check)); return; }
  if (node && typeof node === "object") {
    if (typeof node.$ref === "string") check(node.$ref);
    for (const v of Object.values(node)) walkRefs(v, check);
  }
}

// ————————————————————————— 0. --trace：结构骨架 —————————————————————————
// 定位大型 JSON 的括号失衡：打印每一行的前后深度，只显示回到浅层的行。
if (args.includes("--trace")) {
  const target = args[args.indexOf("--trace") + 1];
  if (!target) { console.error("用法：node tools/validate-contracts.mjs --trace <json文件>"); process.exit(2); }
  const text = readFileSync(target, "utf8");
  let depth = 0, inStr = false, esc = false;
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const before = depth;
    for (const c of lines[ln]) {
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") depth--;
    }
    // 只打印浅层行（depth <= 2）与深度异常行
    if (depth <= 2 || depth < 0 || before <= 2) {
      console.log(`${String(ln + 1).padStart(4)}  d=${String(depth).padStart(3)}  ${lines[ln].slice(0, 90)}`);
    }
  }
  console.log(`\n终态深度 = ${depth}（应为 0）${inStr ? "；字符串未闭合" : ""}`);
  process.exit(depth === 0 && !inStr ? 0 : 1);
}

// ————————————————————————— 1. Profile JSON Schema —————————————————————————

{
  const rel = "contracts/profile.schema.json";
  const p = join(ROOT, rel);
  if (!existsSync(p)) fail(rel, "MISSING", "文件不存在");
  else {
    const rawText = readFileSync(p, "utf8");
    let doc;
    try { doc = JSON.parse(rawText); } catch (e) { fail(rel, "PARSE", `${e.message}\n    ↳ ${jsonStructureHint(rawText)}`); doc = null; }
    if (doc) {
      if (!/^https:\/\/json-schema\.org\/draft\/2020-12\/schema$/.test(doc.$schema || "")) {
        fail(rel, "SCHEMA", `$schema 应为 draft 2020-12，实为 ${doc.$schema}`);
      }
      const verifyReq = (node, path) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node.required) && node.properties) {
          for (const k of node.required) {
            if (!(k in node.properties)) {
              fail(rel, "SCHEMA", `${path}: required 含 "${k}"，但 properties 中不存在`);
            }
          }
        }
        // 仅在根级断言「required 必须能在本层 properties 找到」。
        // 嵌套与 allOf 分支里 required 可以引用父级或组合定义的属性，
        // 在那里强判会产生误报——本校验器初版即因此报了 2 处假错。
        if (path === "#" && Array.isArray(node.required) && !node.properties) {
          fail(rel, "SCHEMA", "根级的 required 无对应 properties，无法校验来源");
        }
        for (const [k, v] of Object.entries(node)) {
          if (k === "properties" || k === "$defs" || k === "items" || k === "allOf" || k === "anyOf" || k === "oneOf") {
            if (Array.isArray(v)) v.forEach((x, i) => verifyReq(x, `${path}/${k}/${i}`));
            else for (const [kk, vv] of Object.entries(v || {})) verifyReq(vv, `${path}/${k}/${kk}`);
          } else if (v && typeof v === "object" && !Array.isArray(v)) {
            verifyReq(v, `${path}/${k}`);
          }
        }
      };
      verifyReq(doc, "#");

      walkRefs(doc, (ref) => {
        const r = resolvePointer(doc, ref);
        if (!r.ok) fail(rel, "REF", `$ref "${ref}" 不可解析：${r.reason}`);
      });

      // $defs 是否都被用到（孤儿 defs 提示拼写错误）
      const refs = new Set(collectRefs(doc));
      for (const name of Object.keys(doc.$defs || {})) {
        if (!refs.has(`#/$defs/${name}`)) {
          fail(rel, "REF", `$defs/${name} 从未被 $ref 引用（可能是拼写错误或残留）`);
        }
      }
    }
  }
}

// ————————————————————————— 2. OpenAPI 3.1 —————————————————————————

{
  const rel = "contracts/openapi.json";
  const p = join(ROOT, rel);
  if (!existsSync(p)) fail(rel, "MISSING", "文件不存在");
  else {
    const rawText = readFileSync(p, "utf8");
    let doc;
    try { doc = JSON.parse(rawText); } catch (e) { fail(rel, "PARSE", `${e.message}\n    ↳ ${jsonStructureHint(rawText)}`); doc = null; }
    if (doc) {
      if (!/^3\.1\./.test(doc.openapi || "")) fail(rel, "OAS", `openapi 应为 3.1.x，实为 ${doc.openapi}`);
      if (!doc.info?.title || !doc.info?.version) fail(rel, "OAS", "info.title / info.version 缺失");

      walkRefs(doc, (ref) => {
        const r = resolvePointer(doc, ref);
        if (!r.ok) fail(rel, "REF", `$ref "${ref}" 不可解析：${r.reason}`);
      });

      const declaredTags = new Set((doc.tags || []).map((t) => t.name));
      const seenOps = new Map();
      const specText = specCorpus();
      const HTTP = ["get", "put", "post", "delete", "patch", "head", "options", "trace"];

      for (const [path, item] of Object.entries(doc.paths || {})) {
        if (!path.startsWith("/v1/")) fail(rel, "OAS", `路径 ${path} 未以 /v1/ 开头`);
        for (const [method, op] of Object.entries(item)) {
          if (!HTTP.includes(method)) continue;
          const where = `${method.toUpperCase()} ${path}`;
          if (!op.operationId) fail(rel, "OAS", `${where}: 缺 operationId（SDK 生成必需）`);
          else if (seenOps.has(op.operationId)) fail(rel, "OAS", `${where}: operationId "${op.operationId}" 与 ${seenOps.get(op.operationId)} 重复`);
          else seenOps.set(op.operationId, where);

          if (!op.responses || Object.keys(op.responses).length === 0) {
            fail(rel, "OAS", `${where}: 无 responses`);
          }
          for (const t of op.tags || []) {
            if (!declaredTags.has(t)) fail(rel, "OAS", `${where}: 使用了未在顶层 tags 声明的 tag "${t}"`);
          }
          const reqs = op["x-ov-requirements"];
          if (!Array.isArray(reqs)) {
            fail(rel, "OAS", `${where}: 缺 x-ov-requirements（须标明本操作落实哪些需求）`);
          } else {
            for (const id of reqs) {
              if (!/^(SEC|REL|ENG|PRD|EVO|GATE)-\d{3}$/.test(id)) {
                fail(rel, "REQ", `${where}: 需求 ID 形式非法 "${id}"`);
              } else if (specText && !specText.includes(id)) {
                fail(rel, "REQ", `${where}: 需求 ${id} 未出现在 spec/ 中（疑似编号错误）`);
              }
            }
          }
        }
      }

      // 至少存在一条安全要求（本契约要求 bearerAuth）
      if (!doc.components?.securitySchemes?.bearerAuth) {
        fail(rel, "OAS", "缺 securitySchemes.bearerAuth（域外 RBAC 的前提）");
      }
      // 不得出现模型直连端点（D9）
      for (const path of Object.keys(doc.paths || {})) {
        if (/\/llm\/(chat|completions|messages|stream)/.test(path)) {
          fail(rel, "OAS", `出现模型直连端点 ${path}——D9 禁止，所有模型调用必须经反向网关`);
        }
      }
    }
  }
}

// ————————————————————————— 输出 —————————————————————————

if (!problems.length) {
  console.log("契约校验：✅ 全部通过（REF / SCHEMA / OAS / REQ）");
} else {
  console.log(`契约校验：❌ ${problems.length} 处违规：\n`);
  for (const p of problems) console.log(`  [${p.rule}] ${p.file}\n    ${p.msg}`);
}
process.exit(problems.length ? 1 : 0);
