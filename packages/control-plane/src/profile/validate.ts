/**
 * Profile 校验器（`ENG-029` 表驱动；交付物 `D-7`）。
 *
 * 覆盖 `contracts/profile.schema.json` 的 required/类型/枚举 + 全部
 * `x-ov-semanticChecks`（`PC-001`…`PC-012`）+ 版本列车纪律（`ENG-025`，
 * `EVO_TRAIN_VERSION_AMBIGUOUS`）+ 必挂行断言（`ENG-030`）+
 * deadlines/buffers/sandboxModeCeiling 三组字段（`ENG-062`）+ 三层截止时间（`ENG-041`）+
 * `toolAllowlist` 双态规则（`ENG-045`）。
 *
 * 表驱动纪律（`ENG-029` 判据②）：每个字段一个校验函数 + 一个失败用例；任一必需字段
 * 缺省即拒绝，**不得**静默用默认值补齐；错误信息必须含字段路径。
 */

/** Profile 校验的环境（`ENG-045`：仅 dev 允许逃生门）。 */
export type ProfileEnv = "dev" | "prod";

export interface ProfileIssue {
  readonly path: string;
  readonly rule: string;
  readonly message: string;
}

export interface ProfileWarning {
  /** `ENG-045` 判据③：逃生门开启时的显式告警行。 */
  readonly code: "ESCAPE_HATCH_ACTIVE";
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly ProfileIssue[];
  readonly warnings: readonly ProfileWarning[];
}

/** 校验选项（平台侧配置，非 Profile 内容）。 */
export interface ValidateOptions {
  /** `PC-009`：hosting=exception 的按域硬上限（平台配置）。 */
  readonly exceptionConnectorLimit?: number;
  /** `PC-012`：该租户已启用场景涉及的全部会话类型（Scenario Catalog 并集）。 */
  readonly knownSessionTypes?: readonly string[];
}

/** schema required 全集（24 字段，`ENG-029`：任一缺省即拒绝）。
 *  `toolAllowlist` 的存在性由双态规则单独判定（`ENG-045`：dev 允许缺省，生产必填）。 */
const REQUIRED_FIELDS: readonly string[] = [
  "profileId", "protocolVersion", "trainVersion", "tenantId", "isolationGroupId",
  "residencyRegion", "workspaces", "presetId", "pluginSet", "removedRows", "hmr",
  "skillRoots", "sandboxMode", "sandboxModeCeiling", "permissionPresets",
  "connectors", "deadlines", "buffers", "modelDegradation", "sessionProjectionCache",
  "quota", "gateway", "requiredPlugins",
];

/** 通配符字符：工具名精确匹配，禁用 glob 与正则（`ENG-045` / `SEC-036`）。 */
const WILDCARD_CHARS = /[*?\[\]{}+^$|()\\]/;

const SANDBOX_ORDER: Record<string, number> = {
  "read-only": 0,
  "workspace-write": 1,
  "danger-full-access": 2,
};

/** credential provider 拒绝清单（`SEC-041` / `GATE-002-C12`；域外代码常量）。 */
export const CREDENTIAL_PROVIDER_DENYLIST: readonly string[] = [
  "dsh-credentials-local",
  "dsh-credentials-env",
  "dsh-credentials-vault",
];

