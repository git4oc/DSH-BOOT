/**
 * 混版检测（`ENG-035` 判据③ / `ENG-028`：fleet 只有一个 `trainVersion`，`C33`/`C34`）。
 *
 * 收集当前列车上的全部 `trainVersion` 声明（seed Profile、快照基线），
 * 集合大小必须 == 1；> 1 即混版，非零退出。
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const trains = new Set();
const sources = [];

function collect(profile) {
  if (typeof profile?.trainVersion === "string" && profile.trainVersion.length > 0) {
    trains.add(profile.trainVersion);
    sources.push(profile.trainVersion);
  }
  const trainVersion = profile?.trainVersion;
  if (Array.isArray(trainVersion)) {
    for (const version of trainVersion) {
      trains.add(String(version));
      sources.push(String(version));
    }
  }
  if (Array.isArray(profile?.pluginSet)) {
    for (const p of profile.pluginSet) {
      if (typeof p?.version === "string" && p.version.length > 0) {
        trains.add(p.version);
        sources.push(p.version);
      }
    }
  }
}

// ① seed Profile（当前列车声明）。
const seedPath = join(root, "dev", "seed", "profile.json");
if (existsSync(seedPath)) {
  collect(JSON.parse(readFileSync(seedPath, "utf8")));
}

// ② 快照基线（`snapshots/<train>.api.json` 的 train 字段）。
const snapshotsDir = join(root, "snapshots");
if (existsSync(snapshotsDir)) {
  for (const file of readdirSync(snapshotsDir)) {
    if (file.endsWith(".api.json")) {
      const snapshot = JSON.parse(readFileSync(join(snapshotsDir, file), "utf8"));
      if (typeof snapshot.train === "string" && snapshot.train.length > 0) {
        trains.add(snapshot.train);
        sources.push(snapshot.train);
      }
    }
  }
}

export function collectMixedVersions() {
  return { trains: [...trains], count: trains.size };
}

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isEntry) {
  const mixedVersions = Math.max(0, trains.size - 1);
  console.log(`mixedVersions=${mixedVersions}（声明 ${sources.length} 处 / 去重 ${trains.size} 种）`);
  if (trains.size > 1) {
    console.error(`混版：fleet 存在多个 trainVersion（${[...trains].join(" | ")}）——ENG-035 判据③ / C33`);
    process.exit(1);
  }
  process.exit(0);
}
