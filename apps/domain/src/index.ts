/**
 * `@dsh-boot/apps-domain` — 域镜像入口与 Cordis Profile 装配（`ENG-020`）。
 * 消费内部反向 I/O 契约（`CTR-001`），不依赖对外 SDK（`LAYER-001` §4 O-1）。
 */
import type { DomainReadiness } from "@dsh-boot/protocol";
import { REVERSAL_FACE_LIMIT } from "@dsh-boot/domain-bridge";

export function skeletonFacts(): { entry: string; faceLimit: number } {
  return { entry: "registerTool", faceLimit: REVERSAL_FACE_LIMIT };
}

export type { DomainReadiness };
