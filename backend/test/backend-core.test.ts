import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { buildApiApp } from '../src/api/app.js';
import { mapDocument } from '../src/api/serializers.js';
import { loadConfig } from '../src/config/env.js';
import { hashCanonicalJson, sha256Hex } from '../src/lib/canonicalJson.js';
import { decisionSchema, genLayerModelResultSchema } from '../src/schemas/domain.js';
import { submitRequestSchema } from '../src/schemas/api.js';
import type { EvidenceDocument, NormalizedEvidence, ReviewReadModel } from '../src/types/domain.js';
import { evidencePackageSchema } from '../src/types/evidencePackage.js';
import { compareDocuments, validateEvidencePair } from '../src/services/comparisonService.js';
import { normalizeDocument } from '../src/services/documentNormalization.js';
import { buildEvidencePackage } from '../src/services/submissionPackage.js';
import { DisabledGenLayerAdapter, classifyGenLayerStatus } from '../src/services/genlayerAdapter.js';
import { ReviewService, submissionIdempotencyKey } from '../src/services/reviewService.js';
import { assertEvidenceMutable, type DocumentService } from '../src/services/documentService.js';
import { isRetryableSubmissionError } from '../src/services/submissionWorker.js';

const site = { siteCode: 'LOT-47', name: 'Riverbend Site', location: 'Odi' };
const reviewIdentity = { reviewId: 'c2ff0000-0000-4000-8000-000000000001', siteCode: site.siteCode, milestone: 'Soil treatment close-out' };
const sourceHashes = ['a'.repeat(64), 'b'.repeat(64)];

function normalized(hash: string, partial: Partial<NormalizedEvidence> = {}): NormalizedEvidence {
  return {
    site_id: 'LOT-47',
    site_name: 'Riverbend Site',
    milestone: 'Soil treatment close-out',
    location: 'Odi',
    report_reference: null,
    report_date: null,
    issuer: null,
    finding_reference: 'S-01',
    reported_findings: 'Below threshold',
    source_document_hash: hash,
    ...partial,
  };
}

function evidence(role: EvidenceDocument['role'], hash: string, fields: Partial<NormalizedEvidence> = {}, status: EvidenceDocument['processingStatus'] = 'READY'): EvidenceDocument {
  const id = role === 'PROJECT_CLOSEOUT' ? 'd2ff0000-0000-4000-8000-000000000001' : 'd2ff0000-0000-4000-8000-000000000002';
  return {
    id,
    reviewId: reviewIdentity.reviewId,
    role,
    filename: role === 'PROJECT_CLOSEOUT' ? 'closeout.txt' : 'independent.txt',
    mimeType: 'text/plain',
    size: 100,
    sha256: hash,
    source: null,
    uploadedAt: '2026-10-03T08:00:00.000Z',
    uploadedBy: 'test-reviewer',
    processingStatus: status,
    processingError: status === 'FAILED' ? 'No extractable text was found.' : null,
    storageReference: `${reviewIdentity.reviewId}/${id}`,
    normalizedEvidence: normalized(hash, fields),
    fields: [],
  };
}

function pair(overrides: { project?: EvidenceDocument; independent?: EvidenceDocument } = {}) {
  return [
    overrides.project ?? evidence('PROJECT_CLOSEOUT', sourceHashes[0]!),
    overrides.independent ?? evidence('INDEPENDENT_EVIDENCE', sourceHashes[1]!),
  ];
}

function reviewForPackage(documents: EvidenceDocument[]): ReviewReadModel {
  const fields = compareDocuments(documents[0]!, documents[1]!);
  return {
    id: reviewIdentity.reviewId,
    reviewId: reviewIdentity.reviewId,
    siteId: site.siteCode,
    siteName: site.name,
    location: site.location,
    milestone: reviewIdentity.milestone,
    sourceReference: 'claim-ref-01',
    policyVersion: 'lotcheck-document-review-v1',
    version: 1,
    supersedesReviewId: null,
    state: 'EVIDENCE_READY',
    decision: null,
    decisionExplanation: null,
    reasonCode: null,
    createdAt: '2026-10-03T08:00:00.000Z',
    submittedAt: null,
    finalizedAt: null,
    updatedAt: '2026-10-03T08:00:00.000Z',
    evidence: documents,
    comparison: {
      projectDocumentId: documents[0]!.id,
      independentDocumentId: documents[1]!.id,
      policyVersion: 'lotcheck-document-review-v1',
      comparedAt: '2026-10-03T08:01:00.000Z',
      fields,
    },
    events: [],
    recordId: null,
    transactionHash: null,
    transactionUrl: null,
    contractAddress: null,
    network: null,
    consensusState: null,
    transactionStatus: null,
    blockReference: null,
    errorCode: null,
    errorMessage: null,
    evidencePackageHash: null,
    precheck: null,
  };
}

