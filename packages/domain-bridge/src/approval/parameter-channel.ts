/**
 * 审批参数通道（`SEC-DOC-06`；`ENG-012`；`SEC-058`–`SEC-062`）。
 *
 * 十字段载荷是唯一合法形态（§1）：`tenantId`/`isolationGroupId`/`workspaceId`/
 * `sessionId`/`turnId`/`callId`/`toolName`/`argsDigest`/`argsPreview`/`redacted`。
 * 投递方向：域内桥 → 域外（`POST /internal/kernel/tool-audit`，审批判定**之前**，`O-3`）。
 * 键级脱敏规则落配置（§2）；体积上限与固定截断顺序（§3）；定序（§4）；
 * 回补端点数据源（§5）。`displayReason` 绝不持久化（`CTR-001` §4.2）。
 */

import { createHash } from "node:crypto";

/** 体积上限（`SEC-DOC-06` §3，固定取值）。 */
export const ARGS_PREVIEW_MAX_BYTES = 65536; // 64 KiB（UTF-8 计）
export const ARGS_VALUE_MAX_BYTES = 8192;
export const ARGS_MAX_DEPTH = 8;
export const ARGS_MAX_ARRAY_ITEMS = 100;
export const ARGS_MAX_KEYS = 256;

/** 键级脱敏规则（落配置；缺省 = `SEC-DOC-06` §2.1 固定集合）。 */
export interface RedactionRules {
  exactKeys: readonly string[];
  suffixKeys: readonly string[];
}

export const DEFAULT_REDACTION_RULES: RedactionRules = {
  exactKeys: [
    "password", "passwd", "pwd", "passphrase", "secret", "clientsecret", "token",
    "accesstoken", "refreshtoken", "idtoken", "apikey", "apitoken", "authorization",
    "auth", "cookie", "setcookie", "credential", "credentials", "privatekey",
    "accesskey", "secretkey", "sessiontoken", "bearer", "signature", "signingkey",
    "rootpassword",
  ],
  suffixKeys: ["secret", "token", "password", "passwd", "apikey", "privatekey", "credential"],
};

/** 十字段载荷（§1 唯一合法形态）。 */
export interface ApprovalPayload {
  readonly tenantId: string;
  readonly isolationGroupId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly argsDigest: string;
  readonly argsPreview: string;
  readonly redacted: boolean;
}

/** 域内调用上下文（应答者补齐 `sessionId` 等，内核载荷不含，`C9`）。 */
export interface ApprovalDomainContext {
  readonly tenantId: string;
  readonly isolationGroupId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly turnId: string;
}

/** 回补端点响应（§5 全部必返字段；`displayReason` 绝不出现）。 */
export interface BackfillRecord {
  readonly payload: ApprovalPayload;
  readonly userId: string;
  readonly callSeq: number;
  approvalSeq: number | null;
  approvalStatus: "pending" | "allowed-once" | "rejected" | "cancelled" | "unavailable" | "timeout";
  decidedAt: string | null;
  decidedByRole: string | null;
  outcomeReasonCode: string | null;
}

/** `normalizeKey(k) = lowercase(删除所有非 [a-z0-9] 字符)`（§2.1）。 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sensitiveKey(key: string, rules: RedactionRules): boolean {
  const normalized = normalizeKey(key);
  if (rules.exactKeys.some((k) => normalizeKey(k) === normalized)) return true;
  // `SUFFIX_SET` 语义按 `SEC-DOC-06` §2.1 原文为「**包含**任一 SUFFIX_SET 成员」（子串匹配，
  // 非 endsWith）——实现与规格逐字一致；偏保守方向（多脱敏不漏脱敏）。
  return rules.suffixKeys.some((suffix) => normalized.includes(normalizeKey(suffix)));
}

/** UTF-8 字节安全的截断（确定性）。 */
function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString("utf8");
}

interface RedactedNode {
  value: unknown;
  redacted: boolean;
}

/**
 * 键级脱敏 + 值级规则 + 截断（§2.2 顺序固定：先键级，再值级；§3 截断顺序固定：
 * ① 单值 → ② 数组项 → ③ 键数 → ④ 深度 → ⑤ 总字节；输出前按键名升序排序，确定性）。
 */
