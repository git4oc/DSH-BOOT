English | [简体中文](README.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Русский](README.ru.md) | [Português](README.pt.md)

# DSH-BOOT

> **An enterprise-grade AI Agent platform built on top of the DSH kernel.**
> You only write business logic. Multi-tenant isolation, security audit, approvals, quota & billing, session persistence, evolution compatibility — all provided by the platform and pinned by contract tests. You never write them yourself.

## Why this project exists

After DSH was open-sourced, I kept asking myself one question: **how do we bring DSH's capabilities into enterprise applications?**

I have always believed that not every company is able to build a complete AI Agent platform of its own — yet in the AI era, every company shares the same need: to combine its business scenarios with AI, and to build localized services and cloud deployments on top of that.

DeepSeek harness does not do these concrete things. Building on its "everything is a plugin" philosophy, we can treat it as a harness base platform that is free to use, free of copyright risk, and constantly evolving at the technical frontier — sparing enterprises the many costs of chasing new technology.

DSH does a great job on the single-Agent runtime — tool sandboxing, approval waterfalls, presets and the plugin ecosystem all come out of the box. But enterprise applications need more: how do you isolate tenants? How do you make audits tamper-proof? What happens when a user asks you to delete their data? What if one tenant starves the others? How do you upgrade without breaking customer data? The DSH kernel does none of these — and every company building them from scratch walks over the same landmines.

The conclusion of that exploration: **a harness platform with DSH as its kernel**. The DSH kernel already provides two of the three boundaries (capability boundary, invocation boundary); only the outermost one (tenant/resource isolation) is missing — so this project does not rewrite DSH. It completes the outer layer on top of it and pins down the inner two, turning the "hard but right" parts of enterprise software into platform code.

The goal: **let enterprises focus on business implementation while fully enjoying the dividends of DSH's advanced ideas** — you define scenarios, tools, connectors, and skills; isolation, audit, approvals, quota & billing, persistence & recovery, and evolution compatibility are handled by the platform, with every promise pinned by contract tests. Whether and when to upgrade DSH is also your call: upgrades go through a five-gate pipeline (contract tests, snapshot diff, train consistency, canary records, readiness re-verification) and roll out smoothly without affecting the business.

## One business system, three tiers

One session of your business system passes through three tiers, top to bottom:

```
Your users
   │
   ▼
┌──────────────────────────────────────────────┐
│ Business system (yours)                      │
│ Your UI (Web/App/CLI) + your business flows  │
│ + scenarios, tools, connectors, skills       │
└──────────────────┬───────────────────────────┘
                   │ Call the platform API to start a session/turn
                   ▼
┌──────────────────────────────────────────────┐
│ DSH-BOOT (this project, platform tier)       │
│ Auth · quota & billing · approvals · audit   │
│ forensics · DSR deletion · degradation ·     │
│ upgrade gates                                │
└──────────────────┬───────────────────────────┘
                   │ Dispatch the turn to an isolation domain
                   ▼
┌──────────────────────────────────────────────┐
│ DSH kernel (one instance per domain)         │
│ Model calls · tool execution · sandbox ·     │
│ plugins                                      │
└──────────────────────────────────────────────┘
```

| Tier | Provided by | What you do |
|---|---|---|
| **Business system** | **You**: UI, business flows, and the scenarios/tools/connectors/skills you define | Define the four asset types + call the platform API; the UI follows your business (Web/App/CLI all work) |
| **DSH-BOOT** | **This repo** (implemented, pinned by contract tests): multi-tenancy, audit, quota & billing, DSR, degradation, upgrade gates | At deployment, wire up infrastructure (Linux container runtime, enterprise IdP, object storage) and configure |
| **DSH kernel** | **The DSH open-source kernel** (unmodified): single-Agent runtime | Nothing — versions, readiness, and drift are managed by DSH-BOOT for you |

From a security perspective, these three tiers correspond to **three boundaries**: the inner capability boundary and the middle invocation boundary are jointly enforced by the DSH kernel and DSH-BOOT; the outer tenant/resource isolation is provided by DSH-BOOT — see the table below.

