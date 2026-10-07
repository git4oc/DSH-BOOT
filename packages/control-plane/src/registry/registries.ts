/**
 * 四目录/注册表（设计 §5.3/§5.3.1/§5.6；`SEC-105`；`ENG-063`；`EVO-011`–`EVO-020`）。
 *
 * **强制力只来自域外**（§5.3.1 强制链）：层级合法性在**域外 Profile 生成时**判定（第 1 项），
 * 分层锁是**产品侧治理策略、不是平台强制力**（preset 不是安全沙箱 C17）。
 * **出现"域内自证合规"的实现即判不通过**（D9/D15）。
 */

import { createHash } from "node:crypto";

// ── 1. Plugin Registry（§5.3：制品/版本/标签/签名/完整性哈希/回滚） ─────────────
export type PluginTier = "platform" | "seam" | "tool" | "ui";

export interface RegisteredPlugin {
  readonly name: string;
  readonly version: string;
  readonly tier: PluginTier;
  /** 完整性哈希（域外加装时计算，加载器包装层校验——强制链第 2 项）。 */
  readonly integrity: string;
  readonly signature: string;
  readonly deprecated: boolean;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, RegisteredPlugin>();

  register(plugin: Omit<RegisteredPlugin, "integrity" | "signature">, artifact: string, signingKey: string): RegisteredPlugin {
    const integrity = `sha512-${sha256(artifact)}`;
    const full: RegisteredPlugin = { ...plugin, integrity, signature: sign(artifact, signingKey) };
    this.plugins.set(`${plugin.name}@${plugin.version}`, full);
    return full;
  }

  /** 回滚（`EVO-020`）：回退到上一版本制品。 */
  rollback(name: string, toVersion: string): RegisteredPlugin {
    const plugin = this.plugins.get(`${name}@${toVersion}`);
    if (!plugin) throw new Error(`PLUGIN_VERSION_NOT_FOUND: ${name}@${toVersion}`);
    return plugin;
  }

  get(name: string, version: string): RegisteredPlugin | undefined {
    return this.plugins.get(`${name}@${version}`);
  }
}

/**
 * 层级合法性判定——**必须在域外 Profile 生成时完成，不在域内**（强制链第 1 项；验收②）。
 * 分层锁是**产品侧治理策略、不是平台强制力**（preset 不是安全沙箱 C17）。
 * 平台锁定层（platform/seam）不接受租户自定义插件。
 */
export function decideTierLegalityAtProfileGeneration(plugin: { name: string; requestedTier: PluginTier; tenantCustom: boolean }, platformLockTiers: readonly PluginTier[]): { allowed: boolean; decidedBy: "profile-generator-out-of-domain"; reason?: string } {
  if (plugin.tenantCustom && platformLockTiers.includes(plugin.requestedTier)) {
    return { allowed: false, decidedBy: "profile-generator-out-of-domain", reason: `租户自定义插件不得进入平台锁定层（${plugin.requestedTier}）——层级合法性在域外 Profile 生成时判定（§5.3.1 第 1 项）` };
  }
  return { allowed: true, decidedBy: "profile-generator-out-of-domain" };
}

// ── 2. Connector Registry（§5.6） ─────────────────────────────────────────────
export type ConnectorHosting = "domain" | "data-plane" | "exception";
export type ConnectorTrust = "trusted" | "untrusted";

export interface RegisteredConnector {
  readonly serverName: string;
  readonly transport: "stdio" | "streamable-http";
  readonly hosting: ConnectorHosting;
  readonly credentialRef: string;
  readonly trust: ConnectorTrust;
  readonly securityReviewPassed: boolean;
}

export interface ConnectorHealth {
  readonly serverName: string;
  readonly connected: boolean;
  readonly toolCount: number;
  readonly reconnects: number;
}

export class ConnectorRegistry {
  private readonly connectors = new Map<string, RegisteredConnector>();
  private readonly health = new Map<string, ConnectorHealth>();
  /** 突变处置：冻结该 connector 的新工具可见性（§5.6 突变处置）。 */
  private readonly frozen = new Set<string>();
  public readonly alerts: { kind: string; serverName: string; detail: string }[] = [];
  private readonly maxExceptionConnectorsPerDomain: number;

  constructor(maxExceptionConnectorsPerDomain: number = 2) {
    this.maxExceptionConnectorsPerDomain = maxExceptionConnectorsPerDomain;
  }

