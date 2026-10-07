/**
 * 四目录/注册表契约（设计 §5.3/§5.3.1/§5.6；`SEC-105`；`ENG-063`；验收四条）。
 *
 * 直跑入口（进程内 test()，与既有契约套件同一模式）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  PluginRegistry,
  decideTierLegalityAtProfileGeneration,
  ConnectorRegistry,
  SkillCatalog,
  ScenarioCatalog,
  generateProfilePatch,
} from "../../../../packages/control-plane/src/registry/registries.ts";
import { validateProfile } from "../../../../packages/control-plane/src/profile/validate.ts";

test("REG-1: Plugin Registry——制品/版本/签名/完整性哈希/回滚（§5.3）", () => {
  const registry = new PluginRegistry();
  const plugin = registry.register({ name: "dsh-tool-pwsh", version: "0.2.0-rc.2", tier: "tool", deprecated: false }, "artifact-bytes", "key");
  assert.ok(plugin.integrity.startsWith("sha512-")); // 完整性哈希（域外计算，SEC-011 sha512- 前缀）
  assert.equal(registry.get("dsh-tool-pwsh", "0.2.0-rc.2").integrity, plugin.integrity);
  // 回滚（EVO-020）
  registry.register({ name: "dsh-tool-pwsh", version: "0.2.0-rc.1", tier: "tool", deprecated: true }, "old-bytes", "key");
  assert.equal(registry.rollback("dsh-tool-pwsh", "0.2.0-rc.1").version, "0.2.0-rc.1");
});

test("REG-2: 层级合法性在域外 Profile 生成时判定；租户自定义插件不进平台锁定层（验收①②；§5.3.1 第 1 项）", () => {
  const platformLockTiers = ["platform", "seam"];
  // 租户自定义插件请求 platform 层：域外判定拒绝
  const denied = decideTierLegalityAtProfileGeneration({ name: "tenant-custom", requestedTier: "platform", tenantCustom: true }, platformLockTiers);
  assert.equal(denied.allowed, false);
  assert.equal(denied.decidedBy, "profile-generator-out-of-domain");
  assert.ok(denied.reason.includes("平台锁定层"));
  // seam 层同样拒绝
  assert.equal(decideTierLegalityAtProfileGeneration({ name: "tenant-custom", requestedTier: "seam", tenantCustom: true }, platformLockTiers).allowed, false);
  // tool 层允许
  assert.equal(decideTierLegalityAtProfileGeneration({ name: "tenant-custom", requestedTier: "tool", tenantCustom: true }, platformLockTiers).allowed, true);
  // 分层锁是产品侧治理策略、不是平台强制力（preset 不是安全沙箱 C17）——由"域外判定"而非"域内强制"承载
});

test("REG-3: Connector Registry——工具数突变告警 + 冻结可见性；例外 connector 按域上限（验收③；§5.6）", () => {
  const registry = new ConnectorRegistry(2);
  const health = registry.register({ serverName: "github-mcp", transport: "stdio", hosting: "domain", credentialRef: "credref-1", trust: "untrusted", securityReviewPassed: false });
  assert.equal(health.trust, "untrusted"); // 默认 untrusted（未知即不可信）
  // 工具数突变：必须告警 + 冻结该 connector 新工具可见性
  registry.reportHealth({ serverName: "github-mcp", connected: true, toolCount: 5, reconnects: 0 });
  const mutation = registry.reportHealth({ serverName: "github-mcp", connected: true, toolCount: 6, reconnects: 0 });
  assert.equal(mutation.alerted, true);
  assert.equal(mutation.frozenNewToolVisibility, true);
  assert.equal(registry.newToolVisibilityFrozen("github-mcp"), true);
  // 例外归属：须安全评审（未评审即拒）
  assert.throws(() => registry.register({ serverName: "bad-exception", transport: "stdio", hosting: "exception", credentialRef: "c", trust: "untrusted", securityReviewPassed: false }), /CONNECTOR_EXCEPTION_REVIEW_REQUIRED/);
  // 例外归属：按域硬上限（2）
  registry.register({ serverName: "exception-1", transport: "stdio", hosting: "exception", credentialRef: "c", trust: "untrusted", securityReviewPassed: true });
  registry.register({ serverName: "exception-2", transport: "stdio", hosting: "exception", credentialRef: "c", trust: "untrusted", securityReviewPassed: true });
  assert.throws(() => registry.register({ serverName: "exception-3", transport: "stdio", hosting: "exception", credentialRef: "c", trust: "untrusted", securityReviewPassed: true }), /CONNECTOR_EXCEPTION_CAP_EXCEEDED/);
});

test("REG-4: Skill Catalog 三级作用域 + skillRoots 装配（SEC-105/ENG-063）；Scenario Catalog presetId 只增不改", () => {
  const catalog = new SkillCatalog();
  catalog.publish({ name: "deploy-skill", scope: "platform", version: "1.0.0" });
  catalog.publish({ name: "tenant-skill", scope: "tenant", tenantId: "tenant-a", version: "1.1.0" });
  catalog.publish({ name: "user-skill", scope: "user", tenantId: "tenant-a", version: "1.0.0" });
  assert.throws(() => catalog.publish({ name: "bad", scope: "tenant", version: "1.0.0" }), /SKILL_SCOPE_TENANT_REQUIRED/);
  const roots = catalog.assembleSkillRoots("tenant-a");
  assert.equal(roots.skillRoots.length, 3);
  assert.ok(roots.skillRoots.some((r) => r.includes("platform/deploy-skill")));
  assert.ok(roots.skillRoots.some((r) => r.includes("tenant/tenant-skill")));
  // Scenario Catalog：presetId 只增不改（EVO-011）
  const scenarios = new ScenarioCatalog();
  scenarios.define({ presetId: "preset-1", pluginSet: ["dsh-base"], policies: { requireApproval: ["shell"], toolAllowlist: ["fs"] } });
  assert.throws(() => scenarios.define({ presetId: "preset-1", pluginSet: [], policies: { requireApproval: [], toolAllowlist: [] } }), /SCENARIO_PRESET_IMMUTABLE/);
  assert.equal(scenarios.get("preset-1").pluginSet.length, 1);
});

test("REG-5: 域外 Profile 生成器产出能被 P0-A4 校验器接受（验收①）；域内自证合规 ⇒ 不通过（D9/D15）", async () => {
  const plugins = new PluginRegistry();
  const plugin = plugins.register({ name: "dsh-base", version: "0.2.0-rc.2", tier: "platform", deprecated: false }, "dsh-base-artifact", "k");
  const skills = new SkillCatalog();
  skills.publish({ name: "deploy-skill", scope: "platform", version: "1.0.0" });
  const patch = generateProfilePatch({
    presetId: "preset-registry",
    plugins: [plugin],
    toolAllowlist: ["dsh-base"],
    skillRoots: skills.assembleSkillRoots("tenant-a").skillRoots,
    removedRows: ["tool-plugin-manager", "plugin-manager"],
  });
  // generatedBy 标注域外（强制链第 1 项）；出现"域内自证合规"即判不通过（D9/D15）
  assert.equal(patch.generatedBy, "profile-generator-out-of-domain");
  // 产出能被 P0-A4 校验器接受（验收①）
  const fullProfile = {
    profileId: "registry-generated",
    protocolVersion: "1.0",
    trainVersion: "0.2.0-rc.2",
    tenantId: "tenant-a",
    isolationGroupId: "ig-1",
    residencyRegion: "local",
    workspaces: [{ workspaceId: "ws", root: "/workspace", writable: true }],
    presetId: patch.presetId,
    pluginSet: patch.pluginSet,
    removedRows: patch.removedRows,
    hmr: { enabled: false },
    toolAllowlist: patch.toolAllowlist,
    skillRoots: patch.skillRoots,
    sandboxMode: "read-only",
    sandboxModeCeiling: "workspace-write",
    permissionPresets: { reachable: ["preset-registry"] },
    connectors: [],
    deadlines: { approvalSeconds: 90, modelStreamSeconds: 300, turnSeconds: 900 },
    buffers: { audit: { retainHours: 24 }, billing: { retainHours: 24 } },
    modelDegradation: { main: { target: "fail-closed" } },
    sessionProjectionCache: { writeEveryEvents: 100, writeIntervalMs: 1000 },
    quota: { tokensPerDay: 100000, toolCallsPerTurn: 10 },
    gateway: { endpoint: "http://127.0.0.1:7301", tokenTtlSeconds: 300 },
    requiredPlugins: ["dsh-invariants"],
  };
  const result = validateProfile(fullProfile, "dev");
  assert.equal(result.ok, true, JSON.stringify(result.errors ?? []));
});