## The relationship between DSH-BOOT and DSH: three boundaries, only the outermost missing

The DSH kernel gives a single Agent a complete runtime: model calls (`ctx.llm`), tool registration (`ctx.tools`), approval waterfall (`ctx.approval`), sandbox (`dsh-sandbox*`), presets (`dsh-agent-preset`). But of the three boundaries **it only provides two** — missing exactly the one multi-tenancy needs most:

| Boundary | Nature | DSH kernel | What DSH-BOOT does |
|---|---|---|---|
| **Inner: capability** | Which tools/plugins this Agent has | ✅ `dsh-agent-preset` + scope | **Pin down + govern outside the domain**: the tool-registration bridge is the single entry point (anything outside `toolAllowlist` is never registered); single preset + privilege-ceiling; the Plugin/Connector/Skill/Scenario catalogs judge tier legality outside the domain at Profile generation — **tenant-defined plugins cannot enter the platform-locked tier** |
| **Middle: invocation** | Per-call file-write policy + approval waterfall | ⚠️ Present, but Windows tier is partial | **Complete + test**: approval responder + ten-field parameter channel (redaction/truncation/ordering) + three-tier deadlines (`T_a`/`T_m`/`T_turn`); in-container ACL testing on Windows **honestly failed → Windows is excluded from multi-tenant isolation** |
| **Outer: tenant/resource isolation** | Kernel-level multi-tenancy | ❌ None | **Built from scratch (the bulk of this project)**: three-state domain pool (hot/warm/cold), domain tokens bound to `(tenantId, isolationGroupId)`, workspace exclusive leases, identity/RBAC/quota/fair scheduling/billing, SessionPersistence L1/L2 + migration state machine, fail-closed audit + WORM hash chain, DSR deletion proofs, degradation ladder |

**All three tiers together make multi-tenancy real.** Claiming isolation from the inner tier alone (which tools an Agent has) is dressing a capability boundary up as a security boundary — this is the starting point of every architectural decision in this project.

So what exactly is DSH-BOOT? It is a **multi-tenant AI Agent platform**, made of three parts:

1. **Control-plane services** (TypeScript packages): identity & RBAC, quota & fair scheduling, billing ingestion, audit & forensics, DSR deletion, session routing & indexing — the back-office logic of an enterprise platform;
2. **DSH integration** (reverse-gateway stub + domain bridge): connects DSH's model calls, tool registration, and approval waterfall to the control plane, and performs artifact verification and drift detection outside the domain — without modifying the DSH kernel;
3. **Engineering gates** (spec set + validation tools): 397 requirements, six gates, snapshot diffs — so none of the promises above can be quietly broken by later changes.

It does not rewrite DSH: every Agent still runs on the DSH kernel; DSH-BOOT manages many such Agents into one enterprise's multi-tenant platform. Deployment shape: control-plane services + one DSH instance per isolation domain (Linux containers) + gateway.

### What passes between DSH-BOOT and DSH

Each isolation domain runs one DSH instance, and only a few well-defined channels connect the two:

| Interaction | Direction | Content |
|---|---|---|
| **Profile dispatch** | Outside → inside | The scenarios/tools/connectors/skills you define are turned by the Profile generator (outside) into `pluginSet`, `toolAllowlist`, `skillRoots`, mounted read-only into the DSH instance |
| **Plugin/artifact registration** | Outside | Plugins are registered in the Plugin Registry (version, signature, integrity hash); legality is judged outside and only then enters the Profile — **there is no "install a plugin" action inside the domain** |
| **Tool registration** | Inside | After DSH starts, the only entry point is `ctx.tools.register`, and only names on the `toolAllowlist` pass; at runtime the domain reports a tool-manifest hash which the outside compares — any mismatch and the domain is detached |
| **Model calls** | Inside → outside | `ctx.llm` calls leave the domain through the reverse gateway: credentials are brokered outside, token usage is metered and billed outside |
| **Approvals** | Inside → outside | Dangerous actions raise an approval; the outside responder answers; parameters travel through the channel (redacted/truncated/ordered) and must converge within the three-tier deadline |
| **Credentials** | Outside → inside | MCP connectors only receive short-TTL credential references; no long-lived credentials exist inside the domain |
| **Session persistence** | Inside → outside | Session logs are written to the domain's local volume and consumed outside at the "upload-confirmed watermark" — quota, billing, and audit all take this as the source of truth |

