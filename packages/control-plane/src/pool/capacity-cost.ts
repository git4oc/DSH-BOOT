/**
 * 容量模型与单位经济（`GATE-004`；`REL-061`–`REL-063`；`PRD-043`–`PRD-049`；设计 §9.5/§10.4）。
 *
 * - **N_node = min(N_mem, N_blast)**：两项各自给出输入、来源与 ±20% 敏感性；
 *   **N_node 不得只由内存推出**（`REL-061`）。
 * - 跨租户反亲和：任一节点租户数 ≤ min(N_node, Y% × 租户总数)（`REL-062`）。
 * - 成本公式以**推理 token 为主成本项**（§10.4 v2.6 修正）；≥3 画像可算毛利率；
 *   4 画像 × 3 档矩阵 12 格全部有数字（假设值登记，`PRD-044` 判据③口径）。
 */

export interface CapacityInput {
  readonly parameter: string;
  readonly sourceType: "实测（目标机型）" | "实测派生" | "合同 / SLA 反推" | "实测（批量恢复压测）";
  readonly status: "待压测回填" | "已定";
  readonly value: number;
  readonly sensitivity: string;
}

export interface DerivationResult {
  readonly nMem: { readonly value: number; readonly formula: string; readonly inputs: readonly CapacityInput[] };
  readonly nBlast: { readonly value: number; readonly formula: string; readonly inputs: readonly CapacityInput[] };
  readonly nNode: { readonly value: number; readonly formula: string };
  readonly antiAffinityCapPerNode: { readonly value: number; readonly formula: string };
  readonly note: string;
}

/**
 * `N_node = min(N_mem, N_blast)` 推导（与 docs/reliability/failure-domain-matrix.md §4 同源）。
 * 数值为**示例推导值**（PP 参数〔待压测回填〕，敏感性 ±20%）。
 * 输入校验：非正数值拒绝（0 除会产生 Infinity，不允许出现非有限容量数字）。
 */
export function deriveNodeCapacity(input: { nodeMemoryGb: number; domainMemoryGb: number; affectedTenantCap: number; recoveryDomainsPerWindow: number; slaRecoveryHours: number; tenantCount: number; yPercent: number }): DerivationResult {
  const numeric = [input.nodeMemoryGb, input.domainMemoryGb, input.affectedTenantCap, input.recoveryDomainsPerWindow, input.slaRecoveryHours, input.tenantCount, input.yPercent];
  if (numeric.some((v) => !Number.isFinite(v))) {
    throw new Error("CAPACITY_INPUT_INVALID: 全部输入必须为有限数值");
  }
  if (input.nodeMemoryGb <= 0 || input.domainMemoryGb <= 0 || input.affectedTenantCap <= 0 || input.recoveryDomainsPerWindow <= 0 || input.slaRecoveryHours <= 0 || input.tenantCount < 0) {
    throw new Error("CAPACITY_INPUT_INVALID: 内存/容量/恢复参数必须为正数，租户总数不得为负");
  }
  if (input.yPercent < 0 || input.yPercent > 100) {
    throw new Error("CAPACITY_INPUT_INVALID: yPercent 须在 [0, 100] 区间");
  }
  const nMem = Math.floor(input.nodeMemoryGb / input.domainMemoryGb);
  const nBlast = Math.min(input.affectedTenantCap, Math.floor(input.recoveryDomainsPerWindow * input.slaRecoveryHours));
  const nNode = Math.min(nMem, nBlast);
  const antiAffinity = Math.min(nNode, Math.floor((input.yPercent / 100) * input.tenantCount));
  return {
    nMem: {
      value: nMem,
      formula: `⌊${input.nodeMemoryGb} / ${input.domainMemoryGb}⌋ = ${nMem}`,
      inputs: [
        { parameter: "节点可用内存", sourceType: "实测（目标机型）", status: "待压测回填", value: input.nodeMemoryGb, sensitivity: "±20% 线性（N_mem 正相关）" },
        { parameter: "域内存预留", sourceType: "实测派生", status: "待压测回填", value: input.domainMemoryGb, sensitivity: "倒数敏感（比节点内存更敏感，容量评审优先收紧）" },
      ],
    },
    nBlast: {
      value: nBlast,
      formula: `min(${input.affectedTenantCap}, ⌊${input.recoveryDomainsPerWindow} × ${input.slaRecoveryHours}⌋) = ${nBlast}`,
      inputs: [
        { parameter: "允许受影响租户数上限", sourceType: "合同 / SLA 反推", status: "待压测回填", value: input.affectedTenantCap, sensitivity: "±20% 线性（N_blast 正相关）" },
        { parameter: "单位时间可恢复域数", sourceType: "实测（批量恢复压测）", status: "待压测回填", value: input.recoveryDomainsPerWindow, sensitivity: "±20% 线性（N_blast 正相关）" },
        { parameter: "SLA 恢复时长承诺", sourceType: "合同 / SLA 反推", status: "已定", value: input.slaRecoveryHours, sensitivity: "±20% 线性（N_blast 正相关）" },
      ],
    },
    nNode: { value: nNode, formula: `min(${nMem}, ${nBlast}) = ${nNode}（爆炸半径约束生效）` },
    antiAffinityCapPerNode: {
      value: antiAffinity,
      formula: `min(${nNode}, floor(${input.yPercent}% x ${input.tenantCount})) = ${antiAffinity}`,
    },
    note: "N_node 不得只由内存推出（REL-061）；两处引用同源（REL-063）；数值随压测回填更新且矩阵版本 +1（REL-067）",
  };
}