/** 关键平台行（`ENG-027`/`ENG-040`：存在且 `disabled !== true`）。 */
export const CRITICAL_ROWS: readonly string[] = ["dsh-invariants", "dsh-tool-call-timeout-policy"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// ── 表驱动：每字段一个校验函数（`ENG-029` 判据①） ──────────────────────────

type FieldCheck = (profile: Record<string, unknown>, env: ProfileEnv, options: ValidateOptions) => ProfileIssue[];

/** `trainVersion` 单值 + 版本列车纪律（`ENG-025`；`EVO_TRAIN_VERSION_AMBIGUOUS`）。 */
function checkTrainVersion(profile: Record<string, unknown>): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  const trainVersion = profile.trainVersion;
  // 缺失 / 为数组 / 含两个值 ⇒ EVO_TRAIN_VERSION_AMBIGUOUS（schema $comment，`ENG-036`/`EVO-001`）。
  if (Array.isArray(trainVersion)) {
    return [{ path: "trainVersion", rule: "EVO_TRAIN_VERSION_AMBIGUOUS", message: "trainVersion 为数组（必须单值，C33）" }];
  }
  if (!isNonEmptyString(trainVersion)) {
    return [{ path: "trainVersion", rule: "EVO_TRAIN_VERSION_AMBIGUOUS", message: "trainVersion 缺失或非单值（必须恰好一个值）" }];
  }
  // `ENG-025` 判据①：new Set([trainVersion, ...pluginSet.map(p => p.version)]).size === 1。
  const pluginSet = profile.pluginSet;
  if (Array.isArray(pluginSet)) {
    const versions = [trainVersion, ...pluginSet.map((p) => (isRecord(p) ? p.version : undefined))];
    if (new Set(versions).size !== 1) {
      for (const p of pluginSet) {
        if (isRecord(p) && p.version !== trainVersion) {
          issues.push({
            path: "pluginSet",
            rule: "EVO_TRAIN_VERSION_AMBIGUOUS",
            message: `train.mixed: ${String(p.name)}@${String(p.version)} != ${trainVersion}`,
          });
        }
      }
    }
  }
  return issues;
}

/** `hmr.enabled === false`（`PC-005`；schema const false）。 */
function checkHmr(profile: Record<string, unknown>): ProfileIssue[] {
  const hmr = profile.hmr;
  if (!isRecord(hmr) || hmr.enabled !== false) {
    return [{ path: "hmr.enabled", rule: "PC-005", message: "hmr.enabled 必须为 false（SEC-013/SEC-020/SEC-021）" }];
  }
  return [];
}

/** `removedRows ⊇ {tool-plugin-manager, plugin-manager}`（`PC-005`）。 */
function checkRemovedRows(profile: Record<string, unknown>): ProfileIssue[] {
  const removed = profile.removedRows;
  if (!Array.isArray(removed)) {
    return [{ path: "removedRows", rule: "removedRows.array", message: "removedRows 必须是字符串数组" }];
  }
  const issues: ProfileIssue[] = [];
  for (const row of ["tool-plugin-manager", "plugin-manager"]) {
    if (!removed.includes(row)) {
      issues.push({ path: "removedRows", rule: "PC-005", message: `removedRows 缺少 ${row}（SEC-020/SEC-021）` });
    }
  }
  return issues;
}

/** `sandboxMode <= sandboxModeCeiling`（`PC-003`；序：read-only < workspace-write < danger-full-access）。 */
function checkSandboxOrder(profile: Record<string, unknown>): ProfileIssue[] {
  const mode = SANDBOX_ORDER[String(profile.sandboxMode)] ?? -1;
  const ceiling = SANDBOX_ORDER[String(profile.sandboxModeCeiling)] ?? -1;
  if (mode < 0 || ceiling < 0) {
    return [{ path: "sandboxMode", rule: "PC-003", message: "sandboxMode/sandboxModeCeiling 必须为合法枚举值" }];
  }
  if (mode > ceiling) {
    return [{ path: "sandboxMode", rule: "PC-003", message: `sandboxMode 超过 sandboxModeCeiling（SEC-023）：${String(profile.sandboxMode)} > ${String(profile.sandboxModeCeiling)}` }];
  }
  return [];
}

/** `permissionPresets.reachable` 恰含一个元素且 ∉ {danger-full-access, never}（`PC-004`）。 */
function checkPermissionPresets(profile: Record<string, unknown>): ProfileIssue[] {
  const presets = profile.permissionPresets;
  if (!isRecord(presets) || !Array.isArray(presets.reachable)) {
    return [{ path: "permissionPresets", rule: "PC-004", message: "permissionPresets.reachable 必须是数组" }];
  }
  const reachable = presets.reachable;
  if (reachable.length !== 1) {
    return [{ path: "permissionPresets.reachable", rule: "PC-004", message: `reachable 必须恰含一个元素，got ${reachable.length}（SEC-025/C38）` }];
  }
  if (reachable[0] === "danger-full-access" || reachable[0] === "never") {
    return [{ path: "permissionPresets.reachable", rule: "PC-004", message: "reachable 不得为 danger-full-access 或 never（SEC-025/C38）" }];
  }
  return [];
}

