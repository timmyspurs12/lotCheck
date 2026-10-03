import type { Pool, PoolClient } from 'pg';
import { notFound } from '../lib/errors.js';
import { evidenceRoleSchema, normalizedEvidenceSchema } from '../schemas/domain.js';
import type { ComparisonResult, EvidenceDocument, ReviewReadModel } from '../types/domain.js';
import type { AppConfig } from '../config/env.js';
import { appendAuditEvent } from './auditRepository.js';

export type Queryable = Pool | PoolClient;

type ReviewDbRow = {
  id: string;
  site_id: string;
  site_code: string;
  site_name: string;
  location: string | null;
  milestone: string;
  claim_source_reference: string | null;
  version: number;
  supersedes_review_id: string | null;
  status: ReviewReadModel['state'];
  decision: ReviewReadModel['decision'];
  decision_explanation: string | null;
  reason_code: string | null;
  policy_version: string;
  created_at: Date | string;
  submitted_at: Date | string | null;
  finalized_at: Date | string | null;
  updated_at: Date | string;
  precheck_result: unknown;
  genlayer_contract: string | null;
  genlayer_network: string | null;
  transaction_hash: string | null;
  transaction_url: string | null;
  consensus_state: string | null;
  transaction_status: string | null;
  block_reference: unknown;
  evidence_package_hash: string | null;
  record_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_by: string;
};

type DocumentDbRow = {
  id: string;
  review_id: string;
  role: string;
  filename: string;
  mime_type: string;
  size: string | number;
  sha256: string;
  source: string | null;
  uploaded_at: Date | string;
  uploaded_by: string;
  processing_status: 'READY' | 'FAILED';
  processing_error_code: string | null;
  processing_error: string | null;
  storage_reference: string;
};

type FieldDbRow = { document_id: string; field_name: string; field_value: string | null; extraction_source: string };
type ComparisonDbRow = { review_id: string; field_name: string; project_value: string | null; independent_value: string | null; match_state: ComparisonResult['fields'][number]['match']; explanation: string | null; compared_at: Date | string };
type EventDbRow = { id: string; review_id: string; event_type: string; actor: string; occurred_at: Date | string; metadata: unknown };

const reviewBaseSql = `
  SELECT r.id, r.site_id, s.site_code, s.name AS site_name, s.location,
    r.milestone, r.claim_source_reference, r.version, r.supersedes_review_id,
    r.status, r.decision, r.decision_explanation, r.reason_code, r.policy_version,
    r.created_at, r.submitted_at, r.finalized_at, r.updated_at, r.precheck_result,
    r.genlayer_contract, r.genlayer_network, r.transaction_hash, r.transaction_url,
    r.consensus_state, r.transaction_status, r.block_reference, r.evidence_package_hash,
    r.record_id, r.error_code, r.error_message, r.created_by
  FROM reviews r JOIN sites s ON s.id = r.site_id
`;

const normalizedKeys = ['site_id','site_name','milestone','location','report_reference','report_date','issuer','finding_reference','reported_findings'] as const;

