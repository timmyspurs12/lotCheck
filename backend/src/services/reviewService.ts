import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { inTransaction } from '../lib/db.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import type { AppConfig } from '../config/env.js';
import type { Actor, ComparisonResult } from '../types/domain.js';
import type { CreateReviewInput, CreateSiteInput } from '../schemas/api.js';
import { appendAuditEvent } from '../repositories/auditRepository.js';
import { createSite as createSiteRow, createOrGetReviewerSite, getSite, listSites } from '../repositories/siteRepository.js';
import { createReviewRow, getRecordById, getReviewModel, listReviewModels } from '../repositories/reviewRepository.js';
import { compareDocuments, validateEvidencePair } from './comparisonService.js';
import { buildEvidencePackage } from './submissionPackage.js';
import type { GenLayerAdapter } from './genlayerAdapter.js';
import type { SubmissionWorker } from './submissionWorker.js';

export function submissionIdempotencyKey(reviewId: string) { return `review:${reviewId}`; }

export class ReviewService {
  constructor(
    private readonly db: Pool,
    private readonly config: AppConfig,
    private readonly adapter: GenLayerAdapter,
    private readonly worker: SubmissionWorker,
  ) {}

  listSites() { return listSites(this.db); }
  getSite(id: string) { return getSite(this.db, id); }
  createSite(input: CreateSiteInput, actor: Actor) { return createSiteRow(this.db, input, actor); }

  async createReview(input: CreateReviewInput, actor: Actor) {
    const id = randomUUID();
    await inTransaction(this.db, async (client) => {
      let version = 1;
      let supersededSiteId: string | null = null;
      if (input.supersedesReviewId) {
        const previous = await client.query<{ site_id: string; site_code: string; version: number; status: string }>(
          `SELECT r.site_id, s.site_code, r.version, r.status
           FROM reviews r JOIN sites s ON s.id=r.site_id WHERE r.id=$1::uuid FOR UPDATE OF r`,
          [input.supersedesReviewId],
        );
        if (!previous.rowCount) throw notFound('The review selected for versioning does not exist.');
        const prior = previous.rows[0]!;
        if (['SUBMITTING','SUBMITTED','CONSENSUS_PENDING','FINALIZING'].includes(prior.status)) {
          throw conflict('REVIEW_TRANSACTION_PENDING', 'A review cannot be superseded while its GenLayer transaction is pending. Wait for a terminal result or resolve the pending transaction first.');
        }
        if (input.siteId !== prior.site_code && input.siteId !== prior.site_id) {
          throw conflict('REVIEW_VERSION_SITE_MISMATCH', 'A new review version must refer to the same persisted site.');
        }
        version = prior.version + 1;
        supersededSiteId = prior.site_id;
      }

      const site = await createOrGetReviewerSite(client, input, actor);
      if (supersededSiteId && site.id !== supersededSiteId) throw conflict('REVIEW_VERSION_SITE_MISMATCH', 'A new review version must refer to the same persisted site.');
      await createReviewRow(client, {
        id,
        siteId: site.id,
        milestone: input.milestone,
        sourceReference: input.sourceReference,
        version,
        supersedesReviewId: input.supersedesReviewId,
        policyVersion: this.config.policyVersion,
      }, actor.id);
    });
    const review = await getReviewModel(this.db, id, this.config);
    if (!review) throw new Error('Review row was committed but could not be reloaded from persistent storage.');
    return review;
  }

  listReviews(filters: { status?: string; siteId?: string; search?: string; limit: number; offset: number }) {
    return listReviewModels(this.db, filters, this.config);
  }

  getReview(reviewId: string) { return getReviewModel(this.db, reviewId, this.config); }