/** `connectors[]`：serverName 唯一（`PC-006`）、transport/hosting/trust 枚举、exception 条数上限（`PC-009`）。 */
function checkConnectors(profile: Record<string, unknown>, options: ValidateOptions): ProfileIssue[] {
  const connectors = profile.connectors;
  if (!Array.isArray(connectors)) {
    return [{ path: "connectors", rule: "connectors.array", message: "connectors 必须是数组" }];
  }
  const issues: ProfileIssue[] = [];
  const seen = new Set<string>();
  let exceptionCount = 0;
  for (const [index, connector] of connectors.entries()) {
    const path = `connectors[${index}]`;
    if (!isRecord(connector)) {
      issues.push({ path, rule: "connectors.object", message: "connector 必须是对象" });
      continue;
    }
    const serverName = connector.serverName;
    if (typeof serverName === "string" && serverName.length > 0) {
      if (seen.has(serverName)) {
        issues.push({ path: `${path}.serverName`, rule: "PC-006", message: `connectors[].serverName 在同一 Profile 内必须唯一：${serverName}（C10）` });
      }
      seen.add(serverName);
    } else {
      issues.push({ path: `${path}.serverName`, rule: "connectors.serverName", message: "serverName 必须为非空字符串" });
    }
    if (connector.transport !== "stdio" && connector.transport !== "streamable-http") {
      issues.push({ path: `${path}.transport`, rule: "connectors.transport", message: "transport 必须为 stdio 或 streamable-http" });
    }
    if (connector.hosting !== "domain" && connector.hosting !== "data-plane" && connector.hosting !== "exception") {
      issues.push({ path: `${path}.hosting`, rule: "connectors.hosting", message: "hosting 必须为 domain/data-plane/exception" });
    }
    if (connector.trust !== "trusted" && connector.trust !== "untrusted") {
      issues.push({ path: `${path}.trust`, rule: "connectors.trust", message: "trust 必须为 trusted 或 untrusted" });
    }
    if (connector.credentialException === true) {
      exceptionCount += 1;
      if (connector.hosting !== "exception") {
        issues.push({ path: `${path}.hosting`, rule: "connectors.credentialException", message: "credentialException=true 时 hosting 必须为 exception（SEC-055）" });
      }
    }
  }
  const limit = options.exceptionConnectorLimit ?? 1;
  if (exceptionCount > limit) {
    issues.push({ path: "connectors", rule: "PC-009", message: `hosting=exception 条数 ${exceptionCount} 超过按域硬上限 ${limit}（SEC-055）` });
  }
  return issues;
}

/** `modelDegradation`：`noDegrade=true` ⇒ `reasonCode` 必填（`PC-010`）；键覆盖已启用场景（`PC-012`）。 */
function checkModelDegradation(profile: Record<string, unknown>, options: ValidateOptions): ProfileIssue[] {
  const degradation = profile.modelDegradation;
  if (!isRecord(degradation) || Object.keys(degradation).length < 1) {
    return [{ path: "modelDegradation", rule: "modelDegradation.minProperties", message: "modelDegradation 必须至少含一个会话类型条目（EVO-019）" }];
  }
  const issues: ProfileIssue[] = [];
  for (const [sessionType, entry] of Object.entries(degradation)) {
    if (!isRecord(entry)) {
      issues.push({ path: `modelDegradation.${sessionType}`, rule: "modelDegradation.object", message: "降级条目必须是对象" });
      continue;
    }
    if (!isNonEmptyString(entry.target)) {
      issues.push({ path: `modelDegradation.${sessionType}.target`, rule: "modelDegradation.target", message: "target 必填（模型 id 或 fail-closed）" });
    }
    if (entry.noDegrade === true && !isNonEmptyString(entry.reasonCode)) {
      issues.push({ path: `modelDegradation.${sessionType}.reasonCode`, rule: "PC-010", message: "noDegrade=true 时 reasonCode 必填且非空（EVO-019）" });
    }
  }
  if (options.knownSessionTypes !== undefined) {
    for (const sessionType of options.knownSessionTypes) {
      if (!(sessionType in degradation)) {
        issues.push({ path: "modelDegradation", rule: "PC-012", message: `键集合必须覆盖已启用场景的全部会话类型：缺 ${sessionType}（EVO-019）` });
      }
    }
  }
  return issues;
}

