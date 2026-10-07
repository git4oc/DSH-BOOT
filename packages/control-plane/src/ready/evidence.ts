/**
 * 域外证据记录（`SEC-DOC-04` §3.2；`PC-007`；`GATE-002` 条件 4）。
 *
 * 平台**必须**能产出并留存域就绪所需的域外事实——镜像摘要、挂载内容摘要、
 * 运行时配置快照摘要、Profile 生成摘要——且**每次域创建时留证**（设计 §4.1.2）。
 * 留存要求：≥ 366 天；记录本身进哈希链（前一条的摘要进下一条）。
 */

import { createHash } from "node:crypto";

/** 域外证据记录（`SEC-DOC-04` §3.2 全部必填字段）。 */
export interface DomainEvidenceRecord {
  readonly domainId: string;
  readonly tenantId: string;
  readonly isolationGroupId: string;
  readonly imageDigest: string;
  readonly mountDigest: string;
  readonly runtimeConfigDigest: string;
  readonly profileGenerationDigest: string;
  readonly criticalRowsDigest: string;
  readonly denylistDigest: string;
  readonly results: Readonly<Record<string, { verdict: string; observed: string; source: string }>>;
  readonly createdAt: string;
  readonly retainedAt: string;
  /** 哈希链：本记录的链上摘要（含前一条的 chainHash）。 */
  readonly chainHash: string;
}

export interface DomainEvidenceInput {
  readonly domainId: string;
  readonly tenantId: string;
  readonly isolationGroupId: string;
  readonly imageDigest?: string;
  readonly mountDigest?: string;
  readonly runtimeConfigDigest?: string;
  readonly profileGenerationDigest?: string;
  readonly results?: Readonly<Record<string, { verdict: string; observed: string; source: string }>>;
  readonly now?: () => Date;
  readonly previousChainHash?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 四类摘要非空（`PC-007`：domainEvidence 在域创建时必须产出并留存，非空）。 */
export function evidenceComplete(input: DomainEvidenceInput): boolean {
  return (
    isNonEmpty(input.imageDigest) &&
    isNonEmpty(input.mountDigest) &&
    isNonEmpty(input.runtimeConfigDigest) &&
    isNonEmpty(input.profileGenerationDigest)
  );
}

function isNonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

/**
 * 每次域创建留证（`GATE-002` 条件 4）：四类摘要缺失即拒绝（`PC-007`），不得留空证。
 */
export function createDomainEvidence(input: DomainEvidenceInput): DomainEvidenceRecord {
  if (!evidenceComplete(input)) {
    throw new Error("PC-007：四类域外摘要（image/mount/runtimeConfig/profileGeneration）必须非空——每次域创建留证（GATE-002 条件 4）");
  }
  const now = (input.now ?? (() => new Date()))();
  const createdAt = now.toISOString();
  const retainedAt = `WORM://evidence/GATE-002/domain-evidence/${input.domainId}/`;
  const withoutChain = {
    domainId: input.domainId,
    tenantId: input.tenantId,
    isolationGroupId: input.isolationGroupId,
    imageDigest: input.imageDigest as string,
    mountDigest: input.mountDigest as string,
    runtimeConfigDigest: input.runtimeConfigDigest as string,
    profileGenerationDigest: input.profileGenerationDigest as string,
    criticalRowsDigest: sha256(CRITICAL_ROWS_JSON),
    denylistDigest: sha256(DENYLIST_JSON),
    results: input.results ?? {},
    createdAt,
    retainedAt,
  };
  const chainHash = sha256(`${input.previousChainHash ?? "GENESIS"}|${JSON.stringify(withoutChain)}`);
  return { ...withoutChain, chainHash };
}

const CRITICAL_ROWS_JSON = JSON.stringify(["dsh-invariants", "dsh-tool-call-timeout-policy"]);
const DENYLIST_JSON = JSON.stringify(["dsh-credentials-local", "dsh-credentials-env", "dsh-credentials-vault"]);

/** 哈希链校验：逐条复算 chainHash（导出物含链首尾摘要，`SEC-DOC-13` §6.3）。 */
export function verifyChain(records: readonly DomainEvidenceRecord[]): boolean {
  let previous = "GENESIS";
  for (const record of records) {
    const { chainHash, ...rest } = record;
    const expected = sha256(`${previous}|${JSON.stringify(rest)}`);
    if (chainHash !== expected) return false;
    previous = chainHash;
  }
  return true;
}
