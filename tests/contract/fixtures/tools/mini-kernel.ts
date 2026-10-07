/**
 * 契约测试夹具：mini-kernel（内核形状，P0-A2 工具注册桥契约测试）。
 *
 * 语义逐条来自 `VER-001` 的内核实证结论（`docs/bridge-defense-in-depth.md`）：
 * - `register` 是唯一插入入口（`tools.insert` 仅存在于内核 register 内）；
 * - 全局上下文调用 restrict **直接抛错**（`C51`，dsh-tools/lib/index.js:2897）；
 * - plain-context guard 全局生效、**覆盖 scoped 注册**（index.js:2913），
 *   派发期按最终工具名判定、只否、单调（index.d.ts:515-521）；
 * - scoped 上下文的 register/restrict 合法（scoped 注册路径可绕过桥）。
 * 真实内核验证在 `GATE-002` 条件 2 出口随域构建实测（`E-04`/`E-05`）。
 */

import type { ToolDefinition, ToolGuard } from "../../../../packages/domain-bridge/src/tools.ts";

export interface MiniKernelToolDefinition extends ToolDefinition {
  run: (args: Readonly<Record<string, unknown>>) => unknown;
}

export interface MiniKernelDispatchResult {
  readonly denied: boolean;
  readonly reason?: string;
  readonly found: boolean;
  readonly called: boolean;
  readonly output?: unknown;
}

export interface MiniKernel {
  /** 全局上下文（桥安装 guard 的位置）。 */
  global: {
    register(definition: MiniKernelToolDefinition): () => void;
    guard(guard: ToolGuard): () => void;
    restrict(): never;
  };
  /** scoped 上下文（scoped 注册路径：可绕过桥直接 register/restrict）。 */
  scoped: {
    register(definition: MiniKernelToolDefinition): () => void;
    restrict(filter: { readonly deny?: readonly string[] }): () => void;
  };
  /** 派发：守卫按序求值（只否、单调），随后执行已注册工具。 */
  dispatch(toolName: string, args?: Readonly<Record<string, unknown>>): MiniKernelDispatchResult;
  /** 模型可见集 = 注册表键集（`ENG-003` 判据①的工具集断言）。 */
  visibleTools(): readonly string[];
  scopedRestrictions: readonly string[];
}

export function createMiniKernel(): MiniKernel {
  const registry = new Map<string, MiniKernelToolDefinition>();
  const guards: ToolGuard[] = [];
  const restrictions: string[] = [];

  const insert = (definition: MiniKernelToolDefinition): () => void => {
    registry.set(definition.name, definition);
    return () => registry.delete(definition.name);
  };

  const global = {
    register(definition: MiniKernelToolDefinition): () => void {
      return insert(definition);
    },
    guard(guard: ToolGuard): () => void {
      guards.push(guard);
      return () => {
        const index = guards.indexOf(guard);
        if (index >= 0) guards.splice(index, 1);
      };
    },
    restrict(): never {
      // `C51`：全局上下文调用 restrict 直接抛错（VER-001，index.js:2897）。
      throw new Error("restrict is scoped-only; plain-context restriction is forbidden");
    },
  };

  const scoped = {
    register(definition: MiniKernelToolDefinition): () => void {
      return insert(definition);
    },
    restrict(filter: { readonly deny?: readonly string[] }): () => void {
      for (const name of filter.deny ?? []) restrictions.push(name);
      return () => undefined;
    },
  };

  return {
    global,
    scoped,
    dispatch(toolName: string, args: Readonly<Record<string, unknown>> = {}): MiniKernelDispatchResult {
      for (const guard of guards) {
        const reason = guard({ toolName });
        if (reason !== undefined) return { denied: true, reason, found: false, called: false };
      }
      const definition = registry.get(toolName);
      if (!definition) return { denied: false, reason: undefined, found: false, called: false };
      return { denied: false, found: true, called: true, output: definition.run(args) };
    },
    visibleTools(): readonly string[] {
      return [...registry.keys()];
    },
    scopedRestrictions: restrictions,
  };
}
