/**
 * `pnpm gate:001`（`ENG-047`；`SPEC-00` §7 `GATE-001` 通过条件）。
 *
 * 一条命令：dev:up → 反向网关桩与内存 attest 自检 → 一轮 smoke →
 * 开发态逃生门双向断言 → 生产态拒绝 "*" 断言。退出码非零即 P-1 不得开工 P0。
 * 幂等：每次起临时端口的新桩，可重复执行。
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "./turn-harness.mjs";
import { escapeHatchAssertions, validateProfile } from "../packages/control-plane/src/profile/validate.ts";

const here = dirname(fileURLToPath(import.meta.url));
const problems = [];
const checks = [];
const started = Date.now();
const record = (name, ok, detail) => {
  checks.push({ name, verdict: ok ? "pass" : "fail", detail });
  if (!ok) problems.push(`${name}: ${detail}`);
};

function ok2xx(response) {
  return response.status >= 200 && response.status < 300;
}

async function post(baseUrl, path, body, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "x-ov-turn-id": "gate001",
      "x-ov-attribution": "provider=stub;model=stub-small",
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({ protocolVersion: "1.0", ...body }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

// ── 1. 起桩（临时端口，幂等） ──────────────────────────────────────────────
const child = spawn(
  process.execPath,
  [join(here, "gateway-main.mjs")],
  {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, DSH_GATEWAY_PORT: "0", OV_ENV: "dev" },
  },
);
child.unref();

const statePath = join(here, ".gateway.json");
const deadline = Date.now() + 60_000;
let port;
while (Date.now() < deadline) {
  if (existsSync(statePath)) {
    try {
      port = JSON.parse(readFileSync(statePath, "utf8")).port;
      const health = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (health.ok) break;
    } catch {
      /* not yet */
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!port) {
  console.error("[gate:001] gateway stub did not become ready");
  process.exit(1);
}
const baseUrl = `http://127.0.0.1:${port}`;
const upElapsedMs = Date.now() - started;
record("dev.up.elapsed", upElapsedMs <= 300_000, `topology ready in ${upElapsedMs}ms (limit 300000ms, ENG-042 判据②)`);
record("gateway.self.routes", (await (await fetch(`${baseUrl}/__routes`)).json()).count === 10, "route table has exactly 10 §6.3 endpoints (ENG-043 判据①)");

// ── 2. 反向网关桩自检（HTTP 级，`ENG-043` 判据①③） ───────────────────────
const noAttribution = await fetch(`${baseUrl}/internal/kernel/llm/models`, { method: "POST" });
record(
  "gateway.attribution.400",
  noAttribution.status === 400,
  `missing attribution headers yield 400 (ENG-008 判据③), got ${noAttribution.status}`,
);

const badVersion = await fetch(`${baseUrl}/internal/kernel/llm/models`, {
  method: "POST",
  headers: { "x-ov-turn-id": "t", "x-ov-attribution": "a", "content-type": "application/json" },
  body: JSON.stringify({ protocolVersion: "9.9" }),
});
record("gateway.protocolVersion.426", badVersion.status === 426, `incompatible protocolVersion yields 426, got ${badVersion.status}`);

const hardEndpoints = [
  "/internal/kernel/llm/stream",
  "/internal/kernel/llm/models",
  "/internal/kernel/llm/resolve-model",
  "/internal/kernel/llm/prepare-call",
  "/internal/kernel/approval/request",
  "/internal/kernel/skills/resolve",
  "/internal/kernel/attest",
];
let attributionAll400 = true;
for (const endpoint of hardEndpoints) {
  const response = await fetch(`${baseUrl}${endpoint}`, { method: "POST", body: "{}" });
  if (response.status !== 400) attributionAll400 = false;
}
record("gateway.attribution.allHardEndpoints", attributionAll400, "every hard endpoint rejects missing attribution with 400 (ENG-008 判据③)");