// ── 成本模型（`PRD-043`–`PRD-049`；设计 §10.4） �──────────────────────────────
export interface ProfileAssumptions {
  readonly profile: string;
  /** 上分位假设（`PRD-044` 判据③口径）：全部为**假设值**，实测回填前用于报价护栏。 */
  readonly inputTokensPerMonth: number;
  readonly outputTokensPerMonth: number;
  readonly cacheHitRatio: number;
  readonly mcpProcesses: number;
  readonly storageGb: number;
  readonly egressGb: number;
  readonly monthlyRevenue: number;
}

export interface CostAssumptions {
  /** 输入 token 单价（$/1M tokens）——假设值（A-13）。 */
  readonly inputTokenPrice: number;
  /** 输出 token 单价（$/1M tokens）——假设值（A-14）。 */
  readonly outputTokenPrice: number;
  /** 缓存命中折扣。 */
  readonly cacheDiscount: number;
  /** 固定摊分（控制面 + 数据面 + 网关 + 池预热）$/月。 */
  readonly fixedAmortization: number;
  /** MCP 托管（$/进程/月）。 */
  readonly mcpHostingPerProcess: number;
  /** 存储（$/GB/月）。 */
  readonly storagePerGb: number;
  /** 出网流量（$/GB）。 */
  readonly egressPerGb: number;
  /** Windows 域溢价（ACL 传播）$/域/月。 */
  readonly windowsPremium: number;
}

export interface MarginResult {
  readonly profile: string;
  readonly cTenant: number;
  readonly revenue: number;
  readonly grossMargin: number;
  readonly tokenShare: number;
  readonly valueBasis: "假设值（上分位假设 + 成本加成 + 毛利护栏；实测回填前报价护栏，PRD-044 判据③）";
}

/** 单画像 C_tenant（token 为主成本项 ★）与毛利率。输入校验：负值/非法区间拒绝（0 收入会产生 NaN 毛利率）。 */
export function grossMargin(assumptions: ProfileAssumptions, cost: CostAssumptions): MarginResult {
  const numericProfile = [assumptions.inputTokensPerMonth, assumptions.outputTokensPerMonth, assumptions.mcpProcesses, assumptions.storageGb, assumptions.egressGb, assumptions.monthlyRevenue];
  const numericCost = [cost.inputTokenPrice, cost.outputTokenPrice, cost.cacheDiscount, cost.fixedAmortization, cost.mcpHostingPerProcess, cost.storagePerGb, cost.egressPerGb, cost.windowsPremium];
  if (numericProfile.some((v) => !Number.isFinite(v)) || numericCost.some((v) => !Number.isFinite(v)) || !Number.isFinite(assumptions.cacheHitRatio)) {
    throw new Error("COST_INPUT_INVALID: 全部输入必须为有限数值");
  }
  if (numericProfile.some((v) => v < 0) || numericCost.some((v) => v < 0)) {
    throw new Error("COST_INPUT_INVALID: 用量与成本输入不得为负");
  }
  if (assumptions.cacheHitRatio < 0 || assumptions.cacheHitRatio > 1) {
    throw new Error("COST_INPUT_INVALID: cacheHitRatio 须在 [0, 1] 区间");
  }
  if (assumptions.monthlyRevenue <= 0) {
    throw new Error("COST_INPUT_INVALID: monthlyRevenue 必须为正数（否则毛利率无定义）");
  }
  const inputCost = (assumptions.inputTokensPerMonth / 1_000_000) * cost.inputTokenPrice;
  const outputCost = (assumptions.outputTokensPerMonth / 1_000_000) * cost.outputTokenPrice;
  const cacheCredit = (inputCost + outputCost) * assumptions.cacheHitRatio * cost.cacheDiscount;
  const tokenCost = inputCost + outputCost - cacheCredit;
  const mcpCost = assumptions.mcpProcesses * cost.mcpHostingPerProcess;
  const storageCost = assumptions.storageGb * cost.storagePerGb;
  const egressCost = assumptions.egressGb * cost.egressPerGb;
  const cTenant = cost.fixedAmortization + tokenCost + mcpCost + storageCost + egressCost + cost.windowsPremium;
  const grossMarginValue = (assumptions.monthlyRevenue - cTenant) / assumptions.monthlyRevenue;
  return {
    profile: assumptions.profile,
    cTenant: round2(cTenant),
    revenue: assumptions.monthlyRevenue,
    grossMargin: round4(grossMarginValue),
    tokenShare: round4(tokenCost / cTenant),
    valueBasis: "假设值（上分位假设 + 成本加成 + 毛利护栏；实测回填前报价护栏，PRD-044 判据③）",
  };
}

/** 4 画像 × 3 档单位经济矩阵（`PRD-045`：12 格全部有数字）。 */
export function unitEconomicsMatrix(profiles: readonly ProfileAssumptions[], cost: CostAssumptions, tierFactors: readonly { readonly tier: string; readonly usageFactor: number; readonly priceFactor: number }[]): { readonly matrix: readonly { readonly profile: string; readonly tier: string; readonly margin: number }[]; readonly allCellsNumeric: boolean } {
  const matrix = profiles.flatMap((profile) =>
    tierFactors.map((tier) => {
      const scaled: ProfileAssumptions = {
        ...profile,
        inputTokensPerMonth: profile.inputTokensPerMonth * tier.usageFactor,
        outputTokensPerMonth: profile.outputTokensPerMonth * tier.usageFactor,
        mcpProcesses: Math.ceil(profile.mcpProcesses * tier.usageFactor),
        monthlyRevenue: profile.monthlyRevenue * tier.priceFactor,
      };
      return { profile: profile.profile, tier: tier.tier, margin: grossMargin(scaled, cost).grossMargin };
    }),
  );
  return { matrix, allCellsNumeric: matrix.every((cell) => Number.isFinite(cell.margin)) };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