  async compare(reviewId: string, actor: Actor) {
    await inTransaction(this.db, async (client) => {
      const current = await client.query<{ status: string; submitted_at: Date | null }>(
        'SELECT status, submitted_at FROM reviews WHERE id=$1::uuid FOR UPDATE', [reviewId],
      );
      if (!current.rowCount) throw notFound('The requested review does not exist.');
      if (current.rows[0]!.submitted_at || !['DRAFT','EVIDENCE_READY','COMPARISON_READY'].includes(current.rows[0]!.status)) {
        throw conflict('COMPARISON_LOCKED', 'Comparisons are immutable after GenLayer submission begins. Create a new review version to change evidence or comparison.');
      }
      const review = await getReviewModel(client, reviewId, this.config);
      if (!review) throw notFound('The requested review does not exist.');
      const project = review.evidence?.find((document) => document.role === 'PROJECT_CLOSEOUT') ?? null;
      const independent = review.evidence?.find((document) => document.role === 'INDEPENDENT_EVIDENCE') ?? null;
      const fields = compareDocuments(project, independent);
      const comparison: ComparisonResult = {
        projectDocumentId: project?.id ?? null,
        independentDocumentId: independent?.id ?? null,
        policyVersion: review.policyVersion,
        comparedAt: new Date().toISOString(),
        fields,
      };
      await client.query('DELETE FROM comparisons WHERE review_id=$1::uuid', [reviewId]);
      for (const item of fields) {
        await client.query(
          `INSERT INTO comparisons (id, review_id, field_name, project_value, independent_value, match_state, explanation, compared_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [randomUUID(), reviewId, item.key, item.projectValue, item.independentValue, item.match, item.whyItMatters, comparison.comparedAt],
        );
      }
      const precheck = validateEvidencePair(
        { reviewId: review.id, siteCode: review.siteId, milestone: review.milestone },
        { siteCode: review.siteId, name: review.siteName ?? review.siteId, location: review.location },
        review.evidence ?? [],
      );
      await client.query(
        `UPDATE reviews SET precheck_result=$2::jsonb,
          status=CASE WHEN status='EVIDENCE_READY' AND $3::boolean THEN 'COMPARISON_READY' ELSE status END
         WHERE id=$1::uuid`,
        [reviewId, JSON.stringify(precheck), precheck.eligible],
      );
      await appendAuditEvent(client, reviewId, 'COMPARISON_COMPLETED', actor.id, {
        status: 'COMPLETED',
        detail: `${fields.length} deterministic field comparisons were persisted under policy ${review.policyVersion}. The comparison is not a GenLayer decision.`,
      });
    });
    const updated = await getReviewModel(this.db, reviewId, this.config);
    if (!updated) throw new Error('Review comparison committed but could not be reloaded from persistent storage.');
    return updated;
  }

  async submit(reviewId: string, actor: Actor) {
    const priorJob = await this.db.query<{ request_hash: string; status: string }>(
      'SELECT request_hash, status FROM genlayer_jobs WHERE review_id=$1::uuid', [reviewId],
    );
    if (priorJob.rowCount) {
      const existing = await getReviewModel(this.db, reviewId, this.config);
      if (!existing) throw notFound('The requested review does not exist.');
      if (!['DONE','FAILED'].includes(priorJob.rows[0]!.status)) this.worker.kick();
      return existing;
    }
    if (!this.adapter.configured) throw new AppError(503, 'GENLAYER_NOT_CONFIGURED', 'GenLayer submission is disabled or missing a configured contract and signer. No transaction was created.');
    const health = await this.adapter.health();
    if (!health.connected) {
      const stillExisting = await this.db.query('SELECT 1 FROM genlayer_jobs WHERE review_id=$1::uuid', [reviewId]);
      if (stillExisting.rowCount) {
        const existing = await getReviewModel(this.db, reviewId, this.config);
        if (existing) return existing;
      }
      throw new AppError(503, 'GENLAYER_RPC_UNAVAILABLE', health.detail ?? 'The configured GenLayer RPC did not report a connected expected network. No transaction was created.');
    }

    const outcome = await inTransaction(this.db, async (client) => {
      const locked = await client.query<{ status: string; submitted_at: Date | null }>(
        'SELECT status, submitted_at FROM reviews WHERE id=$1::uuid FOR UPDATE', [reviewId],
      );
      if (!locked.rowCount) throw notFound('The requested review does not exist.');
      const existingJob = await client.query<{ status: string }>('SELECT status FROM genlayer_jobs WHERE review_id=$1::uuid', [reviewId]);
      if (existingJob.rowCount) return { kind: 'existing' as const };
      const review = await getReviewModel(client, reviewId, this.config);
      if (!review) throw notFound('The requested review does not exist.');

      const block = async (code: string, detail: string, precheck?: unknown) => {
        if (precheck) await client.query('UPDATE reviews SET precheck_result=$2::jsonb WHERE id=$1::uuid', [reviewId, JSON.stringify(precheck)]);
        await appendAuditEvent(client, reviewId, 'SUBMISSION_BLOCKED', actor.id, {
          status: 'BLOCKED', reasonCode: code, detail,
        });
        return { kind: 'blocked' as const, code, detail, precheck };
      };

      if (locked.rows[0]!.submitted_at || !['DRAFT','EVIDENCE_READY','COMPARISON_READY'].includes(review.state)) {
        return block('REVIEW_STATE_NOT_SUBMITTABLE', `Review state ${review.state} does not permit a new submission.`);
      }
      const precheck = validateEvidencePair(
        { reviewId: review.id, siteCode: review.siteId, milestone: review.milestone },
        { siteCode: review.siteId, name: review.siteName ?? review.siteId, location: review.location },
        review.evidence ?? [],
      );
      if (!precheck.eligible) return block(precheck.reasonCode ?? 'INSUFFICIENT_EVIDENCE_FIELDS', precheck.detail, precheck);
      if (!review.comparison) {
        return block('COMPARISON_REQUIRED', 'Run and persist the deterministic comparison before submission.');
      }
      if (review.state !== 'COMPARISON_READY') {
        return block('COMPARISON_REQUIRED', 'A successful deterministic comparison is required before GenLayer submission.');
      }
      if (review.comparison.policyVersion !== review.policyVersion) {
        return block('POLICY_VERSION_MISMATCH', 'The stored comparison was generated under a different policy version; rerun comparison before submission.');
      }

      const submittedAt = new Date().toISOString();
      const { packageJson, packageHash, package: evidencePackage } = buildEvidencePackage(review, review.evidence ?? [], this.config, submittedAt);
      const idempotencyKey = submissionIdempotencyKey(review.id);
      const requestHash = packageHash;
      await client.query(
        `INSERT INTO genlayer_jobs
          (id, review_id, idempotency_key, action, status, request_hash, package_json, evidence_package_hash)
         VALUES ($1,$2,$3,'INTERPRET','QUEUED',$4,$5,$6)`,
        [randomUUID(), review.id, idempotencyKey, requestHash, packageJson, packageHash],
      );
      await client.query(
        `UPDATE reviews SET status='SUBMITTING', submitted_at=$2::timestamptz,
          evidence_package_hash=$3, precheck_result=$4::jsonb, genlayer_contract=$5,
          genlayer_network=$6, transaction_status=NULL, consensus_state=NULL,
          error_code=NULL, error_message=NULL
         WHERE id=$1::uuid`,
        [review.id, submittedAt, packageHash, JSON.stringify(precheck), health.contractAddress, health.network],
      );
      await appendAuditEvent(client, review.id, 'SUBMISSION_QUEUED', actor.id, {
        status: 'SUBMITTING',
        packageHash,
        policyVersion: review.policyVersion,
        idempotencyKey,
        detail: 'The server canonicalized and hashed the complete evidence package. GenLayer interpretation is queued; no decision has been recorded.',
      });
      return { kind: 'created' as const, recordId: evidencePackage.record_id };
    });

    if (outcome.kind === 'blocked') throw new AppError(422, outcome.code, outcome.detail, outcome.precheck);
    if (outcome.kind === 'created' || outcome.kind === 'existing') this.worker.kick();
    const result = await getReviewModel(this.db, reviewId, this.config);
    if (!result) throw notFound('The requested review does not exist.');
    return result;
  }

  async status(reviewId: string) {
    const before = await getReviewModel(this.db, reviewId, this.config);
    if (!before) throw notFound('The requested review does not exist.');
    const refresh = await this.worker.refreshReview(reviewId);
    const after = await getReviewModel(this.db, reviewId, this.config);
    if (!after) throw notFound('The requested review does not exist.');
    return { review: after, statusRefresh: refresh };
  }

  getRecord(recordId: string) { return getRecordById(this.db, recordId, this.config); }
}
