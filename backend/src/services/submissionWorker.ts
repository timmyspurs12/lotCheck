import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { inTransaction } from '../lib/db.js';
import { hashCanonicalJson } from '../lib/canonicalJson.js';
import { appendAuditEvent } from '../repositories/auditRepository.js';
import { evidencePackageSchema } from '../types/evidencePackage.js';
import type { EvidencePackage } from '../types/evidencePackage.js';
import { onchainRecordSchema } from '../schemas/domain.js';
import type { AppConfig } from '../config/env.js';
import type { GenLayerAdapter, GenLayerPollResult } from './genlayerAdapter.js';
import { GenLayerStatusError } from './genlayerAdapter.js';

interface JobRow {
  id: string;
  review_id: string;
  idempotency_key: string;
  package_json: string;
  request_hash: string;
  evidence_package_hash: string;
  transaction_hash: string | null;
  attempts: number;
  poll_errors: number;
  status: string;
}

export type RefreshResult = { refreshed: boolean; error?: { code: string; message: string } };

function cleanError(error: unknown, config: AppConfig) {
  const message = error instanceof Error ? error.message : String(error);
  const privateKey = config.genlayerPrivateKey;
  let sanitized = message;
  for (const secret of [privateKey, config.databaseUrl, config.genlayerRpc, config.s3AccessKeyId, config.s3SecretAccessKey, config.oidcJwksUrl]) {
    if (secret) sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  sanitized = sanitized
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:api[_-]?key|token|secret|signature)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .trim();
  return sanitized.slice(0, 1000) || 'The GenLayer operation failed without a message.';
}

function errorCode(error: unknown) {
  if (error instanceof GenLayerStatusError) return error.code;
  if (typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string') return String((error as { code: string }).code).slice(0, 100);
  return error instanceof Error && error.name ? error.name.slice(0, 100) : 'GENLAYER_OPERATION_FAILED';
}

export function isRetryableSubmissionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|ETIMEDOUT|EAI_AGAIN|network|socket|fetch|ECONN|connection|reset|429|502|503|504|rate limit|temporar|busy|unavailable/i.test(message);
}

function transientPollError(error: unknown) {
  return error instanceof GenLayerStatusError && ['GENLAYER_STATUS_UNAVAILABLE', 'ONCHAIN_RECORD_READ_FAILED'].includes(error.code);
}

function retryDelay(attempt: number) { return Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6)); }

class EvidencePackageIntegrityError extends Error {
  readonly code = 'EVIDENCE_PACKAGE_INTEGRITY_FAILED';
  constructor() { super('The persisted evidence package does not match its canonical serialization or stored SHA-256 fingerprint.'); }
}

function parseVerifiedPackage(job: JobRow): EvidencePackage {
  try {
    const value = evidencePackageSchema.parse(JSON.parse(job.package_json));
    const canonical = hashCanonicalJson(value);
    if (canonical.serialized !== job.package_json || canonical.sha256 !== job.evidence_package_hash || job.request_hash !== job.evidence_package_hash) {
      throw new EvidencePackageIntegrityError();
    }
    return value;
  } catch (error) {
    if (error instanceof EvidencePackageIntegrityError) throw error;
    throw new EvidencePackageIntegrityError();
  }
}

function rank(state: string) {
  return ({ SUBMITTING: 0, SUBMITTED: 1, CONSENSUS_PENDING: 2, FINALIZING: 3, FINALIZED: 4, FAILED: 4 } as Record<string, number>)[state] ?? -1;
}

function intendedReviewState(transactionStatus: string) {
  return ['READY_TO_FINALIZE', 'FINALIZING'].includes(transactionStatus) ? 'FINALIZING' : 'CONSENSUS_PENDING';
}