function iso(value: Date | string | null) { return value == null ? null : new Date(value).toISOString(); }
function number(value: string | number) { return typeof value === 'number' ? value : Number(value); }
function obj(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function eventView(row: EventDbRow) {
  const metadata = obj(row.metadata);
  const eventType = row.event_type;
  const labels: Record<string, string> = {
    REVIEW_CREATED: 'Review created',
    REVIEW_VERSIONED: 'Review version created',
    EVIDENCE_UPLOADED: `${String(metadata.roleLabel ?? 'Evidence')} uploaded`,
    DOCUMENT_PROCESSING_FAILED: `${String(metadata.roleLabel ?? 'Evidence')} processing failed`,
    COMPARISON_COMPLETED: 'Evidence comparison completed',
    SUBMISSION_BLOCKED: 'Submission blocked by deterministic checks',
    SUBMISSION_QUEUED: 'GenLayer submission queued',
    TRANSACTION_SUBMITTED: 'GenLayer transaction submitted',
    GENLAYER_STATUS_UPDATED: 'GenLayer transaction status updated',
    GENLAYER_CONSENSUS_PENDING: 'GenLayer consensus pending',
    GENLAYER_FINALIZING: 'GenLayer finalizing transaction',
    GENLAYER_STATUS_CHECK_FAILED: 'GenLayer status check failed; retry scheduled',
    GENLAYER_SUBMISSION_RETRY: 'GenLayer submission retry scheduled',
    TRANSACTION_FAILED: 'GenLayer transaction failed',
    DECISION_FINALIZED: 'GenLayer decision finalized',
    ONCHAIN_RECORD_RECORDED: 'On-chain record verified and stored',
  };
  const status = typeof metadata.status === 'string' ? metadata.status : eventType === 'TRANSACTION_FAILED' || eventType === 'DOCUMENT_PROCESSING_FAILED' ? 'FAILED' : eventType === 'TRANSACTION_SUBMITTED' ? 'SUBMITTED' : eventType === 'SUBMISSION_QUEUED' ? 'SUBMITTING' : eventType === 'COMPARISON_COMPLETED' ? 'COMPLETED' : 'RECORDED';
  return {
    id: row.id,
    label: labels[eventType] ?? eventType.toLowerCase().replaceAll('_', ' '),
    status: status.toUpperCase(),
    timestamp: iso(row.occurred_at)!,
    actor: row.actor,
    reference: typeof metadata.reference === 'string' ? metadata.reference : null,
    detail: typeof metadata.detail === 'string' ? metadata.detail : null,
  };
}

function makeDocument(row: DocumentDbRow, fields: FieldDbRow[]): EvidenceDocument {
  const values: Record<string, string | null> = { source_document_hash: row.sha256 };
  for (const key of normalizedKeys) values[key] = null;
  const extractionStatus = new Map<string, string>();
  for (const field of fields) {
    if (field.field_name in values && field.field_name !== 'source_document_hash') values[field.field_name] = field.field_value;
    extractionStatus.set(field.field_name, field.extraction_source);
  }
  const normalizedEvidence = normalizedEvidenceSchema.parse(values);
  const fieldViews: EvidenceDocument['fields'] = normalizedKeys.map((key) => ({
    key,
    label: key.replaceAll('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase()),
    value: normalizedEvidence[key],
    extractionStatus: extractionStatus.get(key) ?? 'NOT_EXTRACTED',
  }));
  fieldViews.push({
    key: 'source_document_hash',
    label: 'Source document SHA-256',
    value: row.sha256,
    extractionStatus: 'SERVER_CALCULATED',
  });
  const role = evidenceRoleSchema.parse(row.role);
  return {
    id: row.id,
    reviewId: row.review_id,
    role,
    filename: row.filename,
    mimeType: row.mime_type,
    size: number(row.size),
    sha256: row.sha256,
    source: row.source,
    uploadedAt: iso(row.uploaded_at)!,
    uploadedBy: row.uploaded_by,
    processingStatus: row.processing_status,
    processingError: row.processing_error,
    storageReference: row.storage_reference,
    normalizedEvidence,
    fields: fieldViews,
  };
}

function makeComparison(reviewId: string, docs: EvidenceDocument[], rows: ComparisonDbRow[], policyVersion: string): ComparisonResult | null {
  const reviewRows = rows.filter((row) => row.review_id === reviewId);
  if (!reviewRows.length) return null;
  const project = docs.find((document) => document.role === 'PROJECT_CLOSEOUT');
  const independent = docs.find((document) => document.role === 'INDEPENDENT_EVIDENCE');
  return {
    projectDocumentId: project?.id ?? null,
    independentDocumentId: independent?.id ?? null,
    policyVersion,
    comparedAt: reviewRows.reduce((latest, row) => new Date(row.compared_at).getTime() > new Date(latest).getTime() ? iso(row.compared_at)! : latest, iso(reviewRows[0]!.compared_at)!),
    fields: reviewRows.map((row) => ({
      key: row.field_name,
      label: row.field_name.replaceAll('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase()),
      projectValue: row.project_value,
      independentValue: row.independent_value,
      match: row.match_state,
      whyItMatters: row.explanation,
    })),
  };
}

export async function loadReviewsByIds(db: Queryable, ids: string[], config: Pick<AppConfig, 'genlayerExplorerUrl'>): Promise<ReviewReadModel[]> {
  if (!ids.length) return [];
  const baseResult = await db.query<ReviewDbRow>(`${reviewBaseSql} WHERE r.id = ANY($1::uuid[])`, [ids]);
  const actualIds = baseResult.rows.map((row) => row.id);
  if (!actualIds.length) return [];
  const [documentResult, fieldResult, comparisonResult, eventResult] = await Promise.all([
    db.query<DocumentDbRow>('SELECT * FROM documents WHERE review_id = ANY($1::uuid[]) ORDER BY uploaded_at, id', [actualIds]),
    db.query<FieldDbRow>(`SELECT f.document_id, f.field_name, f.field_value, f.extraction_source
      FROM evidence_fields f JOIN documents d ON d.id=f.document_id WHERE d.review_id=ANY($1::uuid[]) ORDER BY f.field_name`, [actualIds]),
    db.query<ComparisonDbRow>('SELECT * FROM comparisons WHERE review_id = ANY($1::uuid[]) ORDER BY field_name', [actualIds]),
    db.query<EventDbRow>('SELECT * FROM audit_events WHERE review_id = ANY($1::uuid[]) ORDER BY occurred_at, id', [actualIds]),
  ]);
  const fieldsByDocument = new Map<string, FieldDbRow[]>();
  for (const field of fieldResult.rows) {
    const items = fieldsByDocument.get(field.document_id) ?? [];
    items.push(field);
    fieldsByDocument.set(field.document_id, items);
  }
  const docsByReview = new Map<string, EvidenceDocument[]>();
  for (const row of documentResult.rows) {
    const document = makeDocument(row, fieldsByDocument.get(row.id) ?? []);
    const items = docsByReview.get(row.review_id) ?? [];
    items.push(document);
    docsByReview.set(row.review_id, items);
  }
  const eventsByReview = new Map<string, ReturnType<typeof eventView>[]>();
  for (const event of eventResult.rows) {
    const items = eventsByReview.get(event.review_id) ?? [];
    items.push(eventView(event));
    eventsByReview.set(event.review_id, items);
  }
  const byId = new Map<string, ReviewReadModel>();
  for (const row of baseResult.rows) {
    const evidence = docsByReview.get(row.id) ?? [];
    const comparisonRows = comparisonResult.rows.filter((comparison) => comparison.review_id === row.id);
    const comparison = makeComparison(row.id, evidence, comparisonRows, row.policy_version);
    const transactionUrl = row.transaction_hash && config.genlayerExplorerUrl
      ? `${config.genlayerExplorerUrl.replace(/\/$/, '')}/tx/${row.transaction_hash}`
      : row.transaction_url;
    byId.set(row.id, {
      id: row.id,
      reviewId: row.id,
      siteId: row.site_code,
      siteName: row.site_name,
      location: row.location,
      milestone: row.milestone,
      sourceReference: row.claim_source_reference,
      policyVersion: row.policy_version,
      version: row.version,
      supersedesReviewId: row.supersedes_review_id,
      state: row.status,
      decision: row.decision,
      decisionExplanation: row.decision_explanation,
      reasonCode: row.reason_code,
      createdAt: iso(row.created_at)!,
      submittedAt: iso(row.submitted_at),
      finalizedAt: iso(row.finalized_at),
      updatedAt: iso(row.updated_at)!,
      evidence,
      comparison,
      events: eventsByReview.get(row.id) ?? [],
      recordId: row.record_id,
      transactionHash: row.transaction_hash,
      transactionUrl,
      contractAddress: row.genlayer_contract,
      network: row.genlayer_network,
      consensusState: row.consensus_state,
      transactionStatus: row.transaction_status,
      blockReference: row.block_reference && typeof row.block_reference === 'object' && !Array.isArray(row.block_reference) ? row.block_reference as Record<string, unknown> : null,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      evidencePackageHash: row.evidence_package_hash,
      precheck: row.precheck_result as ReviewReadModel['precheck'],
    });
  }
  return ids.map((id) => byId.get(id)).filter((item): item is ReviewReadModel => Boolean(item));
}

export async function getReviewModel(db: Queryable, idOrReviewId: string, config: Pick<AppConfig, 'genlayerExplorerUrl'>) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idOrReviewId);
  const query = isUuid
    ? 'SELECT id FROM reviews WHERE id = $1::uuid'
    : `SELECT r.id FROM reviews r WHERE r.id::text = $1 OR r.id::text IN (SELECT d.review_id::text FROM documents d WHERE d.id::text = $1)`;
  const result = await db.query<{ id: string }>(query, [idOrReviewId]);
  if (!result.rowCount) throw notFound('The requested review does not exist in persistent storage.');
  const models = await loadReviewsByIds(db, [result.rows[0]!.id], config);
  return models[0] ?? null;
}

export async function listReviewModels(
  db: Pool,
  filters: { status?: string; siteId?: string; search?: string; limit: number; offset: number },
  config: Pick<AppConfig, 'genlayerExplorerUrl'>,
) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (filters.status) {
    const normalized = filters.status.toUpperCase();
    if (normalized === 'READY_FOR_REVIEW') clauses.push(`r.status IN ('EVIDENCE_READY','COMPARISON_READY')`);
    else if (['DRAFT','EVIDENCE_READY','COMPARISON_READY','SUBMITTING','SUBMITTED','CONSENSUS_PENDING','FINALIZING','FINALIZED','FAILED'].includes(normalized)) clauses.push(`r.status = ${bind(normalized)}`);
    else clauses.push('false');
  }
  if (filters.siteId) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(filters.siteId)) {
      const site = bind(filters.siteId);
      clauses.push(`(s.site_code = ${site} OR s.id = ${site}::uuid)`);
    } else clauses.push(`s.site_code = ${bind(filters.siteId)}`);
  }
  if (filters.search) {
    const escaped = filters.search.replace(/[\\%_]/g, '\\$&');
    const term = bind(`%${escaped}%`);
    clauses.push(`(s.site_code ILIKE ${term} ESCAPE '\\' OR s.name ILIKE ${term} ESCAPE '\\' OR r.milestone ILIKE ${term} ESCAPE '\\')`);
  }
  const limit = bind(filters.limit);
  const offset = bind(filters.offset);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await db.query<{ id: string }>(
    `SELECT r.id FROM reviews r JOIN sites s ON s.id=r.site_id ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return loadReviewsByIds(db, result.rows.map((row) => row.id), config);
}

export async function getRecordById(db: Pool, recordId: string, config: Pick<AppConfig, 'genlayerExplorerUrl'>) {
  const result = await db.query<{ review_id: string }>('SELECT review_id FROM decisions WHERE onchain_record_id = $1::uuid', [recordId]);
  if (!result.rowCount) throw notFound('The requested on-chain record does not exist in the persistent read model.');
  const review = await getReviewModel(db, result.rows[0]!.review_id, config);
  if (!review || review.state !== 'FINALIZED') throw notFound('No finalized persistent record is associated with this identifier.');
  return review;
}

export async function getDocumentById(db: Pool, documentId: string) {
  const result = await db.query<DocumentDbRow & { site_code: string; site_name: string }>(
    `SELECT d.*, s.site_code, s.name AS site_name
     FROM documents d JOIN reviews r ON r.id=d.review_id JOIN sites s ON s.id=r.site_id
     WHERE d.id=$1::uuid`,
    [documentId],
  );
  if (!result.rowCount) throw notFound('The requested document does not exist in persistent storage.');
  const row = result.rows[0]!;
  const fields = await db.query<FieldDbRow>('SELECT document_id, field_name, field_value, extraction_source FROM evidence_fields WHERE document_id=$1::uuid ORDER BY field_name', [documentId]);
  const document = makeDocument(row, fields.rows);
  return { document, siteId: row.site_code, siteName: row.site_name };
}

export async function createReviewRow(db: PoolClient, input: {
  id: string;
  siteId: string;
  milestone: string;
  sourceReference?: string;
  version: number;
  supersedesReviewId?: string;
  policyVersion: string;
}, actor: string) {
  await db.query(
    `INSERT INTO reviews (id, site_id, milestone, claim_source_reference, version, supersedes_review_id, policy_version, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.id, input.siteId, input.milestone, input.sourceReference ?? null, input.version, input.supersedesReviewId ?? null, input.policyVersion, actor],
  );
  await appendAuditEvent(db, input.id, input.supersedesReviewId ? 'REVIEW_VERSIONED' : 'REVIEW_CREATED', actor, {
    detail: input.supersedesReviewId ? `Version ${input.version} supersedes review ${input.supersedesReviewId}.` : 'A new documentary review was created.',
    reference: input.siteId,
  });
  return input.id;
}
