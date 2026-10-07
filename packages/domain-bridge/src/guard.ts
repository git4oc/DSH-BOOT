/**
 * 反转面 2 纵深防御：全局 `guard()` 安装（`ENG-004`；`SEC-DOC-03` 覆盖项 `SEC-029`/`SEC-019`）。
 *
 * 在**宿主上下文**一次性安装（`VER-001` §3.3 已定论：plain-context guard 全局生效，
 * **覆盖 scoped 注册**；派发期按最终工具名判定、只否、单调）。内核 restrict 在全局上下文
 * 调用会**直接抛错**且不覆盖 scoped 注册——本桥**不得**调用它（`C51`；`ENG-004` 判据④）。
 * 两道防线互相独立：主防线（registerTool）管可见性，本 guard 管执行期兜底
 * （`VER-002` §6：覆盖 PTC run_code 内调用、子代理、嵌套派发）。
 */

import type { ToolGuard } from "./tools.ts";
import type { ClientContext } from "./register.ts";

/**
 * 宿主上下文一次性安装全局守卫（`ENG-004` 判据①）：
 * 对 `toolName ∉ toolAllowlist` 返回拒绝理由（只否，无 allow 结果——后安装者无法翻盘）。
 * 返回内核 disposer 原样透传（`CTR-001` C-4），由域生命周期持有。
 */
export function installGuard(ctx: ClientContext, allowlist: readonly string[] | undefined): () => void {
  const guard: ToolGuard = (execution) => {
    const allowed = !!allowlist && allowlist.length > 0 &&
      (allowlist.includes(execution.toolName) || allowlist.includes("*"));
    if (!allowed) {
      return `tool not in toolAllowlist: ${execution.toolName}（纵深防御，SEC-029）`;
    }
    return undefined; // 放行（guard 只否，无 allow 结果）
  };
  return ctx.tools.guard(guard); // 内核 disposer 原样透传（`CTR-001` C-4）
}
