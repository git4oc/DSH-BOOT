/**
 * 域就绪判据 7 条（`SEC-DOC-04` §2 RC-1…RC-7；`ENG-040`/`ENG-026`/`ENG-027`/`ENG-062`）。
 *
 * **判定纪律（设计 §4.1.2 收口修正）**：每条的判定输入必须是**域外事实**——镜像摘要 /
 * 挂载内容摘要 / 运行时配置快照 / Profile 生成摘要 / Session Router 探针；域内上报一律
 * 只作**交叉核验**（detective），不一致时置 `drift=true`（进入摘域流程），**不作为通过依据**
 * （`SEC-044`：禁止以「域能启动」替代；`GATE-002` 条件 3）。
 *
 * 判定函数（§3.1）：`ready = RC1 ∧ RC2 ∧ RC3 ∧ RC4 ∧ RC5 ∧ RC6`；
 * `active = ready ∧ RC7`（RC-7 失败 ⇒ 不进入 `active`，**不**判 `ready_denied`）。
 * 任一条不可执行（输入缺失）⇒ 记 `fail`，不得记 `pass`/`skip`（`SEC-044`）。
 */

import { CRITICAL_ROWS, CREDENTIAL_PROVIDER_DENYLIST } from "../profile/validate.ts";

/** 域外事实（判定输入；来源 ∈ 域外组件白名单，`GATE-002` G-R1）。 */
export interface OutOfDomainFacts {
  /** RC-1：镜像内容清单（发布时登记的包与版本，非域内上报）。 */
  readonly imageManifest?: readonly { name: string; version: string; disabled?: boolean }[];
  /** RC-2：含桥制品的镜像摘要（装配由 Profile 决定）。 */
  readonly imageDigest?: string;
  /** RC-2：域外可观测的工具名集合（网关侧副本）。 */
  readonly observedToolset?: readonly string[];
  /** RC-3：容器内活动 fiber 清单（域外驱动的采集任务产出）。 */
  readonly activeFibers?: readonly string[];
  /** RC-4：容器环境变量 `DSH_PERMISSION_MODE` 的注入值（域外编排器记录）。 */
  readonly permissionModeEnv?: string;
  /** RC-6：域外编排器的挂载声明。 */
  readonly mountDeclarations?: readonly { path: string; readOnly: boolean; hostPath?: boolean }[];
  /** RC-6：挂载内容摘要。 */
  readonly mountDigest?: string;
  /** RC-6/RC-4：Profile 生成摘要。 */
  readonly profileGenerationDigest?: string;
  /** RC-7：Session Router 的 connector 探针结果（域外发起、域外判定）。 */
  readonly connectorProbes?: readonly { serverName: string; ok: boolean; toolCount?: number }[];
}

/** 域内上报（**交叉核验**；detective，不作为通过依据，`SEC-044`）。 */
export interface CrossCheckReports {
  readonly criticalRows?: { ok: boolean; detail?: string };
  readonly toolsetFingerprint?: readonly string[];
  readonly fibers?: readonly string[];
}

export type ReadyCheckId = "RC-1" | "RC-2" | "RC-3" | "RC-4" | "RC-5" | "RC-6" | "RC-7";

export interface ReadyCheckResult {
  readonly check: ReadyCheckId;
  readonly verdict: "pass" | "fail";
  readonly observed: string;
  readonly source: "out-of-domain";
  /** 交叉核验不一致 ⇒ true（进入摘域流程；不影响本条 verdict）。 */
  readonly drift?: boolean;
}

export interface ReadinessInput {
  readonly profile: {
    readonly trainVersion?: string;
    readonly toolAllowlist?: readonly string[];
    readonly removedRows?: readonly string[];
    readonly hmr?: { enabled: boolean };
    readonly sandboxMode?: string;
    readonly sandboxModeCeiling?: string;
    readonly permissionPresets?: { reachable?: readonly string[] };
    readonly pluginSet?: readonly { name?: string; version?: string }[];
    readonly connectors?: readonly { serverName?: string; required?: boolean }[];
  };
  readonly facts: OutOfDomainFacts;
  readonly crossCheck?: CrossCheckReports;
}

export interface ReadinessDecision {
  readonly ready: boolean;
  readonly active: boolean;
  readonly results: readonly ReadyCheckResult[];
  /** 任一交叉核验与域外判定不一致 ⇒ true（进入摘域流程）。 */
  readonly driftDetected: boolean;
}

const MANAGER_FIBERS = new Set(["tool-plugin-manager", "plugin-manager", "hmr"]);

