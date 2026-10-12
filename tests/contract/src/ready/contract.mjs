/**
 * P0-A4 契约测试：Profile 校验器 + 域就绪判定 + 域令牌绑定 + 版本列车纪律。
 *
 * 验收项：
 *   - 逐字段负例（删字段/错类型/违反大小关系）各至少一条，断言域拒绝 ready（`ENG-029` 判据②）
 *   - `trainVersion` 缺失/为数组/含两个值 ⇒ `EVO_TRAIN_VERSION_AMBIGUOUS`（`ENG-025`/`ENG-036`）
 *   - 域内上报"全绿"但域外证据不符时，域【仍被拒绝】（`SEC-044`：门禁不是自证）
 *   - 用 A 域令牌以 B 租户身份发请求 ⇒ 被拒且产生硬审计（`SEC-008`/§4.2.1）
 *   - 域外证据四类摘要非空 + 每次域创建留证 + 哈希链（`PC-007`/`GATE-002` 条件 4）
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateProfile,
  validateDeadlines,
  CRITICAL_ROWS,
} from "../../../../packages/control-plane/src/profile/validate.ts";
import { evaluateReadiness } from "../../../../packages/control-plane/src/ready/evaluate.ts";
import {
  createDomainEvidence,
  verifyChain,
} from "../../../../packages/control-plane/src/ready/evidence.ts";
import {
  issueDomainToken,
  verifyDomainToken,
  getTokenAudits,
} from "../../../../packages/control-plane/src/token/domain-token.ts";
import { createGatewayStub, listenStub } from "../../../../packages/reverse-gateway/src/stub/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");
const results = [];
const record = (name, verdict, detail) => results.push({ name, verdict, detail });

/** schema 合成 Profile（合规基线，`ENG-029` 表驱动失败用例的基准）。 */
function validProfile(overrides = {}) {
  return {
    profileId: "synthetic",
    protocolVersion: "1.0",
    trainVersion: "0.2.0-rc.2",
    tenantId: "tenant-a",
    isolationGroupId: "iso-1",
    residencyRegion: "local",
    workspaces: [{ workspaceId: "ws", root: "/workspace", writable: true }],
    presetId: "preset-1",
    pluginSet: [{ name: "dsh-base", version: "0.2.0-rc.2", integrity: "sha512-x", tier: "platform" }],
    removedRows: ["tool-plugin-manager", "plugin-manager"],
    hmr: { enabled: false },
    toolAllowlist: ["mcp__dev__tool_a", "dsh-base"],
    skillRoots: [],
    sandboxMode: "read-only",
    sandboxModeCeiling: "workspace-write",
    permissionPresets: { reachable: ["preset-1"] },
    connectors: [{ serverName: "dev", transport: "stdio", hosting: "domain", trust: "untrusted", command: "node", args: ["x.js"], required: true }],
    deadlines: { approvalSeconds: 90, modelStreamSeconds: 300, turnSeconds: 900 },
    buffers: { audit: { retainHours: 24 }, billing: { retainHours: 24 } },
    modelDegradation: { main: { target: "fail-closed" } },
    sessionProjectionCache: { writeEveryEvents: 100, writeIntervalMs: 1000 },
    quota: { tokensPerDay: 100000, toolCallsPerTurn: 10 },
    gateway: { endpoint: "http://127.0.0.1:7301", tokenTtlSeconds: 300 },
    requiredPlugins: ["dsh-invariants"],
    ...overrides,
  };
}

/** 合规的域外事实基线（七条全过）。 */
function passingFacts(overrides = {}) {
  return {
    imageManifest: [
      { name: "dsh-base", version: "0.2.0-rc.2" },
      { name: "dsh-invariants", version: "0.2.0-rc.2" },
      { name: "dsh-tool-call-timeout-policy", version: "0.2.0-rc.2" },
    ],
    imageDigest: "sha512-image",
    observedToolset: ["mcp__dev__tool_a", "dsh-base"],
    activeFibers: [],
    permissionModeEnv: "read-only",
    mountDeclarations: [
      { path: "cordis.patch.yml", readOnly: true },
      { path: "package.json", readOnly: true },
      { path: "compatibility.json", readOnly: true },
      { path: "plugins/", readOnly: true },
    ],
    mountDigest: "sha512-mount",
    profileGenerationDigest: "sha512-mount",
    connectorProbes: [{ serverName: "dev", ok: true, toolCount: 1 }],
    ...overrides,
  };
}

