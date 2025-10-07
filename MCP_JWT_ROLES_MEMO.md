# Memorandum: MCP JWT Role Claim Rollout

**To:** Dexter downstream service owners, MCP integrators, wallet tooling teams  
**From:** Dexter API team  
**Date:** October 7, 2025  
**Subject:** MCP JWT now emits normalized `roles` claim for authenticated users

---

## 1. Executive Summary
- The Dexter API now embeds a `roles` array in every Model Context Protocol (MCP) JWT issued to authenticated users.
- Roles are normalized (trimmed, lowercased, empty entries removed) before signing; guests continue to receive tokens without the claim.
- Downstream services can use the JWT as the canonical source for role-aware authorization, eliminating the need to query Supabase metadata on each MCP invocation.
- Action required: audit your MCP token consumers, ensure they tolerate/consume the new claim, and adjust authorization logic to recognize the normalized role format.

---

## 2. Background & Motivation
1. **Prior state:**  
   - MCP JWTs exposed core identifiers (`supabase_user_id`, `supabase_email`, optional `scope`, and `wallet_public_key`) but omitted the user’s Supabase roles.  
   - Downstream services that needed role checks either performed additional Supabase lookups or maintained bespoke caches, leading to inconsistency and extra latency.  

2. **Pain points identified:**  
   - Multiple consumers performed their own ad-hoc normalization of `app_metadata.roles`, producing divergent interpretations (case sensitivity, whitespace issues).  
   - Runtime dependencies on Supabase added failure modes when the auth service throttled or when tokens were already nearly expired.  
   - Access revocations required bespoke coordination because we lacked a single, signed payload reflecting authorization state at issuance time.

3. **Objectives for this change:**  
   - Provide a signed, uniform role signal inside the MCP JWT.  
   - Reduce direct Supabase dependencies inside hot-path MCP consumers.  
   - Improve auditability by having the token itself reflect the authorization snapshot used at request time.

---

## 3. Change Overview
### 3.1 Implementation Highlights
- `issueMcpJwt` (see `src/utils/mcpJwt.ts`) now:
  - Accepts an optional `roles` array.
  - Normalizes each entry via `String(entry).trim().toLowerCase()` and filters blanks before embedding.
- All API surfaces that mint MCP tokens were updated to capture roles from Supabase and pass them to `issueMcpJwt`, including:
  - Realtime session bootstrap (`src/app.ts`, `src/realtime.ts`).
  - Connector OAuth flows (`src/routes/connectorOAuth.ts`).
  - Wallet allocator (`src/wallets/allocator.ts`).
  - Wallet activation route (`src/routes/wallets.ts`) — newly aligned to forward roles.
- Role extractors across the codebase were hardened to match the same normalization logic (`src/routes/*.ts`, `src/app.ts`).
- Tests (`tests/mcpJwt.test.ts`) now assert role normalization behaviour, guarding against regressions.

### 3.2 Token Payload Illustration
Example payload for an authenticated user assigned `["SuperAdmin", "operator"]` at issuance time:

```json
{
  "iss": "https://dexter.cash/mcp",
  "aud": "https://dexter.cash/mcp",
  "sub": "user-123",
  "supabase_user_id": "user-123",
  "supabase_email": "user@example.com",
  "wallet_public_key": "ABCDE12345...",
  "scope": "wallet.read",
  "roles": ["superadmin", "operator"],
  "iat": 1696675200,
  "exp": 1696675800
}
```

Guests or users without assigned roles continue to receive tokens without the `roles` property.

---

## 4. Behavioural Implications
| Aspect | Previous Behaviour | New Behaviour |
| --- | --- | --- |
| Role availability | Not present in MCP JWT; consumers had to query Supabase | JWT contains normalized `roles` array for authenticated users |
| Role formatting | Consumer-specific; often mixed case / whitespace inconsistencies | Guaranteed lowercase, trimmed entries, no null/empty strings |
| Authorization freshness | Driven by Supabase fetch frequency | Reflects state at token issuance; refresh or reissue to pick up role changes |
| Dependencies | Supabase user endpoint required in hot paths | Optional Supabase read; JWT self-contained for role checks |

---

## 5. Required Actions for Downstream Teams
1. **Token validation:** Ensure JWT validators do not reject tokens because of the additional `roles` claim.  
2. **Authorization logic:** Prefer the JWT’s `roles` array for access checks. Enforce lowercase comparisons (`roles` are pre-normalized).  
3. **Staleness mitigation:** If you need near-real-time revocation, adopt one or both of the following:
   - Decrease MCP JWT TTL via configuration (`MCP_JWT_TTL_SECONDS`) and trigger token regeneration after role changes.
   - Perform targeted Supabase revalidation when a high-risk action occurs.
4. **Logging & analytics:** Update structured logs to capture `roles` from the JWT rather than re-deriving from Supabase.  
5. **Documentation:** Reflect the new claim in any consumer-facing API docs, contract tests, or OpenAPI/JSON schema references.  
6. **Testing:** Extend integration tests to assert behaviour when `roles` is present vs. absent; confirm case-insensitive matching and fallback paths.

---

## 6. Compatibility & Risk Assessment
- **Backwards compatibility:** Adding an optional claim is backwards compatible with RFC-compliant JWT consumers. Services that performed strict schema validation must be updated to accept the new field.  
- **Security:** Roles are contained in an HMAC-signed token using the existing `MCP_JWT_SECRET`. Ensure the secret is consistently configured across environments.  
- **Revocation latency:** Role changes take effect on the next token issuance. Consider TTL tuning or pro-active session invalidation for high-sensitivity roles.  
- **Monitoring:** Watch authentication dashboards for elevated 4xx/5xx counts indicating JWT schema rejections.

---

## 7. Validation & Rollout
- **Unit coverage:** `tests/mcpJwt.test.ts` expanded to verify role normalization and omission of empty entries.  
- **Manual verification:** Post-deploy, exercised `/wallets/active` and connector OAuth flows to confirm `roles` appear in minted tokens.  
- **Deployment status (October 7, 2025):** Dexer API rebuilt (`npm run build`) and restarted under PM2 (`pm2 restart dexter-api` with PID 1539757). Production is already serving tokens with the new claim.

---

## 8. Timeline & Next Steps
- **Immediate (Today):** Downstream teams review memo, adjust validators, and update docs/tests.  
- **Within 1 week:** Report readiness to the API team; highlight any blockers or edge cases.  
- **Within 2 weeks:** Complete migration to JWT-based role checks; decommission redundant Supabase lookups where feasible.  
- **Ongoing:** Monitor for discrepancies; coordinate any future role taxonomy changes through the same memo process.

---

## 9. Contact & Support
- **Point of contact:** Dexter API team (`#dexter-backend` Slack channel or backend@dexter.cash).  
- **Escalation path:** For production incidents related to role authorization, page the on-call backend engineer via PagerDuty rotation “dexter-api”.  
- **Feedback loop:** File GitHub issues in the `dexter-api` repo under the “auth” label for feature requests or follow-up improvements.

Please acknowledge receipt of this memorandum in your team’s operations channel and confirm when your services have been updated. Reach out with any questions or edge cases that require additional support.

— Dexter API Team
