/**
 * A–F 契约测试的 `node --test` 入口（`ENG-031` 判据④：套件必须能在 `node --test`
 * 与 CI 两处运行）。测试名按 A–F 分列 6 项（判据①）；逐项失败信息点名 A–F 中的
 * 哪一项与哪条断言（判据②）。
 */

import test from "node:test";
import { runAF } from "./a2f.mjs";

const results = runAF();
const labels = { A: "(A) 撕裂尾", B: "(B) 单写者", C: "(C) closed handle", D: "(D) freshness", E: "(E) format 拒绝方向", F: "(F) flush 即物化空会话" };

for (const result of results) {
  test(`${labels[result.item]} — ${result.ok ? "通过" : "失败"}`, () => {
    if (!result.ok) {
      throw new Error(result.detail);
    }
  });
}
