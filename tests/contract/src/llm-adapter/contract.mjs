/**
 * P0-A1 契约测试：`LlmAdapter` 模型调用经反向网关出域（`ENG-005`–`ENG-008`）。
 *
 * 验收项：
 *   1. 字段保真比对（`ENG-007`）：深冻结请求 JSON 往返一致、字段数一致、仍为深冻结
 *   2. abort 在 TTFB 前生效并取消网关侧上游连接（设计 §6.3 流式契约）
 *   3. 反向网关桩对四个 LLM 端点全断言归因头，缺头返回 400（`ENG-008` 判据③）
 *   4. 注入持续 429，断言在 `T_m` 内终结且不突破 `T_m`（`ENG-006` 判据②）
 *   5. resolve-model / prepare-call 失败必须 fail-closed，不得返回缓存或默认值（`CTR-001` §2.5）
 * 附加：`ENG-005` 判据①②（providerInfo/listModels/resolveModel）、`ENG-006` 判据①③
 * （prepareCall().stream() 可消费 + 单一漏斗）、`ENG-008` 判据③（源码无 this.attributionHeaders）。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createCaptureGateway } from "../../fixtures/llm/capture-gateway.ts";
import {
  DSH_LLM_RETRY_MOUNTED,
  GatewayLlmAdapter,
  clearCurrentTurnContext,
  setCurrentTurnContext,
} from "../../../../packages/domain-bridge/src/llm/index.ts";
import { createGatewayStub, listenStub } from "../../../../packages/reverse-gateway/src/stub/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const results = [];
const record = (name, verdict, detail) => results.push({ name, verdict, detail });

function deepFreeze(obj) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    // AbortSignal 不可冻结（内部 kAborted 状态会被冻结破坏）。
    if (value && typeof value === "object" && !(value instanceof AbortSignal)) deepFreeze(value);
  }
  return Object.freeze(obj);
}

async function consume(iterable) {
  const chunks = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

async function main() {
  // ── 1. 字段保真比对（`ENG-007`） ─────────────────────────────────────────
  {
    const gw = await createCaptureGateway();
    const adapter = new GatewayLlmAdapter({ gatewayBaseUrl: gw.url, modelStreamSeconds: 5 });
    setCurrentTurnContext("turn-FIDELITY-001", "provider=stub;model=stub-small");
    const options = deepFreeze({
      provider: "stub",
      model: "stub-small",
      prompt: "P0-A1 fidelity probe",
      temperature: 0.7,
      maxTokens: 128,
      messages: [{ role: "user", content: "hi" }],
      metadata: { sessionId: "s-1", turnId: "t-1" },
    });
    const chunks = await consume(adapter.stream(options));
    const captured = gw.lastRequest("/internal/kernel/llm/stream");
    const wire = JSON.parse(captured.body);
    const roundTrip = JSON.stringify(wire.options) === JSON.stringify(options);
    const fieldCount = Object.keys(wire.options).length === Object.keys(options).length;
    let stillFrozen = Object.isFrozen(options);
    try {
      options.temperature = 999;
      stillFrozen = false;
    } catch {
      stillFrozen = true;
    }
    let nestedFrozen = true;
    try {
      options.metadata.sessionId = "mutated";
      nestedFrozen = false;
    } catch {
      nestedFrozen = true;
    }
    const last = chunks[chunks.length - 1];
    const explicitDone = last.kind === "done" && last.reason === "completed";
    record(
      "OPTIONS-FIDELITY",
      roundTrip && fieldCount && stillFrozen && nestedFrozen && explicitDone,
      `深冻结请求 JSON 往返一致=${roundTrip}，字段数一致=${fieldCount}，仍深冻结=${stillFrozen && nestedFrozen}，显式终止帧=${explicitDone}（ENG-007 判据①②）`,
    );
    // 单一漏斗：stream 必须先流经 prepare-call（`ENG-006` 判据③）。
    const funnel = gw.requestCount("/internal/kernel/llm/prepare-call") === 1 &&
      gw.requestCount("/internal/kernel/llm/stream") === 1;
    record("PREPARED-CALL-FUNNEL", funnel, "每次派发先经 prepare-call 收敛，无绕过路径（ENG-006 判据③）");
    await gw.close();
    clearCurrentTurnContext();
  }

  // ── 2. abort 在 TTFB 前生效（设计 §6.3 流式契约） ────────────────────────
  {
    const gw = await createCaptureGateway({ ttfbMs: 5000 });
    const adapter = new GatewayLlmAdapter({ gatewayBaseUrl: gw.url, modelStreamSeconds: 60 });
    setCurrentTurnContext("turn-ABORT-001", "provider=stub");
    const controller = new AbortController();
    const options = deepFreeze({
      provider: "stub",
      model: "stub-small",
      prompt: "abort before TTFB",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    const start = Date.now();
    const chunks = await consume(adapter.stream(options));
    const elapsed = Date.now() - start;
    const last = chunks[chunks.length - 1];
    const abortedFrame = last.kind === "done" && last.reason === "aborted";
    const prompt = elapsed < 2000;
    const upstreamCancelled = gw.lastRequest("/internal/kernel/llm/stream")?.closedBeforeResponse === true;
    record(
      "ABORT-BEFORE-TTFB",
      abortedFrame && prompt && upstreamCancelled,
      `终止帧 done/aborted=${abortedFrame}，${elapsed}ms（TTFB 5000ms 前生效）=${prompt}，网关侧上游连接已取消=${upstreamCancelled}`,
    );
    await gw.close();
    clearCurrentTurnContext();
  }

  // ── 3. 反向网关桩四端点归因头断言（`ENG-008` 判据③） ─────────────────────
  {
    const stub = createGatewayStub({ port: 0, seedProfile: { profileId: "dev-seed", trainVersion: "0" } });
    const port = await listenStub(stub);
    const base = `http://127.0.0.1:${port}`;
    const endpoints = [
      "/internal/kernel/llm/stream",
      "/internal/kernel/llm/models",
      "/internal/kernel/llm/resolve-model",
      "/internal/kernel/llm/prepare-call",
    ];
    let all400 = true;
    for (const endpoint of endpoints) {
      const response = await fetch(`${base}${endpoint}`, {
        method: "POST",
        body: JSON.stringify({ options: { provider: "stub" } }),
      });
      if (response.status !== 400) all400 = false;
    }
    record(
      "ATTRIBUTION-FOUR-ENDPOINTS",
      all400,
      `四个 LLM 端点缺归因头全部 400（stream/models/resolve-model/prepare-call）=${all400}（ENG-008 判据③）`,
    );
    await stub.close();
  }

  // ── 4. 持续 429：在 `T_m` 内终结且不突破 `T_m`（`ENG-006` 判据②） ─────────
  {
    const gw = await createCaptureGateway({ sustainedStatus: 429 });
    const adapter = new GatewayLlmAdapter({ gatewayBaseUrl: gw.url, modelStreamSeconds: 1 });
    setCurrentTurnContext("turn-RETRY-001", "provider=stub");
    const start = Date.now();
    const chunks = await consume(adapter.stream(deepFreeze({ provider: "stub", model: "stub-small", prompt: "429" })));
    const elapsed = Date.now() - start;
    const last = chunks[chunks.length - 1];
    const withinBudget = elapsed <= 1100; // T_m = 1000ms + 观测容差
    const attempted = gw.requestCount("/internal/kernel/llm/stream") > 1;
    record(
      "SUSTAINED-429-TM-BUDGET",
      last.kind === "done" && last.reason === "adapter-error" && withinBudget && attempted,
      `持续 429 在 ${elapsed}ms 终结（T_m=1000ms）=${withinBudget}，重试发生（${gw.requestCount("/internal/kernel/llm/stream")} 次）=${attempted}，终态 done/adapter-error=${last.reason === "adapter-error"}（ENG-006 判据②）`,
    );
    await gw.close();
    clearCurrentTurnContext();
  }

  // ── 5. resolve-model / prepare-call 失败 fail-closed（`CTR-001` §2.5） �───
  {
    const gw = await createCaptureGateway({ failResolve: true, failPrepare: true });
    const adapter = new GatewayLlmAdapter({ gatewayBaseUrl: gw.url, modelStreamSeconds: 5 });
    setCurrentTurnContext("turn-FAILCLOSED-001", "provider=stub");
    let resolveFailed = false;
    try {
      await adapter.resolveModel("stub", "stub-small");
    } catch (error) {
      resolveFailed = error.name === "RESOLVE_MODEL_FAILED";
    }
    const chunks = await consume(adapter.stream(deepFreeze({ provider: "stub", model: "stub-small", prompt: "x" })));
    const last = chunks[chunks.length - 1];
    const streamFailed = last.kind === "done" && last.reason === "adapter-error";
    const noDefaultDispatch = gw.requestCount("/internal/kernel/llm/stream") === 0;
    record(
      "FAIL-CLOSED",
      resolveFailed && streamFailed && noDefaultDispatch,
      `resolve-model 抛 RESOLVE_MODEL_FAILED=${resolveFailed}，prepare-call 失败后轮次以 adapter-error 终结=${streamFailed}，无默认派发=${noDefaultDispatch}`,
    );
    await gw.close();
    clearCurrentTurnContext();
  }

  // ── 6. `ENG-005` 判据①② + `ENG-006` 判据①（真实桩） ─────────────────────
  {
    const stub = createGatewayStub({ port: 0, seedProfile: { profileId: "dev-seed", trainVersion: "0" } });
    const port = await listenStub(stub);
    const adapter = new GatewayLlmAdapter({ gatewayBaseUrl: `http://127.0.0.1:${port}`, modelStreamSeconds: 10 });
    setCurrentTurnContext("turn-CONTRACT-001", "provider=stub;model=stub-small");
    const infoOk = adapter.providerInfo("stub").id === "stub";
    const models = await adapter.listModels("stub");
    const listOk = models.length === 2 && models.every((m) => m.provider === "stub" && typeof m.contextWindow === "number");
    const ref = await adapter.resolveModel("stub", "stub-small");
    const resolveOk = ref.provider === "stub" && ref.model === "stub-small" && ref.contextWindow === 128000;
    record(
      "ADAPTER-CONTRACT-ENG005",
      infoOk && listOk && resolveOk,
      `providerInfo(p).id===p=${infoOk}，listModels 结构化非空=${listOk}，resolveModel 精确身份=${resolveOk}（ENG-005 判据①②）`,
    );
    const prepared = adapter.prepareCall("stub", "stub-small", { temperature: 0.5 });
    const chunks = await consume(prepared.stream(deepFreeze({ provider: "stub", model: "stub-small", prompt: "prepared" })));
    const last = chunks[chunks.length - 1];
    const deltas = chunks.filter((c) => c.kind === "delta").length;
    record(
      "PREPARED-STREAM-CONSUMABLE",
      last.kind === "done" && last.reason === "completed" && deltas > 0,
      `prepareCall(p,m).stream(opts) 可消费并产出 chunk（delta=${deltas}，显式终止帧=${last.reason}）（ENG-006 判据①）`,
    );
    let invalidPrepared = false;
    try {
      const mismatched = adapter.prepareCall("stub", "stub-small", {});
      await consume(mismatched.stream(deepFreeze({ provider: "other", model: "other-model", prompt: "x" })));
    } catch (error) {
      invalidPrepared = error.name === "INVALID_PREPARED_CALL";
    }
    record("INVALID-PREPARED-CALL", invalidPrepared, `派发上下文不一致抛 INVALID_PREPARED_CALL=${invalidPrepared}（ENG-006）`);
    await stub.close();
    clearCurrentTurnContext();
  }

  // ── 7. `ENG-008` 判据③：源码禁止 this.attributionHeaders ────────────────
  {
    const source = readFileSync(
      join(here, "..", "..", "..", "..", "packages", "domain-bridge", "src", "llm", "gateway-adapter.ts"),
      "utf8",
    );
    const noThisForm = !source.includes("this.attributionHeaders");
    const usesModuleFn = source.includes("attributionHeaders()");
    const retryDeclared = DSH_LLM_RETRY_MOUNTED === false;
    record(
      "ATTRIBUTION-SOURCE-CHECK",
      noThisForm && usesModuleFn && retryDeclared,
      `源码无 this.attributionHeaders=${noThisForm}，模块级函数出站携带=${usesModuleFn}，dsh-llm-retry 不挂载显式声明=${retryDeclared}（ENG-008 判据③ / REL-102）`,
    );
  }
}

try {
  await main();
} catch (error) {
  results.push({ name: "UNCAUGHT", verdict: "fail", detail: String(error?.stack ?? error) });
}

for (const r of results) {
  console.log(`${r.verdict ? "✓" : "✗"} ${r.name}: ${r.detail}`);
}
const failed = results.filter((r) => !r.verdict);
if (failed.length > 0) {
  console.error(`\n[contract:llm] FAIL — ${failed.length}/${results.length} 项未通过`);
  process.exit(1);
}
console.log(`\n[contract:llm] PASS — ${results.length}/${results.length} 项通过（ENG-005–008）`);
