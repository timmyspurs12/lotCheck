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
- `GENLAYER_MODE=live`, `GENLAYER_NETWORK`, `GENLAYER_RPC`, deployed `GENLAYER_CONTRACT_ADDRESS`, and a funded `GENLAYER_PRIVATE_KEY` are needed for real writes. The backend does not generate credentials or silently fall back to a mock. `GENLAYER_MODE=disabled` means no GenLayer transaction can be submitted.
- The adapter currently uses the locked `genlayer-js` 1.1.8 stable API and its Asimov/Bradbury, Studio, and localnet chain definitions. The production config disallows Studio/localnet. A live connection, deployment, fee posture, signer, contract compatibility, or transaction has **not** been exercised here. Re-check the matching SDK/network release and fee requirements before enabling real writes.
- `GENLAYER_EXPLORER_URL` is optional. Transaction links are returned only when it is configured; no explorer URL is fabricated.
- The existing frontend has no built-in OIDC login/token provider. Production deployment must supply bearer tokens through its authentication integration; do not put a static access token in Vite build variables.

## API surface

All non-health routes require a verified reviewer identity. Request bodies and path/query inputs are schema-validated; submission accepts no decision field.

- `GET /api/health`
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

The server computes the canonical evidence-package SHA-256. The Intelligent Contract validates and records the supplied fingerprint and performs the documentary interpretation, but this contract deliberately does **not** recompute SHA-256 inside GenVM because authoritative support for that hashing API has not been established. The contract receives the canonical package and fingerprint in the same write; independent verification of the fingerprint against the transaction input must be validated against the configured network/RPC before relying on it as a chain-side recomputation. No such live verification has been performed.

`ACCEPT` means only: “The submitted documentary evidence appears sufficiently consistent under the configured review policy.” It is not certification or proof of land safety, physical remediation quality, sampling or laboratory validity, absence of contamination, or regulatory satisfaction. The contract and API summaries preserve this distinction.

## Validation

```bash
npm run backend:test
npm run backend:build
npm run build
```

Backend tests cover deterministic readiness/comparison, actual-byte hashing, canonical role/document response fields, strict GenLayer result parsing, failed lifecycle classification, evidence immutability rules, idempotent retry behavior, and a Fastify-inject test proving a client-supplied `{ "decision": "ACCEPT" }` is rejected. They are unit/inject tests, not database-backed integration tests. No PostgreSQL migration, GenLayer contract compilation/test, deployed SDK transaction, or live RPC operation has run in this workspace.
