/**
 * 夹具 D（`ENG-046`）：freshness 违例探测——写批 + flush 后启动的读必须至少看到该前缀。
 * 返回探测结果；`sawPrefix === false` 即 freshness 违例（`ENG-018` 的失败条件）。
 */

export interface FreshnessProbe {
  readonly sawPrefix: boolean;
  readonly expected: number;
  readonly observed: number;
}

/** 最小读形状：返回帧数组（与基底无关）。 */
export function probeFreshness(
  expected: number,
  readAfterFlush: () => readonly unknown[],
): FreshnessProbe {
  const observed = readAfterFlush().length;
  return { sawPrefix: observed >= expected, expected, observed };
}
