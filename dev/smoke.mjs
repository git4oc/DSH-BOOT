/**
 * `pnpm dev:smoke`（`ENG-042` 判据①）：对运行中的最小拓扑执行一轮完整轮次，
 * 断言 `turn.started → message.delta → turn.completed` 全链路事件按序出现。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "./turn-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const port = process.env.DSH_GATEWAY_PORT ?? readGatewayPort();
const baseUrl = `http://127.0.0.1:${port}`;
const seedProfile = JSON.parse(readFileSync(join(here, "seed", "profile.json"), "utf8"));

function readGatewayPort() {
  const statePath = join(here, ".gateway.json");
  try {
    return JSON.parse(readFileSync(statePath, "utf8")).port;
  } catch {
    return "7301";
  }
}

try {
  const result = await runTurn(baseUrl, seedProfile);
  console.log(`[dev:smoke] turn ${result.turnId} events: ${result.events.join(" → ")}`);
  console.log("[dev:smoke] PASS");
  process.exit(0);
} catch (error) {
  console.error(`[dev:smoke] FAIL: ${error.message}`);
  process.exit(1);
}
