# x402 Integration Plan

This document captures how we'll introduce Coinbase's x402 protocol across the Dexter stack. The goal is to support crypto-native, per-request billing for both human users and autonomous agents with minimal friction.

## Objectives
- Add a trust-minimised payment rail that settles in seconds and supports sub-cent pricing.
- Keep the integration HTTP-native so existing services can adopt it without major refactors.
- Provide a reusable client layer so our agents (MCP + future workers) can negotiate 402 challenges automatically.
- Ship real infrastructure (not a throwaway PoC) that we can harden with monitoring and security controls.

## Components & Repos
| Component | Responsibility | Repository/Directory |
| --- | --- | --- |
| **Resource Server** | Hosts billable endpoints (e.g. `/agent/run`, `/reports/generate`). Issues 402 challenges and verifies receipts. | `dexter-api` – add an `x402` module under `src/payments/` and middleware wiring in `src/app.ts`. |
| **Facilitator Service** | Verifies and settles payments on Solana, shielding app servers from RPC/signing complexity. | `~/websites/x402-facilitator` (TypeScript). Built on the `x402` reference packages with our logging/metrics/security hardening. |
| **Agent Clients** | Handles 402 responses, triggers facilitator payments, retries requests. | `dexter-mcp` (and any future agents). Add a client helper under `legacy-tools/` or new `clients/x402.ts` when we start wiring tools. |
| **Key Management & Secrets** | Secure storage for facilitator keys, RPC endpoints, and pricing configs. | Existing secrets workflow (Supabase Vault + `.env` injection). Documented separately in `dexter-ops`. |

## High-Level Flow
1. Client (human UI or agent) requests a paid endpoint on `dexter-api`.
2. Middleware detects a missing `X-PAYMENT` header → responds `402 Payment Required` with a JSON `accepts` array (price, SPL token mint, network, facilitator URL).
3. Client calls the facilitator's `/settle` (or helper) with the requirement. Facilitator signs and submits the transfer on Solana mainnet and returns a payload plus receipt metadata.
4. Client retries the original request with `X-PAYMENT: <base64 payload>`.
5. Middleware verifies the payload (locally or via facilitator `/verify`), settles if needed, and serves the response. Optional `X-PAYMENT-RESPONSE` header surfaces transaction signatures for auditing.

## Phase 0 – Foundation
1. **Facilitator bootstrap (done)**
   - Scaffolded `~/websites/x402-facilitator` with Express, Solana-only config, and the standard x402 facilitator endpoints (`/healthz`, `/supported`, `/verify`, `/settle`).
   - Added `.env.example` + README instructions for generating a base58 Solana secret key and funding SOL/USDC.
2. **dexter-api wiring** *(next up)*
   - Add `x402` + `x402-express` dependencies.
   - Create `src/payments/x402Config.ts` (pricing map, Solana pay-to address, facilitator URL).
   - Add middleware wrapper (e.g. `withX402`) and apply to the first billable route (target: agent orchestration endpoint).
   - Persist payment receipts in Prisma (`PaymentReceipt` table) for auditing/refunds.
3. **Client helper stub**
   - Add a placeholder `x402Client.ts` in `dexter-mcp` that can parse the `402` body, call the facilitator, and replay the request. This will evolve once the facilitator is live.
4. **Documentation & Ops**
   - Extend `dexter-ops` README with Solana key rotation, balance monitoring, and incident response steps.

## Phase 1 – Production Readiness
- Multi-tenant pricing support (per workspace or per API key).
- Rate limiting and replay protection (`nonce` tracking) at the facilitator.
- Metrics + alerting (Prometheus, Grafana, PagerDuty hooks).
- Automated reconciliation job that verifies facilitator ledger vs. on-chain balances daily.

## Open Questions
- Which endpoints ship first? Proposal: gate high-value analysis tools to validate demand before expanding access.
- Do we need a prepaid balance UX for users without wallets, or is this agent-only at launch?
- Compliance stance per jurisdiction (e.g., MTL requirements) – tracked in `dexter-ops`.

## Next Steps
- Fund a Solana fee payer wallet and drop the base58 secret into `x402-facilitator/.env`.
- Wire the `x402` middleware skeleton in `dexter-api`, pointing at the facilitator's URL.
- Implement the agent-side helper so MCP tools can complete the 402 → pay → retry loop automatically.
