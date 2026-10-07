/**
 * 自建契约测试套件核心（`ENG-031` A–F 六项；交付物 `D-3`）。
 *
 * **套件在发行版之外自建**（发行版不含契约测试套件，`C41`），不依赖内核仓库：
 * 参考实现为 `tests/contract/fixtures/persistence` 的可编程基底 + 本文件的契约
 * 参考核心（torn-tolerant reader / 会话句柄语义）。实现（P1-B）落地后换绑。
 *
 * 每项失败信息必须点名 A–F 中的哪一项与哪条断言（`ENG-031` 判据②）。
 */

import { readFileSync, existsSync, openSync, closeSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDevJsonl,
  sessionPaths,
  injectTearTail,
  holdExclusiveLock,
  injectForeignFormat,
  isForeignFormat,
} from "../../fixtures/persistence/index.ts";

/** 契约参考读取器：完整帧逐行解析；**物理半帧/损坏帧不被返回**（A）；外来格式必须被拒绝（E）。 */
export function readContractFrames(logPath) {
  if (!existsSync(logPath)) return [];
  const content = readFileSync(logPath, "utf8");
  // E 拒绝方向：不能解码的格式必须被拒绝，不得尝试升级或宽松解码。
  if (isForeignFormat(content)) {
    const error = new Error(`SESSION_FORMAT_UNSUPPORTED: ${logPath}`);
    error.name = "SESSION_FORMAT_UNSUPPORTED";
    throw error;
  }
  const lines = content.split("\n");
  const frames = [];
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    try {
      frames.push(JSON.parse(line));
    } catch {
      // A 拒绝方向：物理半帧只允许出现在**尾部**（崩溃语义），且不被返回。
      const isTail = index === lines.length - 1 || (index === lines.length - 2 && lines[lines.length - 1].trim().length === 0);
      if (!isTail) {
        const error = new Error(`SESSION_FORMAT_UNSUPPORTED: 损坏帧不在尾部（${logPath}:${index}）`);
        error.name = "SESSION_FORMAT_UNSUPPORTED";
        throw error;
      }
      break; // 撕裂尾：物理半帧不被 read 返回
    }
  }
  return frames;
}

/** 契约参考会话句柄：closed 后各方法返回 `SESSION_HANDLE_CLOSED`；close 幂等（C）。 */
export function createContractHandle(dir, sessionId) {
  const log = createDevJsonl({ dir, sessionId });
  let closed = false;
  return {
    path: log.path,
    append(frame) {
      if (closed) throw closedError();
      return log.append(frame);
    },
    read() {
      if (closed) throw closedError();
      return readContractFrames(log.path);
    },
    stat() {
      if (closed) throw closedError();
      return existsSync(log.path) ? readFileSync(log.path, "utf8").length : 0;
    },
    flush() {
      if (closed) throw closedError();
      log.flush();
    },
    close() {
      if (closed) return false; // 幂等：第二次 close 不抛错
      log.flush(); // close 完成持久化
      closed = true;
      return true;
    },
  };
}

function closedError() {
  const error = new Error("SESSION_HANDLE_CLOSED");
  error.name = "SESSION_HANDLE_CLOSED";
  return error;
}

