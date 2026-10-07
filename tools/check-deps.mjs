#!/usr/bin/env node
/**
 * 层依赖方向校验器（SPEC-03 D-6）。
 *
 * 覆盖 LAYER-001 §6 的五项：
 *   1. 解析每个 package.json 的 @dsh-boot/* 依赖 → 与 §3 白名单矩阵逐条比对
 *   2. 违规输出格式：`包A → 包B 违反方向（依据 ENG-021 / LAYER-001 §3）` 并非零退出
 *   3. R-3 的 DFS 零环检测
 *   4. §5 的反转面目录数断言（ENG-024）
 *   5. §4 的未定边按本表实现（O-1…O-4）；§3/§4 未列为允许的边一律按禁止（保守默认）
 *
 * 另含 ENG-022 的三条独立断言（各给独立失败信息）：
 *   (a) packages/domain-bridge 不得依赖 packages/control-plane
 *   (b) 内核不得被产品壳代码 import（packages/control-plane、packages/protocol 命中数 == 0；
 *       类型导入用 import type 时单独列白名单文件）
 *   (c) apps/domain 不得被任何包依赖
 *
 * 判据以目标架构为准（D13）。矩阵以 docs/layer-dependency-matrix.md §3/§4 为唯一来源，
 * 本脚本不得就地放宽（LAYER-001 §4：新增允许边必须改该文件并由架构评审签署）。
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const problems = [];

/** LAYER-001 §1 包清单（ENG-020）：矩阵行键 = 仓库相对目录。 */
const PACKAGE_DIRS = [
  "packages/protocol",
  "packages/domain-bridge",
  "packages/reverse-gateway",
  "packages/control-plane",
  "packages/sdk",
  "apps/domain",
  "apps/control",
  "tools/snapshot",
  "tests/contract",
];

/** 包名 → 矩阵行键。 */
const NAME_TO_DIR = {
  "@dsh-boot/protocol": "packages/protocol",
  "@dsh-boot/domain-bridge": "packages/domain-bridge",
  "@dsh-boot/reverse-gateway": "packages/reverse-gateway",
  "@dsh-boot/control-plane": "packages/control-plane",
  "@dsh-boot/sdk": "packages/sdk",
  "@dsh-boot/apps-domain": "apps/domain",
  "@dsh-boot/apps-control": "apps/control",
  "@dsh-boot/tools-snapshot": "tools/snapshot",
  "@dsh-boot/tests-contract": "tests/contract",
};

/**
 * LAYER-001 §3 白名单矩阵（行 = 源包，值 = 允许的目标包集合），
 * 按 §4 已裁定边修正：O-1（apps/domain → sdk 禁止）、O-2（tests/contract → tools/snapshot 允许）、
 * O-3（tools/snapshot → protocol 允许）、O-4（apps/* 互不依赖）。
 * 未列为允许的边一律按禁止（§4 保守默认）。
 */
const MATRIX = {
  "packages/protocol": [],
  "packages/domain-bridge": ["packages/protocol"],
  "packages/reverse-gateway": ["packages/protocol"],
  "packages/control-plane": [
    "packages/protocol",
    "packages/domain-bridge",
    "packages/reverse-gateway",
  ],
  "packages/sdk": ["packages/protocol"],
  "apps/domain": [
    "packages/protocol",
    "packages/domain-bridge",
    "packages/reverse-gateway",
    "packages/control-plane",
  ],
  "apps/control": [
    "packages/protocol",
    "packages/reverse-gateway",
    "packages/control-plane",
    "packages/sdk",
  ],
  "tools/snapshot": ["packages/protocol"],
  "tests/contract": [
    "packages/protocol",
    "packages/domain-bridge",
    "packages/reverse-gateway",
    "packages/control-plane",
    "tools/snapshot",
  ],
};

const KERNEL_SCOPE = "@deepseek-ai/";
const OWN_SCOPE = "@dsh-boot/";
/** ENG-022 判据②：类型导入用 import type 时单独列白名单文件（当前为空）。 */
const KERNEL_TYPE_IMPORT_WHITELIST = [];

