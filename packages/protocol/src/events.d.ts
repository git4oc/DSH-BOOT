/**
 * dsh-boot 会话事件与审计键类型（`@dsh-boot/protocol`）。
 *
 * 审计键五元组口径来源：`CTR-001` C-5（`SPEC-01` §5.5）；事件名与内核发行包
 * 会话日志实证一致（`tool/call`、`tool/result`、`tool/ptc-dispatch` 等）。
 * 本包只含类型与 schema，无运行期依赖（`ENG-020` 判据②）。
 */

/** 审计键五元组 + MCP 相关再带 `rawName`（`CTR-001` C-5）。 */
export interface AuditKey {
  readonly tenantId: string;
  readonly isolationGroupId: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly serverName: string;
  readonly rawName?: string;
}

/** 强制链会话事件名（`SEC-DOC-03` 拦截点的会话日志载体）。 */
export type SessionEventName =
  | "tool/call"
  | "tool/result"
  | "tool/ptc-dispatch"
  | "tool/ptc-dispatch-start"
  | "approval/requested"
  | "approval/decided"
  | "tools/change"
  | "bridge/guard-installed"
  | "bridge/register-denied"
  | "session/ready";

/** 域就绪门禁输入的域外事实四项摘要（`SEC-DOC-04` §2；`SPEC-00` `GATE-002` 条件 3）。 */
export interface DomainReadinessFacts {
  readonly mirrorDigest: string;
  readonly mountDigest: string;
  readonly runtimeConfigSnapshot: string;
  readonly profileGenerationDigest: string;
}

/** 域就绪判定结果（任一 fail ⇒ ready=false，域不进入 active）。 */
export interface DomainReadiness {
  readonly ready: boolean;
  readonly checks: ReadonlyArray<{ readonly id: string; readonly verdict: "pass" | "fail" }>;
}