In one sentence: **the domain only executes; judgment happens outside**. A DSH instance does not know other tenants exist; every cross-tenant decision (who gets in, what they can use, what they did, how it is deleted) lives on the DSH-BOOT side.

One-line analogy: **DSH is to DSH-BOOT roughly what the JVM is to Spring Boot** — the kernel runs single instances; the platform governs multi-tenant enterprise semantics.

## A few terms, defined first

This repo (and the DSH design) uses these concepts repeatedly:

- **Domain (isolation domain)**: one isolated runtime environment running a DSH instance serving one tenant's isolation group (in production, inside its own container). Domains cannot see each other — this is the unit of multi-tenant isolation.
- **Inside / outside the domain**: inside = within the DSH instance, where models and tools execute — **untrusted** (vulnerable to prompt injection or tampering); outside = the dsh-boot control plane and gateway — **trusted**. That is why authorization, audit, artifact verification, and readiness checks all happen outside, and inside-the-domain reports are only cross-checks — this is "enforcement comes from outside the domain".
- **Gate (GATE)**: a mandatory checkpoint before entering the next stage. Each gate has executable verifications (contract tests, drills, live tests) and archived evidence; fail means stop — no signing off.
- **Contract tests**: every promise of the platform ("tenants cannot see each other", "failed approvals never auto-retry", "torn tails never reach the user") is written as an automated test. Any later change that breaks a promise turns a test red.

## What you no longer have to solve

| Enterprise problem | What DSH-BOOT gives you |
|---|---|
| Multi-tenant isolation | One `(tenantId, isolationGroupId)` per domain, tenants never share; workspace exclusive leases (fencing epoch, transferable); the limits of in-domain read non-isolation are disclosed honestly — need-to-know customers use team/user-level isolation groups |
| Who can do what | JWT (OIDC against your enterprise IdP) + RBAC over scenarios, plugins, tools, MCP, and sandbox-mode ceilings per tenant/role; SSO/SCIM automated onboarding; sessions and tokens fully invalidated within 5 minutes of deactivation |
| Tamper-proof auditing | Minimal audit set, six classes, **fail-closed** (if it cannot be recorded, the action is denied); WORM + hash chain; five-field audit keys; exportable, independently verifiable forensics packs |
| Users demanding deletion | Full DSR deletion (logs, attachments, FTS, snapshots, object-store versions, container temp layers) + tombstones + deletion reports + hash-chain proofs; effective ≤ 24h, 7-day revocation window |
| Resource hogs | Tiered quotas (soft/hard) + fair scheduling: over-quota tenants are **throttled proportionally**, everyone else is unaffected; soft-dependency failures never block execution |
| When a dependency dies | Degradation ladder L0/L1/L1b/L2/L3: entry/exit thresholds, hysteresis and minimum dwell, per-tenant aggregated alerts, error budgets and freeze lists |
| Upgrades corrupting customer data | Five-state migration state machine + `targetBaseSeq == sourceLastReplicatedSeq` assertion against torn tails; source of truth = log + upload-confirmed watermark; five-gate upgrade pipeline with per-prerequisite re-checks |
| Compliance needs proof | Forensics packs + deletion proofs + hash chains, all exportable and independently verifiable |

## Quick start