/** 必挂行断言（`ENG-030`）：`requiredPlugins` 含 `dsh-invariants`；不得新增 `dsh-tool-call-timeout-policy` 行。 */
function checkRequiredPlugins(profile: Record<string, unknown>): ProfileIssue[] {
  const requiredPlugins = profile.requiredPlugins;
  if (!Array.isArray(requiredPlugins)) {
    return [{ path: "requiredPlugins", rule: "requiredPlugins.array", message: "requiredPlugins 必须是字符串数组" }];
  }
  const issues: ProfileIssue[] = [];
  if (!requiredPlugins.includes("dsh-invariants")) {
    issues.push({ path: "requiredPlugins", rule: "ENG-030", message: "requiredPlugins 必须含 dsh-invariants（C25：dsh-base 刻意省略，须显式挂载）" });
  }
  const pluginSet = profile.pluginSet;
  if (Array.isArray(pluginSet)) {
    for (const p of pluginSet) {
      if (isRecord(p) && p.name === "dsh-tool-call-timeout-policy") {
        issues.push({ path: "pluginSet", rule: "ENG-030", message: "dsh-tool-call-timeout-policy 已在 dsh-base 默认挂载（C29），不得新增该行（重复挂载即失败）" });
      }
    }
  }
  return issues;
}

/** `PC-008`：toolAllowlist 每个工具名可解析到 pluginSet 工具插件或 connector 的 `mcp__<server>__<raw>`。 */
function checkToolAllowlistResolvable(profile: Record<string, unknown>): ProfileIssue[] {
  const allowlist = profile.toolAllowlist;
  if (!Array.isArray(allowlist) || allowlist.includes("*")) return []; // dev 逃生门 ["*"] 不做逐名解析
  const pluginNames = new Set<string>();
  if (Array.isArray(profile.pluginSet)) {
    for (const p of profile.pluginSet) {
      if (isRecord(p) && typeof p.name === "string") pluginNames.add(p.name);
    }
  }
  const mcpPrefixes = new Set<string>();
  if (Array.isArray(profile.connectors)) {
    for (const c of profile.connectors) {
      if (isRecord(c) && typeof c.serverName === "string") mcpPrefixes.add(`mcp__${c.serverName}__`);
    }
  }
  const issues: ProfileIssue[] = [];
  for (const name of allowlist) {
    if (typeof name !== "string") continue;
    if (pluginNames.has(name)) continue;
    if ([...mcpPrefixes].some((prefix) => name.startsWith(prefix))) continue;
    issues.push({ path: "toolAllowlist", rule: "PC-008", message: `工具名 ${name} 不可解析到 pluginSet 或 connector（ENG-002/§5.3.1）` });
  }
  return issues;
}

/** 校验一条工具名（生产态）：精确匹配，禁用通配符（`ENG-045`）。 */
function checkExactToolName(name: unknown): ProfileIssue | undefined {
  if (typeof name !== "string" || name.length === 0) {
    return { path: "toolAllowlist[]", rule: "toolAllowlist.exact", message: "工具名必须为非空字符串" };
  }
  if (WILDCARD_CHARS.test(name)) {
    if (name === "*") return undefined; // 整表 "*" 已由 noWildcard 规则处理
    return { path: "toolAllowlist[]", rule: "toolAllowlist.exact", message: `通配符被拒绝（工具名精确匹配）：${name}` };
  }
  return undefined;
}