function validateOnchainProvenance(recordInput: unknown, packageValue: EvidencePackage, packageHash: string) {
  const validated = onchainRecordSchema.safeParse(recordInput);
  if (!validated.success) throw new GenLayerStatusError('INVALID_ONCHAIN_RECORD', `The on-chain contract record failed schema validation: ${validated.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  const record = validated.data;
  const project = packageValue.evidence.find((evidence) => evidence.role === 'PROJECT_CLOSEOUT');
  const independent = packageValue.evidence.find((evidence) => evidence.role === 'INDEPENDENT_EVIDENCE');
  const expectedReferences = [project?.sha256, independent?.sha256];
  if (!project || !independent) throw new GenLayerStatusError('INVALID_EVIDENCE_PACKAGE', 'The persisted submission package does not contain exactly one document per role.');
  const fieldsMatch = record.review_id === packageValue.review_id
    && record.record_id === packageValue.record_id
    && record.site_id === packageValue.site.site_id
    && record.milestone === packageValue.milestone
    && record.evidence_package_hash === packageHash
    && record.project_document_hash === project.sha256
    && record.independent_document_hash === independent.sha256
    && record.policy_version === packageValue.policy.version
    && record.timestamp === packageValue.submission.submitted_at
    && record.evidence_references[0] === expectedReferences[0]
    && record.evidence_references[1] === expectedReferences[1]
    && record.decision_source === 'GENLAYER_INTERPRETATION';
  if (!fieldsMatch) throw new GenLayerStatusError('ONCHAIN_PROVENANCE_MISMATCH', 'The GenLayer record does not match the submitted site, milestone, source hashes, policy, timestamp, and canonical package hash.');
  return record;
}

export class SubmissionWorker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private stopped = false;
  private activePromise: Promise<void> | null = null;

  constructor(private readonly db: Pool, private readonly adapter: GenLayerAdapter, private readonly config: AppConfig) {}

  start() {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => this.kick(), this.config.genlayerJobIntervalMs);
    this.timer.unref?.();
    this.kick();
  }

  kick() {
    if (this.stopped || this.inFlight) return;
    this.inFlight = true;
    this.activePromise = this.processOne()
      .catch(() => undefined)
      .finally(() => { this.inFlight = false; this.activePromise = null; });
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.activePromise?.catch(() => undefined);
  }

  async refreshReview(reviewId: string): Promise<RefreshResult> {
    const result = await this.db.query<JobRow>(
      `SELECT id, review_id, idempotency_key, package_json, request_hash, evidence_package_hash, transaction_hash, attempts, poll_errors, status
       FROM genlayer_jobs WHERE review_id=$1::uuid`, [reviewId],
    );
    const job = result.rows[0];
    if (!job?.transaction_hash || !this.adapter.configured || ['FAILED','RUNNING'].includes(job.status)) return { refreshed: false };
    let packageValue: EvidencePackage;
    try { packageValue = parseVerifiedPackage(job); }
    catch (error) {
      const code = errorCode(error);
      const message = cleanError(error, this.config);
      await this.failJob(job, code, message, job.transaction_hash);
      return { refreshed: true, error: { code, message } };
    }
    let poll: GenLayerPollResult;
    try {
      poll = await this.adapter.poll(job.transaction_hash, { reviewId: job.review_id, recordId: packageValue.record_id, packageHash: job.evidence_package_hash });
    } catch (error) {
      const failure = await this.handlePollError(job, error);
      return { refreshed: true, error: failure };
    }
    try {
      await this.applyPoll(job, packageValue, poll);
      return { refreshed: true };
    } catch (error) {
      return { refreshed: false, error: { code: 'READ_MODEL_UPDATE_FAILED', message: cleanError(error, this.config) } };
    }
  }

  private async claimOne() {
    return inTransaction(this.db, async (client) => {
      const result = await client.query<JobRow>(
        `WITH candidate AS (
          SELECT id FROM genlayer_jobs
          WHERE status IN ('QUEUED','WAITING','RUNNING')
            AND available_at <= now()
            AND (locked_until IS NULL OR locked_until < now())
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE genlayer_jobs j
        SET status='RUNNING',
            attempts=j.attempts + CASE WHEN j.transaction_hash IS NULL THEN 1 ELSE 0 END,
            locked_until=now() + interval '5 minutes'
        FROM candidate c WHERE j.id=c.id
        RETURNING j.id, j.review_id, j.idempotency_key, j.package_json, j.request_hash, j.evidence_package_hash, j.transaction_hash, j.attempts, j.poll_errors, j.status`,
      );
      return result.rows[0] ?? null;
    });
  }

  private async processOne() {
    if (!this.adapter.configured) return;
    const job = await this.claimOne();
    if (!job) return;
    if (job.transaction_hash) await this.processPoll(job);
    else await this.processSubmit(job);
    await this.db.query(
      `INSERT INTO service_heartbeats (service_name, last_seen_at, detail)
       VALUES ('genlayer-worker', now(), 'Worker loop completed a job check')
       ON CONFLICT (service_name) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at, detail=EXCLUDED.detail`,
    ).catch(() => undefined);
  }

  private async processSubmit(job: JobRow) {
    try { parseVerifiedPackage(job); }
    catch (error) {
      await this.failJob(job, errorCode(error), cleanError(error, this.config), null);
      return;
    }
    let transactionHash: string;
    try {
      transactionHash = await this.adapter.submit(job.package_json, job.evidence_package_hash);
    } catch (error) {
      const code = errorCode(error);
      const message = cleanError(error, this.config);
      const retryable = isRetryableSubmissionError(error) && job.attempts < this.config.genlayerJobMaxAttempts;
      if (retryable) await this.scheduleSubmitRetry(job, code, message);
      else await this.failJob(job, code, message, null);
      return;
    }
    await inTransaction(this.db, async (client) => {
        const locked = await client.query<JobRow>(
          'SELECT id, review_id, idempotency_key, package_json, request_hash, evidence_package_hash, transaction_hash, attempts, poll_errors, status FROM genlayer_jobs WHERE id=$1::uuid FOR UPDATE', [job.id],
        );
        const current = locked.rows[0];
        if (!current || ['DONE','FAILED'].includes(current.status)) return;
        if (current.transaction_hash) {
          if (current.transaction_hash !== transactionHash) {
            await appendAuditEvent(client, current.review_id, 'GENLAYER_SUBMISSION_RETRY', 'genlayer-worker', {
              status: 'DUPLICATE_SUBMISSION', reference: transactionHash,
              detail: 'An idempotent retry produced an additional transaction hash; the first persisted transaction remains the tracked transaction.',
            });
          }
          return;
        }
        await client.query(
          `UPDATE genlayer_jobs SET transaction_hash=$2, status='WAITING', available_at=now()+($3::int * interval '1 millisecond'), locked_until=NULL, last_error_code=NULL, last_error=NULL
           WHERE id=$1::uuid`, [job.id, transactionHash, this.config.genlayerPollIntervalMs],
        );
        const reviewResult = await client.query<{ status: string }>('SELECT status FROM reviews WHERE id=$1::uuid FOR UPDATE', [job.review_id]);
        const state = reviewResult.rows[0]?.status;
        if (state === 'SUBMITTING') {
          await client.query(
            `UPDATE reviews SET status='SUBMITTED', transaction_hash=$2, transaction_status=NULL, consensus_state=NULL, error_code=NULL, error_message=NULL
             WHERE id=$1::uuid`, [job.review_id, transactionHash],
          );
          await appendAuditEvent(client, job.review_id, 'TRANSACTION_SUBMITTED', 'genlayer-worker', {
            status: 'SUBMITTED', reference: transactionHash, detail: 'GenLayer SDK returned a transaction hash; finality and execution result are still pending.',
          });
        }
    });
  }

  private async scheduleSubmitRetry(job: JobRow, code: string, message: string) {
    await inTransaction(this.db, async (client) => {
      const latest = await client.query<{ status: string }>('SELECT status FROM genlayer_jobs WHERE id=$1::uuid FOR UPDATE', [job.id]);
      if (!latest.rowCount || ['DONE','FAILED'].includes(latest.rows[0]!.status)) return;
      await client.query(
        `UPDATE genlayer_jobs SET status='WAITING', available_at=now()+($2::int * interval '1 millisecond'), locked_until=NULL, last_error_code=$3, last_error=$4
         WHERE id=$1::uuid`, [job.id, retryDelay(job.attempts), code, message],
      );
      await appendAuditEvent(client, job.review_id, 'GENLAYER_SUBMISSION_RETRY', 'genlayer-worker', {
        status: 'RETRY_SCHEDULED', detail: `Submission attempt ${job.attempts} failed: ${message}`,
      });
    });
  }

  private async processPoll(job: JobRow) {
    let packageValue: EvidencePackage;
    try { packageValue = parseVerifiedPackage(job); }
    catch (error) {
      await this.failJob(job, errorCode(error), cleanError(error, this.config), job.transaction_hash);
      return;
    }
    let poll: GenLayerPollResult;
    try {
      poll = await this.adapter.poll(job.transaction_hash!, { reviewId: job.review_id, recordId: packageValue.record_id, packageHash: job.evidence_package_hash });
    } catch (error) {
      await this.handlePollError(job, error);
      return;
    }
    await this.applyPoll(job, packageValue, poll);
  }

  private async handlePollError(job: JobRow, error: unknown) {
    const code = errorCode(error);
    const message = cleanError(error, this.config);
    const chainState = error instanceof GenLayerStatusError ? error.chainState : undefined;
    if (transientPollError(error)) await this.recordTransientPollError(job, code, message, chainState);
    else await this.failJob(job, code, message, job.transaction_hash, chainState?.transactionStatus, chainState?.consensusState, chainState?.blockReference);
    return { code, message };
  }

  private async applyPoll(job: JobRow, packageValue: EvidencePackage, poll: GenLayerPollResult) {
    if (poll.state === 'FAILED') {
      await this.failJob(job, poll.errorCode ?? 'GENLAYER_TRANSACTION_FAILED', poll.errorMessage ?? `GenLayer transaction entered terminal state ${poll.transactionStatus}.`, job.transaction_hash, poll.transactionStatus, poll.consensusState, poll.blockReference);
      return;
    }
    if (poll.state === 'PENDING') {
      await inTransaction(this.db, async (client) => {
        const currentJob = await client.query<{ status: string }>('SELECT status FROM genlayer_jobs WHERE id=$1::uuid FOR UPDATE', [job.id]);
        if (!currentJob.rowCount || ['DONE','FAILED'].includes(currentJob.rows[0]!.status)) return;
        const reviewResult = await client.query<{ status: string; transaction_status: string | null }>('SELECT status, transaction_status FROM reviews WHERE id=$1::uuid FOR UPDATE', [job.review_id]);
        const review = reviewResult.rows[0];
        if (!review || ['FINALIZED','FAILED'].includes(review.status)) return;
        const next = intendedReviewState(poll.transactionStatus);
        const statusChanged = review.transaction_status !== poll.transactionStatus;
        if (rank(next) > rank(review.status)) {
          await client.query(
            `UPDATE reviews SET status=$2, transaction_status=$3, consensus_state=$4, block_reference=$5::jsonb
             WHERE id=$1::uuid`,
            [job.review_id, next, poll.transactionStatus, poll.consensusState, JSON.stringify(poll.blockReference ?? {})],
          );
        } else {
          await client.query(
            `UPDATE reviews SET transaction_status=$2, consensus_state=$3, block_reference=$4::jsonb
             WHERE id=$1::uuid`,
            [job.review_id, poll.transactionStatus, poll.consensusState, JSON.stringify(poll.blockReference ?? {})],
          );
        }
        if (statusChanged) {
          const eventType = next === 'CONSENSUS_PENDING' ? 'GENLAYER_CONSENSUS_PENDING' : next === 'FINALIZING' ? 'GENLAYER_FINALIZING' : 'GENLAYER_STATUS_UPDATED';
          await appendAuditEvent(client, job.review_id, eventType, 'genlayer-worker', {
            status: poll.transactionStatus, reference: job.transaction_hash,
            detail: `GenLayer RPC reported transaction status ${poll.transactionStatus}; no decision is recorded until final execution and contract storage are verified.`,
          });
        }
        await client.query(
          `UPDATE genlayer_jobs SET status='WAITING', available_at=now()+($2::int * interval '1 millisecond'), locked_until=NULL, last_error_code=NULL, last_error=NULL
           WHERE id=$1::uuid`, [job.id, this.config.genlayerPollIntervalMs],
        );
      });
      return;
    }

    let record;
    try { record = validateOnchainProvenance(poll.record, packageValue, job.evidence_package_hash); }
    catch (error) { await this.failJob(job, errorCode(error), cleanError(error, this.config), job.transaction_hash, poll.transactionStatus, poll.consensusState, poll.blockReference); return; }

    await inTransaction(this.db, async (client) => {
      const currentJob = await client.query<{ status: string }>('SELECT status FROM genlayer_jobs WHERE id=$1::uuid FOR UPDATE', [job.id]);
      if (!currentJob.rowCount || ['DONE','FAILED'].includes(currentJob.rows[0]!.status)) return;
      const reviewResult = await client.query<{ status: string; decision: string | null }>('SELECT status, decision FROM reviews WHERE id=$1::uuid FOR UPDATE', [job.review_id]);
      const current = reviewResult.rows[0];
      if (!current || current.status === 'FINALIZED') return;
      if (current.status === 'FAILED') return;
      const transactionHash = job.transaction_hash!;
      const finalizedAt = new Date().toISOString();
      await client.query(
        `INSERT INTO decisions
          (id, review_id, decision, summary, reason_code, policy_version, evidence_package_hash,
           project_document_hash, independent_document_hash, material_conflicts, evidence_references,
           decision_source, contract_address, network, transaction_hash, block_reference,
           onchain_record_id, created_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16::jsonb,$17,$18,$19)
         ON CONFLICT (review_id) DO NOTHING`,
        [randomUUID(), job.review_id, record.decision, record.summary, record.reason_code, record.policy_version,
          record.evidence_package_hash, record.project_document_hash, record.independent_document_hash,
          JSON.stringify(record.material_conflicts), JSON.stringify(record.evidence_references), record.decision_source,
          this.config.genlayerContractAddress!, this.adapter.network!, transactionHash,
          JSON.stringify(poll.blockReference ?? {}), record.record_id, finalizedAt, 'genlayer-worker'],
      );
      await client.query(
        `UPDATE reviews SET status='FINALIZED', decision=$2, decision_explanation=$3, reason_code=$4,
          finalized_at=$5, record_id=$6, transaction_status=$7, consensus_state=$8, block_reference=$9::jsonb,
          error_code=NULL, error_message=NULL
         WHERE id=$1::uuid AND decision IS NULL`,
        [job.review_id, record.decision, record.summary, record.reason_code, finalizedAt, record.record_id,
          poll.transactionStatus, poll.consensusState, JSON.stringify(poll.blockReference ?? {})],
      );
      await client.query(
        `UPDATE genlayer_jobs SET status='DONE', locked_until=NULL, last_error_code=NULL, last_error=NULL, updated_at=now()
         WHERE id=$1::uuid`, [job.id],
      );
      await appendAuditEvent(client, job.review_id, 'DECISION_FINALIZED', 'genlayer-worker', {
        status: record.decision, reference: transactionHash, detail: record.summary,
      });
      await appendAuditEvent(client, job.review_id, 'ONCHAIN_RECORD_RECORDED', 'genlayer-worker', {
        status: 'FINALIZED', reference: record.record_id,
        detail: 'Decision and provenance were read from the configured GenLayer contract after finalized execution succeeded.',
      });
    });
  }

  private async recordTransientPollError(job: JobRow, code: string, message: string, chainState?: { transactionStatus: string; consensusState: string | null; blockReference?: Record<string, unknown> }) {
    await inTransaction(this.db, async (client) => {
      const current = await client.query<{ status: string; last_error_code: string | null; poll_errors: number }>(
        'SELECT status, last_error_code, poll_errors FROM genlayer_jobs WHERE id=$1::uuid FOR UPDATE', [job.id],
      );
      if (!current.rowCount || ['DONE','FAILED'].includes(current.rows[0]!.status)) return;
      const shouldAudit = current.rows[0]!.last_error_code !== code;
      await client.query(
        `UPDATE genlayer_jobs SET status='WAITING', poll_errors=poll_errors+1,
          available_at=now()+($2::int * interval '1 millisecond'), locked_until=NULL,
          last_error_code=$3, last_error=$4 WHERE id=$1::uuid`,
        [job.id, this.config.genlayerPollIntervalMs, code, message],
      );
      if (chainState) {
        await client.query(
          `UPDATE reviews SET transaction_status=$2, consensus_state=$3, block_reference=$4::jsonb
           WHERE id=$1::uuid AND status NOT IN ('FINALIZED','FAILED')`,
          [job.review_id, chainState.transactionStatus, chainState.consensusState, JSON.stringify(chainState.blockReference ?? {})],
        );
      }
      if (shouldAudit) await appendAuditEvent(client, job.review_id, 'GENLAYER_STATUS_CHECK_FAILED', 'genlayer-worker', {
        status: 'RETRYING', reference: job.transaction_hash, detail: `${code}: ${message}`,
      });
    });
  }

  private async failJob(job: JobRow, code: string, message: string, transactionHash: string | null, actualTransactionStatus?: string, actualConsensusState?: string | null, blockReference?: Record<string, unknown>) {
    await inTransaction(this.db, async (client) => {
      const locked = await client.query<{ status: string; transaction_hash: string | null }>(
        'SELECT status, transaction_hash FROM genlayer_jobs WHERE id=$1::uuid FOR UPDATE', [job.id],
      );
      if (!locked.rowCount || ['DONE','FAILED'].includes(locked.rows[0]!.status)) return;
      const actualHash = transactionHash ?? locked.rows[0]!.transaction_hash;
      await client.query(
        `UPDATE genlayer_jobs SET status='FAILED', locked_until=NULL,
          last_error_code=$2, last_error=$3 WHERE id=$1::uuid`, [job.id, code, message],
      );
      const review = await client.query<{ status: string }>('SELECT status FROM reviews WHERE id=$1::uuid FOR UPDATE', [job.review_id]);
      const currentState = review.rows[0]?.status;
      if (currentState && !['FINALIZED','FAILED'].includes(currentState)) {
        await client.query(
          `UPDATE reviews SET status='FAILED', error_code=$2, error_message=$3,
            transaction_hash=COALESCE(transaction_hash,$4), transaction_status=COALESCE($5,transaction_status),
            consensus_state=COALESCE($6,consensus_state), block_reference=COALESCE($7::jsonb,block_reference)
           WHERE id=$1::uuid`, [job.review_id, code, message, actualHash, actualTransactionStatus ?? null, actualConsensusState ?? null, blockReference ? JSON.stringify(blockReference) : null],
        );
      }
      await appendAuditEvent(client, job.review_id, 'TRANSACTION_FAILED', 'genlayer-worker', {
        status: 'FAILED', reference: actualHash, detail: `${code}: ${message}`,
      });
    });
  }
}
