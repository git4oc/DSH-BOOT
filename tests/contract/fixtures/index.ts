/**
 * 测试夹具与故障注入器总出口（`ENG-046`：8 个注入器，每个有独立用例）。
 *
 * 四个反转面各自的夹具可单独加载（判据②）：
 *   - persistence/：夹具 A–F（撕裂尾 / 锁被占 / 句柄关闭 / freshness / 格式不支持 / 不 flush 不可见）
 *   - llm/：模型流故障（TTFB / aborted / adapter-error）
 *   - approval/：审批不响应 / 结果覆盖
 *   - tools/：MCP 工具数突变与重连耗尽
 *   - gateway/：端点不可达
 * 单面加载：只 import 对应面目录的 index，不加载其他面（`ENG-023` 的 4 个 CI job 分别引用）。
 */

// 夹具 A–F（persistence 反转面）
export {
  injectTearTail,
  secondWriterFails,
  driveClosedHandle,
  probeFreshness,
  injectForeignFormat,
  isForeignFormat,
  createUnflushedSession,
  createDevJsonl,
} from "./persistence/index.ts";

// 夹具 7（tools 反转面）
export { createFakeMcp } from "./tools/index.ts";

// 夹具 8（gateway 反转面）
export { markEndpointsUnreachable } from "./gateway/index.ts";

// llm / approval 反转面的旋钮注入
export { streamFaultKnobs, resetKnobs } from "./llm/index.ts";
export { approvalNoResponseKnob, approvalOutcomeKnob } from "./approval/index.ts";