/** RC-1：关键平台行无 `disabled`（`SEC-037`；不可执行 ⇒ fail，不是跳过）。 */
function rc1(input: ReadinessInput): ReadyCheckResult {
  const manifest = input.facts.imageManifest;
  const trainVersion = input.profile.trainVersion;
  if (!manifest || !trainVersion || typeof trainVersion !== "string" || trainVersion.length === 0) {
    return { check: "RC-1", verdict: "fail", observed: "不可执行：镜像清单或 trainVersion 缺失", source: "out-of-domain" };
  }
  const missing = CRITICAL_ROWS.filter((row) => {
    const entry = manifest.find((m) => m.name === row);
    return entry === undefined || entry.disabled === true || entry.version !== trainVersion;
  });
  const drift = input.crossCheck?.criticalRows !== undefined && input.crossCheck.criticalRows.ok === true && missing.length > 0;
  return {
    check: "RC-1",
    verdict: missing.length === 0 ? "pass" : "fail",
    observed: missing.length === 0
      ? `criticalRows ${CRITICAL_ROWS.join(",")} 全部存在且版本 == ${trainVersion}`
      : `关键行缺失/禁用/版本不符: ${missing.join(",")}`,
    source: "out-of-domain",
    ...(drift ? { drift: true } : {}),
  };
}

/** RC-2：桥已装载且工具集 == `toolAllowlist`（集合相等，`SEC-038`）。 */
function rc2(input: ReadinessInput): ReadyCheckResult {
  const { imageDigest, observedToolset } = input.facts;
  const allowlist = input.profile.toolAllowlist;
  if (!imageDigest || !observedToolset || !allowlist) {
    return { check: "RC-2", verdict: "fail", observed: "不可执行：镜像摘要或域外工具集观测缺失", source: "out-of-domain" };
  }
  if (!imageDigest.startsWith("sha512-")) {
    return { check: "RC-2", verdict: "fail", observed: "镜像摘要不含桥制品（sha512- 前缀缺失）", source: "out-of-domain" };
  }
  const allowed = new Set(allowlist);
  const observed = new Set(observedToolset);
  if (allowlist.includes("*")) {
    // dev 逃生门 ["*"]：集合相等断言退化为「非空可见集」。
    return { check: "RC-2", verdict: observed.size > 0 ? "pass" : "fail", observed: `dev 逃生门（*）：观测 ${observed.size} 个工具`, source: "out-of-domain" };
  }
  const extra = [...observed].filter((t) => !allowed.has(t));
  const missing = [...allowed].filter((t) => !observed.has(t));
  const fingerprint = input.crossCheck?.toolsetFingerprint;
  const drift = fingerprint !== undefined && new Set(fingerprint).size !== observed.size;
  return {
    check: "RC-2",
    verdict: extra.length === 0 && missing.length === 0 ? "pass" : "fail",
    observed: `extra=[${extra.join(",")}] missing=[${missing.join(",")}]`,
    source: "out-of-domain",
    ...(drift ? { drift: true } : {}),
  };
}

/** RC-3：`plugin-manager` 与 `hmr` 无活动 fiber（`SEC-039`）。 */
function rc3(input: ReadinessInput): ReadyCheckResult {
  const fibers = input.facts.activeFibers;
  const removedRows = input.profile.removedRows;
  const hmrEnabled = input.profile.hmr?.enabled;
  if (!fibers || !removedRows || hmrEnabled === undefined) {
    return { check: "RC-3", verdict: "fail", observed: "不可执行：fiber 清单或 Profile 字段缺失", source: "out-of-domain" };
  }
  const removed = new Set(removedRows);
  const rowsOk = removed.has("tool-plugin-manager") && removed.has("plugin-manager");
  const hit = fibers.filter((f) => MANAGER_FIBERS.has(f));
  const inDomainHit = input.crossCheck?.fibers?.some((f) => MANAGER_FIBERS.has(f)) ?? false;
  const drift = inDomainHit !== hit.length > 0;
  return {
    check: "RC-3",
    verdict: rowsOk && hmrEnabled === false && hit.length === 0 ? "pass" : "fail",
    observed: `removedRows 完整=${rowsOk}，hmr.enabled=${hmrEnabled}，manager fiber 命中=[${hit.join(",")}]`,
    source: "out-of-domain",
    ...(drift ? { drift: true } : {}),
  };
}

