/**
 * 内核 `.d.ts` API 快照 diff（`ENG-032` 判据② / `ENG-033`；交付物 `D-4`）。
 *
 * 无变更时打印 `snapshot: identical` 退出 0；有变更时逐包 added/removed/changed
 * 明细并非零退出。diff 范围**收敛到 4 个反转面**（`ENG-033`），并对每个反转面
 * 自动生成"签名是否变化"的结论（不得人工填写）。
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { buildSnapshot } from "./generate.mjs";

// 仓库根：默认按本文件位置定位（tools/snapshot/ 的上两级），--root 显式覆盖。
const here = dirname(fileURLToPath(import.meta.url));
const rootIdx = process.argv.indexOf("--root");
const root = rootIdx >= 0 ? resolve(process.argv[rootIdx + 1]) : resolve(here, "..", "..");

/** 四个反转面的符号集（`ENG-033`：逐面给出"签名是否变化"结论）。 */
export const REVERSAL_FACES = {
  "LlmAdapter": ["providerInfo", "providerRetryPolicy", "imageRequestPricing", "listModels", "resolveModel", "prepareCall", "stream"],
  "工具桥": ["register", "ToolDefinition"],
  "审批": ["ApprovalRequestEvent", "ApprovalOutcome", "approval/request"],
  "SessionPersistence": ["create", "open", "flush", "stat", "list", "SessionHandle"],
};

/** 逐包 diff：added/removed/changed（按符号名与签名串比对）。 */
function diffPackages(before, after) {
  const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const report = {};
  for (const name of names) {
    const b = before?.[name];
    const a = after?.[name];
    const bSigs = new Map((b?.exports ?? []).map((e) => [e.name, e.signature]));
    const aSigs = new Map((a?.exports ?? []).map((e) => [e.name, e.signature]));
    const added = [...aSigs.keys()].filter((k) => !bSigs.has(k));
    const removed = [...bSigs.keys()].filter((k) => !aSigs.has(k));
    const changed = [...aSigs.keys()].filter((k) => bSigs.has(k) && bSigs.get(k) !== aSigs.get(k));
    const filesChanged = JSON.stringify(b?.files ?? {}) !== JSON.stringify(a?.files ?? {});
    const versionChanged = (b?.version ?? "") !== (a?.version ?? "");
    if (added.length + removed.length + changed.length > 0 || !b || !a || filesChanged || versionChanged) {
      report[name] = {
        added, removed, changed,
        baselineMissing: !b, newPackage: !a, filesChanged, versionChanged,
      };
    }
  }
  return report;
}

/** 快照 diff + 四个反转面逐面结论（导出供 gate-006 复用）。 */
export function computeDiff() {
  const current = buildSnapshot();
  const baselinePath = join(root, "snapshots", `${current.train}.api.json`);
  if (!existsSync(baselinePath)) {
    return { baselineMissing: true, baselinePath, current };
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const diff = diffPackages(baseline.packages, current.packages);
  const diffLines = Object.values(diff).reduce(
    (sum, p) => sum + p.added.length + p.removed.length + p.changed.length
      + (p.baselineMissing ? 1 : 0) + (p.newPackage ? 1 : 0) + (p.filesChanged ? 1 : 0) + (p.versionChanged ? 1 : 0),
    0,
  );
  const faces = Object.entries(REVERSAL_FACES).map(([face, symbols]) => {
    const touched = new Set();
    for (const p of Object.values(diff)) {
      for (const name of [...p.added, ...p.removed, ...p.changed]) touched.add(name);
    }
    const changed = symbols.some((symbol) => {
      for (const touchedName of touched) {
        if (touchedName === symbol) return true;
        if (touchedName.toLowerCase() === symbol.toLowerCase()) return true;
        // 审批面端点形状（`approval/request`）：命中该面前缀的任意符号变化即可
        if (symbol.includes("/") && touchedName.toLowerCase().includes(symbol.split("/")[0].toLowerCase())) return true;
      }
      return false;
    });
    return { face, changed };
  });
  return { baselineMissing: false, baselinePath, current, baseline, diff, diffLines, faces };
}

/** 直跑守卫：`pnpm snapshot:diff`（被 gate-006 导入时无副作用）。 */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = computeDiff();
  if (result.baselineMissing) {
    console.error(`snapshot: 入库快照缺失：${result.baselinePath}（先运行 pnpm snapshot:generate 生成并入库，改写须走评审 PR——ENG-052）`);
    process.exit(2);
  }
  console.log(`snapshot: train=${result.current.train} 包数 ${Object.keys(result.baseline.packages ?? {}).length} → ${result.current.packageCount}`);
  if (result.diffLines === 0 && Object.keys(result.diff).length === 0) {
    console.log("snapshot: identical");
    for (const face of result.faces) console.log(`反转面 ${face.face} 签名变更: ${face.changed ? "是" : "否"}`);
    process.exit(0);
  }
  console.error(`snapshot: 快照 diff 非空（${result.diffLines} 处）——升级门禁失败（ENG-032 判据②）`);
  for (const [name, p] of Object.entries(result.diff)) {
    console.error(`  ${name}${p.versionChanged ? `（版本 ${result.baseline.packages?.[name]?.version ?? "?"} → ${result.current.packages?.[name]?.version ?? "?"}）` : ""}`);
    for (const added of p.added) console.error(`    added:   ${added}`);
    for (const removed of p.removed) console.error(`    removed: ${removed}`);
    for (const changed of p.changed) console.error(`    changed: ${changed}`);
    if (p.baselineMissing) console.error("    baseline 缺该包");
    if (p.newPackage) console.error("    新增包");
    if (p.filesChanged) console.error("    文件哈希变化");
  }
  for (const face of result.faces) console.error(`反转面 ${face.face} 签名变更: ${face.changed ? "是" : "否"}`);
  console.error("snapshot: 若签名变化为「是」，本次升级必须附适配层改造与契约测试重跑记录（ENG-033 判据②）");
  process.exit(1);
}
