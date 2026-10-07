# dev — 本地最小拓扑（P-1，`GATE-001`）

`ENG-042`：单域 + 反向网关桩 + 内存 attest + 种子 Profile + 本地对象存储替身（目录）。
P-1 阶段域镜像尚未构建（`apps/domain` 的入口在 P0-A4 落地），拓扑执行由等价脚本承载
（`ENG-042` 允许「dev/compose.yml（或等价脚本）」）；`compose.yml` 为声明形式，
域镜像就绪后换绑，桩契约不变。

## 命令

```bash
pnpm dev:up      # 起反向网关桩（含内存 attest）+ 种子 Profile + 对象存储目录（分离进程）
pnpm dev:smoke   # 一轮 turn.started → message.delta → turn.completed 事件序断言
pnpm dev:down    # 停止拓扑
pnpm gate:001    # ENG-047 单命令：up → 桩/attest 自检 → smoke → 逃生门双向断言 → 生产态拒绝 "*"
pnpm fixtures:selftest   # 8 个测试注入器的独立用例（ENG-046）
```

## 拓扑

| 组件 | 位置 | 说明 |
|---|---|---|
| 反向网关桩 | `packages/reverse-gateway/src/stub/`（`ENG-043`） | 设计 §6.3 全部 10 个端点 + 故障旋钮 + 缺归因头 400 |
| 内存 attest 桩 | 同上 `attest.ts`（`ENG-044`） | 四值响应 accept/deny/resync-profile/drain-domain + 降级级别；detective 定性（`D15`） |
| 种子 Profile | `dev/seed/profile.json` | dev 态（`toolAllowlist: ["*"]` 逃生门，`ENG-045`） |
| 对象存储替身 | `dev/object-store/`（目录） | 本地目录即替身 |
| 轮次执行器 | `dev/turn-harness.mjs` | attest → resolve-model → prepare-call → stream → 审批 → usage/egress/skills |

## 故障旋钮（`ENG-043` 判据②）

经 `POST /__knobs` 下发（`POST /__reset` 复位）：

| 旋钮 | 触发路径 |
|---|---|
| `ttfbMs` | 模型流首字节延迟 → `T_m` |
| `streamMode: aborted / adapter-error` | 显式终止帧 → 轮次中断 |
| `approvalNoResponse` | 审批挂起 → `T_a` |
| `unreachable: [端点前缀]` | 端点不可达 → 503 |

## 归因头（`ENG-008`）

桩要求每个 `/internal/*` 请求携带 `x-ov-turn-id` 与 `x-ov-attribution`，缺任一返回 400。
P0-A2 落地后，头名集合接内核 `attributionHeaders()` 的真实输出（`StubOptions.attributionHeaderNames`）。
