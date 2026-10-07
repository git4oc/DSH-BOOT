/**
 * `@dsh-boot/protocol` — Profile JSON Schema、反向 I/O 类型、事件类型。
 * 仅类型与 schema，无运行期依赖（`ENG-020`）。
 */

/** Runtime Profile JSON Schema（`D-14`），与 `contracts/profile.schema.json` 同源分发。 */
export const PROFILE_SCHEMA_PATH = "./profile.schema.json" as const;

export type {
  LlmStreamRequest,
  LlmGenerateOptions,
  LlmStreamChunk,
  ModelRef,
  RetryPolicy,
  ApprovalRequestEvent,
} from "./reverse-io.d.ts";

export type {
  AuditKey,
  SessionEventName,
  DomainReadinessFacts,
  DomainReadiness,
} from "./events.d.ts";