function validateToolAllowlist(
  profile: Record<string, unknown>,
  env: ProfileEnv,
  errors: ProfileIssue[],
  warnings: ProfileWarning[],
): void {
  const present = "toolAllowlist" in profile;
  if (!present) {
    if (env === "dev") {
      warnings.push({
        code: "ESCAPE_HATCH_ACTIVE",
        message: "dev 环境 toolAllowlist 缺省（可见工具集为空集或由运行态决定）",
      });
      return;
    }
    errors.push({ path: "toolAllowlist", rule: "toolAllowlist.required", message: "生产态 toolAllowlist 必填，缺省被拒绝" });
    return;
  }
  const list = profile.toolAllowlist;
  if (!Array.isArray(list)) {
    errors.push({ path: "toolAllowlist", rule: "toolAllowlist.array", message: "toolAllowlist 必须是字符串数组" });
    return;
  }
  if (list.includes("*")) {
    if (env === "dev") {
      warnings.push({ code: "ESCAPE_HATCH_ACTIVE", message: 'dev 环境 toolAllowlist: ["*"]（逃生门开启，生产态拒绝）' });
    } else {
      errors.push({ path: "toolAllowlist", rule: "toolAllowlist.noWildcard", message: '生产态拒绝 "*"（工具名精确匹配）' });
    }
  }
  if (list.length === 0) {
    if (env === "prod") {
      errors.push({ path: "toolAllowlist", rule: "toolAllowlist.nonEmpty", message: "生产态拒绝空数组（可见工具集为空集 ≠ 全集，须显式列出）" });
    }
    return;
  }
  for (const name of list) {
    const issue = checkExactToolName(name);
    if (issue) errors.push(issue);
  }
}

/**
 * 三层截止时间校验（`ENG-041` / `ENG-062` / `PC-001` / `PC-002`；设计 §4.4.1）：
 * `T_a` ∈ [60, 120] < `T_turn`，`T_m < T_turn`，`T_turn ≤ 900`。缺省即违规。
 */
export function validateDeadlines(deadlines: unknown): readonly ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  if (!isRecord(deadlines)) {
    issues.push({ path: "deadlines", rule: "deadlines.required", message: "deadlines 必填（§4.4.1 三层截止时间）" });
    return issues;
  }
  const ta = deadlines.approvalSeconds;
  const tm = deadlines.modelStreamSeconds;
  const tt = deadlines.turnSeconds;
  if (typeof ta !== "number" || !Number.isInteger(ta) || ta < 60 || ta > 120) {
    issues.push({ path: "deadlines.approvalSeconds", rule: "deadlines.Ta.range", message: "T_a 必须为 60–120 的整数（§4.4.1/ENG-041）" });
  }
  if (typeof tm !== "number" || !Number.isInteger(tm) || tm < 1) {
    issues.push({ path: "deadlines.modelStreamSeconds", rule: "deadlines.Tm.required", message: "T_m 必填（含重试总预算，§4.4.1/ENG-041）" });
  }
  if (typeof tt !== "number" || !Number.isInteger(tt) || tt < 1 || tt > 900) {
    issues.push({ path: "deadlines.turnSeconds", rule: "deadlines.Tturn.range", message: "T_turn ≤ 900 s（§4.4.1/ENG-041）" });
  }
  if (typeof ta === "number" && typeof tt === "number" && ta >= tt) {
    issues.push({ path: "deadlines", rule: "PC-001", message: `必须 deadlines.approvalSeconds < deadlines.turnSeconds（REL-102），got T_a=${ta} ≥ T_turn=${tt}` });
  }
  if (typeof tm === "number" && typeof tt === "number" && tm >= tt) {
    issues.push({ path: "deadlines", rule: "PC-002", message: `必须 deadlines.modelStreamSeconds < deadlines.turnSeconds（REL-102），got T_m=${tm} ≥ T_turn=${tt}` });
  }
  return issues;
}

/** 数值字段校验（整数 + 下界）。 */
function checkIntField(path: string, value: unknown, minimum: number): ProfileIssue | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    return { path, rule: `${path}.range`, message: `${path} 必须为 ≥ ${minimum} 的整数` };
  }
  return undefined;
}

/**
 * 表驱动的 Profile 校验（`ENG-029`；完整 schema required/类型/枚举 + `PC-001`…`PC-012`）。
 */
