/**
 * `LlmAdapter` 实现：模型调用经反向网关出域（`ENG-005`–`ENG-008`；`CTR-001` §2）。
 *
 * - 上行 `GenerateOptions` **逐字段保真转发**：深冻结对象原样透传，不重组/改名/增删（`ENG-007`）。
 * - `prepareCall` 的产物 `PreparedLlmCall` **由适配器自己用于派发**；`stream()` 内部也
 *   经 `prepareCall` 收敛，因此**不存在**"先 resolveModel 再直接 stream"的路径（`ENG-006`）。
 * - 每个 provider HTTP 请求携带模块级 `attributionHeaders()` 的返回值（`ENG-008`）。
 * - 遵守 `options.signal`：abort 在 TTFB 前生效并取消网关侧上游连接（设计 §6.3 流式契约）。
 * - `T_m` = 单次模型流**含重试总预算**，由域外单调时钟计时；`dsh-llm-retry` **不挂载**，
 *   重试由本适配器在其声明的策略与 `T_m` 预算内执行（`REL-102`）。
 * - 下行逐 chunk 透传 + 显式终止帧；`resolve-model` / `prepare-call` 失败一律 fail-closed。
 */

import type { ModelRef, RetryPolicy } from "@dsh-boot/protocol";
import { attributionHeaders } from "./attribution.ts";
import {
  InvalidPreparedCallError,
  LlmAdapter,
  PrepareCallFailedError,
  ResolveModelFailedError,
} from "./types.ts";
import type {
  CallConfig,
  GenerateOptions,
  ImagePricing,
  ModelInfo,
  PreparedLlmCall,
  ProviderInfo,
  StreamChunk,
} from "./types.ts";

/**
 * `dsh-llm-retry` **不挂载**的显式声明（`REL-102`：必须声明是否挂载）。
 * 重试由本适配器在其声明的 `providerRetryPolicy` 与 `T_m` 总预算内执行。
 */
export const DSH_LLM_RETRY_MOUNTED = false;

const PROTOCOL_VERSION = "1.0";

export interface GatewayLlmAdapterOptions {
  /** 反向网关基地址（dev 桩或生产网关）。 */
  gatewayBaseUrl: string;
  /** `T_m`：单次模型流**含重试总预算**（秒，`REL-102`）。 */
  modelStreamSeconds: number;
  /** `listModels` 的目录缓存 TTL（毫秒；缓存等级语义，`CTR-001` §2.5）。 */
  listModelsTtlMs?: number;
  /** 单调时钟（`CTR-001` C-8）；默认 `performance.now()`。 */
  now?: () => number;
}

export class GatewayLlmAdapter extends LlmAdapter {
  private readonly gatewayBaseUrl: string;
  private readonly modelStreamSeconds: number;
  private readonly listModelsTtlMs: number;
  private readonly now: () => number;
  private modelsCache: { at: number; models: readonly ModelInfo[] } | undefined;
  private readonly retryPolicy: RetryPolicy = {
    retryableCodes: ["408", "429", "502", "503", "504"],
    maxAttempts: 8,
    backoffMs: [250, 500, 1000, 2000, 4000, 8000, 16000, 32000],
  };

  constructor(options: GatewayLlmAdapterOptions) {
    super();
    this.gatewayBaseUrl = options.gatewayBaseUrl.replace(/\/$/, "");
    this.modelStreamSeconds = options.modelStreamSeconds;
    this.listModelsTtlMs = options.listModelsTtlMs ?? 60_000;
    this.now = options.now ?? (() => performance.now());
  }

  /** `ENG-005` 判据①：`providerInfo(p).id === p`。 */
  providerInfo(provider: string): ProviderInfo {
    return { id: provider, name: provider };
  }

