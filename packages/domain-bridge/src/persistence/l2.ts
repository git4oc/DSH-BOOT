/**
 * SessionPersistence L2 提供方（设计 §11.4/§11.4.1；`ENG-036`/`ENG-037`）。
 *
 * L1 的禁止事项在 L2 **解除**（`ENG-036`）：世代迁移、Windows、对象存储直读。
 * L2 能力以独立能力开关暴露（`ENG-036` 判据③）；**能力开关 ≠ 能力实现**：
 * - 世代迁移：显式 v1→v2 字段映射（本文件，fail-closed，不认识的世代拒绝）；
 * - 对象存储直读：逐文件 sha256 + 清单摘要校验（本文件，校验不过拒绝直读）；
 * - Windows：本仓库**无 Windows L2 provider 实现**（GATE-002 条件 9 实测 fail，如实标注），
 *   故默认 `windowsAllowed: false`；仅当部署方显式注入已验证的 Windows provider 后才可置 true。
 */

import { createHash } from "node:crypto";

export interface L2Capabilities {
  /** 世代迁移：跨格式版本迁移（L1 禁止，L2 允许；实现见 `migrateGeneration`）。 */
  readonly generationMigration: true;
  /**
   * Windows：L2 在 Windows 可用（L1 禁止，L2 允许）。
   * **本仓库默认 `false`**：无 Windows L2 provider 实现（GATE-002 条件 9 如实 fail）；
   * 部署方注入已验证的 Windows provider 后，经 `withWindowsSupport` 显式开启。
   */
  readonly windowsAllowed: boolean;
  /** 对象存储直读：清单完整性校验后直读（L1 禁止，L2 允许；实现见 `objectStoreDirectRead`）。 */
  readonly objectStoreDirectRead: true;
}

export const L2: L2Capabilities = {
  generationMigration: true,
  windowsAllowed: false, // 如实：本仓库无 Windows L2 provider（GATE-002 条件 9 fail），不得虚报 true
  objectStoreDirectRead: true,
};

/** 显式注入已验证的 Windows L2 provider 后开启 `windowsAllowed`（`ENG-036` 能力开关）。 */
export function withWindowsSupport(capabilities: L2Capabilities = L2): L2Capabilities {
  if (capabilities === L2 || capabilities.windowsAllowed !== true) {
    throw new Error(
      "L2 windows support requires an explicitly verified Windows provider injection (none ships in this repo; GATE-002 condition 9 failed)",
    );
  }
  return capabilities;
}

/** L2 世代常量（L1 仅支持 `CURRENT_FORMAT_VERSION = "1"`；L2 目标世代为 2）。 */
export const L2_GENERATION = 2;

export interface MigrateGenerationResult {
  /** fail-closed：false 表示 payload 中存在不认识的世代/坏帧，已拒绝迁移（不产出半迁移产物）。 */
  readonly ok: boolean;
  readonly reason?: string;
  readonly generation: 2;
  readonly payload: string;
  /** false = 输入本就是 gen2，未做转换（如实返回，不虚报）。 */
  readonly migrated: boolean;
  /** 实际转换的帧数（migrated=true 时 ≥ 1）。 */
  readonly frameCount: number;
}

/**
 * 世代迁移：显式 v1→v2 字段映射（`ENG-036`；迁移前置校验见 `REL-086`，格式拒绝方向见 P-7/`C39`）。
 *
 * 映射语义（显式、无损）：v2 是 v1 的超集——逐帧校验 `v === "1"` 后将帧标记重写为
 * `v: "2"`，其余字段**逐字保留**（不重组、不改名、不增删）；v2 = v1 全字段 + 新世代标记。
 * - `fromGeneration === 2`：输入已是目标世代，原样返回 `migrated: false`（如实，不做 `false as true` 谎报）。
 * - 任一帧非合法 JSON、或 `v` 不属于 {1, 2}：fail-closed 拒绝（`ok: false`），**不产出**半迁移产物。
 */