export function validateProfile(
  profile: unknown,
  env: ProfileEnv,
  options: ValidateOptions = {},
): ValidationResult {
  const errors: ProfileIssue[] = [];
  const warnings: ProfileWarning[] = [];

  if (!isRecord(profile)) {
    return {
      ok: false,
      errors: [{ path: "$", rule: "shape.object", message: "Profile 必须是对象" }],
      warnings,
    };
  }

  // ① required 全集（`ENG-029`：任一缺省即拒绝，不得静默补齐）。
  for (const field of REQUIRED_FIELDS) {
    if (!(field in profile)) {
      errors.push({ path: field, rule: "required", message: `必填字段缺失：${field}` });
    }
  }

  // ② 表驱动逐字段校验（每个字段一个校验函数）。
  if (typeof profile.profileId !== "string" || profile.profileId.length === 0) {
    errors.push({ path: "profileId", rule: "profileId.string", message: "profileId 必须为非空字符串" });
  }
  if (profile.protocolVersion !== "1.0") {
    errors.push({ path: "protocolVersion", rule: "protocolVersion.const", message: `protocolVersion 必须为 "1.0"，got ${JSON.stringify(profile.protocolVersion)}` });
  }
  errors.push(...checkTrainVersion(profile));
  for (const field of ["tenantId", "isolationGroupId", "residencyRegion", "presetId"]) {
    if (!isNonEmptyString(profile[field])) {
      errors.push({ path: field, rule: `${field}.string`, message: `${field} 必须为非空字符串` });
    }
  }
  if (!Array.isArray(profile.workspaces) || profile.workspaces.length < 1) {
    errors.push({ path: "workspaces", rule: "workspaces.minItems", message: "workspaces 必须至少含一项" });
  } else {
    for (const [index, ws] of profile.workspaces.entries()) {
      if (!isRecord(ws) || !isNonEmptyString(ws.workspaceId) || !isNonEmptyString(ws.root) || typeof ws.writable !== "boolean") {
        errors.push({ path: `workspaces[${index}]`, rule: "workspaces.items", message: "workspace 条目必须含 workspaceId/root（绝对路径）/writable" });
      } else if (!ws.root.startsWith("/")) {
        errors.push({ path: `workspaces[${index}].root`, rule: "workspaces.root", message: "root 必须为域内绝对路径" });
      }
    }
  }
  if (!Array.isArray(profile.pluginSet)) {
    errors.push({ path: "pluginSet", rule: "pluginSet.array", message: "pluginSet 必须是数组" });
  } else {
    for (const [index, p] of profile.pluginSet.entries()) {
      const path = `pluginSet[${index}]`;
      if (!isRecord(p) || !isNonEmptyString(p.name) || !isNonEmptyString(p.version)) {
        errors.push({ path, rule: "pluginSet.items", message: "pluginSet 条目必须含 name/version" });
      } else if (typeof p.integrity !== "string" || !p.integrity.startsWith("sha512-")) {
        errors.push({ path: `${path}.integrity`, rule: "pluginSet.integrity", message: "integrity 必须为 sha512- 前缀（SEC-011）" });
      } else if (p.tier !== "platform" && p.tier !== "scenario" && p.tier !== "tenant") {
        errors.push({ path: `${path}.tier`, rule: "pluginSet.tier", message: "tier 必须为 platform/scenario/tenant" });
      }
    }
  }
  errors.push(...checkRemovedRows(profile));
  errors.push(...checkHmr(profile));
  validateToolAllowlist(profile, env, errors, warnings);
  errors.push(...checkToolAllowlistResolvable(profile));
  if (!Array.isArray(profile.skillRoots)) {
    errors.push({ path: "skillRoots", rule: "skillRoots.array", message: "skillRoots 必须是数组" });
  }
  errors.push(...checkSandboxOrder(profile));
  errors.push(...checkPermissionPresets(profile));
  errors.push(...checkConnectors(profile, options));
  errors.push(...validateDeadlines(profile.deadlines));
  if (isRecord(profile.buffers)) {
    for (const key of ["audit", "billing"]) {
      const buffer = profile.buffers[key];
      if (!isRecord(buffer) || checkIntField(`buffers.${key}.retainHours`, buffer.retainHours, 1)) {
        errors.push({ path: `buffers.${key}.retainHours`, rule: "buffers.retainHours", message: `buffers.${key}.retainHours 必填且为 ≥ 1 的整数（REL-053）` });
      }
    }
  } else if ("buffers" in profile) {
    errors.push({ path: "buffers", rule: "buffers.object", message: "buffers 必须是对象" });
  }
  errors.push(...checkModelDegradation(profile, options));
  if (isRecord(profile.sessionProjectionCache)) {
    for (const key of ["writeEveryEvents", "writeIntervalMs"]) {
      const issue = checkIntField(`sessionProjectionCache.${key}`, profile.sessionProjectionCache[key], 1);
      if (issue) errors.push(issue);
    }
  }
  if (isRecord(profile.quota)) {
    for (const key of ["tokensPerDay", "toolCallsPerTurn"]) {
      const issue = checkIntField(`quota.${key}`, profile.quota[key], 0);
      if (issue) errors.push(issue);
    }
  }
  if (isRecord(profile.gateway)) {
    if (!isNonEmptyString(profile.gateway.endpoint)) {
      errors.push({ path: "gateway.endpoint", rule: "gateway.endpoint", message: "gateway.endpoint 必填（URI）" });
    }
    const ttl = profile.gateway.tokenTtlSeconds;
    if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 1 || ttl > 300) {
      errors.push({ path: "gateway.tokenTtlSeconds", rule: "gateway.tokenTtlSeconds", message: "tokenTtlSeconds 必须为 1–300 的整数（会话租约 TTL 上限 300 s，§4.2.1）" });
    }
  }
  errors.push(...checkRequiredPlugins(profile));

  return { ok: errors.length === 0, errors, warnings };
}