  /**
   * 模型目录：缓存等级语义（`CTR-001` §2.5）——目录服务不可用时用已知清单，
   * 从未取得过才失败（与 `resolve-model` 的 fail-closed 不同）。
   */
  async listModels(provider: string): Promise<ModelInfo[]> {
    const cache = this.modelsCache;
    if (cache && this.now() - cache.at < this.listModelsTtlMs) {
      return cache.models.filter((m) => m.provider === provider);
    }
    try {
      const response = await fetch(`${this.gatewayBaseUrl}/internal/kernel/llm/models`, {
        method: "POST",
        headers: { ...attributionHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, provider }),
      });
      if (!response.ok) throw new Error(`gateway ${response.status}`);
      const body = (await response.json()) as { models?: ModelInfo[] };
      const models = body.models ?? [];
      this.modelsCache = { at: this.now(), models };
      return models.filter((m) => m.provider === provider);
    } catch (error) {
      if (cache) return cache.models.filter((m) => m.provider === provider); // 缓存等级
      throw new ResolveModelFailedError(`模型目录不可用且无已知清单：${String(error)}`);
    }
  }

  /** 模型解析：fail-closed——失败抛错，**不得**返回缓存或默认值（`CTR-001` §2.5）。 */
  async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<ModelRef> {
    let response: Response;
    try {
      response = await fetch(`${this.gatewayBaseUrl}/internal/kernel/llm/resolve-model`, {
        method: "POST",
        headers: { ...attributionHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, provider, model }),
        signal,
      });
    } catch (error) {
      throw new ResolveModelFailedError(`resolve-model 通道不可达：${String(error)}`);
    }
    if (!response.ok) {
      throw new ResolveModelFailedError(`resolve-model 失败（gateway ${response.status}）`);
    }
    const body = (await response.json()) as { provider?: string; model?: string; contextWindow?: number };
    if (!body.provider || !body.model || typeof body.contextWindow !== "number") {
      throw new ResolveModelFailedError("resolve-model 响应缺字段");
    }
    return { provider: body.provider, model: body.model, contextWindow: body.contextWindow };
  }

  /** 重试策略声明（`REL-102`：dsh-llm-retry 不挂载，由本适配器在 `T_m` 预算内执行）。 */
  providerRetryPolicy(provider: string): RetryPolicy {
    void provider;
    return this.retryPolicy;
  }

  /** 图像计价：stub provider 不适用，显式返回 undefined（`ENG-006`）。 */
  imageRequestPricing(provider: string): ImagePricing | undefined {
    void provider;
    return undefined;
  }

  /**
   * 调用准备（内核签名同步）：发起 `/prepare-call` 出站（不阻塞返回），
   * `PreparedLlmCall.stream` 在派发前收敛其结果——失败即 fail-closed 终结，
   * **不得**回退默认 `callId` 或缓存（`ENG-006` / `CTR-001` §2.5）。
   */
  prepareCall(provider: string, model: string, config: CallConfig): PreparedLlmCall {
    const preparePromise = this.postPrepareCall(provider, model, config);
    // 派发路径抛错（如 INVALID_PREPARED_CALL）或调用方不消费时，防止未处理拒绝；
    // dispatch 仍会 await 原始 promise 并 fail-closed。
    preparePromise.catch(() => {});
    const adapter = this;
    const prepared: PreparedLlmCall = {
      provider,
      model,
      get callId(): string {
        // callId 在 prepare-call 响应到达前未知；派发前由 stream 消费。
        return `${provider}:${model}`;
      },
      config,
      stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        return adapter.dispatch(prepared, options, preparePromise);
      },
    };
    return prepared;
  }

  /**
   * 抽象方法实现：**内部经 `prepareCall` 收敛**——所有派发都流经
   * `PreparedLlmCall`，因此不存在"先 resolveModel 再直接 stream"的路径（`ENG-006` 判据③）。
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const config: CallConfig = {
      temperature: options.temperature as number | undefined,
      maxTokens: options.maxTokens as number | undefined,
    };
    return this.prepareCall(options.provider as string, options.model as string, config).stream(options);
  }

  /** 派发核心：`T_m` 自持预算 + 重试 + signal 遵守 + 逐 chunk 透传 + 显式终止帧。 */
  private async *dispatch(
    prepared: PreparedLlmCall,
    options: GenerateOptions,
    preparePromise: Promise<{ callId: string }>,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    // 派发上下文一致性自检（`ENG-006`：`INVALID_PREPARED_CALL`）。
    if (options.provider !== prepared.provider || options.model !== prepared.model) {
      throw new InvalidPreparedCallError(
        `GenerateOptions(${String(options.provider)}/${String(options.model)}) 与 PreparedLlmCall(${prepared.provider}/${prepared.model}) 不一致`,
      );
    }

    const t_m_ms = this.modelStreamSeconds * 1000;
    const deadline = this.now() + t_m_ms;
    const controller = new AbortController();
    let abortKind: "aborted" | "timeout" | undefined;
    const externalSignal = options.signal as AbortSignal | undefined;
    const onExternalAbort = () => {
      abortKind = "aborted";
      controller.abort();
    };
    if (externalSignal) {
      if (externalSignal.aborted) {
        yield { kind: "done", reason: "aborted" as const };
        return;
      }
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timer = setTimeout(
      () => {
        abortKind = "timeout";
        controller.abort();
      },
      Math.max(0, deadline - this.now()),
    );

    try {
      // prepare-call 收敛（fail-closed：失败即显式 adapter-error 终结，无默认值）。
      let callId: string;
      try {
        callId = (await preparePromise).callId;
      } catch (error) {
        void error; // PrepareCallFailedError：fail-closed，不回退默认值
        yield { kind: "done", reason: "adapter-error" as const };
        return;
      }

      let attempt = 0;
      while (true) {
        if (controller.signal.aborted) {
          yield { kind: "done", reason: (abortKind === "timeout" ? "adapter-error" : "aborted") as "aborted" | "adapter-error" };
          return;
        }
        attempt++;
        let response: Response;
        try {
          // 上行：深冻结 `options` **原样透传**（`ENG-007`），不重组/改名/增删。
          response = await fetch(`${this.gatewayBaseUrl}/internal/kernel/llm/stream`, {
            method: "POST",
            headers: { ...attributionHeaders(), "content-type": "application/json" },
            body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, callId, options }),
            signal: controller.signal,
          });
        } catch {
          // fetch 中止 = 外部 abort 或 `T_m` 到期（网关侧上游连接已被取消）；
          // 纯网络失败（非 abort）= 反向网关不可达 → fail-closed 立即终结（`CTR-001` C-1）。
          if (!controller.signal.aborted) {
            yield { kind: "done", reason: "adapter-error" as const };
            return;
          }
          yield {
            kind: "done",
            reason: (abortKind === "timeout" ? "adapter-error" : "aborted") as "aborted" | "adapter-error",
          };
          return;
        }

        if (!response.ok) {
          const retryable = this.retryPolicy.retryableCodes.includes(String(response.status));
          if (retryable && this.now() < deadline) {
            await this.backoffSleep(attempt, deadline, controller);
            continue;
          }
          // 非重试态或 `T_m` 预算耗尽：fail-closed 终结（不得伪装成正常结束）。
          yield { kind: "done", reason: "adapter-error" as const };
          return;
        }

        // 下行：逐 chunk 透传（无界缓冲禁止——直接从 reader 产出）。
        try {
          for await (const frame of this.readFrames(response)) {
            yield frame;
            if (frame.kind === "done") return;
          }
          // 连接在终止帧前中断：显式补终止帧（不得伪装成正常结束）。
          yield { kind: "done", reason: "adapter-error" as const };
          return;
        } catch (error) {
          // 定性方向固定：外部 abort ⇒ aborted；`T_m` 到期 ⇒ adapter-error；
          // **其余**（网关输出坏帧等非 abort 失败）⇒ adapter-error——不得把损坏伪装成用户取消
          //（与上方 fetch 阶段同方向，`CTR-001` §2.5 错误语义）。
          if (controller.signal.aborted) {
            yield {
              kind: "done",
              reason: (abortKind === "timeout" ? "adapter-error" : "aborted") as "aborted" | "adapter-error",
            };
            return;
          }
          void error;
          yield { kind: "done", reason: "adapter-error" as const };
          return;
        }
      }
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  /** ndjson 帧读取：逐行解析、透传，不做缓冲聚合。 */
  private async *readFrames(response: Response): AsyncGenerator<StreamChunk, void, unknown> {
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line.length > 0) yield JSON.parse(line) as StreamChunk;
          newline = buffer.indexOf("\n");
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** 退避等待：受 `T_m` 预算与 abort 双重约束——不突破预算、不被 abort 卡住。 */
  private async backoffSleep(attempt: number, deadline: number, controller: AbortController): Promise<void> {
    const schedule = this.retryPolicy.backoffMs;
    const raw = schedule[Math.min(attempt - 1, schedule.length - 1)] ?? 250;
    const bounded = Math.min(raw, Math.max(0, deadline - this.now()));
    if (bounded <= 0) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, bounded);
      controller.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }

  /** `/prepare-call` 出站：失败抛 `PrepareCallFailedError`（fail-closed）。 */
  private async postPrepareCall(provider: string, model: string, config: CallConfig): Promise<{ callId: string }> {
    let response: Response;
    try {
      response = await fetch(`${this.gatewayBaseUrl}/internal/kernel/llm/prepare-call`, {
        method: "POST",
        headers: { ...attributionHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          options: { provider, model, config },
        }),
      });
    } catch (error) {
      throw new PrepareCallFailedError(`prepare-call 通道不可达：${String(error)}`);
    }
    if (!response.ok) {
      throw new PrepareCallFailedError(`prepare-call 失败（gateway ${response.status}）`);
    }
    const body = (await response.json()) as { prepared?: boolean; callId?: string };
    if (body.prepared !== true || !body.callId) {
      throw new PrepareCallFailedError("prepare-call 响应缺 prepared/callId");
    }
    return { callId: body.callId };
  }
}
