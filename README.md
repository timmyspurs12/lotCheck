# LotCheck

LotCheck is a documentary evidence-review system for cleanup-milestone records. The backend keeps the API, review/evidence services, normalization, deterministic comparison, GenLayer adapter, submission worker, and persistent read model separate. It does not use seeded records, local verdict fixtures, or a fake transaction mode.

## Architecture

```text
Fastify API
  → review/evidence services
  → private document storage + byte hashing
  → explicit-field normalization
  → deterministic comparison and identity pre-check
  → durable GenLayer submission queue
  → GenLayer adapter / Intelligent Contract
  → verified contract record
  → PostgreSQL read model and audit trail
```

The backend source is under `backend/src`; the contract source is `contracts/lotcheck_review.py`; the initial schema is `backend/migrations/001_initial.sql`.

## Local setup

Requirements: Node.js compatible with the lockfile, npm, and PostgreSQL. The API refuses to start if its configured migration checksum is missing or stale.

```bash
npm ci
cp .env.example .env
# Set DATABASE_URL to a local PostgreSQL database and keep AUTH_MODE=disabled only for local development.
npm run backend:migrate
npm run backend:dev
```

In another terminal, run the existing frontend:

```bash
npm run dev
```

The Vite `/api` proxy is server-side development plumbing; it is not a health-data fallback. The browser calls relative `/api/...` paths and health is returned only by the backend.

`DB_AUTO_MIGRATE=true` is available for controlled local use. For production, apply reviewed migrations as a separate deployment step and leave auto-migration disabled. The migration has **not** been applied or validated against PostgreSQL in this workspace; validate it against a disposable PostgreSQL instance before deployment.

## Production configuration

Use a deployment secret store, not a checked-in `.env` file.