/** 单测与 `gate:001` 的逃生门双向断言（`ENG-045` 判据① / `ENG-047`）。 */
export function escapeHatchAssertions(): {
  verdict: "pass" | "fail";
  problems: readonly string[];
} {
  const problems: string[] = [];
  const synthetic = (toolAllowlist?: string[]) => ({
    profileId: "synthetic",
    protocolVersion: "1.0",
    trainVersion: "0.2.0-rc.2",
    tenantId: "tenant",
    isolationGroupId: "isolation",
    residencyRegion: "local",
    workspaces: [{ workspaceId: "ws", root: "/workspace", writable: true }],
    presetId: "preset",
    pluginSet: [{ name: "dsh-base", version: "0.2.0-rc.2", integrity: "sha512-x", tier: "platform" }],
    removedRows: ["tool-plugin-manager", "plugin-manager"],
    hmr: { enabled: false },
    skillRoots: [],
    sandboxMode: "read-only",
    sandboxModeCeiling: "workspace-write",
    permissionPresets: { reachable: ["dev-preset"] },
    connectors: [],
    deadlines: { approvalSeconds: 90, modelStreamSeconds: 300, turnSeconds: 900 },
    buffers: { audit: { retainHours: 24 }, billing: { retainHours: 24 } },
    modelDegradation: { main: { target: "fail-closed" } },
    sessionProjectionCache: { writeEveryEvents: 1, writeIntervalMs: 1000 },
    quota: { tokensPerDay: 1000, toolCallsPerTurn: 10 },
    gateway: { endpoint: "http://127.0.0.1:7301", tokenTtlSeconds: 300 },
    requiredPlugins: ["dsh-invariants"],
    ...(toolAllowlist === undefined ? {} : { toolAllowlist }),
  });
  const devWildcard = validateProfile(synthetic(["*"]), "dev");
  if (devWildcard.ok !== true || devWildcard.warnings.length === 0) {
    problems.push('dev + ["*"] 必须接受且产生 ESCAPE_HATCH_ACTIVE 告警');
  }
  const devOmitted = validateProfile(synthetic(), "dev");
  if (devOmitted.ok !== true || devOmitted.warnings.length === 0) {
    problems.push("dev + 缺省必须接受且产生告警");
  }
  for (const list of [["*"], [], ["dsh-tool-*"]]) {
    const prod = validateProfile(synthetic(list), "prod");
    if (prod.ok !== false) {
      problems.push(`生产态必须拒绝 ${JSON.stringify(list)}`);
    }
  }
  const prodMissing = validateProfile(synthetic(), "prod");
  if (prodMissing.ok !== false) {
    problems.push("生产态缺省 toolAllowlist 必须被拒绝");
  }
  return { verdict: problems.length === 0 ? "pass" : "fail", problems };
}