async function main() {
  // ── 1. `ENG-029` 判据②：逐字段负例（删每个必填字段 → 拒绝且错误含字段路径） ─
  {
    const required = [
      "profileId", "protocolVersion", "trainVersion", "tenantId", "isolationGroupId",
      "residencyRegion", "workspaces", "presetId", "pluginSet", "removedRows", "hmr",
      "toolAllowlist", "skillRoots", "sandboxMode", "sandboxModeCeiling", "permissionPresets",
      "connectors", "deadlines", "buffers", "modelDegradation", "sessionProjectionCache",
      "quota", "gateway", "requiredPlugins",
    ];
    const base = validProfile();
    let allRejected = true;
    const missingPaths = [];
    for (const field of required) {
      const broken = { ...base };
      delete broken[field];
      const result = validateProfile(broken, "prod");
      if (result.ok !== false) allRejected = false;
      else missingPaths.push(field);
    }
    record(
      "PROFILE-REQUIRED-FIELDS",
      allRejected && missingPaths.length === required.length,
      `全部 ${required.length} 个必填字段逐个删除后均被拒绝=${allRejected}（ENG-029 判据②：任一缺省即拒绝，不得静默补齐）`,
    );
  }

  // ── 2. 错类型 + 大小关系负例（`PC-003` / `PC-001` / `PC-002` / `PC-004`） ───
  {
    const wrongProtocol = validateProfile(validProfile({ protocolVersion: "2.0" }), "prod");
    const hmrOn = validateProfile(validProfile({ hmr: { enabled: true } }), "prod");
    const removedMissing = validateProfile(validProfile({ removedRows: ["tool-plugin-manager"] }), "prod");
    const sandboxUp = validateProfile(validProfile({ sandboxMode: "danger-full-access", sandboxModeCeiling: "read-only" }), "prod");
    const twoPresets = validateProfile(validProfile({ permissionPresets: { reachable: ["a", "b"] } }), "prod");
    const widePreset = validateProfile(validProfile({ permissionPresets: { reachable: ["danger-full-access"] } }), "prod");
    const deadlineInverted = validateProfile(validProfile({ deadlines: { approvalSeconds: 90, modelStreamSeconds: 300, turnSeconds: 60 } }), "prod");
    const deadlineRange = validateDeadlines({ approvalSeconds: 500, modelStreamSeconds: 300, turnSeconds: 900 });
    const record = (r) => r.ok === false;
    const pc003 = sandboxUp.errors.some((e) => e.rule === "PC-003");
    const pc001 = deadlineInverted.errors.some((e) => e.rule === "PC-001");
    const allRejected = record(wrongProtocol) && record(hmrOn) && record(removedMissing) && record(sandboxUp) &&
      record(twoPresets) && record(widePreset) && record(deadlineInverted) && deadlineRange.length > 0;
    record(
      "PROFILE-SEMANTIC-NEGATIVES",
      allRejected && pc003 && pc001,
      `错类型（protocolVersion）=${record(wrongProtocol)}，hmr.enabled=${record(hmrOn)}，removedRows 缺行=${record(removedMissing)}，sandboxMode>ceiling=${record(sandboxUp)}（PC-003=${pc003}），双预设=${record(twoPresets)}，宽预设=${record(widePreset)}，T_a≥T_turn=${record(deadlineInverted)}（PC-001=${pc001}），T_a 越界=${deadlineRange.length > 0}`,
    );
  }

  // ── 3. `ENG-025`/`ENG-036`：trainVersion 缺失/数组/两值 ⇒ EVO_TRAIN_VERSION_AMBIGUOUS ─
  {
    const missing = validateProfile(validProfile({ trainVersion: undefined }), "prod");
    const asArray = validateProfile(validProfile({ trainVersion: ["0.2.0-rc.2", "0.2.0-rc.3"] }), "prod");
    const mixed = validateProfile(validProfile({
      pluginSet: [
        { name: "dsh-base", version: "0.2.0-rc.2", integrity: "sha512-x", tier: "platform" },
        { name: "dsh-invariants", version: "0.2.0-rc.3", integrity: "sha512-x", tier: "platform" },
      ],
    }), "prod");
    const hasRule = (r) => r.errors.some((e) => e.rule === "EVO_TRAIN_VERSION_AMBIGUOUS");
    record(
      "EVO-TRAIN-VERSION-AMBIGUOUS",
      hasRule(missing) && hasRule(asArray) && hasRule(mixed),
      `缺失=${hasRule(missing)}，为数组=${hasRule(asArray)}，含两个值（train.mixed: dsh-invariants@0.2.0-rc.3 != 0.2.0-rc.2）=${hasRule(mixed)}（ENG-025 判据① / ENG-036 / EVO-001）`,
    );
  }

  // ── 4. 合规 Profile 通过（正向） ─────────────────────────────────────────
  {
    const valid = validateProfile(validProfile(), "prod");
    const seed = validateProfile(JSON.parse(readFileSync(join(root, "dev", "seed", "profile.json"), "utf8")), "dev");
    record(
      "PROFILE-VALID-PASS",
      valid.ok === true && seed.ok === true,
      `合成合规 Profile 通过=${valid.ok === true}，dev seed Profile 通过（dev 逃生门）=${seed.ok === true}（ENG-029 正向）`,
    );
  }

  // ── 5. 域就绪七条：逐条失败注入 → ready=false / active=false ─────────────
  {
    const profile = validProfile({ toolAllowlist: ["mcp__dev__tool_a", "dsh-base"] });
    const cases = [
      { label: "RC-1 关键行 disabled", facts: passingFacts({ imageManifest: [{ name: "dsh-base", version: "0.2.0-rc.2" }, { name: "dsh-invariants", version: "0.2.0-rc.2", disabled: true }] }), expectReady: false, check: "RC-1" },
      { label: "RC-2 工具集不符", facts: passingFacts({ observedToolset: ["mcp__dev__tool_a"] }), expectReady: false, check: "RC-2" },
      { label: "RC-3 manager fiber 活跃", facts: passingFacts({ activeFibers: ["hmr"] }), expectReady: false, check: "RC-3" },
      { label: "RC-4 权限模式非 read-only", facts: passingFacts({ permissionModeEnv: "workspace-write" }), expectReady: false, check: "RC-4" },
      { label: "RC-5 credential provider", facts: passingFacts(), profileOverride: { pluginSet: [{ name: "dsh-credentials-local", version: "0.2.0-rc.2", integrity: "sha512-x", tier: "platform" }] }, expectReady: false, check: "RC-5" },
      { label: "RC-6 可写挂载", facts: passingFacts({ mountDeclarations: [{ path: "cordis.patch.yml", readOnly: false }] }), expectReady: false, check: "RC-6" },
      { label: "RC-7 必需 connector 探针失败", facts: passingFacts({ connectorProbes: [{ serverName: "dev", ok: false }] }), expectReady: false, check: "RC-7" },
    ];
    let allDenied = true;
    const details = [];
    for (const testCase of cases) {
      const decision = evaluateReadiness({
        profile: { ...profile, ...(testCase.profileOverride ?? {}) },
        facts: testCase.facts,
      });
      details.push(`${testCase.check}: ready=${decision.ready},active=${decision.active}`);
      if (testCase.check === "RC-7") {
        // 差异点：RC-7 失败 ⇒ 不进入 active，但 ready 保持 true（不判 ready_denied）。
        if (decision.active !== false || decision.ready !== true) allDenied = false;
      } else if (decision.ready !== testCase.expectReady) {
        allDenied = false;
      }
    }
    record(
      "READY-SEVEN-CHECKS",
      allDenied,
      `七种失败态逐条独立判定：${details.join("；")}（RC-1…RC-6 失败 ⇒ ready=false；RC-7 失败 ⇒ 不进入 active）（SEC-037–SEC-043）`,
    );
  }

  // ── 6. 关键负例：域内上报"全绿"但域外证据不符 ⇒ 仍被拒绝（门禁不是自证） ──
  {
    const decision = evaluateReadiness({
      profile: validProfile(),
      facts: passingFacts({
        // 域外事实：关键行 dsh-invariants 被禁用且版本不符
        imageManifest: [
          { name: "dsh-base", version: "0.2.0-rc.2" },
          { name: "dsh-invariants", version: "0.2.0-rc.3", disabled: true },
        ],
      }),
      crossCheck: {
        // 域内上报自称全绿（被改写的域可以自报全绿）
        criticalRows: { ok: true, detail: "selfcheck: all critical rows present" },
        fibers: [],
      },
    });
    const rc1 = decision.results.find((r) => r.check === "RC-1");
    const stillDenied = decision.ready === false;
    const crossCheckNotBasis = rc1.source === "out-of-domain" && rc1.verdict === "fail" && rc1.drift === true;
    record(
      "GATE-NOT-SELF-CERTIFYING",
      stillDenied && crossCheckNotBasis && decision.driftDetected === true,
      `域内自报全绿但域外证据不符 ⇒ ready=false=${stillDenied}，RC-1 verdict=fail（source=out-of-domain）=${crossCheckNotBasis}，交叉核验不一致 → drift（摘域流程）=${decision.driftDetected}（SEC-044：门禁只接受域外事实，域内上报不作为通过依据）`,
    );
  }

  // ── 7. 域外证据留证（`PC-007` / `GATE-002` 条件 4）：四类摘要非空 + 哈希链 ─
  {
    const record1 = createDomainEvidence({
      domainId: "domain-1",
      tenantId: "tenant-a",
      isolationGroupId: "iso-1",
      imageDigest: "sha512-image",
      mountDigest: "sha512-mount",
      runtimeConfigDigest: "sha512-runtime",
      profileGenerationDigest: "sha512-profile",
    });
    const record2 = createDomainEvidence({
      domainId: "domain-2",
      tenantId: "tenant-a",
      isolationGroupId: "iso-1",
      imageDigest: "sha512-image",
      mountDigest: "sha512-mount",
      runtimeConfigDigest: "sha512-runtime",
      profileGenerationDigest: "sha512-profile",
      previousChainHash: record1.chainHash,
    });
    const chainOk = verifyChain([record1, record2]);
    let missingRejected = false;
    try {
      createDomainEvidence({ domainId: "domain-3", tenantId: "t", isolationGroupId: "i", imageDigest: "sha512-image" });
    } catch {
      missingRejected = true; // PC-007：摘要缺失即拒绝留空证
    }
    record(
      "DOMAIN-EVIDENCE-RETAINED",
      chainOk && missingRejected && record1.imageDigest === "sha512-image",
      `每次域创建留证（2 条）=${chainOk}，哈希链校验通过=${chainOk}，摘要缺失拒绝留空证=${missingRejected}（PC-007 / GATE-002 条件 4，SEC-DOC-04 §3.2）`,
    );
  }

  // ── 8. 域令牌绑定：A 域令牌以 B 租户身份发请求 ⇒ 拒绝 + 硬审计 ────────────
  {
    const issued = issueDomainToken({ tenantId: "tenant-a", isolationGroupId: "iso-1", ttlSeconds: 300, secret: "test-secret" });
    const sameTenant = verifyDomainToken(issued.token, "tenant-a", { secret: "test-secret" });
    const crossTenant = verifyDomainToken(issued.token, "tenant-b", { secret: "test-secret" });
    const audit = getTokenAudits().filter((a) => a.event === "token.cross_tenant_rejected");
    const tampered = verifyDomainToken(`${issued.token}x`, "tenant-a", { secret: "test-secret" });
    record(
      "DOMAIN-TOKEN-BINDING",
      sameTenant.ok === true && crossTenant.ok === false && audit.length === 1 && tampered.ok === false,
      `同租户放行=${sameTenant.ok}，跨租户拒绝=${crossTenant.ok === false}，硬审计 ${audit.length} 条（token.cross_tenant_rejected）=${audit.length === 1}，签名篡改拒绝=${tampered.ok === false}（SEC-007/SEC-008，§4.2.1 域令牌绑定 (tenantId, isolationGroupId)）`,
    );
  }

  // ── 9. 网关桩自检：port=0（临时端口）下 selfCheck 用实际绑定端口（ENG-043/044）──
  {
    const stub = createGatewayStub({ port: 0, seedProfile: { profileId: "dev-seed", trainVersion: "0" } });
    const port = await listenStub(stub); // port=0 ⇒ 实际绑定临时端口
    const selfCheck = await stub.selfCheck();
    const ephemeralPort = port !== 0; // 实际绑定的不是配置值 0
    record(
      "STUB-SELFCHECK-EPHEMERAL-PORT",
      selfCheck.verdict === "pass" && ephemeralPort,
      `port=0 临时端口=${ephemeralPort}，selfCheck 对实际绑定端口执行且全过=${selfCheck.verdict === "pass"}${selfCheck.problems.length > 0 ? `，problems=${selfCheck.problems.join("；")}` : ""}（ENG-043/ENG-044 桩自检）`,
    );
    await stub.close();
  }
}

try {
  await main();
} catch (error) {
  results.push({ name: "UNCAUGHT", verdict: false, detail: String(error?.stack ?? error) });
}

for (const r of results) {
  console.log(`${r.verdict ? "✓" : "✗"} ${r.name}: ${r.detail}`);
}
const failed = results.filter((r) => !r.verdict);
if (failed.length > 0) {
  console.error(`\n[contract:ready] FAIL — ${failed.length}/${results.length} 项未通过`);
  process.exit(1);
}
console.log(`\n[contract:ready] PASS — ${results.length}/${results.length} 项通过（ENG-025/029/030/040/041/062）`);