**Requirements**: Node ≥ 22, pnpm; **a Linux host** (production multi-tenancy is Linux-only — Windows has been tested and excluded, see [Boundaries](#current-status-and-boundaries-the-honest-version)).

```bash
pnpm install

# Start the minimal local topology: reverse-gateway stub + in-memory attest + seed Profile
pnpm dev:up          # HTTP endpoint at http://127.0.0.1:7301 (JSON API)
pnpm dev:smoke       # Run one full turn
```

## Building your business system

Writing a business system on DSH-BOOT = defining four asset types; the platform handles everything else:

| You define | Via | The platform guarantees |
|---|---|---|
| **Scenario** | `presetId + pluginSet + policies` | presetId is append-only (a permanent compatibility surface) |
| **Tool** | The single registration-bridge entry; anything outside toolAllowlist is never registered | Even a malicious MCP pushing new tools never enters the visible set |
| **Connector** | Catalog registration, `untrusted` by default | Credentials stored by reference only; exceptions require security review |
| **Skill** | platform / tenant / user scopes | Assembled per tenant, never crossing tiers |

Minimal example (excerpted from the contract tests, copy-and-run):

```js
import { ScenarioCatalog, ConnectorRegistry } from "../../../../packages/control-plane/src/registry/registries.ts";

// Define a scenario: presetId + plugin set + policies
const scenarios = new ScenarioCatalog();
scenarios.define({
  presetId: "preset-1",
  pluginSet: ["dsh-base"],
  policies: { requireApproval: ["shell"], toolAllowlist: ["fs"] },
});

// Register an MCP connector: untrusted by default; exceptions require security review
const registry = new ConnectorRegistry(2);
registry.register({
  serverName: "github-mcp",
  transport: "stdio",
  hosting: "domain",
  credentialRef: "credref-1",
  trust: "untrusted",
  securityReviewPassed: false,
});
```

Business developers **write no isolation, audit, quota, or persistence code** — define the four asset types and the platform provides the rest.

```bash
# 11 contract suites — every semantic promise of the platform is pinned by a test
pnpm contract:llm && pnpm contract:tools && pnpm contract:approval
pnpm contract:ready && pnpm contract:persistence-l1 && pnpm contract:pool
pnpm contract:identity-quota && pnpm contract:registry
pnpm contract:session-ops && pnpm contract:lifecycle

# Spec & doc validation
node tools/lint-specs.mjs && node tools/check-gates.mjs
node tools/validate-contracts.mjs && node tools/lint-docs.mjs
```

## Design principles

1. **Enforcement comes only from outside the domain** — tier legality is judged at Profile generation; the domain never vouches for itself (self-attested compliance fails).
2. **Gates only accept facts from outside the domain** — in-domain reports are cross-checks only; a mismatch detaches the domain.
3. **Soft dependencies never block execution** — if billing or general audit dies, execution continues; bounded drops + tombstones + re-upload.
4. **Say what you cannot do** — every unfinished item is recorded honestly; no invented numbers.

## Current status and boundaries (the honest version)

- ✅ All six stage gates (GATE-001…006) are reachable, each with evidence artifacts; all 11 contract suites green.
- ❌ **Windows is excluded from multi-tenant isolation**: in-container ACL testing failed (GATE-002 condition 9, honestly marked fail).
- 🔶 **3 of 6 drills**: DRL-03/04/06 require in-kernel components and multi-node topology — honestly blocked.
- 🔶 **Load-test parameters not backfilled**: `PP-01…PP-35` are all "example-derived values, pending load testing" — no invented numbers.
- 🚫 **No UI**: this repo ships libraries and an HTTP API (gateway stub); no product UI.
- 📦 **Production deployment brings your own execution environment**: the container/microVM execution environment of an isolation domain is not implemented by this repo — at deployment the operator provides infrastructure (Linux container runtime, enterprise IdP, object storage) and wires it up; business developers are unaffected.

For the layer-by-layer consistency comparison against the original plan (all six items consistent, including the honestly-executed "Windows fails" branch), see the [Engineering Handbook](docs/ENGINEERING-HANDBOOK.md#9-实现与规划的一致性对照).

## Documentation

- [Engineering Handbook](docs/ENGINEERING-HANDBOOK.md) — authority order, gate quick reference, gap ledger, changelog (required reading for contributors)
- [Spec master](spec/00-规格总纲.md) — entry to the spec set
- [Failure-domain matrix](docs/reliability/failure-domain-matrix.md) / [Degradation ladder](docs/reliability/degradation-ladder.md) / [DSR inventory](docs/security/dsr-inventory-and-proof.md)

## License

[MIT](LICENSE)