// ── 3. 故障旋钮（`ENG-043` 判据②） ────────────────────────────────────────
const ttfbStart = Date.now();
await fetch(`${baseUrl}/__knobs`, { method: "POST", body: JSON.stringify({ ttfbMs: 400 }) });
const ttfbStream = await fetch(`${baseUrl}/internal/kernel/llm/stream`, {
  method: "POST",
  headers: { "x-ov-turn-id": "t", "x-ov-attribution": "a", "content-type": "application/json" },
  body: JSON.stringify({ protocolVersion: "1.0", options: { prompt: "ttfb" } }),
});
await ttfbStream.text();
const ttfbElapsed = Date.now() - ttfbStart;
record("knob.ttfb", ttfbStream.status === 200 && ttfbElapsed >= 400, `TTFB delay 400ms observed ${ttfbElapsed}ms → triggers T_m path (ENG-043 判据②)`);

await fetch(`${baseUrl}/__knobs`, { method: "POST", body: JSON.stringify({ streamMode: "aborted" }) });
const aborted = await fetch(`${baseUrl}/internal/kernel/llm/stream`, {
  method: "POST",
  headers: { "x-ov-turn-id": "t", "x-ov-attribution": "a", "content-type": "application/json" },
  body: JSON.stringify({ protocolVersion: "1.0", options: { prompt: "abort" } }),
});
const abortedText = await aborted.text();
record("knob.aborted", abortedText.includes('"reason":"aborted"'), "aborted stream ends with explicit done/aborted frame → 轮次中断 (ENG-043 判据②)");

await fetch(`${baseUrl}/__knobs`, { method: "POST", body: JSON.stringify({ streamMode: "adapter-error" }) });
const adapterError = await fetch(`${baseUrl}/internal/kernel/llm/stream`, {
  method: "POST",
  headers: { "x-ov-turn-id": "t", "x-ov-attribution": "a", "content-type": "application/json" },
  body: JSON.stringify({ protocolVersion: "1.0", options: { prompt: "err" } }),
});
const adapterText = await adapterError.text();
record(
  "knob.adapterError",
  adapterText.includes('"kind":"error"') && adapterText.includes('"reason":"adapter-error"'),
  "adapter-error stream carries explicit error frame + done/adapter-error (ENG-043 判据②)",
);

await fetch(`${baseUrl}/__knobs`, { method: "POST", body: JSON.stringify({ approvalNoResponse: true }) });
let hangObserved = false;
try {
  const approvalHang = await fetch(`${baseUrl}/internal/kernel/approval/request`, {
    method: "POST",
    headers: { "x-ov-turn-id": "t", "x-ov-attribution": "a", "content-type": "application/json" },
    body: JSON.stringify({ protocolVersion: "1.0", sessionId: "s", turnId: "t", callId: "c" }),
    signal: AbortSignal.timeout(800),
  });
  await approvalHang.text();
} catch (error) {
  hangObserved = error.name === "TimeoutError" || error.name === "AbortError"; // 客户端超时收敛 = T_a 路径
}
record("knob.approvalNoResponse", hangObserved, "approval no-response knob hangs the request → client T_a timeout (ENG-043 判据②)");

await fetch(`${baseUrl}/__reset`, { method: "POST" });