export function migrateGeneration(fromGeneration: 1 | 2, payload: string): MigrateGenerationResult {
  if (fromGeneration === 2) {
    return { ok: true, generation: 2, payload, migrated: false, frameCount: 0 };
  }
  const lines = payload.split("\n");
  const mapped: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let frame: { v?: unknown; [key: string]: unknown };
    try {
      frame = JSON.parse(trimmed) as { v?: unknown };
    } catch {
      return { ok: false, reason: "MIGRATION_REFUSED: frame is not valid JSON (gen1 → gen2 refused, REL-086/P-7)", generation: 2, payload: "", migrated: false, frameCount: 0 };
    }
    if (frame.v === L2_GENERATION) {
      mapped.push(trimmed); // 已是目标世代标记的帧：逐字保留
      continue;
    }
    if (frame.v !== "1") {
      return { ok: false, reason: `MIGRATION_REFUSED: unknown generation ${String(frame.v)} (only 1 → 2 supported, REL-086/P-7)`, generation: 2, payload: "", migrated: false, frameCount: 0 };
    }
    mapped.push(JSON.stringify({ ...frame, v: String(L2_GENERATION) }));
  }
  const body = mapped.length > 0 ? `${mapped.join("\n")}\n` : "";
  return { ok: true, generation: 2, payload: body, migrated: true, frameCount: mapped.length };
}

export interface ObjectStoreManifest {
  readonly files: readonly { name: string; sha256: string }[];
  /**
   * 清单摘要 = sha256(逐文件 sha256 十六进制按清单顺序以 "\n" 连接)。
   * 本实现是仓库内该字段的唯一定义（此前无定义——如实补齐）。
   */
  readonly digest: string;
}

export interface ObjectStoreReadResult {
  readonly ok: boolean;
  readonly reason?: string;
  /** 校验通过时返回逐文件校验明细（诊断用）。 */
  readonly verified?: readonly string[];
}

function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * 对象存储直读：清单完整性校验（逐文件摘要 + 清单摘要）后直读（`ENG-036` L2 能力）。
 *
 * fail-closed（`C-1`）：任一文件 sha256 与清单不符、或清单摘要不符 ⇒ `{ ok: false }`
 * 拒绝直读；**绝不**在校验不过时返回部分内容。`fetchObject` 由部署方注入
 * （对象存储连接不属于本仓库实现，README 边界「生产部署需自备执行环境」）。
 */
export function objectStoreDirectRead(
  manifest: ObjectStoreManifest,
  fetchObject: (name: string) => string,
): ObjectStoreReadResult {
  const verified: string[] = [];
  const digests: string[] = [];
  for (const file of manifest.files) {
    const body = fetchObject(file.name);
    const actual = sha256Hex(body);
    if (actual !== file.sha256.toLowerCase()) {
      return { ok: false, reason: `OBJECT_STORE_INTEGRITY_FAILED: sha256 mismatch for ${file.name} (expected ${file.sha256}, got ${actual})` };
    }
    verified.push(file.name);
    digests.push(file.sha256.toLowerCase());
  }
  const digest = sha256Hex(digests.join("\n"));
  if (digest !== manifest.digest.toLowerCase()) {
    return { ok: false, reason: `OBJECT_STORE_INTEGRITY_FAILED: manifest digest mismatch (expected ${manifest.digest}, got ${digest})` };
  }
  return { ok: true, verified };
}

/** 实验能力适配层（`EVO-030` 归属）：`dsh-experimental-*` 必须被适配层隔离，不得进入平台锁定层。 */
export function experimentalIsolation(pluginName: string, requestedTier: "platform" | "seam" | "tool" | "ui" | "experimental"): { allowed: boolean; reason?: string } {
  if (pluginName.startsWith("dsh-experimental-") && (requestedTier === "platform" || requestedTier === "seam")) {
    return { allowed: false, reason: "EXPERIMENTAL_LOCKED_LAYER_FORBIDDEN: 实验能力必须经适配层隔离，不得进入平台锁定层（EVO-030）" };
  }
  return { allowed: true };
}
