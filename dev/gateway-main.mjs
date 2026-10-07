/**
 * 反向网关桩的服务入口（`ENG-042` 等价脚本拓扑；`ENG-043` / `ENG-044`）。
 * 由 `pnpm dev:up` 以分离进程启动；端口与 PID 写入 `dev/.gateway.json`。
 */

import { createGatewayStub, listenStub } from "../packages/reverse-gateway/src/stub/index.ts";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const seedProfile = JSON.parse(readFileSync(join(here, "seed", "profile.json"), "utf8"));
const port = Number(process.env.DSH_GATEWAY_PORT ?? 7301);

const stub = createGatewayStub({
  port,
  seedProfile,
  attributionHeaderNames: ["x-ov-turn-id", "x-ov-attribution"],
});

const actualPort = await listenStub(stub);
const statePath = join(here, ".gateway.json");
writeFileSync(statePath, JSON.stringify({ pid: process.pid, port: actualPort }));

console.log(`[gateway-stub] listening on http://127.0.0.1:${actualPort} (pid ${process.pid})`);

const shutdown = () => {
  try {
    unlinkSync(statePath);
  } catch {
    /* already gone */
  }
  stub.close().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
