/**
 * `@dsh-boot/control-plane` — Profile 生成与校验、Session Router 接口、域就绪判定（`ENG-020`）。
 */
import type { DomainReadiness } from "@dsh-boot/protocol";

/** 域就绪判定的最小形状（`SEC-DOC-03` 拦截点 7；任一 fail ⇒ ready=false）。 */
export function summarize(readiness: DomainReadiness): boolean {
  return readiness.checks.every((c) => c.verdict === "pass");
}
