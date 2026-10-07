/**
 * `pnpm dev:up`（`ENG-042`）：从零起最小拓扑——反向网关桩（含内存 attest）+
 * 种子 Profile + 本地对象存储替身（目录）。分离进程启动，就绪探测后返回。
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const started = Date.now();

// 本地对象存储替身（目录）。
mkdirSync(join(here, "object-store"), { recursive: true });

const port = process.env.DSH_GATEWAY_PORT ?? "7301";
const child = spawn(
  process.execPath,
  [join(here, "gateway-main.mjs")],
  {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, DSH_GATEWAY_PORT: port, OV_ENV: "dev" },
  },
);
child.unref();

// 就绪探测：/healthz 可达即认为拓扑就绪。
const deadline = Date.now() + 60_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    /* not yet */
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

if (!ready) {
  console.error("[dev:up] gateway stub did not become ready in 60s");
  process.exit(1);
}

if (!existsSync(join(here, "seed", "profile.json"))) {
  console.error("[dev:up] seed profile missing");
  process.exit(1);
}

const elapsedMs = Date.now() - started;
writeFileSync(
  join(here, ".dev-up-timing.json"),
  JSON.stringify({ elapsedMs, at: new Date().toISOString() }),
);
console.log(`[dev:up] topology ready in ${elapsedMs}ms (limit 300000ms) at http://127.0.0.1:${port}`);
console.log("[dev:up] run `pnpm dev:smoke` to exercise one full turn");