function fail(msg) {
  problems.push(msg);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** 收集工作区包：目录 → package.json 内容。 */
function collectPackages() {
  const found = new Map();
  for (const dir of PACKAGE_DIRS) {
    const pkgPath = join(ROOT, dir, "package.json");
    if (!existsSync(pkgPath)) {
      fail(`缺少包：${dir} 的 package.json 不存在（依据 ENG-020 包划分）`);
      continue;
    }
    found.set(dir, readJson(pkgPath));
  }
  return found;
}

/** 解析一个 package.json 里声明的 @dsh-boot/* 依赖（dependencies + peerDependencies）。 */
function ownDeps(pkg) {
  const out = [];
  for (const section of ["dependencies", "peerDependencies"]) {
    for (const name of Object.keys(pkg[section] ?? {})) {
      if (name.startsWith(OWN_SCOPE)) out.push(name);
    }
  }
  return out;
}

/** R-2 / LAYER-001 §6.1：@dsh-boot/* 依赖与 §3 矩阵逐条比对。 */
function checkMatrix(packages) {
  for (const [dir, pkg] of packages) {
    for (const depName of ownDeps(pkg)) {
      const target = NAME_TO_DIR[depName];
      if (!target) {
        fail(
          `${dir} → ${depName} 未登记的 @dsh-boot/* 依赖（依据 ENG-020 包划分 / LAYER-001 §4 保守默认）`
        );
        continue;
      }
      if (!MATRIX[dir].includes(target)) {
        fail(`${dir} → ${target} 违反方向（依据 ENG-021 / LAYER-001 §3）`);
      }
    }
  }
}

/** R-1 / ENG-020 判据②：protocol 的 dependencies 与 peerDependencies 不含 @dsh-boot/* 与内核运行期包。 */
function checkProtocolLeaf(packages) {
  const pkg = packages.get("packages/protocol");
  if (!pkg) return;
  const sections = ["dependencies", "peerDependencies"];
  for (const section of sections) {
    for (const name of Object.keys(pkg[section] ?? {})) {
      if (name.startsWith(OWN_SCOPE)) {
        fail(
          `packages/protocol → ${name} 叶包依赖 @dsh-boot/*（依据 ENG-020 判据② / LAYER-001 §3 R-1）`
        );
      }
      if (name.startsWith(KERNEL_SCOPE)) {
        fail(
          `packages/protocol → ${name} 叶包依赖内核运行期包（依据 ENG-020 判据② / LAYER-001 §3 R-1）`
        );
      }
    }
  }
}

/** R-3 / ENG-021 判据②：依赖图零环（DFS）。 */
function checkCycles(packages) {
  const graph = new Map();
  for (const [dir, pkg] of packages) {
    graph.set(
      dir,
      ownDeps(pkg).map((n) => NAME_TO_DIR[n]).filter(Boolean)
    );
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  for (const dir of graph.keys()) color.set(dir, WHITE);
  const stack = [];

  function dfs(node) {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      if (color.get(next) === GRAY) {
        const cycle = [...stack.slice(stack.indexOf(next)), next];
        fail(`依赖图存在环：${cycle.join(" → ")}（依据 ENG-021 判据② / LAYER-001 §3 R-3）`);
      } else if (color.get(next) === WHITE) {
        dfs(next);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const dir of graph.keys()) {
    if (color.get(dir) === WHITE) dfs(dir);
  }
}

/** ENG-022 (a)：domain-bridge 不得依赖 control-plane（独立断言 + 独立失败信息）。 */
function checkBridgeNotAboveControlPlane(packages) {
  const pkg = packages.get("packages/domain-bridge");
  if (!pkg) return;
  for (const depName of ownDeps(pkg)) {
    if (depName === "@dsh-boot/control-plane") {
      fail(
        "packages/domain-bridge → packages/control-plane 反向依赖（依据 ENG-022 判据① (a)）：domain-bridge 不得依赖 control-plane"
      );
    }
  }
}

/** ENG-022 (b)：内核不得被产品壳代码 import（independent 断言）。 */
function checkNoKernelImport(packages) {
  const scanDirs = ["packages/control-plane", "packages/protocol"];
  for (const dir of scanDirs) {
    const srcDir = join(ROOT, dir, "src");
    if (!existsSync(srcDir)) continue;
    for (const file of walkSources(srcDir)) {
      if (KERNEL_TYPE_IMPORT_WHITELIST.includes(relative(ROOT, file).replaceAll(sep, "/"))) {
        continue;
      }
      const text = readFileSync(file, "utf8");
      const pattern = /from\s+['"]@deepseek-ai\/dsh/g;
      if (pattern.test(text)) {
        fail(
          `${relative(ROOT, file).replaceAll(sep, "/")} 产品壳代码 import 内核包（依据 ENG-022 判据① (b)）：命中数必须 == 0`
        );
      }
    }
  }
}

/** ENG-022 (c)：apps/domain 不得被任何包依赖（独立断言 + 独立失败信息）。 */
function checkDomainAppNotDependedOn(packages) {
  for (const [dir, pkg] of packages) {
    if (dir === "apps/domain") continue;
    for (const section of ["dependencies", "peerDependencies", "devDependencies"]) {
      for (const name of Object.keys(pkg[section] ?? {})) {
        if (name === "@dsh-boot/apps-domain") {
          fail(
            `${dir} → apps/domain 反向依赖（依据 ENG-022 判据① (c)）：apps/domain 不得被任何包依赖`
          );
        }
      }
    }
  }
}

/** ENG-024 / LAYER-001 §5：domain-bridge/src 反转面目录数断言（≤ 4 且 4 个面齐备）。 */
function checkReversalFaces() {
  const srcDir = join(ROOT, "packages/domain-bridge/src");
  if (!existsSync(srcDir)) {
    fail("packages/domain-bridge/src 不存在，无法断言反转面目录数（依据 ENG-024）");
    return;
  }
  const FACE_DIRS = new Set(["llm", "approval", "persistence"]);
  const entries = readdirSync(srcDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const unknown = dirs.filter((d) => !FACE_DIRS.has(d));
  if (dirs.length > 4) {
    fail(
      `packages/domain-bridge/src 一级目录数 ${dirs.length} > 4（依据 ENG-024）：新增第 5 个反转面必须先过架构审批并同步 SPEC-00 与设计文档`
    );
  }
  for (const d of unknown) {
    fail(
      `packages/domain-bridge/src/${d}/ 不是已登记的反转面目录（依据 ENG-024 / LAYER-001 §5）：登记的四个面为 llm/、{register,tools,guard}.ts、approval/、persistence/`
    );
  }
  for (const d of FACE_DIRS) {
    if (!existsSync(join(srcDir, d))) {
      fail(`packages/domain-bridge/src/${d}/ 缺失（依据 LAYER-001 §5）：四个反转面必须齐备`);
    }
  }
  for (const f of ["register.ts", "guard.ts"]) {
    if (!existsSync(join(srcDir, f))) {
      fail(`packages/domain-bridge/src/${f} 缺失（依据 LAYER-001 §5）：tools 反转面的入口文件必须齐备`);
    }
  }
}

function* walkSources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkSources(full);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts") || entry.name.endsWith(".mjs") || entry.name.endsWith(".js")) {
      yield full;
    }
  }
}

function main() {
  const packages = collectPackages();
  checkMatrix(packages);
  checkProtocolLeaf(packages);
  checkCycles(packages);
  checkBridgeNotAboveControlPlane(packages);
  checkNoKernelImport(packages);
  checkDomainAppNotDependedOn(packages);
  checkReversalFaces();

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ verdict: problems.length === 0 ? "pass" : "fail", problems }, null, 2));
  } else if (problems.length > 0) {
    for (const p of problems) console.error(`✗ ${p}`);
  }

  if (problems.length > 0) {
    console.error(`\n层依赖校验：${problems.length} 项违规（详见 docs/layer-dependency-matrix.md）`);
    process.exit(1);
  }
  console.log(`层依赖校验：${packages.size} 个包 / 矩阵逐条比对 / DFS 零环 / 反转面目录数断言 — 全部通过`);
}

main();