function redactNode(
  value: unknown,
  rules: RedactionRules,
  depth: number,
  state: { redacted: boolean },
): RedactedNode {
  // 键级规则 1：命中即整个值替换（不看值类型；对象/数组整体替换）。
  if (depth > ARGS_MAX_DEPTH) {
    state.redacted = true;
    return { value: "[TRUNCATED:DEPTH]", redacted: true }; // 截断顺序 ④ 深度
  }
  if (typeof value === "string") {
    if (value.includes("-----BEGIN") && value.includes("PRIVATE KEY")) {
      state.redacted = true;
      return { value: "[REDACTED:PEM]", redacted: true };
    }
    if (/^eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*$/.test(value)) {
      state.redacted = true;
      return { value: "[REDACTED:JWT]", redacted: true };
    }
    if (/^(AKIA|ASIA)[0-9A-Z]{16}$/.test(value) || /^gh[pousr]_[A-Za-z0-9]{20,}$/.test(value) ||
      /^xox[baprs]-[A-Za-z0-9-]{10,}$/.test(value)) {
      state.redacted = true;
      return { value: "[REDACTED:KEY]", redacted: true };
    }
    if (
      value.length >= 40 && /[a-zA-Z]/.test(value) && /[0-9]/.test(value) &&
      /^[A-Za-z0-9_\-+/=]+$/.test(value)
    ) {
      state.redacted = true;
      return { value: "[REDACTED:HIGHENTROPY]", redacted: true };
    }
    if (Buffer.byteLength(value, "utf8") > ARGS_VALUE_MAX_BYTES) {
      state.redacted = true;
      return { value: truncateUtf8(value, ARGS_VALUE_MAX_BYTES), redacted: true }; // 截断顺序 ① 单值
    }
    return { value, redacted: state.redacted };
  }
  if (Array.isArray(value)) {
    if (value.length > ARGS_MAX_ARRAY_ITEMS) {
      state.redacted = true;
      const kept = value.slice(0, ARGS_MAX_ARRAY_ITEMS).map((item) =>
        redactNode(item, rules, depth + 1, state).value
      );
      kept.push(`[TRUNCATED:ITEMS:${value.length}]`); // 截断顺序 ② 数组项
      return { value: kept, redacted: true };
    }
    return { value: value.map((item) => redactNode(item, rules, depth + 1, state).value), redacted: state.redacted };
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort(); // 按键名升序（确定性要求）
    if (keys.length > ARGS_MAX_KEYS) {
      state.redacted = true;
      keys.length = ARGS_MAX_KEYS; // 截断顺序 ③ 键数
    }
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (sensitiveKey(key, rules)) {
        state.redacted = true;
        out[key] = "[REDACTED]"; // 键级规则 1：整个值替换
        continue;
      }
      out[key] = redactNode((value as Record<string, unknown>)[key], rules, depth + 1, state).value;
    }
    return { value: out, redacted: state.redacted };
  }
  return { value, redacted: state.redacted };
}

/** JCS（RFC 8785）形态规范序列化：按键名升序递归排序后 `JSON.stringify`（`SEC-058`）。 */
export function canonicalSerialize(value: unknown): string {
  const seen = new Set<unknown>();
  const walk = (node: unknown): unknown => {
    if (node === null) return null;
    const type = typeof node;
    if (type === "string" || type === "boolean") return node;
    if (type === "number") {
      if (!Number.isFinite(node as number)) throw new TypeError("non-finite number is not serializable");
      return node;
    }
    if (type === "bigint" || type === "function" || type === "symbol" || type === "undefined") {
      throw new TypeError(`${type} is not serializable (F-1)`);
    }
    if (Array.isArray(node)) {
      if (seen.has(node)) throw new TypeError("circular reference is not serializable (F-1)");
      seen.add(node);
      const mapped = node.map(walk);
      seen.delete(node); // DAG 共享引用（非循环）不误报：walk 完成后回删
      return mapped;
    }
    if (seen.has(node)) throw new TypeError("circular reference is not serializable (F-1)");
    seen.add(node);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node as Record<string, unknown>).sort()) {
      out[key] = walk((node as Record<string, unknown>)[key]);
    }
    seen.delete(node); // DAG 共享引用（非循环）不误报：walk 完成后回删
    return out;
  };
  return JSON.stringify(walk(value));
}

