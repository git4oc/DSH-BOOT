/**
 * 内存 attest 桩（`ENG-044`；设计 §6.3 `/internal/kernel/attest` 契约）。
 *
 * - 校验请求字段：`profileId`、`trainVersion`、实际加载的插件行与版本、`tools[]`
 *   （名称 + schema 哈希）、活动 fiber 检查（plugin-manager / hmr / credential provider）、
 *   触发原因枚举（`boot｜tools-change｜heartbeat`）
 * - 四值响应：`accept` / `deny` / `resync-profile` / `drain-domain` + 当前降级级别
 * - 缺字段请求返回 `deny`（`ENG-044` 判据①）
 * - 定性为 **detective**（设计 `D15`：自报指纹不防篡改，不计入硬控制）
 */

import type {
  AttestRequest,
  AttestResponse,
  AttestTrigger,
  AttestVerdict,
  DegradationLevel,
  FaultKnobs,
} from "./types.ts";

/** 活动 fiber 检查（设计 §6.3：这三个 fiber 的存在即配置漂移）。 */
const FORBIDDEN_FIBERS = ["plugin-manager", "hmr", "credential-provider"];

/** 触发原因枚举（设计 §6.3）。 */
const TRIGGERS: readonly string[] = ["boot", "tools-change", "heartbeat"];

export interface AttestStub {
  /** 契约判定入口（缺字段即 deny，缺省旋钮覆盖）。 */
  attest(request: AttestRequest): AttestResponse;
  /** 当前降级级别（`ENG-044`：响应含降级级别）。 */
  degradation(): DegradationLevel;
  /** 应用故障旋钮（forceVerdict / degradationLevel 覆盖）。 */
  applyKnobs(knobs: FaultKnobs): void;
  /** 自检（`ENG-044` 判据①②的最小形态）。 */
  selfCheck(): { verdict: "pass" | "fail"; problems: readonly string[] };
}

const PROTOCOL_VERSION = "1.0";

export function createAttestStub(
  seedProfile: Record<string, unknown>,
  knobs: FaultKnobs = {},
): AttestStub {
  let forcedVerdict: AttestVerdict | undefined = knobs.attestForceVerdict;
  let degradation: DegradationLevel = knobs.degradationLevel ?? "L0";
  let counter = 0;

  const knownProfileId = typeof seedProfile.profileId === "string" ? seedProfile.profileId : "";
  const knownTrainVersion =
    typeof seedProfile.trainVersion === "string" ? seedProfile.trainVersion : "";

  function attest(request: AttestRequest): AttestResponse {
    counter += 1;
    const requestId = `attest-${counter}`;
    const reasons: string[] = [];

    if (request.protocolVersion !== PROTOCOL_VERSION) {
      // 设计 §6.3：反向通道须带 protocolVersion，不兼容返回 426（由路由层处理）。
      reasons.push(`protocolVersion mismatch: ${String(request.protocolVersion)}`);
    }
    if (typeof request.profileId !== "string" || request.profileId.length === 0) {
      reasons.push("missing profileId");
    } else if (knownProfileId && request.profileId !== knownProfileId) {
      reasons.push(`unknown profileId: ${request.profileId}`);
    }
    if (typeof request.trainVersion !== "string" || request.trainVersion.length === 0) {
      reasons.push("missing trainVersion");
    } else if (knownTrainVersion && request.trainVersion !== knownTrainVersion) {
      reasons.push(`trainVersion mismatch: ${request.trainVersion} != ${knownTrainVersion}`);
    }
    if (!TRIGGERS.includes(request.trigger)) {
      reasons.push(`trigger must be one of ${TRIGGERS.join("|")}, got ${String(request.trigger)}`);
    }
    if (!Array.isArray(request.rows)) {
      reasons.push("missing rows[] (实际加载的插件行与版本)");
    }
    if (!Array.isArray(request.tools)) {
      reasons.push("missing tools[] (名称 + schema 哈希)");
    } else {
      for (const tool of request.tools) {
        if (typeof tool?.schemaHash !== "string" || tool.schemaHash.length === 0) {
          reasons.push(`tools[] entry without schemaHash: ${String(tool?.name)}`);
        }
      }
    }
    if (!Array.isArray(request.fibers)) {
      reasons.push("missing fibers[] (活动 fiber 检查)");
    } else {
      for (const fiber of request.fibers) {
        if (FORBIDDEN_FIBERS.includes(String(fiber))) {
          reasons.push(`forbidden fiber active: ${String(fiber)}`);
        }
      }
    }

    let verdict: AttestVerdict;
    if (forcedVerdict) {
      verdict = forcedVerdict;
      reasons.push(`forced by knob: ${forcedVerdict}`);
    } else if (reasons.length > 0) {
      verdict = "deny";
    } else if (request.trigger === "tools-change") {
      verdict = "resync-profile";
      reasons.push("tools-change trigger: profile resync advised");
    } else {
      verdict = "accept";
    }

    return { verdict, degradation, reasons, requestId };
  }

  return {
    attest,
    degradation: () => degradation,
    applyKnobs(next: FaultKnobs) {
      if ("attestForceVerdict" in next) forcedVerdict = next.attestForceVerdict;
      if ("degradationLevel" in next && next.degradationLevel) degradation = next.degradationLevel;
    },
    selfCheck() {
      const problems: string[] = [];
      const base: AttestRequest = {
        profileId: knownProfileId || "dev-seed",
        trainVersion: knownTrainVersion || "0.0.0",
        protocolVersion: PROTOCOL_VERSION,
        trigger: "boot",
        rows: [{ name: "row", version: "0" }],
        tools: [{ name: "tool", schemaHash: "sha256-x" }],
        fibers: [],
      };
      const ok = attest({ ...base, trigger: "boot" });
      if (ok.verdict !== "accept") problems.push("clean boot request must be accepted");
      const missing = attest({ ...base, profileId: "" });
      if (missing.verdict !== "deny") problems.push("missing-field request must be denied");
      const badTrigger = attest({ ...base, trigger: "nope" as AttestTrigger });
      if (badTrigger.verdict !== "deny") problems.push("unknown trigger must be denied");
      const fiberHit = attest({ ...base, fibers: ["hmr"] });
      if (fiberHit.verdict !== "deny") problems.push("forbidden fiber must be denied");
      return { verdict: problems.length === 0 ? "pass" : "fail", problems };
    },
  };
}