/** RC-4：单一预设且宽模式不可达（`SEC-040`）。 */
function rc4(input: ReadinessInput): ReadyCheckResult {
  const reachable = input.profile.permissionPresets?.reachable;
  const env = input.facts.permissionModeEnv;
  if (!reachable || env === undefined) {
    return { check: "RC-4", verdict: "fail", observed: "不可执行：预设表或 DSH_PERMISSION_MODE 注入值缺失", source: "out-of-domain" };
  }
  const order: Record<string, number> = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 };
  const mode = order[input.profile.sandboxMode ?? ""] ?? -1;
  const ceiling = order[input.profile.sandboxModeCeiling ?? ""] ?? -1;
  const single = reachable.length === 1;
  const narrow = single && reachable[0] !== "danger-full-access" && reachable[0] !== "never";
  const envOk = env === "read-only";
  const ceilingOk = mode >= 0 && ceiling >= 0 && mode <= ceiling;
  return {
    check: "RC-4",
    verdict: single && narrow && envOk && ceilingOk ? "pass" : "fail",
    observed: `reachable=[${reachable.join(",")}]，DSH_PERMISSION_MODE=${env}，sandboxMode≤ceiling=${ceilingOk}`,
    source: "out-of-domain",
  };
}

/** RC-5：无 credential provider 插件（`SEC-041`；拒绝清单存在且非空，`GATE-002-C12`）。 */
function rc5(input: ReadinessInput): ReadyCheckResult {
  const denylist = CREDENTIAL_PROVIDER_DENYLIST;
  if (denylist.length === 0) {
    return { check: "RC-5", verdict: "fail", observed: "不可执行：拒绝清单缺失（GATE-002-C12）", source: "out-of-domain" };
  }
  const pluginSet = input.profile.pluginSet ?? [];
  const hit = pluginSet.filter((p) => p.name !== undefined && denylist.includes(p.name));
  return {
    check: "RC-5",
    verdict: hit.length === 0 ? "pass" : "fail",
    observed: hit.length === 0 ? "pluginSet ∩ denylist == ∅" : `credential provider 命中: ${hit.map((p) => p.name).join(",")}`,
    source: "out-of-domain",
  };
}

const READ_ONLY_MOUNT_PATHS = ["cordis.patch.yml", "package.json", "compatibility.json", "plugins/"];

/** RC-6：只读挂载校验通过（`SEC-042`；判定输入 = 域外编排器的挂载声明）。 */
function rc6(input: ReadinessInput): ReadyCheckResult {
  const declarations = input.facts.mountDeclarations;
  const { mountDigest, profileGenerationDigest } = input.facts;
  if (!declarations || !mountDigest || !profileGenerationDigest) {
    return { check: "RC-6", verdict: "fail", observed: "不可执行：挂载声明或摘要缺失", source: "out-of-domain" };
  }
  const writable = declarations.filter((d) => !d.readOnly || d.hostPath === true);
  const digestOk = mountDigest === profileGenerationDigest;
  return {
    check: "RC-6",
    verdict: writable.length === 0 && digestOk ? "pass" : "fail",
    observed: `可写/直通挂载=[${writable.map((d) => d.path).join(",") || "无"}]，mountDigest==profileGenerationDigest=${digestOk}（READ_ONLY_MOUNT_PATHS ${READ_ONLY_MOUNT_PATHS.length} 类）`,
    source: "out-of-domain",
  };
}

/** RC-7：必需 connector 就绪（`SEC-043`；失败 ⇒ 不进入 `active`，不判 `ready_denied`）。 */
function rc7(input: ReadinessInput): ReadyCheckResult {
  const probes = input.facts.connectorProbes;
  const required = (input.profile.connectors ?? []).filter((c) => c.required === true);
  if (!probes) {
    return { check: "RC-7", verdict: "fail", observed: "不可执行：connector 探针结果缺失", source: "out-of-domain" };
  }
  const failed = required.filter((c) => {
    const probe = probes.find((p) => p.serverName === c.serverName);
    return probe === undefined || probe.ok !== true;
  });
  return {
    check: "RC-7",
    verdict: failed.length === 0 ? "pass" : "fail",
    observed: failed.length === 0
      ? `required connector ${required.length} 个全部探针通过`
      : `必需 connector 未就绪: ${failed.map((c) => c.serverName).join(",")}`,
    source: "out-of-domain",
  };
}

/**
 * 域就绪判定（`SEC-DOC-04` §3.1）：逐条判定，不允许合并为单一布尔值；
 * 判定输入只来自域外事实；域内上报仅交叉核验（不一致 ⇒ drift，摘域流程）。
 */
export function evaluateReadiness(input: ReadinessInput): ReadinessDecision {
  const results = [rc1(input), rc2(input), rc3(input), rc4(input), rc5(input), rc6(input), rc7(input)];
  const ready = results.filter((r) => r.check !== "RC-7").every((r) => r.verdict === "pass");
  const rc7Result = results.find((r) => r.check === "RC-7");
  const active = ready && rc7Result?.verdict === "pass";
  const driftDetected = results.some((r) => r.drift === true);
  return { ready, active, results, driftDetected };
}