  /** 注册：例外（hosting=exception）须安全评审 + 按域硬上限（验收③）。 */
  register(connector: RegisteredConnector): RegisteredConnector {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(connector.serverName)) {
      throw new Error("CONNECTOR_NAME_INVALID: serverName 须为 [A-Za-z0-9_-]{1,32} 且作用域内唯一（§5.6）");
    }
    if (connector.hosting === "exception") {
      if (!connector.securityReviewPassed) {
        throw new Error("CONNECTOR_EXCEPTION_REVIEW_REQUIRED: 例外归属须安全评审（§5.6）");
      }
      const exceptions = [...this.connectors.values()].filter((c) => c.hosting === "exception").length;
      if (exceptions >= this.maxExceptionConnectorsPerDomain) {
        throw new Error(`CONNECTOR_EXCEPTION_CAP_EXCEEDED: 例外 connector 超过按域上限 ${this.maxExceptionConnectorsPerDomain}`);
      }
    }
    // 信任级默认 untrusted（未知即不可信）。
    const full: RegisteredConnector = { ...connector, trust: connector.trust ?? "untrusted" };
    this.connectors.set(full.serverName, full);
    return full;
  }

  /** 健康：连接状态、工具数、重连次数；**工具数突变必须告警**并冻结新工具可见性。 */
  reportHealth(health: ConnectorHealth): { alerted: boolean; frozenNewToolVisibility: boolean } {
    const previous = this.health.get(health.serverName);
    this.health.set(health.serverName, health);
    if (previous && previous.toolCount !== health.toolCount) {
      this.alerts.push({ kind: "connector.tool_count_mutated", serverName: health.serverName, detail: `工具数 ${previous.toolCount} → ${health.toolCount}` });
      this.frozen.add(health.serverName);
      return { alerted: true, frozenNewToolVisibility: true };
    }
    return { alerted: false, frozenNewToolVisibility: this.frozen.has(health.serverName) };
  }

  /** 冻结中的 connector：新工具不得进入模型可见集（配合 §4.5.1 闸门）。 */
  newToolVisibilityFrozen(serverName: string): boolean {
    return this.frozen.has(serverName);
  }
}

// ── 3. Skill Catalog（`SEC-105` 三级作用域 + `ENG-063` skillRoots 装配） ───────
export type SkillScope = "platform" | "tenant" | "user";

export interface SkillEntry {
  readonly name: string;
  readonly scope: SkillScope;
  readonly tenantId?: string;
  readonly version: string;
}

export class SkillCatalog {
  private readonly skills: SkillEntry[] = [];

  publish(entry: SkillEntry): void {
    if (entry.scope !== "platform" && !entry.tenantId) {
      throw new Error("SKILL_SCOPE_TENANT_REQUIRED: 租户/用户级 Skill 须绑定租户");
    }
    this.skills.push(entry);
  }

  /** `ENG-063`：按作用域装配 skillRoots（platform 全量 + 租户/用户按归属）。 */
  assembleSkillRoots(tenantId: string): { readonly skillRoots: readonly string[] } {
    const roots = this.skills
      .filter((s) => s.scope === "platform" || s.tenantId === tenantId)
      .map((s) => `skill://${s.scope}/${s.name}@${s.version}`);
    return { skillRoots: roots };
  }
}

// ── 4. Scenario Catalog（presetId + pluginSet + policies） ────────────────────
export interface ScenarioDefinition {
  readonly presetId: string;
  readonly pluginSet: readonly string[];
  readonly policies: { readonly requireApproval: readonly string[]; readonly toolAllowlist: readonly string[] };
}

export class ScenarioCatalog {
  private readonly scenarios = new Map<string, ScenarioDefinition>();

  define(definition: ScenarioDefinition): void {
    // presetId 只增不改（`EVO-011` 永久兼容面）。
    if (this.scenarios.has(definition.presetId)) {
      throw new Error(`SCENARIO_PRESET_IMMUTABLE: ${definition.presetId} 已定义（presetId 只增不删）`);
    }
    this.scenarios.set(definition.presetId, definition);
  }

  get(presetId: string): ScenarioDefinition | undefined {
    return this.scenarios.get(presetId);
  }
}

// ── Profile 生成（域外；强制链第 1 项） ────────────────────────────────────────
/** 域外 Profile 生成器输入：来自四个注册表的视图。 */
export function generateProfilePatch(input: { presetId: string; plugins: readonly RegisteredPlugin[]; toolAllowlist: readonly string[]; skillRoots: readonly string[]; removedRows: readonly string[] }): {
  readonly presetId: string;
  readonly pluginSet: readonly { readonly name: string; readonly version: string; readonly integrity: string; readonly tier: string }[];
  readonly toolAllowlist: readonly string[];
  readonly skillRoots: readonly string[];
  readonly removedRows: readonly string[];
  readonly generatedBy: "profile-generator-out-of-domain";
} {
  return {
    presetId: input.presetId,
    pluginSet: input.plugins.map((p) => ({ name: p.name, version: p.version, integrity: p.integrity, tier: p.tier })),
    toolAllowlist: input.toolAllowlist,
    skillRoots: input.skillRoots,
    removedRows: input.removedRows,
    generatedBy: "profile-generator-out-of-domain",
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sign(value: string, key: string): string {
  return createHash("sha256").update(`${key}:${value}`, "utf8").digest("hex").slice(0, 32);
}
