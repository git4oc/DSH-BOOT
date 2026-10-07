/**
 * 夹具 C（`ENG-046`）：句柄关闭后调用——各方法返回 `SESSION_HANDLE_CLOSED` 条件。
 * 注入器对任意最小句柄形状（open/close/read/append）驱动「开 → 关 → 调用」序列。
 */

export interface MinimalHandle {
  append(frame: Record<string, unknown>): unknown;
  read(): readonly Record<string, unknown>[];
  close(): void;
}

export interface ClosedHandleOutcome {
  readonly threwAfterClose: boolean;
  readonly errorName: string | undefined;
}

/** 驱动「开 → 关 → 再调用」序列，返回第二次调用是否抛出（`ENG-016` 的 closed 条件）。 */
export function driveClosedHandle<H extends MinimalHandle>(
  open: () => H,
  call: (handle: H) => unknown,
): ClosedHandleOutcome {
  const handle = open();
  handle.close();
  try {
    call(handle);
    return { threwAfterClose: false, errorName: undefined };
  } catch (error) {
    return { threwAfterClose: true, errorName: (error as { name?: string }).name };
  }
}
