# Always-On Trivia Game Show Outline

## Overview
- Continuous, 24/7 trivia with 10-minute rounds (8-minute entry window, 2-minute results window).
- Each user interacts with their own voice agent; rounds broadcast simultaneously across all active sessions.
- Entry requires a SOL fee escrowed from managed wallets; 90% of the pot pays the winner, 10% feeds a jackpot pool.

## Round Lifecycle
1. **round.start** (T = :00): scheduler emits event; agents announce new round and deliver the prompt.
2. **Answer window** (T = :00 → :08): players submit via `trivia_submit_answer`; tool validates funds, escrows SOL, logs timestamp.
3. **round.lock** (T = :08): submissions close; any late calls rejected.
4. **Judging** (T = :08 → :09:30): automated LLM grading plus optional manual review queue.
5. **round.results** (T = :09:30): winner, scores, jackpot balance broadcast; SOL payouts executed.
6. **Cooldown** (T = :09:30 → :10:00): agents recap; scheduler prepares the next round.

## Core Components
- **Scheduler Worker:** PM2/cron process controlling round state machine, persisting records in PostgreSQL (Supabase).
- **Event Bus:** Redis pub/sub or Supabase realtime channel delivering `round.*` events to API and MCP.
- **Submission Tool:** MCP/API endpoint (`trivia_submit_answer`) capturing `roundId`, free-form `answer`, escrow amount, submission metadata.
- **Wallet Service:** Existing managed-wallet layer moving SOL into per-round escrow accounts and distributing payouts.
- **Scoring Service:** Applies time-decay curve to correct answers, resolves winner, handles jackpot accrual.
- **Notification Layer:** Proactive push to realtime voice sessions plus mirrored web UI countdown/history.

## Data Model Sketch
- `trivia_rounds`: id, state, question, start_at, close_at, pot_lamports, jackpot_contrib_lamports.
- `trivia_submissions`: id, round_id, user_id, answer_raw, submitted_at, elapsed_ms, escrow_tx, status, score.
- `trivia_events`: audit log of lifecycle transitions and payouts.
- `jackpot_pool`: cumulative balance + payout history.

## Scoring & Anti-Cheating
- Points = `base_points * decay(elapsed_seconds)` (linear or exponential; zero after 8 minutes).
- One active submission per user; updates allowed until lock but reuse original elapsed time.
- Automated rubric ensures semantic correctness; ambiguous answers routed to manual review queue before payout.

## Compliance & Risk Controls
- Enforce KYC / eligibility checks before enabling the tool.
- Log all SOL transfers with transaction hashes for audit.
- Feature flags and rate limiting (per user, per round) to mitigate abuse.
- Error handling: friendly agent responses for insufficient funds, round closed, or judgment delays.

## Next Steps
1. Implement scheduler + round state tables under feature flag.
2. Build `trivia_submit_answer` endpoint with escrow + validation.
3. Define scoring decay function and LLM grading prompt templates.
4. Hook notifications into realtime voice agent (server-driven turns).
5. Create analytics dashboard to monitor participation, pot sizes, jackpot growth.

## Real-Money Implementation Pillars
1. **Escrow & Accounting Backbone** – Expand managed-wallet services with per-round escrows, double-entry ledgering, and reconciliation scripts so every lamport can be traced.
2. **Round Engine & Notifications** – Scheduler issues rounds every 10 minutes, seeds questions, and drives `round.start/lock/results` events to agents and web clients with retryable pushes.
3. **Submission Tooling** – `trivia_submit_answer` validates eligibility, reserves SOL escrow idempotently, timestamps entries, and surfaces friendly agent responses for late/insufficient cases.
4. **Judging & Payouts** – LLM rubric grades answers; ambiguous cases queue for manual review before releasing funds. Winners get 90% of the pot, 10% flows to jackpot, with receipts stored.
5. **Jackpot & Admin Surface** – Maintain a jackpot ledger plus an admin console to pause rounds, regrade, void pots, trigger payouts, and audit escrow balances.
6. **Risk & Abuse Controls** – Rate limit per wallet/round, detect duplicate accounts, log anomalies, and alert on escrow/payout mismatches so ops can react quickly.
