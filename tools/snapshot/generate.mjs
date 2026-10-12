/**
 * 内核 `.d.ts` API 快照生成（`ENG-032` 判据①；交付物 `D-4`）。
 *
 * 扫描 `node_modules/@deepseek-ai/dsh*` 与 `@deepseek-ai/cordis` 在 pin 版本处的
 * `.d.ts`，抽取**导出符号与签名**成快照入库：`snapshots/<kernelTrain>.api.json`
 * （按包：exports[]、每个符号的签名串、文件哈希）。
 *
 * D13：工具按目标架构构建——内核包未 vendor 时如实产出 0 包快照并标注，
 * vendor 后重新生成即可入 diff 门禁。
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, relative, sep, dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// 仓库根：默认按本文件位置定位（tools/snapshot/ 的上两级），--root 显式覆盖。
const here = dirname(fileURLToPath(import.meta.url));
const rootIdx = process.argv.indexOf("--root");
const root = rootIdx >= 0 ? resolve(process.argv[rootIdx + 1]) : resolve(here, "..", "..");
const modulesRoot = join(root, "node_modules", "@deepseek-ai");
const KERNEL_TRAIN = process.env.DSH_KERNEL_TRAIN ?? readSeedTrain();

/** 目标包集合：`dsh*` 与 `cordis`（`ENG-032`）。 */
function targetPackages() {
  if (!existsSync(modulesRoot)) return [];
  const entries = readdirSync(modulesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && (entry.name.startsWith("dsh") || entry.name === "cordis"))
    .map((entry) => entry.name)
    .sort();
}

/** 递归收集包内全部 .d.ts。 */
function declarationFiles(packageDir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".d.ts")) files.push(full);
    }
  };
  walk(packageDir);
  return files.sort();
}

/**
 * 抽取导出符号与签名串（`ENG-032` 判据①：每个符号的签名串）。
 * 轻量抽取：逐条 `export` 声明（function/class/interface/type/const/let/var/enum），
 * 签名串 = 声明起点到首个定界符（`{`/`;`）。
 */
function extractExports(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const exports = [];
  const exportStart = /^(export\s+)(declare\s+)?(abstract\s+)?(function|class|interface|type|const|let|var|enum|default)\b/;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!exportStart.test(line)) continue;
    let signature = line;
    let cursor = index;
    while (!/[{;}]\s*$/.test(signature) && cursor + 1 < lines.length && signature.length < 400) {
      cursor += 1;
      signature += ` ${lines[cursor].trim()}`;
    }
    signature = signature.replace(/\s+/g, " ").trim();
    const nameMatch = signature.match(/(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/);
    exports.push({
      name: nameMatch ? nameMatch[1] : signature.slice(0, 60),
      signature,
      line: index + 1,
    });
  }
  return exports;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 生成快照对象（导出供 diff 复用；生成与 diff 的抽取逻辑一致）。 */
export function buildSnapshot() {
  const packages = {};
  for (const packageName of targetPackages()) {
    const packageDir = join(modulesRoot, packageName);
    const packageJsonPath = join(packageDir, "package.json");
    const version = existsSync(packageJsonPath)
      ? (JSON.parse(readFileSync(packageJsonPath, "utf8")).version ?? "unknown")
      : "unknown";
    const files = {};
    const exports = [];
    for (const filePath of declarationFiles(packageDir)) {
      const rel = relative(packageDir, filePath).split(sep).join("/");
      files[rel] = sha256(readFileSync(filePath, "utf8"));
      exports.push(...extractExports(filePath));
    }
    packages[`@deepseek-ai/${packageName}`] = { version, files, exports };
  }
  return {
    train: KERNEL_TRAIN,
    generatedAt: new Date().toISOString(),
    packageCount: Object.keys(packages).length,
    note: Object.keys(packages).length === 0
      ? "内核包未 vendor（node_modules/@deepseek-ai 不存在）——快照 0 包；vendor 后重新生成本文件即入 diff 门禁"
      : "",
    packages,
  };
}

function readSeedTrain() {
  try {
    const seed = JSON.parse(readFileSync(join(root, "dev", "seed", "profile.json"), "utf8"));
    return seed.trainVersion ?? "unpinned";
  } catch {
    return "unpinned";
  }
}

/** 直跑守卫：`pnpm snapshot:generate`（被 diff/gate-006 导入时无副作用）。 */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const snapshot = buildSnapshot();
  const outDir = join(root, "snapshots");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${snapshot.train}.api.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  console.log(`snapshot: generated ${outPath}（${snapshot.packageCount} 包 / train=${snapshot.train}）`);
  if (snapshot.packageCount === 0) {
    console.log("snapshot: 内核包未 vendor——快照为空基线，vendor 后重新生成即入 diff 门禁（D13）");
  }
}
