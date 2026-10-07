/**
 * 完整轮次执行器（`ENG-042` / `ENG-047`）：通过反向网关桩跑通一轮，
 * 断言 `turn.started → message.delta → turn.completed` 全链路事件按序出现。
 *
 * 轮次路径：attest → resolve-model → prepare-call → stream（增量）
 *           → tool.call → tool-audit（先于审批）→ approval.requested → approval.decided
 *           → usage / egress / skills → turn.completed（设计 §6.3 / §6.4）。
 */

const PROTOCOL_VERSION = "1.0";

export function eventOrderAssertions(events) {
  const problems = [];
  if (events[0] !== "turn.started") problems.push(`首个事件必须是 turn.started，got ${events[0]}`);
  if (events[events.length - 1] !== "turn.completed") {
    problems.push(`末个事件必须是 turn.completed，got ${events[events.length - 1]}`);
  }
  const delta = events.indexOf("message.delta");
  const toolCall = events.indexOf("tool.call");
  const approval = events.indexOf("approval.requested");
  if (delta === -1) problems.push("缺少 message.delta");
  if (toolCall === -1) problems.push("缺少 tool.call");
  if (approval === -1) problems.push("缺少 approval.requested");
  if (delta !== -1 && approval !== -1 && !(delta < approval)) {
    problems.push("message.delta 必须先于 approval.requested");
  }
  // `ENG-012` 判据③：同 callId 的 tool.call 必须先于 approval.requested。
  if (toolCall !== -1 && approval !== -1 && !(toolCall < approval)) {
    problems.push("tool.call 必须先于 approval.requested（ENG-012）");
  }
  return problems;
}

export async function runTurn(baseUrl, seedProfile) {
  const turnId = `turn-${Date.now()}`;
  const headers = {
    "x-ov-turn-id": turnId,
    "x-ov-attribution": "provider=stub;model=stub-small",
    "content-type": "application/json",
  };
  const post = async (path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...body }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  };

  const events = [];
  events.push("turn.started");

  // attest（门禁）：四值响应 + 降级级别（`ENG-044`）。
  const attest = await post("/internal/kernel/attest", {
    profileId: seedProfile.profileId,
    trainVersion: seedProfile.trainVersion,
    trigger: "boot",
    rows: seedProfile.pluginSet,
    tools: [{ name: "dev-tool", schemaHash: "sha256-dev-tool" }],
    fibers: [],
  });
  if (attest.status !== 200 || attest.body.verdict !== "accept") {
    throw new Error(`attest failed: ${attest.status} ${JSON.stringify(attest.body)}`);
  }
  if (!attest.body.degradation) throw new Error("attest response missing degradation level");

  // resolve-model（硬）。
  const resolved = await post("/internal/kernel/llm/resolve-model", {
    provider: "stub",
    model: "stub-small",
  });
  if (resolved.status !== 200) throw new Error(`resolve-model failed: ${resolved.status}`);

  // prepare-call（硬）。
  const prepared = await post("/internal/kernel/llm/prepare-call", {
    provider: "stub",
    model: resolved.body.model,
    options: { prompt: "dev smoke turn" },
  });
  if (prepared.status !== 200 || prepared.body.prepared !== true) {
    throw new Error(`prepare-call failed: ${prepared.status}`);
  }

  // stream（硬）：逐 chunk 透传，显式终止帧。
  const stream = await fetch(`${baseUrl}/internal/kernel/llm/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      options: { prompt: "dev smoke turn" },
    }),
  });
  if (stream.status !== 200) throw new Error(`stream failed: ${stream.status}`);
  const raw = await stream.text();
  let terminated = false;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const frame = JSON.parse(line);
    if (frame.kind === "delta") {
      events.push("message.delta");
    } else if (frame.kind === "done") {
      terminated = frame.reason === "completed";
    }
  }
  if (!terminated) throw new Error("stream must end with an explicit done/completed frame");

  // tool.call → tool-audit（先于审批，`ENG-012` 判据③）→ 审批。
  events.push("tool.call");
  const audit = await post("/internal/kernel/tool-audit", {
    callId: prepared.body.callId,
    argsDigest: "sha256-dev-args",
  });
  if (audit.status !== 202) throw new Error(`tool-audit failed: ${audit.status}`);

  events.push("approval.requested");
  const approval = await post("/internal/kernel/approval/request", {
    sessionId: "dev-session",
    turnId,
    callId: prepared.body.callId,
    toolName: "dev-tool",
  });
  if (approval.status !== 200 || !approval.body.requestId) {
    throw new Error(`approval failed: ${approval.status}`);
  }
  events.push("approval.decided");

  // 软/缓存端点与出站代理。
  const usage = await post("/internal/kernel/usage", { tokens: 42 });
  if (usage.status !== 202) throw new Error(`usage failed: ${usage.status}`);
  const skills = await post("/internal/kernel/skills/resolve", { name: "dev-skill" });
  if (skills.status !== 200) throw new Error(`skills/resolve failed: ${skills.status}`);
  const egress = await fetch(`${baseUrl}/internal/egress/http/example.test`, {
    method: "GET",
    headers: { "x-ov-turn-id": turnId, "x-ov-attribution": "provider=stub" },
  });
  if (egress.status !== 200) throw new Error(`egress failed: ${egress.status}`);

  events.push("turn.completed");

  const problems = eventOrderAssertions(events);
  if (problems.length > 0) {
    throw new Error(`event order problems: ${problems.join("; ")}`);
  }
  return { events, attest: attest.body, turnId };
}
