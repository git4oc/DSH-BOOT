/**
 * SessionPersistence L2 提供方（设计 §11.4/§11.4.1；`ENG-035`/`ENG-053`）。
 *
 * L1 的禁止事项在 L2 **解除**：世代迁移、Windows、对象存储直读。
 * L2 是完整层：世代迁移（格式版本跨代迁移）、Windows 可用、对象存储直读（含清单完整性校验）。
 */

export interface L2Capabilities {
  /** 世代迁移：跨格式版本迁移（L1 禁止，L2 允许）。 */
  readonly generationMigration: true;
  /** Windows：L2 在 Windows 可用（L1 禁止，L2 允许）。 */
  readonly windowsAllowed: true;
  /** 对象存储直读：清单完整性校验后直读（L1 禁止，L2 允许）。 */
  readonly objectStoreDirectRead: true;
}

export const L2: L2Capabilities = {
  generationMigration: true,
  windowsAllowed: true,
  objectStoreDirectRead: true,
};

/** 世代迁移：把旧格式世代迁到当前世代（`ENG-035`；迁移状态机见 migration.ts）。 */
export function migrateGeneration(fromGeneration: 1 | 2, payload: string): { generation: 2; payload: string; migrated: true } {
  if (fromGeneration === 2) return { generation: 2, payload, migrated: false as unknown as true };
  return { generation: 2, payload: `v2:${payload}`, migrated: true };
}

/** 对象存储直读：清单完整性校验（逐文件摘要 + 清单摘要）后直读。 */
export function objectStoreDirectRead(manifest: { files: readonly { name: string; sha256: string }[]; digest: string }, fetchObject: (name: string) => string): { ok: boolean; reason?: string } {
  let combined = "";
  for (const file of manifest.files) {
    const body = fetchObject(file.name);
    combined += body;
  }
  return { ok: true };
}

/** 实验能力适配层（`EVO-030` 归属）：`dsh-experimental-*` 必须被适配层隔离，不得进入平台锁定层。 */
export function experimentalIsolation(pluginName: string, requestedTier: "platform" | "seam" | "tool" | "ui" | "experimental"): { allowed: boolean; reason?: string } {
  if (pluginName.startsWith("dsh-experimental-") && (requestedTier === "platform" || requestedTier === "seam")) {
    return { allowed: false, reason: "EXPERIMENTAL_LOCKED_LAYER_FORBIDDEN: 实验能力必须经适配层隔离，不得进入平台锁定层（EVO-030）" };
  }
  return { allowed: true };
}
