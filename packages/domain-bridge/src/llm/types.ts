/**
 * 反转面 1 契约类型（`CTR-001` §2；`ENG-005` / `ENG-006`）。
 *
 * 签名来源：`dsh-llm/lib/types/index.d.ts` 的内核实证形状（`CTR-001` §2.2）。
 * wire 类型（`LlmStreamChunk` / `ModelRef` / `RetryPolicy`）自 `@dsh-boot/protocol` 引入。
 * 抽象基类**只有 `stream()` 是 abstract**；其余六个方法虽有内核默认实现，
 * 但本方案要求必须实现（`ENG-005`：`GET /v1/llm/providers` 依赖，不得以空目录交付）。
 */

import type { LlmGenerateOptions, LlmStreamChunk, ModelRef, RetryPolicy } from "@dsh-boot/protocol";

/** 内核 `GenerateOptions` 透传形状（`ENG-007`：逐字段保真转发，不得重组）。 */
export type GenerateOptions = LlmGenerateOptions;

/** 下行分片：逐 chunk 透传 + 显式终止帧（设计 §6.3 流式契约）。 */
export type StreamChunk = LlmStreamChunk;

export type { ModelRef, RetryPolicy };

/** Provider 元数据（`ENG-005` 判据①：`providerInfo(p).id === p`）。 */
export interface ProviderInfo {
  readonly id: string;
  readonly name: string;
}

/** 结构化模型元数据（`ENG-005` 判据①：非空或显式声明无模型）。 */
export interface ModelInfo {
  readonly provider: string;
  readonly model: string;
  readonly contextWindow: number;
}

/** 图像请求计价（可选能力；不适用的 provider 显式返回 undefined）。 */
export interface ImagePricing {
  readonly currency: string;
  readonly perImage: number;
}

/** 调用配置（`prepareCall` 的输入；与 `PreparedLlmCall.config` 一致性由适配器自检）。 */
export interface CallConfig {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly [key: string]: unknown;
}

/**
 * `prepareCall` 的产物：适配器**必须**用它自己派发（`ENG-006`：
 * 不得绕过它另起 `stream()`，否则 `INVALID_PREPARED_CALL` 或代数混用）。
 */
export interface PreparedLlmCall {
  readonly provider: string;
  readonly model: string;
  readonly callId: string;
  readonly config: CallConfig;
  /** 派发入口：消费 `GenerateOptions` 并产出 chunk（显式终止帧收尾）。 */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}

/** 注册句柄：由域生命周期持有，域销毁时释放（`CTR-001` §2.6，不得热替换）。 */
export interface AdapterRegistrationHandle {
  readonly providers: readonly string[];
  dispose(): void;
}

/**
 * 抽象基类 —— 只有 `stream()` 是 abstract（`CTR-001` §2.2 内核实证）。
 * `attributionHeaders` **不是**本类的方法：它是模块级函数（`ENG-008` 判据③）。
 */
export abstract class LlmAdapter {
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>;

  providerInfo(provider: string): ProviderInfo {
    return { id: provider, name: provider };
  }

  listModels(provider: string): Promise<ModelInfo[]> {
    void provider;
    return Promise.resolve([]);
  }

  resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<ModelRef> {
    void provider;
    void model;
    void signal;
    throw new Error("not implemented");
  }

  providerRetryPolicy(provider: string): RetryPolicy {
    void provider;
    return { retryableCodes: [], maxAttempts: 1, backoffMs: [] };
  }

  imageRequestPricing(provider: string): ImagePricing | undefined {
    void provider;
    return undefined;
  }

  prepareCall(provider: string, model: string, config: CallConfig): PreparedLlmCall {
    void provider;
    void model;
    void config;
    throw new Error("not implemented");
  }
}

/** `resolve-model` 失败：fail-closed，不返回缓存或默认值（`CTR-001` §2.5 / `ENG-008`）。 */
export class ResolveModelFailedError extends Error {
  readonly name = "RESOLVE_MODEL_FAILED";
  constructor(message: string) {
    super(message);
  }
}

/** `prepare-call` 失败：fail-closed（`CTR-001` §2.5）。 */
export class PrepareCallFailedError extends Error {
  readonly name = "PREPARE_CALL_FAILED";
  constructor(message: string) {
    super(message);
  }
}

/** 派发上下文与 `prepareCall` 产物不一致（`ENG-006`：`INVALID_PREPARED_CALL`）。 */
export class InvalidPreparedCallError extends Error {
  readonly name = "INVALID_PREPARED_CALL";
  constructor(message: string) {
    super(message);
  }
}
