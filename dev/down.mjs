/**
 * `pnpm dev:down`：停止 `dev:up` 启动的反向网关桩（读取 `dev/.gateway.json` 的 PID）。
 */

import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const statePath = join(here, ".gateway.json");

if (!existsSync(statePath)) {
  console.log("[dev:down] no running gateway stub");
  process.exit(0);
}

const state = JSON.parse(readFileSync(statePath, "utf8"));
try {
  process.kill(state.pid);
  console.log(`[dev:down] stopped gateway stub (pid ${state.pid}, port ${state.port})`);
} catch {
  console.log(`[dev:down] process ${state.pid} already gone`);
}
unlinkSync(statePath);
