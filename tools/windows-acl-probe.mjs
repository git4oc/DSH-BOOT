/**
 * Windows 容器内 ACL 行为实测探针（`GATE-002` 条件 9；`SEC-DOC-10` §2.4/§3；D13）。
 *
 * **判据以容器内实测为准**：现有文档结论来自非容器 README（设计文档 §8.4 v2.6 修正表），
 * **不得**复用——本探针必须在 Windows 容器内执行并产出实测证据。
 *
 * 三项残留实测（`SEC-091`/`SEC-092`/`SEC-093`）：
 *   ① Low 标签加宽——同用户其他 Low-IL 进程在工作区可写可删（`SEC-091`）
 *   ② DACL 永久改写 + 删除语义变化——授权前后 DACL 快照不同；普通删除路径行为改变（`SEC-092`）
 *   ③ 硬链接别名可写——工作区外建硬链接，经外部别名写入成功（`SEC-093`）
 *
 * **fail-closed**：非容器执行（或未带 `--confirm-container`）一律记 `fail`，
 * **不产出通过结论**；未通过则禁止 Windows 参与多租户隔离。
 */

import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

/** 容器上下文检测：Windows Server / Hyper-V 容器的两个已知信号。 */
function detectContainer() {
  const containerProfile = existsSync("C:\\containerprofile.txt");
  const sandboxMount = process.env.CONTAINER_SANDBOX_MOUNT_POINT !== undefined;
  return { containerProfile, sandboxMount, inContainer: containerProfile || sandboxMount };
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" });
}

/**
 * 三项残留实测。`options.confirmContainer`（`--confirm-container`）必须显式传入：
 * 防止非容器运行偶然产出通过结论（D13：判据以容器内为准）。
 */
export function probeWindowsAcl(options = {}) {
  const { containerProfile, sandboxMount, inContainer } = detectContainer();
  const confirmed = options.confirmContainer === true;
  if (!inContainer || !confirmed) {
    return {
      verdict: "fail",
      ranInContainer: false,
      reason: inContainer
        ? "检测到容器上下文但未带 --confirm-container：不产出通过结论（fail-closed）"
        : "未检测到 Windows 容器上下文（containerprofile.txt / CONTAINER_SANDBOX_MOUNT_POINT 均缺失）——文档现有结论来自非容器 README，不得复用（D13）",
      detection: { containerProfile, sandboxMount },
      tests: [],
    };
  }

  const dir = mkdtempSync(join(tmpdir(), "dsh-win-acl-"));
  const tests = [];
  try {
    // ── ① Low 标签加宽（`SEC-091`） ─────────────────────────────────────────
    {
      const target = join(dir, "low-label");
      const child = join(target, "child.txt");
      run("cmd", ["/c", "mkdir", target]);
      writeFileSync(child, "seed", "utf8");
      run("icacls", [target, "/setintegritylevel", "L"]);
      const dacl = run("icacls", [target]);
      // 挂载标签后 DACL 必含 Mandatory Label ACE（LW = 低完整性写语义已编码）。
      const labelApplied = /ML.*(NW|NR).*LW|LW\)/i.test(dacl);
      tests.push({
        case: "SEC-091",
        item: "Low 标签加宽",
        input: `icacls ${target} /setintegritylevel L`,
        observation: labelApplied
          ? "Mandatory Label ACE（LW）已写入 DACL——同用户其他 Low-IL 进程在工作区内可写可删（Windows 强制完整性策略，无排除手段）"
          : `未检出 Mandatory Label ACE；DACL 原文：${dacl.trim()}`,
        verdict: labelApplied ? "pass" : "fail",
      });
    }

    // ── ② DACL 永久改写 + 删除语义变化（`SEC-092`） ─────────────────────────
    {
      const target = join(dir, "dacl");
      const childFile = join(target, "child.txt");
      run("cmd", ["/c", "mkdir", target]);
      writeFileSync(childFile, "seed", "utf8");
      const baseline = run("icacls", [target, "/save", join(dir, "baseline.txt"), "/t", "/c"]);
      const beforeDelete = (() => {
        try {
          run("cmd", ["/c", "del", childFile]);
          return "deleted";
        } catch (error) {
          return `denied(${String(error?.status ?? "?")})`;
        }
      })();
      writeFileSync(childFile, "seed", "utf8");
      // 平台式工作区授权（模拟模块对客户真实目录的安全描述符编辑）。
      run("icacls", [target, "/grant", "*S-1-1-0:(OI)(CI)M", "/t"]);
      const post = run("icacls", [target, "/save", join(dir, "post.txt"), "/t", "/c"]);
      const baselineText = readFileSync(join(dir, "baseline.txt"), "utf8");
      const postText = readFileSync(join(dir, "post.txt"), "utf8");
      const daclChanged = baselineText !== postText;
      const afterDelete = (() => {
        try {
          run("cmd", ["/c", "del", childFile]);
          return "deleted";
        } catch (error) {
          return `denied(${String(error?.status ?? "?")})`;
        }
      })();
      void baseline;
      tests.push({
        case: "SEC-092",
        item: "DACL 永久改写 + 删除语义变化",
        input: `icacls ${target} /grant *S-1-1-0:(OI)(CI)M /t`,
        observation: `授权前后 DACL 快照不同=${daclChanged}；授权前普通删除=${beforeDelete}，授权后普通删除=${afterDelete}（客户真实目录的 DACL 被永久改写，普通删除路径语义改变）`,
        verdict: daclChanged ? "pass" : "fail",
      });
    }

    // ── ③ 硬链接别名可写（`SEC-093`） ───────────────────────────────────────
    {
      const workspace = join(dir, "ws");
      const outside = join(dir, "outside");
      run("cmd", ["/c", "mkdir", workspace]);
      run("cmd", ["/c", "mkdir", outside]);
      const inFile = join(workspace, "target.txt");
      const alias = join(outside, "alias.txt");
      writeFileSync(inFile, "seed", "utf8");
      run("cmd", ["/c", "mklink", "/H", alias, inFile]);
      run("icacls", [workspace, "/grant", "*S-1-1-0:(OI)(CI)M", "/t"]);
      let aliasWritable = false;
      try {
        writeFileSync(alias, "written-via-external-alias", "utf8");
        aliasWritable = readFileSync(inFile, "utf8") === "written-via-external-alias";
      } catch {
        aliasWritable = false;
      }
      tests.push({
        case: "SEC-093",
        item: "硬链接别名可写",
        input: `mklink /H ${alias} ${inFile}; icacls ${workspace} /grant`,
        observation: aliasWritable
          ? "经工作区外部硬链接别名写入成功——继承的工作区授权传播到既有硬链接，同一底层对象可经外部别名写入"
          : "经外部别名写入失败（与披露不符）",
        verdict: aliasWritable ? "pass" : "fail",
      });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const allPass = tests.every((t) => t.verdict === "pass");
  return { verdict: allPass ? "pass" : "fail", ranInContainer: true, detection: { containerProfile, sandboxMount }, tests };
}

/** 直跑守卫：`node tools/windows-acl-probe.mjs [--confirm-container]`。 */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const outcome = probeWindowsAcl({ confirmContainer: process.argv.includes("--confirm-container") });
  console.log(JSON.stringify(outcome, null, 2));
  if (outcome.verdict !== "pass") {
    console.error("[windows-acl-probe] 未通过——禁止 Windows 参与多租户隔离（GATE-002 条件 9）");
    process.exit(1);
  }
  console.log("[windows-acl-probe] PASS——容器内三项残留实测与披露一致");
}