/** A–F 六项逐一运行（幂等：每次独立临时目录）。 */
export function runAF() {
  const results = [];
  const dir = mkdtempSync(join(tmpdir(), "dsh-a2f-"));
  try {
    results.push(runA(dir));
    results.push(runB(dir));
    results.push(runC(dir));
    results.push(runD(dir));
    results.push(runE(dir));
    results.push(runF(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return results;
}

/** (A) 撕裂尾——物理半帧/损坏帧不被 `read` 返回。 */
function runA(dir) {
  const item = "A";
  try {
    const log = createDevJsonl({ dir, sessionId: "a-torn" });
    log.append({ event: "turn.started", seq: 1 });
    log.append({ event: "message.delta", seq: 2 });
    injectTearTail(log.path, 1);
    const physical = readFileSync(log.path, "utf8");
    const lines = physical.split("\n").filter((l) => l.trim().length > 0);
    let tornTailExists = false;
    try {
      JSON.parse(lines[lines.length - 1]);
    } catch {
      tornTailExists = true;
    }
    if (!tornTailExists) {
      return { item, ok: false, detail: "(A) 断言0（故障条件注入）：撕裂尾未注入——物理日志尾必须是半帧（ENG-031 A）" };
    }
    const frames = readContractFrames(log.path);
    if (frames.length !== 2) {
      return { item, ok: false, detail: `(A) 断言1：read 必须恰好返回 2 个完整帧，got ${frames.length}（ENG-031 A：物理半帧不被 read 返回）` };
    }
    if (frames[frames.length - 1].event !== "message.delta") {
      return { item, ok: false, detail: "(A) 断言2：最后一帧必须是完整帧 message.delta，撕裂尾不得出现在返回序列（ENG-031 A）" };
    }
    return { item, ok: true, detail: "(A) 撕裂尾：物理半帧存在且不被 read 返回（2 个完整帧）" };
  } catch (error) {
    return { item, ok: false, detail: `(A) 未预期异常：${String(error?.message ?? error)}（ENG-031 A）` };
  }
}

/** (B) 单写者——第二个写句柄失败且错误码正确。 */
function runB(dir) {
  const item = "B";
  try {
    const lockPath = join(dir, "b.lock");
    const first = holdExclusiveLock(lockPath);
    if (!first.acquired) {
      return { item, ok: false, detail: "(B) 断言0（场景构造）：首个写者未持锁，无法构造单写者场景（ENG-031 B）" };
    }
    let secondErrorName = "";
    let secondFailed = false;
    try {
      openSyncExclusive(lockPath);
    } catch (error) {
      secondFailed = true;
      secondErrorName = String(error?.code ?? error?.name ?? "");
    }
    if (!secondFailed) {
      return { item, ok: false, detail: "(B) 断言1：第二个写句柄必须失败（SESSION_ALREADY_OWNED 条件）（ENG-031 B）" };
    }
    if (secondErrorName !== "EEXIST") {
      return { item, ok: false, detail: `(B) 断言2：错误码必须正确（开发态 EEXIST，即 SESSION_ALREADY_OWNED 条件），got ${secondErrorName}（ENG-031 B）` };
    }
    first.release();
    const reacquired = holdExclusiveLock(lockPath);
    if (!reacquired.acquired) {
      return { item, ok: false, detail: "(B) 断言3：释放后必须可重新获得写锁（ENG-031 B）" };
    }
    reacquired.release();
    return { item, ok: true, detail: "(B) 单写者：第二写者失败（EEXIST=SESSION_ALREADY_OWNED 条件）、释放后可复得" };
  } catch (error) {
    return { item, ok: false, detail: `(B) 未预期异常：${String(error?.message ?? error)}（ENG-031 B）` };
  }
}

function openSyncExclusive(lockPath) {
  const fd = openSync(lockPath, "wx");
  closeSync(fd);
}

/** (C) closed handle——关闭后各方法返回 `SESSION_HANDLE_CLOSED`，close 幂等且完成持久化。 */
function runC(dir) {
  const item = "C";
  try {
    const handle = createContractHandle(dir, "c-closed");
    handle.append({ event: "turn.started", seq: 1 });
    handle.close();
    const probes = [
      ["append", () => handle.append({ event: "after-close" })],
      ["read", () => handle.read()],
      ["stat", () => handle.stat()],
      ["flush", () => handle.flush()],
    ];
    for (const [method, invoke] of probes) {
      let errorName = "";
      try {
        invoke();
      } catch (error) {
        errorName = String(error?.name ?? "");
      }
      if (errorName !== "SESSION_HANDLE_CLOSED") {
        return { item, ok: false, detail: `(C) 断言1：close 后 ${method} 必须抛出 SESSION_HANDLE_CLOSED，got ${errorName || "无异常"}（ENG-031 C）` };
      }
    }
    if (handle.close() !== false) {
      return { item, ok: false, detail: "(C) 断言2：close 必须幂等（第二次 close 不抛错且返回已关闭）（ENG-031 C）" };
    }
    const paths = sessionPaths(dir, "c-closed");
    const durable = readFileSync(paths.logPath, "utf8");
    if (!durable.includes("turn.started")) {
      return { item, ok: false, detail: "(C) 断言3：close 必须完成持久化（帧在 close 返回后已落盘）（ENG-031 C）" };
    }
    return { item, ok: true, detail: "(C) closed handle：close 后四方法抛 SESSION_HANDLE_CLOSED，close 幂等，帧已落盘" };
  } catch (error) {
    return { item, ok: false, detail: `(C) 未预期异常：${String(error?.message ?? error)}（ENG-031 C）` };
  }
}

/** (D) freshness——写后启动的读至少看到该前缀。 */
function runD(dir) {
  const item = "D";
  try {
    const log = createDevJsonl({ dir, sessionId: "d-fresh" });
    const written = [
      { event: "turn.started", seq: 1 },
      { event: "message.delta", seq: 2 },
      { event: "message.delta", seq: 3 },
    ];
    for (const frame of written) log.append(frame);
    // 写后启动的读 = 新实例（模拟其他进程/新打开的读句柄）。
    const fresh = createDevJsonl({ dir, sessionId: "d-fresh" });
    const seen = fresh.read();
    const prefix = seen.slice(0, written.length);
    const prefixMatches = written.every((frame, index) => JSON.stringify(prefix[index]) === JSON.stringify(frame));
    if (seen.length < written.length || !prefixMatches) {
      return { item, ok: false, detail: `(D) 断言1：写后启动的读必须至少看到该前缀（got ${seen.length} 帧，前缀匹配=${prefixMatches}）（ENG-031 D）` };
    }
    return { item, ok: true, detail: "(D) freshness：新读实例看到全部 3 帧前缀" };
  } catch (error) {
    return { item, ok: false, detail: `(D) 未预期异常：${String(error?.message ?? error)}（ENG-031 D）` };
  }
}

/** (E) format 拒绝方向——不能解码的格式必须被拒绝，不得尝试升级或宽松解码。 */
function runE(dir) {
  const item = "E";
  try {
    const foreignPath = join(dir, "e-foreign.jsonl");
    injectForeignFormat(foreignPath);
    let errorName = "";
    let frames;
    try {
      frames = readContractFrames(foreignPath);
    } catch (error) {
      errorName = String(error?.name ?? "");
    }
    if (errorName !== "SESSION_FORMAT_UNSUPPORTED") {
      return { item, ok: false, detail: `(E) 断言1：外来格式必须被拒绝（SESSION_FORMAT_UNSUPPORTED），got ${errorName || "静默返回帧"}（ENG-031 E：不得尝试升级或宽松解码）` };
    }
    if (frames !== undefined) {
      return { item, ok: false, detail: "(E) 断言2：拒绝方向不得返回任何帧（ENG-031 E）" };
    }
    return { item, ok: true, detail: "(E) format 拒绝方向：外来 magic 被拒绝（SESSION_FORMAT_UNSUPPORTED），零帧返回" };
  } catch (error) {
    return { item, ok: false, detail: `(E) 未预期异常：${String(error?.message ?? error)}（ENG-031 E）` };
  }
}

/** (F) flush 即物化空会话——空会话 `flush` 后对其他进程可 `list`/`open`。 */
function runF(dir) {
  const item = "F";
  try {
    const empty = createContractHandle(dir, "f-empty");
    empty.close(); // 空会话（零帧）close 即 flush 物化
    const paths = sessionPaths(dir, "f-empty");
    const manifest = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
    if (!(manifest.sessions ?? []).includes("f-empty")) {
      return { item, ok: false, detail: "(F) 断言1：空会话 flush 后必须进入 manifest（对其他进程可 list）（ENG-031 F）" };
    }
    // open = 其他进程新建句柄实例读取同一会话。
    const reopened = createDevJsonl({ dir, sessionId: "f-empty" });
    const frames = readContractFrames(reopened.path);
    if (frames.length !== 0) {
      return { item, ok: false, detail: `(F) 断言2：空会话 open 后必须可读且为 0 帧，got ${frames.length}（ENG-031 F）` };
    }
    return { item, ok: true, detail: "(F) flush 即物化空会话：manifest 可 list、新进程 open 可读（0 帧）" };
  } catch (error) {
    return { item, ok: false, detail: `(F) 未预期异常：${String(error?.message ?? error)}（ENG-031 F）` };
  }
}