const validPair = pair();

describe('LotCheck documentary backend core', () => {
  it('01 — allows a ready, distinct pair with explicit site and milestone identity through deterministic readiness checks', () => {
    expect(validateEvidencePair(reviewIdentity, site, validPair)).toMatchObject({ eligible: true });
    expect(genLayerModelResultSchema.safeParse({ decision: 'ACCEPT', reason_code: 'DOCUMENTARY_CONSISTENT', material_conflicts: [] }).success).toBe(true);
  });

  it('02 — blocks submission readiness when the project close-out role is missing', () => {
    const result = validateEvidencePair(reviewIdentity, site, [validPair[1]!]);
    expect(result).toMatchObject({ eligible: false, reasonCode: 'MISSING_PROJECT_DOCUMENT', decision: 'INSUFFICIENT' });
  });

  it('03 — blocks submission readiness when independent evidence is missing', () => {
    const result = validateEvidencePair(reviewIdentity, site, [validPair[0]!]);
    expect(result).toMatchObject({ eligible: false, reasonCode: 'MISSING_INDEPENDENT_DOCUMENT', decision: 'INSUFFICIENT' });
  });

  it('04 — blocks a document whose extraction failed, even when its role is present', () => {
    const failed = evidence('INDEPENDENT_EVIDENCE', sourceHashes[1]!, {}, 'FAILED');
    expect(validateEvidencePair(reviewIdentity, site, pair({ independent: failed }))).toMatchObject({
      eligible: false, reasonCode: 'DOCUMENT_PROCESSING_FAILED', decision: 'INSUFFICIENT',
    });
  });

  it('05 — treats an explicit site-code mismatch as a documentary dispute, not a successful comparison', () => {
    const independent = evidence('INDEPENDENT_EVIDENCE', sourceHashes[1]!, { site_id: 'LOT-99' });
    expect(validateEvidencePair(reviewIdentity, site, pair({ independent }))).toMatchObject({
      eligible: false, reasonCode: 'SITE_IDENTITY_CONFLICT', decision: 'DISPUTED',
    });
  });

  it('06 — refuses to submit when both documents lack adequate site identity fields', () => {
    const project = evidence('PROJECT_CLOSEOUT', sourceHashes[0]!, { site_id: null, site_name: null, location: null });
    const independent = evidence('INDEPENDENT_EVIDENCE', sourceHashes[1]!, { site_id: null, site_name: null, location: null });
    expect(validateEvidencePair(reviewIdentity, site, [project, independent])).toMatchObject({
      eligible: false, reasonCode: 'SITE_IDENTITY_UNRESOLVED', decision: 'INSUFFICIENT',
    });
  });

  it('07 — classifies clearly different milestone identities as a dispute before GenLayer submission', () => {
    const independent = evidence('INDEPENDENT_EVIDENCE', sourceHashes[1]!, { milestone: 'Vegetation removal and perimeter fencing' });
    expect(validateEvidencePair(reviewIdentity, site, pair({ independent }))).toMatchObject({
      eligible: false, reasonCode: 'MILESTONE_CONFLICT', decision: 'DISPUTED',
    });
  });

  it('08 — rejects identical actual-byte hashes as independent corroboration', () => {
    const duplicate = evidence('INDEPENDENT_EVIDENCE', sourceHashes[0]!);
    expect(validateEvidencePair(reviewIdentity, site, pair({ independent: duplicate }))).toMatchObject({
      eligible: false, reasonCode: 'DUPLICATE_DOCUMENT_HASH', decision: 'INSUFFICIENT',
    });
  });

  it('09 — compares normalized finding text and exposes an explicit opposing finding signal', () => {
    const project = evidence('PROJECT_CLOSEOUT', sourceHashes[0]!, { reported_findings: 'Contamination detected in soil' });
    const independent = evidence('INDEPENDENT_EVIDENCE', sourceHashes[1]!, { reported_findings: 'Contamination not detected in soil' });
    const comparison = compareDocuments(project, independent);
    expect(comparison.find((field) => field.key === 'REPORTED_FINDINGS')?.match).toBe('CONFLICT');
  });

  it('10 — hashes the uploaded bytes and extracts only explicit labels; unrecognized fields remain null', async () => {
    const bytes = Buffer.from([
      'Site ID: LOT-47',
      'Site name: Riverbend Site',
      'Location: Odi',
      'Milestone: Soil treatment close-out',
      'Finding reference: S-01',
      'Findings: Below threshold',
      'Unrecognized claimed safety score: 100',
    ].join('\n'));
    const digest = sha256Hex(bytes);
    const result = await normalizeDocument(bytes, 'text/plain', digest, 10_000);
    expect(result.normalized).toMatchObject({
      site_id: 'LOT-47',
      site_name: 'Riverbend Site',
      location: 'Odi',
      milestone: 'Soil treatment close-out',
      finding_reference: 'S-01',
      reported_findings: 'Below threshold',
      report_date: null,
      issuer: null,
      source_document_hash: digest,
    });
  });

  it('11 — canonicalizes the complete package, includes comparisons, and excludes any client-requested decision', () => {
    const model = reviewForPackage(validPair);
    const built = buildEvidencePackage(model, validPair, { maxPackageBytes: 80_000 }, '2026-10-03T08:02:00.000Z');
    const parsed = evidencePackageSchema.parse(JSON.parse(built.packageJson));
    expect(parsed.comparisons).toHaveLength(model.comparison!.fields.length);
    expect(parsed.evidence.map((item) => item.role).sort()).toEqual(['INDEPENDENT_EVIDENCE', 'PROJECT_CLOSEOUT']);
    expect('decision' in parsed).toBe(false);
    expect(built.packageHash).toBe(sha256Hex(built.packageJson));
    expect(evidencePackageSchema.safeParse({ ...parsed, decision: 'ACCEPT' }).success).toBe(false);
    expect(hashCanonicalJson(parsed).sha256).toBe(built.packageHash);
  });

  it('12 — enforces only the three allowed decision values and rejects malformed or prose-only model results', () => {
    expect(decisionSchema.safeParse('ACCEPT').success).toBe(true);
    expect(decisionSchema.safeParse('PENDING').success).toBe(false);
    expect(genLayerModelResultSchema.safeParse('I accept the review.').success).toBe(false);
    expect(genLayerModelResultSchema.safeParse({ decision: 'ACCEPT', reason_code: 'DOCUMENTARY_CONSISTENT', material_conflicts: [], extra: 'text' }).success).toBe(false);
  });

  it('13 — rejects ACCEPT when the structured GenLayer result also asserts a material conflict', () => {
    expect(genLayerModelResultSchema.safeParse({
      decision: 'ACCEPT', reason_code: 'DOCUMENTARY_CONSISTENT', material_conflicts: ['REPORTED_FINDINGS'],
    }).success).toBe(false);
  });

  it('14 — rejects a frontend-supplied decision on the actual submit route before the service can queue work', async () => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/lotcheck_test' });
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const submit = vi.fn(async () => { throw new Error('Submit service must not be called for an invalid client decision.'); });
    const reviewsStub = {
      listSites: vi.fn(), getSite: vi.fn(), createSite: vi.fn(), createReview: vi.fn(), listReviews: vi.fn(), getReview: vi.fn(),
      compare: vi.fn(), submit, status: vi.fn(), getRecord: vi.fn(),
    } as unknown as ReviewService;
    const documentsStub = { list: vi.fn(), upload: vi.fn(), getContent: vi.fn() } as unknown as DocumentService;
    const app = await buildApiApp({
      config,
      db: { query } as unknown as Pool,
      reviews: reviewsStub,
      documents: documentsStub,
      genlayer: new DisabledGenLayerAdapter(),
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/reviews/${reviewIdentity.reviewId}/submit`,
        payload: { decision: 'ACCEPT' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
      expect(submit).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('15 — keeps the submit request schema strict even when a client supplies extra fields', () => {
    expect(submitRequestSchema.safeParse({}).success).toBe(true);
    expect(submitRequestSchema.safeParse({ decision: 'ACCEPT' }).success).toBe(false);
  });

  it('16 — changing one uploaded byte changes the server-computed SHA-256 fingerprint', () => {
    const original = Buffer.from('close-out finding: below threshold');
    const altered = Buffer.from('close-out finding: above threshold');
    expect(sha256Hex(original)).not.toBe(sha256Hex(altered));
  });

  it('17 — exposes canonical evidence roles, document IDs, actual hashes, and processing status in API output', () => {
    const document = evidence('PROJECT_CLOSEOUT', sourceHashes[0]!);
    expect(mapDocument(document, site.siteCode)).toMatchObject({
      id: document.id,
      document_id: document.id,
      role: 'PROJECT_CLOSEOUT',
      sha256: sourceHashes[0],
      processingStatus: 'READY',
      processing_status: 'READY',
    });
  });

  it('18 — classifies actual terminal GenLayer failures and finalized execution errors as FAILED', () => {
    expect(classifyGenLayerStatus('CANCELED', 'NOT_VOTED')).toBe('FAILED');
    expect(classifyGenLayerStatus('UNDETERMINED', 'NOT_VOTED')).toBe('FAILED');
    expect(classifyGenLayerStatus('FINALIZED', 'FINISHED_WITH_ERROR')).toBe('FAILED');
    expect(classifyGenLayerStatus('PENDING', 'NOT_VOTED')).toBe('PENDING');
    expect(classifyGenLayerStatus('FINALIZED', 'FINISHED_WITH_RETURN')).toBe('FINALIZED');
  });

  it('19 — rejects evidence mutation after submission has started', () => {
    expect(() => assertEvidenceMutable('SUBMITTING', '2026-10-03T08:00:00.000Z')).toThrow(/immutable/i);
    expect(() => assertEvidenceMutable('SUBMITTED', '2026-10-03T08:00:00.000Z')).toThrow(/immutable/i);
    expect(() => assertEvidenceMutable('DRAFT', null)).not.toThrow();
  });

  it('20 — repeated submit after a queued or network-retry job reuses the persisted review job instead of inserting another', async () => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/lotcheck_test' });
    const persisted = {
      id: reviewIdentity.reviewId, site_id: 'a2ff0000-0000-4000-8000-000000000001', site_code: site.siteCode,
      site_name: site.name, location: site.location, milestone: reviewIdentity.milestone, claim_source_reference: null,
      version: 1, supersedes_review_id: null, status: 'SUBMITTING', decision: null, decision_explanation: null,
      reason_code: null, policy_version: 'lotcheck-document-review-v1', created_by: 'reviewer-1',
      created_at: '2026-10-03T08:00:00.000Z', submitted_at: '2026-10-03T08:01:00.000Z', finalized_at: null,
      updated_at: '2026-10-03T08:01:00.000Z', precheck_result: null, genlayer_contract: `0x${'c'.repeat(40)}`,
      genlayer_network: 'Testnet Asimov', transaction_hash: null, transaction_url: null, consensus_state: null,
      transaction_status: null, block_reference: null, evidence_package_hash: 'c'.repeat(64), record_id: null,
      error_code: null, error_message: null,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM genlayer_jobs WHERE review_id')) return { rows: [{ request_hash: 'c'.repeat(64), status: 'WAITING' }], rowCount: 1 };
      if (sql.startsWith('SELECT id FROM reviews WHERE id')) return { rows: [{ id: reviewIdentity.reviewId }], rowCount: 1 };
      if (sql.includes('FROM reviews r JOIN sites s')) return { rows: [persisted], rowCount: 1 };
      if (sql.includes('FROM documents WHERE review_id')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM evidence_fields')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM comparisons WHERE review_id')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM audit_events WHERE review_id')) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected test SQL: ${sql}`);
    });
    const adapter = { configured: true, health: vi.fn(), submit: vi.fn(), poll: vi.fn() } as unknown as ConstructorParameters<typeof ReviewService>[2];
    const worker = { kick: vi.fn() } as unknown as ConstructorParameters<typeof ReviewService>[3];
    const service = new ReviewService({ query } as unknown as Pool, config, adapter, worker);
    const result = await service.submit(reviewIdentity.reviewId, { id: 'reviewer-1', roles: ['lotcheck:reviewer'] });
    expect(result.state).toBe('SUBMITTING');
    expect(worker.kick).toHaveBeenCalledOnce();
    expect(adapter.health).not.toHaveBeenCalled();
    expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO genlayer_jobs'))).toHaveLength(0);
    expect(submissionIdempotencyKey(reviewIdentity.reviewId)).toBe(submissionIdempotencyKey(reviewIdentity.reviewId));
  });

  it('21 — treats network timeouts as retryable and keeps the same review-scoped idempotency key', () => {
    expect(isRetryableSubmissionError(new Error('connect ETIMEDOUT'))).toBe(true);
    expect(isRetryableSubmissionError(new Error('invalid contract input'))).toBe(false);
    expect(submissionIdempotencyKey(reviewIdentity.reviewId)).toBe(`review:${reviewIdentity.reviewId}`);
  });
});
