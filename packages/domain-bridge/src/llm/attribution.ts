/**
 * 归因头来源（`ENG-008`）。
 *
 * `attributionHeaders` 是**模块级函数**，不是 `LlmAdapter` 的方法——
 * 源码检查禁止 `this.attributionHeaders` 形式（`ENG-008` 判据③）。
 * P0-A2 落地后，本模块接内核 `@deepseek-ai/dsh-llm` 的具名导出
 * `attributionHeaders()` 的真实输出（`CTR-001` §2.2 易错点）；
 * 当前以域侧轮次上下文为来源（每个域外请求必须携带 `turnId`，`CTR-001` C-2）。
 */

interface TurnContext {
  readonly turnId: string;
  readonly attribution: string;
}

let currentTurn: TurnContext | undefined;

/** 轮次开始时设置当前归因上下文（由域侧轮次看护调用）。 */
export function setCurrentTurnContext(turnId: string, attribution: string): void {
  currentTurn = { turnId, attribution };
}

/** 轮次结束后清除（下次出站调用前必须重新设置，否则缺头请求会被网关以 400 拒绝）。 */
export function clearCurrentTurnContext(): void {
  currentTurn = undefined;
}

/**
 * 模块级归因头（`ENG-008`）：每个 provider HTTP 请求**必须**携带其返回值。
 * 无当前轮次上下文时返回仅含归因来源的头（turnId 缺失由网关入站校验拒绝）。
 */
export function attributionHeaders(): Record<string, string> {
  if (!currentTurn) {
    return { "x-ov-attribution": "domain-bridge" };
  }
  return {
    "x-ov-turn-id": currentTurn.turnId,
    "x-ov-attribution": currentTurn.attribution,
  };
}
