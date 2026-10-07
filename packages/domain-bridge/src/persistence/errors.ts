/**
 * SessionPersistence 错误类全集（`docs/reversal-contracts.md` §5.4；`ENG-016`）。
 *
 * **7 与 8 必须分开**：格式不受支持**不是**损坏——用户必须看到"升级 harness"，
 * **绝不能**看到 "corrupt"（§5.4 关键区分）。
 */

/** 错误码全集（`ENG-016` 错误语义闭合）。 */
export const SESSION_ERROR_CODES = {
  notFound: "SESSION_PERSISTENCE_NOT_FOUND",
  alreadyExists: "SESSION_ALREADY_EXISTS",
  alreadyOwned: "SESSION_ALREADY_OWNED",
  readOnly: "SESSION_READ_ONLY",
  ownershipLost: "SESSION_OWNERSHIP_LOST",
  handleClosed: "SESSION_HANDLE_CLOSED",
  corruption: "SESSION_PERSISTENCE_CORRUPTION",
  formatUnsupported: "SESSION_FORMAT_UNSUPPORTED",
} as const;

function make(code: string, message: string): Error {
  const error = new Error(`${code}: ${message}`);
  error.name = code;
  return error;
}

/** 1 | 请求的会话身份在本调用方视角下无持久日志。 */
export function sessionPersistenceNotFoundError(id: string): Error {
  return make(SESSION_ERROR_CODES.notFound, `no persisted session log for ${id}`);
}

/** 2 | create 指向已存在的身份。 */
export function sessionAlreadyExistsError(id: string): Error {
  return make(SESSION_ERROR_CODES.alreadyExists, `session already exists: ${id}`);
}

/** 3 | 写打开发现已被活动写句柄占用（不排队、不超时兜底）。 */
export function sessionAlreadyOwnedError(id: string): Error {
  return make(SESSION_ERROR_CODES.alreadyOwned, `write handle already owned by another instance: ${id}`);
}

/** 4 | 读句柄上调用 append/flush。 */
export function sessionReadOnlyError(id: string): Error {
  return make(SESSION_ERROR_CODES.readOnly, `handle is read-only: ${id}`);
}

/** 5 | 租约过期/续期失败/所有权记录不再指向本句柄。永不复得。 */
export function sessionOwnershipLostError(id: string): Error {
  return make(SESSION_ERROR_CODES.ownershipLost, `write ownership lost (lease expired or fenced): ${id}`);
}

/** 6 | close() 之后调用任何操作。 */
export function sessionHandleClosedError(id: string): Error {
  return make(SESSION_ERROR_CODES.handleClosed, `handle closed: ${id}`);
}

/** 7 | 后端读取成功后内容校验失败（与 8 严格区分）。 */
export function sessionPersistenceCorruptionError(id: string): Error {
  return make(SESSION_ERROR_CODES.corruption, `content verification failed after read: ${id}`);
}

/**
 * 8 | 日志完好但本运行时无法忠实解释（格式版本不受支持，或事件类型未知）。
 * 文案由 `sessionFormatVersionRefusal` 生成：用户看到"升级 harness"，绝不能看到 "corrupt"。
 */
export function sessionFormatUnsupportedError(id: string, version: string, location: { kind: string; path: string }): Error {
  return make(SESSION_ERROR_CODES.formatUnsupported, sessionFormatVersionRefusal(id, version, location));
}

/**
 * 格式版本拒绝文案（方向性要求：`docs/reversal-contracts.md` §5.4 ⚠）。
 * 内核提供 `sessionFormatVersionRefusal(id, version)`；内核未 vendor 期间由本提供方
 * 按同一方向性契约生成——**用户必须看到"升级 harness"，绝不能看到 "corrupt"**。
 */
export function sessionFormatVersionRefusal(id: string, version: string, location: { kind: string; path: string }): string {
  return `session ${id} (format version ${version}, ${location.kind}: ${location.path}) is intact but this runtime cannot interpret it faithfully: upgrade the harness to a build that supports format version ${version}`;
}

/** 格式版本常量（L1：仅支持当前 format，禁止世代迁移）。 */
export const CURRENT_FORMAT_VERSION = "1";