// ── 4. 内存 attest 自检（`ENG-044` 判据①②，HTTP 级） ─────────────────────
const seedProfile = JSON.parse(readFileSync(join(here, "seed", "profile.json"), "utf8"));
const attestHeaders = { "x-ov-turn-id": "t", "x-ov-attribution": "a" };
const clean = await post(baseUrl, "/internal/kernel/attest", {
  profileId: seedProfile.profileId,
  trainVersion: seedProfile.trainVersion,
  trigger: "boot",
  rows: seedProfile.pluginSet,
  tools: [{ name: "dev-tool", schemaHash: "sha256-x" }],
  fibers: [],
}, attestHeaders);
record(
  "attest.accept",
  clean.body.verdict === "accept" && clean.body.degradation === "L0",
  `clean boot → accept + degradation ${clean.body.degradation ?? "missing"}`,
);
const missing = await post(baseUrl, "/internal/kernel/attest", { trigger: "boot" }, attestHeaders);
record("attest.missingField.deny", missing.body.verdict === "deny", `missing-field request → deny (ENG-044 判据①)`);
const badTrigger = await post(baseUrl, "/internal/kernel/attest", {
  profileId: seedProfile.profileId,
  trainVersion: seedProfile.trainVersion,
  trigger: "nope",
  rows: [],
  tools: [],
  fibers: [],
}, attestHeaders);
record("attest.trigger.enum", badTrigger.body.verdict === "deny", "unknown trigger → deny (触发原因枚举闭合)");
const fiberHit = await post(baseUrl, "/internal/kernel/attest", {
  profileId: seedProfile.profileId,
  trainVersion: seedProfile.trainVersion,
  trigger: "boot",
  rows: [{ name: "row", version: "0" }],
  tools: [{ name: "tool", schemaHash: "sha256-x" }],
  fibers: ["hmr"],
}, attestHeaders);
record("attest.forbiddenFiber", fiberHit.body.verdict === "deny", "forbidden fiber (hmr) → deny");
const resync = await post(baseUrl, "/internal/kernel/attest", {
  profileId: seedProfile.profileId,
  trainVersion: seedProfile.trainVersion,
  trigger: "tools-change",
  rows: [{ name: "row", version: "0" }],
  tools: [{ name: "tool", schemaHash: "sha256-x" }],
  fibers: [],
}, attestHeaders);
record("attest.toolsChange.resync", resync.body.verdict === "resync-profile", "tools-change trigger → resync-profile");
await fetch(`${baseUrl}/__knobs`, { method: "POST", body: JSON.stringify({ attestForceVerdict: "drain-domain", degradationLevel: "L2" }) });
const forced = await post(baseUrl, "/internal/kernel/attest", {
  profileId: seedProfile.profileId,
  trainVersion: seedProfile.trainVersion,
  trigger: "heartbeat",
  rows: [],
  tools: [],
  fibers: [],
}, attestHeaders);
record(
  "attest.fourValues.degradation",
  forced.body.verdict === "drain-domain" && forced.body.degradation === "L2",
  `four-value response + degradation level override → ${forced.body.verdict}/${forced.body.degradation} (ENG-044)`,
);
await fetch(`${baseUrl}/__reset`, { method: "POST" });

// ── 5. 一轮完整 smoke（`ENG-042` 判据①） ─────────────────────────────────
try {
  const result = await runTurn(baseUrl, seedProfile);
  record("smoke.fullTurn", true, `turn events: ${result.events.join(" → ")}`);
} catch (error) {
  record("smoke.fullTurn", false, error.message);
}

// ── 6. 逃生门双向断言 + 生产态拒绝 "*"（`ENG-045` / `ENG-047`） ────────────
const escape = escapeHatchAssertions();
record(
  "toolAllowlist.escapeHatch",
  escape.verdict === "pass",
  escape.problems.join("; ") ||
    'dev 接受 ["*"] 与缺省（含 ESCAPE_HATCH_ACTIVE 告警）；生产态拒绝 ["*"] / [] / 缺省 / glob（ENG-045 判据①）',
);
const seedCheck = validateProfile(seedProfile, "dev");
record(
  "seed.profile.dev",
  seedCheck.ok === true && seedCheck.warnings.some((w) => w.code === "ESCAPE_HATCH_ACTIVE"),
  '种子 Profile（dev，toolAllowlist ["*"]）通过校验且携带逃生门告警',
);

// ── 7. 收尾与证据 ────────────────────────────────────────────────────────
try {
  process.kill(JSON.parse(readFileSync(statePath, "utf8")).pid);
} catch {
  /* already gone */
}
await new Promise((resolve) => setTimeout(resolve, 300));
try {
  if (existsSync(statePath)) unlinkSync(statePath);
} catch {
  /* best effort */
}

mkdirSync(join(here, "..", "evidence", "GATE-001"), { recursive: true });
const report = {
  gate: "GATE-001",
  verdict: problems.length === 0 ? "pass" : "fail",
  at: new Date().toISOString(),
  checks,
  problems,
};
writeFileSync(
  join(here, "..", "evidence", "GATE-001", "gate001-report.json"),
  JSON.stringify(report, null, 2),
);

for (const check of checks) {
  console.log(`${check.verdict === "pass" ? "✓" : "✗"} ${check.name}: ${check.detail}`);
}
if (problems.length > 0) {
  console.error(`\n[gate:001] FAIL — ${problems.length} 项未通过（证据：evidence/GATE-001/gate001-report.json）`);
  process.exit(1);
}
console.log("\n[gate:001] PASS — 最小拓扑跑通完整轮次；桩与 attest 自检通过；逃生门双向断言通过；生产态拒绝 \"*\"");
process.exit(0);
