/**
 * P0-A2 契约测试：工具强制两道防线 + 组合面收敛（`ENG-001`–`ENG-004`）。
 *
 * 验收项：
 *   - 负向（`ENG-003` 判据①）：受控恶意 MCP 运行中推送 1 个新工具，断言该工具永不进入可见集
 *   - 正向（`ENG-002` 判据②③）：toolAllowlist=["a"] ⇒ 可见 {a}；=[] ⇒ 空集；缺省 ⇒ 空集
 *   - guard 覆盖 scoped 注册（`ENG-004` 判据② `E-05`）：移除 guard 后 scoped 注册的清单外
 *     工具可被调用；装回后被拒（证明 guard 是覆盖 scoped 注册的唯一手段）
 *   - 源码检索（`ENG-001` 判据① / `ENG-004` 判据④）：全仓 `.tools.register(` 命中数 == 1
 *     且位于 packages/domain-bridge/src/register.ts；宿主上下文无 `.tools.restrict(`
 *   - Profile 收敛（`SEC-DOC-03` 拦截点 4/5）与升权上限（`SEC-023`/`SEC-024`）
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createFakeMcp } from "../../fixtures/tools/mcp-mutation.ts";
import { createMiniKernel } from "../../fixtures/tools/mini-kernel.ts";
import {
  installToolBridge,
  convergeProfileSecurity,
  resolveSandboxPermissions,
} from "../../../../packages/domain-bridge/src/register.ts";
import { BridgeTelemetry } from "../../../../packages/domain-bridge/src/tools.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");
const results = [];
const record = (name, verdict, detail) => results.push({ name, verdict, detail });

/** Profile 安全字段收敛样例（通过校验）。 */
function convergedProfile(allowlist) {
  return {
    toolAllowlist: allowlist,
    removedRows: ["tool-plugin-manager", "plugin-manager"],
    hmr: { enabled: false },
    sandboxMode: "read-only",
    sandboxModeCeiling: "workspace-write",
    permissionPresets: { reachable: ["dev-preset"] },
  };
}

function walkSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSourceFiles(full));
    else if (/\.(ts|mjs|json)$/.test(entry.name) && statSync(full).isFile()) out.push(full);
  }
  return out;
}

/** 源码检索（`ENG-001` 判据① / `ENG-004` 判据④）：packages + apps 全量。 */
function countInSource(literal) {
  let count = 0;
  const files = [];
  for (const base of ["packages", "apps"]) {
    for (const file of walkSourceFiles(join(root, base))) {
      const hits = readFileSync(file, "utf8").split(literal).length - 1;
      if (hits > 0) {
        count += hits;
        files.push(file.replace(/\\/g, "/"));
      }
    }
  }
  return { count, files };
}

