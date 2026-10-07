/**
 * 夹具 8（`ENG-046`）：反向网关各端点不可达（gateway 反转面）。
 * 通过桩的控制端点 `/__knobs` 将端点置为不可达（503），并断言生效。
 */

export interface UnreachableResult {
  readonly endpoints: readonly string[];
  readonly statuses: readonly { endpoint: string; status: number }[];
  readonly allUnreachable: boolean;
}

/** 将端点置为不可达并探测状态码（`ENG-043` 判据②的端点不可达旋钮）。 */
export async function markEndpointsUnreachable(
  baseUrl: string,
  endpoints: readonly string[],
  headers: Record<string, string>,
): Promise<UnreachableResult> {
  await fetch(`${baseUrl}/__knobs`, {
    method: "POST",
    body: JSON.stringify({ unreachable: endpoints }),
  });
  const statuses: { endpoint: string; status: number }[] = [];
  for (const endpoint of endpoints) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    statuses.push({ endpoint, status: response.status });
  }
  return {
    endpoints,
    statuses,
    allUnreachable: statuses.every((s) => s.status === 503),
  };
}