/** `argsDigest = "sha256:" + 小写十六进制`，输入 = 参数对象的 JCS 规范序列化（`SEC-058`）。 */
export function argsDigestOf(canonical: string): string {
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** 构建十字段载荷；F-1（不可序列化）抛错由调用方判定（`SEC-DOC-06` §1/§6.1）。 */
export function buildTenFieldPayload(
  context: ApprovalDomainContext,
  callId: string,
  toolName: string,
  args: unknown,
  rules: RedactionRules = DEFAULT_REDACTION_RULES,
): ApprovalPayload {
  const canonical = canonicalSerialize(args); // F-1：抛错 ⇒ 不可送达
  const state = { redacted: false };
  const redactedNode = redactNode(args, rules, 0, state);
  let preview = JSON.stringify(redactedNode.value) ?? "null";
  if (Buffer.byteLength(preview, "utf8") > ARGS_PREVIEW_MAX_BYTES) {
    preview = truncateUtf8(preview, ARGS_PREVIEW_MAX_BYTES); // 截断顺序 ⑤ 总字节
    state.redacted = true;
  }
  return {
    tenantId: context.tenantId,
    isolationGroupId: context.isolationGroupId,
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    turnId: context.turnId,
    callId,
    toolName,
    argsDigest: argsDigestOf(canonical),
    argsPreview: preview,
    redacted: state.redacted,
  };
}

/**
 * 「参数无法送达域外」的登记期判定（`SEC-DOC-06` §6.1）：
 * F-1 不可序列化 / F-2 截断后仍超限 / F-3 无 `callId` ⇒ 禁止进入 `requireApproval`
 * 且**不予注册**（`ENG-012` 判据②）。
 */
export function argsDeliverable(toolName: string, args: unknown, callId: string | undefined): {
  ok: boolean;
  reason?: string;
} {
  if (callId === undefined || callId === null || callId === "") {
    return { ok: false, reason: "args-undeliverable:F-3-no-callId" };
  }
  try {
    const canonical = canonicalSerialize(args);
    const digest = argsDigestOf(canonical);
    if (typeof digest !== "string" || !digest.startsWith("sha256:")) {
      return { ok: false, reason: "args-undeliverable:F-1-digest" };
    }
    void toolName;
    return { ok: true };
  } catch {
    return { ok: false, reason: "args-undeliverable:F-1-unserializable" };
  }
}

/** 参数通道：上报、定序（`callSeq < approvalSeq`）、回补查询、按用户聚合的收件箱。 */
export class ApprovalParameterChannel {
  private seq = 0;
  private readonly records = new Map<string, BackfillRecord>();
  private readonly rules: RedactionRules;
  private readonly auditEndpoint: string;
  private readonly now: () => Date;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    auditEndpoint: string;
    redactionRules?: RedactionRules;
    now?: () => Date;
    fetchImpl?: typeof fetch;
  }) {
    this.auditEndpoint = options.auditEndpoint;
    this.rules = options.redactionRules ?? DEFAULT_REDACTION_RULES;
    this.now = options.now ?? (() => new Date());
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  /** 审批判定**之前**上报（`O-3`）；同时记 `tool.call` 的 `callSeq`（`O-1`）。失败即不可送达。 */
  async deliver(
    context: ApprovalDomainContext,
    callId: string,
    toolName: string,
    args: unknown,
  ): Promise<boolean> {
    let payload: ApprovalPayload;
    try {
      payload = buildTenFieldPayload(context, callId, toolName, args, this.rules);
    } catch {
      return false; // F-1：不可送达
    }
    try {
      const response = await this.fetchImpl(this.auditEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return false;
    } catch {
      return false; // 通道不可达 ⇒ 不可送达（`ENG-009` fail-closed）
    }
    const record: BackfillRecord = {
      payload,
      userId: context.userId,
      callSeq: this.nextSeq(), // O-1：tool.call 先投递
      approvalSeq: null,
      approvalStatus: "pending",
      decidedAt: null,
      decidedByRole: null,
      outcomeReasonCode: null,
    };
    this.records.set(`${context.sessionId}/${context.turnId}/${callId}`, record);
    return true;
  }

  /** `approval.requested` 的 `approvalSeq`（`O-1`：必须晚于 `callSeq`）。 */
  markApprovalRequested(sessionId: string, turnId: string, callId: string): void {
    const record = this.records.get(`${sessionId}/${turnId}/${callId}`);
    if (record && record.approvalSeq === null) record.approvalSeq = this.nextSeq();
  }

  /** 决议落库（回补端点 `approvalStatus`/`decidedAt`；不含自然人标识，§5）。 */
  markDecided(
    sessionId: string,
    turnId: string,
    callId: string,
    status: BackfillRecord["approvalStatus"],
    decidedByRole: string,
    outcomeReasonCode: string,
  ): void {
    const record = this.records.get(`${sessionId}/${turnId}/${callId}`);
    if (record) {
      record.approvalStatus = status;
      record.decidedAt = this.now().toISOString();
      record.decidedByRole = decidedByRole;
      record.outcomeReasonCode = outcomeReasonCode;
    }
  }

  /** 回补查询（§5；仅用于重连后回补，不得作为重新申请审批的入口）。 */
  getBackfill(sessionId: string, turnId: string, callId: string): BackfillRecord | undefined {
    return this.records.get(`${sessionId}/${turnId}/${callId}`);
  }

  /** 全局收件箱：按用户维度聚合待审批（`A-10`）。 */
  listPending(userId: string): BackfillRecord[] {
    return [...this.records.values()].filter((r) => r.userId === userId && r.approvalStatus === "pending");
  }

  /** 审计记录数（`ENG-010` 判据②：审计计数断言）。 */
  get auditCount(): number {
    return this.records.size;
  }
}
