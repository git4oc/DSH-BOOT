/**
 * `@dsh-boot/reverse-gateway` — 反向 I/O 端点与桩共用的接口定义与实现（`ENG-020`）。
 * 依赖方向：只允许依赖 `packages/protocol`（`ENG-021` / `LAYER-001` §3）。
 */
export const REVERSE_GATEWAY_ENTRY = "reverse-gateway" as const;