async function main() {
  // ── 1. `ENG-002` 判据①：清单外不注册 + 硬审计 + disposer 无副作用 ──────────
  {
    const kernel = createMiniKernel();
    const telemetry = new BridgeTelemetry();
    const before = kernel.visibleTools().length;
    const disposer = installToolBridge({ tools: kernel.global }, convergedProfile(["a"]), telemetry)
      .registerTool({ name: "x", run: () => "x" });
    const registered = kernel.visibleTools().includes("x");
    let disposerSafe = true;
    try {
      disposer();
    } catch {
      disposerSafe = false;
    }
    const audit = telemetry.getAuditRecords();
    record(
      "BRIDGE-DENY-NOT-IN-ALLOWLIST",
      !registered && kernel.visibleTools().length === before && audit.length === 1 && disposerSafe &&
        audit[0].event === "bridge.register.denied",
      `清单外零注册=${!registered}，硬审计 1 条=${audit.length === 1}，disposer 无副作用=${disposerSafe}（ENG-002 判据①）`,
    );
  }

  // ── 2. `ENG-002` 判据②③：缺省/空数组 ⇒ 空集 + 计数器自增 ─────────────────
  {
    for (const allowlist of [undefined, []]) {
      const kernel = createMiniKernel();
      const telemetry = new BridgeTelemetry();
      const before = telemetry.bridgeRegisterDeniedTotal;
      const bridge = installToolBridge({ tools: kernel.global }, convergedProfile(allowlist), telemetry);
      bridge.registerTool({ name: "x", run: () => "x" });
      const empty = kernel.visibleTools().length === 0;
      const incremented = telemetry.bridgeRegisterDeniedTotal === before + 1;
      const label = allowlist === undefined ? "缺省" : "空数组";
      record(
        `ALLOWLIST-${allowlist === undefined ? "MISSING" : "EMPTY"}-EMPTY-SET`,
        empty && incremented,
        `toolAllowlist ${label} ⇒ 可见工具集为空集=${empty}，bridge_register_denied_total 自增=${incremented}（ENG-002 判据②③）`,
      );
    }
  }

  // ── 3. 正向：toolAllowlist=["a"] ⇒ 可见 {a} ──────────────────────────────
  {
    const kernel = createMiniKernel();
    const telemetry = new BridgeTelemetry();
    const bridge = installToolBridge({ tools: kernel.global }, convergedProfile(["a"]), telemetry);
    bridge.registerTool({ name: "a", run: () => "ok" });
    bridge.registerTool({ name: "b", run: () => "b" });
    const visible = kernel.visibleTools();
    const dispatch = kernel.dispatch("a");
    record(
      "ALLOWLIST-SINGLETON",
      visible.length === 1 && visible[0] === "a" && dispatch.called && !dispatch.denied,
      `toolAllowlist=["a"] ⇒ 可见 {a}，a 可被派发=${dispatch.called}（ENG-002 正向）`,
    );
  }

  // ── 4. `ENG-003` 负向用例：受控恶意 MCP 推送新工具，永不进入可见集 ─────────
  {
    const mcp = await createFakeMcp(["mcp_tool_a"]);
    const kernel = createMiniKernel();
    const telemetry = new BridgeTelemetry();
    const bridge = installToolBridge({ tools: kernel.global }, convergedProfile(["mcp_tool_a"]), telemetry);
    const discover = async () => {
      const body = await (await fetch(mcp.url)).json();
      for (const name of body.tools) {
        bridge.registerTool({ name, rawName: name, run: () => "ok" });
      }
    };
    await discover(); // 初始发现
    const beforeMutation = kernel.visibleTools();
    mcp.pushMutation(); // 运行中推送 1 个新工具（list_changed）
    await discover(); // 重做发现，逐个过同一判定
    const afterMutation = kernel.visibleTools();
    const neverVisible = !afterMutation.includes("mcp_evil_tool");
    const initialKept =
      beforeMutation.length === 1 && beforeMutation[0] === "mcp_tool_a" && afterMutation.length === 1;
    const denied = telemetry.bridgeRegisterDeniedTotal >= 1;
    const auditRawName = telemetry.getAuditRecords().some((a) => a.rawName === "mcp_evil_tool");
    record(
      "MALICIOUS-MCP-NEGATIVE",
      neverVisible && initialKept && denied && auditRawName,
      `恶意推送的 mcp_evil_tool 永不进入可见集=${neverVisible}，既有工具保持=${initialKept}，denied_total 自增=${denied}，审计含 rawName=${auditRawName}（ENG-003 判据①）`,
    );
    await mcp.close();
  }

  // ── 5. `ENG-004` 判据②（`E-05`）：guard 覆盖 scoped 注册（移除式对照） �───
  {
    // 无 guard：scoped 注册的清单外工具可被调用（证明桥的 register 判定不覆盖 scoped 路径）。
    const bare = createMiniKernel();
    bare.scoped.register({ name: "scoped_tool", run: () => "ran" });
    const withoutGuard = bare.dispatch("scoped_tool").called;

    // 有 guard：同一 scoped 注册被拒（guard 覆盖 scoped 注册）。
    const guarded = createMiniKernel();
    const telemetry = new BridgeTelemetry();
    const bridge = installToolBridge({ tools: guarded.global }, convergedProfile(["a"]), telemetry);
    guarded.scoped.register({ name: "scoped_tool", run: () => "ran" });
    const withGuardDenied = guarded.dispatch("scoped_tool").denied;

    // 移除 guard（disposer）→ 可被调用；装回 → 被拒。
    bridge.dispose();
    const afterRemoval = guarded.dispatch("scoped_tool").called;
    const reinstall = installToolBridge({ tools: guarded.global }, convergedProfile(["a"]), telemetry);
    void reinstall;
    const afterReinstall = guarded.dispatch("scoped_tool").denied;

    record(
      "GUARD-COVERS-SCOPED",
      withoutGuard && withGuardDenied && afterRemoval && afterReinstall,
      `无 guard 可被调用=${withoutGuard}，有 guard 被拒=${withGuardDenied}，移除 guard 后可被调用=${afterRemoval}，装回后被拒=${afterReinstall}（ENG-004 判据②，证明 guard 是覆盖 scoped 注册的唯一手段）`,
    );
  }

  // ── 6. `ENG-004` 判据③（`E-06`）：可见性防线确实在桥 ─────────────────────
  {
    const kernel = createMiniKernel();
    kernel.global.register({ name: "bypass_tool", run: () => "ran" }); // 绕过桥直接注册
    const bypassVisible = kernel.visibleTools().includes("bypass_tool");
    const bridged = createMiniKernel();
    installToolBridge({ tools: bridged.global }, convergedProfile(["a"]), new BridgeTelemetry())
      .registerTool({ name: "bypass_tool", run: () => "ran" });
    const bridgedVisible = bridged.visibleTools().includes("bypass_tool");
    record(
      "VISIBILITY-LINE-IN-BRIDGE",
      bypassVisible && !bridgedVisible,
      `直接 register 可见（绕过桥）=${bypassVisible}，经桥不可见=${!bridgedVisible}（ENG-004 判据③：单独移除桥的判定则"清单外不可见"断言失败）`,
    );
  }

  // ── 7. `C51`：全局上下文调用 restrict 抛错 ────────────────────────────────
  {
    const kernel = createMiniKernel();
    let threw = false;
    try {
      kernel.global.restrict();
    } catch {
      threw = true;
    }
    record("RESTRICT-GLOBAL-THROWS", threw, `全局上下文调用内核 restrict 直接抛错=${threw}（C51 / VER-001）`);
  }

  // ── 8. Profile 收敛（`SEC-DOC-03` 拦截点 4/5） ───────────────────────────
  {
    const violations = convergeProfileSecurity({
      removedRows: ["tool-plugin-manager"],
      hmr: { enabled: true },
      sandboxMode: "workspace-write",
      sandboxModeCeiling: "read-only",
      permissionPresets: { reachable: ["danger-full-access", "never"] },
    });
    const allViolations = violations.length === 4;
    const ok = convergeProfileSecurity(convergedProfile(["a"])).length === 0;
    record(
      "PROFILE-SECURITY-CONVERGENCE",
      allViolations && ok,
      `四类违规全部检出（removedRows/hmr/permissionPresets/sandboxModeCeiling）=${allViolations}，合规 Profile 零违规=${ok}（SEC-013/SEC-014/SEC-020/SEC-021）`,
    );
  }

  // ── 9. 升权上限（`SEC-023` / `SEC-024`） ─────────────────────────────────
  {
    const exceed = resolveSandboxPermissions("workspace-write", "read-only");
    const within = resolveSandboxPermissions("read-only", "workspace-write");
    const unparseable = resolveSandboxPermissions("weird-mode", "workspace-write");
    const missing = resolveSandboxPermissions(undefined, "workspace-write");
    record(
      "SANDBOX-PERMISSIONS-CEILING",
      !exceed.allowed && within.allowed && !unparseable.allowed && !missing.allowed,
      `超上限拒绝=${!exceed.allowed}，上限内放行=${within.allowed}，无法解析 fail-closed=${!unparseable.allowed}，缺失 fail-closed=${!missing.allowed}（SEC-023/SEC-024）`,
    );
  }

  // ── 10. 源码检索（`ENG-001` 判据① / `ENG-004` 判据④） ───────────────────
  {
    const register = countInSource(".tools.register(");
    const restrict = countInSource(".tools.restrict(");
    const single = register.count === 1 && register.files[0]?.endsWith("packages/domain-bridge/src/register.ts");
    record(
      "SOURCE-CHECK-SINGLE-REGISTER",
      single,
      `全仓 .tools.register( 命中 ${register.count} 处且位于 packages/domain-bridge/src/register.ts=${single}（ENG-001 判据①）`,
    );
    record(
      "SOURCE-CHECK-NO-HOST-RESTRICT",
      restrict.count === 0,
      `宿主上下文 .tools.restrict( 命中 ${restrict.count} 处（须为 0）=${restrict.count === 0}（ENG-004 判据④）`,
    );
  }
}

try {
  await main();
} catch (error) {
  results.push({ name: "UNCAUGHT", verdict: false, detail: String(error?.stack ?? error) });
}

for (const r of results) {
  console.log(`${r.verdict ? "✓" : "✗"} ${r.name}: ${r.detail}`);
}
const failed = results.filter((r) => !r.verdict);
if (failed.length > 0) {
  console.error(`\n[contract:tools] FAIL — ${failed.length}/${results.length} 项未通过`);
  process.exit(1);
}
console.log(`\n[contract:tools] PASS — ${results.length}/${results.length} 项通过（ENG-001–004）`);
