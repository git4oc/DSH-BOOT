#!/usr/bin/env node
/**
 * `packages/sdk` 生成器（`ENG-020`）：由 `contracts/openapi.json` 生成，不手写。
 *
 * 口径与 tools/validate-contracts.mjs 的 OAS 遍历一致：只收编 HTTP 操作（get/put/post/
 * delete/patch/head/options/trace）——路径级 `parameters` 等非 HTTP 键**不是操作**；
 * 缺 `operationId` 即失败（SDK 生成必需，validate-contracts 的 `OAS` 检查项）。
 *
 * `--check` 模式：重放生成并与现存文件比对，不一致即退出 1（CI 校验生成物与 OpenAPI 一致）。
 *
 * 用法：node tools/gen-sdk.mjs [--root <dir>] [--check]
 * 仓库根：默认按本文件位置定位（tools/ 的上一级），--root 显式覆盖。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rootIdx = process.argv.indexOf("--root");
const ROOT = rootIdx >= 0 ? resolve(process.argv[rootIdx + 1]) : resolve(here, "..");

/** HTTP 操作方法白名单（与 tools/validate-contracts.mjs 的 OAS 遍历同口径）。 */
const HTTP = ["get", "put", "post", "delete", "patch", "head", "options", "trace"];

const spec = JSON.parse(readFileSync(join(ROOT, "contracts", "openapi.json"), "utf8"));
const operations = [];
const missingOperationId = [];
for (const [path, methods] of Object.entries(spec.paths ?? {})) {
  for (const [method, op] of Object.entries(methods)) {
    if (!HTTP.includes(method)) continue; // 路径级 parameters 等非 HTTP 键不是操作
    if (typeof op !== "object" || op === null) continue;
    if (!op.operationId) {
      missingOperationId.push(`${method.toUpperCase()} ${path}`);
      continue;
    }
    operations.push({ path, method: method.toUpperCase(), operationId: op.operationId });
  }
}
if (missingOperationId.length > 0) {
  console.error(`[gen-sdk] 以下操作缺 operationId，无法生成 SDK（SDK 生成必需）：
  ${missingOperationId.join("\n  ")}`);
  process.exit(2);
}
operations.sort((a, b) => (a.operationId < b.operationId ? -1 : 1));

const lines = [
  "// @generated",
  "// `@dsh-boot/sdk` — OpenAPI 生成物（`contracts/openapi.json`），不手写（`ENG-020` 判据③）。",
  "// 任何修改都必须通过生成器重放（node tools/gen-sdk.mjs），CI 校验生成物与 OpenAPI 一致。",
  `export const OPENAPI_VERSION = ${JSON.stringify(spec.openapi ?? "3.1")} as const;`,
  `export const INFO_TITLE = ${JSON.stringify(spec.info?.title ?? "DSH API")} as const;`,
  "",
  "export interface SdkOperation {",
  "  readonly operationId: string;",
  "  readonly method: string;",
  "  readonly path: string;",
  "}",
  "",
  "export const OPERATIONS: readonly SdkOperation[] = [",
  ...operations.map((op) => `  { operationId: ${JSON.stringify(op.operationId)}, method: ${JSON.stringify(op.method)}, path: ${JSON.stringify(op.path)} },`),
  "] as const;",
  "",
  "export const OPERATION_IDS: readonly string[] = OPERATIONS.map((op) => op.operationId);",
  "",
];

const generated = `${lines.join("\n")}`;
if (process.argv.includes("--check")) {
  const existing = readFileSync(join(ROOT, "packages", "sdk", "src", "index.ts"), "utf8");
  if (existing !== generated) {
    console.error("SDK 与 OpenAPI 不一致：重放 node tools/gen-sdk.mjs（ENG-020）");
    process.exit(1);
  }
  console.log(`[gen-sdk] 一致（${operations.length} 个操作）`);
} else {
  writeFileSync(join(ROOT, "packages", "sdk", "src", "index.ts"), generated, { encoding: "utf8" });
  console.log(`[gen-sdk] 已生成 ${operations.length} 个操作`);
}