- `DATABASE_URL` must point to PostgreSQL; configure `DB_SSL` as required by the provider.
- Production requires `AUTH_MODE=oidc`, HTTPS issuer/JWKS, audience, and the configured reviewer role (default `lotcheck:reviewer`). Authenticated tokens must carry that role in `roles` or `scope`.
- Production requires private S3-compatible storage, credentials from the secret store, and server-side encryption. Local filesystem storage is development-only.
- `GENLAYER_MODE=live` requires explicit `GENLAYER_NETWORK`, its canonical `GENLAYER_RPC`, a deployed `GENLAYER_CONTRACT_ADDRESS`, and a funded `GENLAYER_PRIVATE_KEY` injected from a secret manager. Missing signer configuration fails clearly; the backend never generates a key, logs a key, or falls back to a mock. `GENLAYER_MODE=disabled` means no GenLayer transaction can be submitted.
- The backend adapter and deployment script use the exact-pinned `genlayer-js` 1.1.8 stable API (the stable GenLayer CLI metadata is 0.39.2) and legacy contract runner. The LotCheck source exposes `submit_review`, `get_record_by_review`, and `get_record_count`. The current authoritative Bradbury deployment is `0x5c708DF3382123d12eC7110F203653E90f12eC57`. Read-only verification on 2026-10-07 confirmed that an existing transaction reached `FINALIZED` / `AGREE` / `FINISHED_WITH_RETURN` and that its `ACCEPT` / `DOCUMENTARY_CONSISTENT` record was readable. The original transaction input and on-chain record matched the review and record IDs, canonical package hash, site and milestone, policy and timestamp, document hashes and evidence references, and `GENLAYER_INTERPRETATION`. This verifies one transaction path only; no fee estimate or paid-fee amount is recorded here.
- Bradbury is the documented real-AI testnet target (chain ID 4221). Operational availability beyond the one verified transaction is not established. Public reports describe a Bradbury `eth_sendRawTransaction` proxy failure ([issue #425](https://github.com/genlayerlabs/genlayer-cli/issues/425)), gas-estimation failures with stable SDK 1.1.8 ([issue #402](https://github.com/genlayerlabs/genlayer-cli/issues/402)), and a roughly 20 KB practical deployment-risk boundary ([issue #419](https://github.com/genlayerlabs/genlayer-cli/issues/419)). These community reports are warnings, not proof of network-wide outage; an `eth_estimateGas` response is not proof of the actual fee paid.
- The separate Consensus v0.6 preview is not interchangeable with this stable path: it requires the matching `genlayer-js` 2.0.0-rc.1 / GenLayer CLI 0.40.0-rc.3, the `studioDevnet` chain (61997), the v0.3 Python runner/import migration, and fee-profile-based estimates (`distribution` plus `feeValue`). Studio-dev is temporary and may reset. LotCheck has not been migrated or deployed to that RC stack.
- `GENLAYER_EXPLORER_URL` is optional. Transaction links are returned only when it is configured; no explorer URL is fabricated.

## GenLayer deployment helper

`scripts/deploy-lotcheck.mjs` is a guarded helper for an explicitly approved **new, first-time deployment** in a separate environment. It submits a new deployment when `GENLAYER_CONTRACT_ADDRESS` is unset and refuses to run when that variable is set. The current Bradbury deployment at `0x5c708DF3382123d12eC7110F203653E90f12eC57` is authoritative: do not unset its address or run this helper for the current deployment. Do not redeploy the contract as part of routine operation.

For a separately approved first deployment, the helper reads `contracts/lotcheck_review.py`, checks the selected network/RPC pair and chain ID, runs remote schema compilation before submission, sends one deployment, waits for `FINALIZED` plus `FINISHED_WITH_RETURN`, extracts the address, checks the deployed schema, and reads `get_record_count` at the latest finalized state. It stops on the first failure and never changes networks or retries a deployment automatically. No signer is stored in this repository; a no-credentials check stopped at `CONFIGURATION` before an RPC request or transaction. This helper uses the stable SDK's legacy GenLayer-chain transaction path (`eth_estimateGas` and `eth_gasPrice`), not the v0.6 `FeesDistribution` quote, and it does not report an actual fee paid.

For Consensus v0.6, use a separate measured fee-profile path: `gltest --fee-profile` measures representative deploy/write behavior, then the matching v2 SDK estimates current network prices/caps and submits `distribution` and `feeValue` unchanged. The escrowed deposit is not the final cost; unused budget is refunded at finalization. Do not reuse the stable-path command/contract header for Studio-dev.
- The frontend includes a shared-passcode login only for the isolated `NODE_ENV=demo` plus `AUTH_MODE=demo` mode. It has no built-in OIDC redirect/login provider; production must keep `AUTH_MODE=oidc` and supply bearer tokens through its approved authentication integration. Never put a static access token or secret in Vite build variables.

## Railway hackathon demo

The repository root `railway.json` configures one backend service: `npm run backend:build`, the checksum-guarded `node backend/dist/migrate.js` pre-deploy step, and `npm run backend:start`. That entry point starts both the Fastify API and the durable submission worker in the same process; do not create a second worker service using the same command, which would run another API and duplicate worker polling. Railway supplies `PORT`; the backend binds to `0.0.0.0`. Deploy the Vite frontend separately and set `VITE_API_BASE_URL` to the public backend origin at frontend build time.

For the explicitly isolated demo service, set `NODE_ENV=demo` and `AUTH_MODE=demo`. Demo mode is not a production bypass: startup still requires PostgreSQL, encrypted S3-compatible storage, the live Bradbury network, and the existing deployed contract. The validator rejects demo auth in `NODE_ENV=production`, rejects disabled/mock GenLayer, and rejects a different network or contract. The demo UI obtains a short-lived signed bearer session from the backend, attaches it to API calls, and offers sign-out. The passcode is shared among demo attendees and does not represent a personal/verified identity; use it only for non-sensitive hackathon data. Production continues to require OIDC.

Configure the Railway backend variables as follows:

- `NODE_ENV=demo`, `AUTH_MODE=demo`, `HOST=0.0.0.0`; use Railway's assigned `PORT`.
- `DATABASE_URL` as a Railway PostgreSQL service reference. Keep `DB_AUTO_MIGRATE=false`; `railway.json` runs the idempotent checksum-checked migration before starting the service. Set `DB_SSL` to match the provider.
- `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_SERVER_SIDE_ENCRYPTION=AES256` (or `aws:kms`). For a non-AWS S3-compatible provider, set its HTTPS `S3_ENDPOINT`; configure path-style only if the provider requires it. Railway's ephemeral filesystem is not evidence storage.
- `DEMO_AUTH_PASSCODE` (a randomly generated 16–256-character passphrase) and `DEMO_AUTH_SIGNING_SECRET` (at least 32 bytes), both as Railway secrets. Generate the signing secret locally, for example with `openssl rand -base64 32`; do not commit either value or put them in `VITE_*` variables. Demo JWT sessions expire after four hours and are held in browser session storage.
- `GENLAYER_MODE=live`, `GENLAYER_NETWORK=testnetBradbury`, `GENLAYER_RPC=https://rpc-bradbury.genlayer.com`, and `GENLAYER_CONTRACT_ADDRESS=0x5c708DF3382123d12eC7110F203653E90f12eC57`. Inject `GENLAYER_PRIVATE_KEY` from Railway's secret store; the contract must not be redeployed or replaced. Submitting a new review is a real Bradbury transaction, not a mock.
- `CORS_ORIGINS` should contain the exact HTTPS origin of the separately deployed frontend (comma-separated only if more than one trusted origin is required). Set the frontend build-time `VITE_API_BASE_URL` to the Railway backend's public HTTPS origin.

The Railway service variables above must be supplied in the Railway dashboard/service-reference UI; the checked-in config intentionally contains no database, S3, passcode, signing, OIDC, or chain-signer values. OIDC variables are not used by demo auth but remain required when running with `NODE_ENV=production`.

## API surface

All review/evidence/document routes require a verified reviewer identity. `GET /api/health`, `GET /api/auth/mode`, and the isolated demo-login endpoint are public; `GET /api/auth/session` is protected. Request bodies and path/query inputs are schema-validated; submission accepts no decision field.

- `GET /api/health`
- `GET /api/auth/mode`, `POST /api/auth/demo-login` (enabled only in explicit demo mode), `GET /api/auth/session`
- `GET /api/sites`, `POST /api/sites`, `GET /api/sites/:siteId`
- `GET /api/reviews`, `POST /api/reviews`, `GET /api/reviews/:reviewId`
- `POST /api/reviews/:reviewId/evidence`, `GET /api/reviews/:reviewId/evidence`
- `POST /api/reviews/:reviewId/compare`, `POST /api/reviews/:reviewId/submit`
- `GET /api/reviews/:reviewId/status`
- `GET /api/records/:recordId`
- `GET /api/documents/:documentId`
- An authenticated `GET /api/documents/:documentId/content` route serves the private original as an attachment. Development responses expose a relative `contentUrl`; OIDC deployments receive `null` because the existing iframe viewer cannot forward bearer authorization.

Site/review/decision responses come from PostgreSQL. Transaction details and records are written to the read model only after polling the configured GenLayer RPC, checking actual lifecycle and execution result, reading the deployed contract record, and validating its provenance. `GET /api/health` reports actual DB/RPC connectivity; it does not declare a disabled adapter connected.

## Evidence and decision boundaries

A review has one `PROJECT_CLOSEOUT` and one `INDEPENDENT_EVIDENCE` document. Uploads are private, size/MIME checked, never executed, and fingerprinted by the server from the original bytes. Only explicitly labeled/extracted values are normalized; unavailable fields remain `null`. The deterministic comparison is persisted and included in the canonical evidence package. The worker recomputes the canonical package hash before submitting it.

Evidence is immutable once submission begins. A submission is queued idempotently per review; the API does not return `FINALIZED` merely because a write call returned a transaction hash. It tracks the actual GenLayer status and execution result. The on-chain record stores hashes and decision metadata, not PDFs.

The server computes the canonical evidence-package SHA-256. The Intelligent Contract validates and records the supplied fingerprint and performs the documentary interpretation, but this contract deliberately does **not** recompute SHA-256 inside GenVM because authoritative support for that hashing API has not been established. For the existing Bradbury review, the original transaction input was read and its canonical package hash matched the submitted fingerprint and the finalized contract record. This is read-only verification for that transaction; it is not contract-side hash recomputation for arbitrary future payloads.

`ACCEPT` means only: “The submitted documentary evidence appears sufficiently consistent under the configured review policy.” It is not certification or proof of land safety, physical remediation quality, sampling or laboratory validity, absence of contamination, or regulatory satisfaction. The contract and API summaries preserve this distinction.

## Validation

```bash
npm run backend:test
npm run backend:build
npm run build
```

Backend tests cover deterministic readiness/comparison, actual-byte hashing, canonical role/document response fields, strict GenLayer result parsing, failed lifecycle classification, evidence immutability rules, idempotent retry behavior, the GenLayer finalization lifecycle, demo-auth isolation/session verification/production OIDC gating, and a Fastify-inject test proving a client-supplied `{ "decision": "ACCEPT" }` is rejected. They are unit/inject tests, not database-backed Railway end-to-end tests. No PostgreSQL migration was applied in this workspace. A read-only Bradbury status, contract-record, and provenance check was performed for the existing transaction; no new deployment or review transaction was submitted, and live Railway database/S3 persistence was not verified here.
