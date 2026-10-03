import { z } from 'zod';
import {
  decisionSchema,
  documentDetailSchema,
  documentSchema,
  healthSchema,
  recordSchema,
  reviewSchema,
  reviewStatusSchema,
  siteSchema,
  type EvidenceRole,
} from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export class LotCheckApiError extends Error {
  code: string;
  status?: number;
  endpoint: string;

  constructor(message: string, code: string, endpoint: string, status?: number) {
    super(message);
    this.name = 'LotCheckApiError';
    this.code = code;
    this.endpoint = endpoint;
    this.status = status;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function asNullableObject(value: unknown): Record<string, unknown> | null | undefined {
  if (value === null) return null;
  return isObject(value) ? value : undefined;
}

function normalizeEvidenceRole(value: unknown) {
  const role = String(value ?? '').toUpperCase();
  if (role === 'PROJECT_CLOSEOUT') return 'PROJECT';
  if (role === 'INDEPENDENT_EVIDENCE') return 'INDEPENDENT';
  return role;
}

function normalizeDocument(value: unknown): unknown {
  if (!isObject(value)) return value;
  const fieldsRaw = pick(value, 'fields', 'extracted_fields', 'extractedFields');
  const fields = Array.isArray(fieldsRaw)
    ? fieldsRaw.map((item) => {
        if (!isObject(item)) return item;
        const key = asString(pick(item, 'key', 'field', 'field_key'));
        return {
          key,
          label: asString(pick(item, 'label', 'name')) ?? key,
          value: asNullableString(pick(item, 'value', 'extracted_value', 'extractedValue')),
          extractionStatus: asString(pick(item, 'extractionStatus', 'extraction_status', 'status')),
        };
      })
    : undefined;

  return {
    id: pick(value, 'id', 'documentId', 'document_id'),
    title: pick(value, 'title', 'documentTitle', 'document_title'),
    filename: pick(value, 'filename', 'fileName', 'file_name'),
    type: pick(value, 'type', 'documentType', 'document_type', 'mimeType', 'mime_type'),
    role: normalizeEvidenceRole(pick(value, 'role', 'evidenceRole', 'evidence_role')),
    issuer: asNullableString(pick(value, 'issuer', 'sourceIssuer', 'source_issuer')),
    date: asNullableString(pick(value, 'date', 'reportDate', 'report_date')),
    referenceNumber: asNullableString(pick(value, 'referenceNumber', 'reference_number', 'reference')),
    uploadedAt: asNullableString(pick(value, 'uploadedAt', 'uploaded_at')),
    uploadedBy: asNullableString(pick(value, 'uploadedBy', 'uploaded_by')),
    sha256: asNullableString(pick(value, 'sha256', 'hash', 'documentHash', 'document_hash')),
    sourceUrl: asNullableString(pick(value, 'sourceUrl', 'source_url')),
    contentUrl: asNullableString(pick(value, 'contentUrl', 'content_url', 'previewUrl', 'preview_url')),
    sizeBytes: pick(value, 'sizeBytes', 'size_bytes') ?? null,
    processingStatus: asNullableString(pick(value, 'processingStatus', 'processing_status')),
    fields,
  };
}

function normalizePrecheck(value: unknown): unknown {
  if (!isObject(value)) return value;
  const rawDecision = pick(value, 'decision', 'result');
  return {
    eligible: pick(value, 'eligible'),
    decision: rawDecision == null ? rawDecision : String(rawDecision).toUpperCase(),
    reasonCode: asNullableString(pick(value, 'reasonCode', 'reason_code')),
    detail: pick(value, 'detail', 'message'),
  };
}

function normalizeComparison(value: unknown): unknown {
  if (!isObject(value)) return value;
  const fields = pick(value, 'fields', 'normalizedFields', 'normalized_fields');
  return {
    fields: Array.isArray(fields)
      ? fields.map((item) => {
          if (!isObject(item)) return item;
          const rawMatch = pick(item, 'match', 'status', 'matchStatus', 'match_status');
          const match = typeof rawMatch === 'string' && rawMatch.trim() ? rawMatch.trim().toUpperCase() : undefined;
          const key = asString(pick(item, 'key', 'field', 'field_key'));
          return {
            key,
            label: asString(pick(item, 'label', 'name')) ?? key,
            projectValue: asNullableString(pick(item, 'projectValue', 'project_value', 'project')),
            independentValue: asNullableString(pick(item, 'independentValue', 'independent_value', 'independent')),
            match,
            whyItMatters: asNullableString(pick(item, 'whyItMatters', 'why_it_matters', 'explanation')),
          };
        })
      : undefined,
    projectDocumentId: asNullableString(pick(value, 'projectDocumentId', 'project_document_id')),
    independentDocumentId: asNullableString(pick(value, 'independentDocumentId', 'independent_document_id')),
    policyVersion: asNullableString(pick(value, 'policyVersion', 'policy_version')),
    comparedAt: asNullableString(pick(value, 'comparedAt', 'compared_at')),
  };
}

function normalizeSite(value: unknown): unknown {
  if (!isObject(value)) return value;
  const siteId = asString(pick(value, 'siteId', 'site_id'));
  return {
    id: asString(pick(value, 'id', 'siteId', 'site_id')),
    siteId,
    name: asString(pick(value, 'name', 'siteName', 'site_name')),
    location: asNullableString(pick(value, 'location', 'community', 'region')),
    milestone: asNullableString(pick(value, 'milestone', 'currentMilestone', 'current_milestone')),
    evidenceState: asNullableString(pick(value, 'evidenceState', 'evidence_state')),
    projectEvidenceCount: pick(value, 'projectEvidenceCount', 'project_evidence_count') as number | null | undefined,
    independentEvidenceCount: pick(value, 'independentEvidenceCount', 'independent_evidence_count') as number | null | undefined,
    lastReviewAt: asNullableString(pick(value, 'lastReviewAt', 'last_review_at')),
    currentStatus: asNullableString(pick(value, 'currentStatus', 'current_status', 'status')),
  };
}

function normalizeEvent(value: unknown): unknown {
  if (!isObject(value)) return value;
  const status = asString(pick(value, 'status', 'state'));
  return {
    id: asString(pick(value, 'id', 'eventId', 'event_id')),
    label: asString(pick(value, 'label', 'name', 'event')),
    status: status?.toUpperCase(),
    timestamp: asNullableString(pick(value, 'timestamp', 'createdAt', 'created_at')),
    actor: asNullableString(pick(value, 'actor', 'reviewer')),
    reference: asNullableString(pick(value, 'reference', 'transactionHash', 'transaction_hash')),
    detail: asNullableString(pick(value, 'detail', 'description')),
  };
}

function normalizeReview(value: unknown): unknown {
  if (!isObject(value)) return value;
  const evidenceRaw = pick(value, 'evidence', 'documents', 'evidenceDocuments', 'evidence_documents');
  const eventsRaw = pick(value, 'events', 'timeline', 'auditEvents', 'audit_events');
  const comparisonRaw = pick(value, 'comparison', 'evidenceComparison', 'evidence_comparison');
  const id = asString(pick(value, 'id', 'reviewId', 'review_id'));
  const reviewId = asString(pick(value, 'reviewId', 'review_id', 'id'));
  const rawState = asString(pick(value, 'state', 'status', 'transactionState', 'transaction_state'));
  const rawDecision = pick(value, 'decision', 'result');
  return {
    id,
    reviewId,
    siteId: asString(pick(value, 'siteId', 'site_id')),
    siteName: asNullableString(pick(value, 'siteName', 'site_name')),
    location: asNullableString(pick(value, 'location', 'community')),
    milestone: asNullableString(pick(value, 'milestone', 'milestoneName', 'milestone_name')),
    state: rawState?.toUpperCase(),
    decision: rawDecision == null ? rawDecision : String(rawDecision).toUpperCase(),

    createdAt: asNullableString(pick(value, 'createdAt', 'created_at')),
    submittedAt: asNullableString(pick(value, 'submittedAt', 'submitted_at')),
    finalizedAt: asNullableString(pick(value, 'finalizedAt', 'finalized_at')),
    updatedAt: asNullableString(pick(value, 'updatedAt', 'updated_at')),
    evidence: Array.isArray(evidenceRaw) ? evidenceRaw.map(normalizeDocument) : undefined,
    comparison: comparisonRaw == null ? comparisonRaw : normalizeComparison(comparisonRaw),
    events: Array.isArray(eventsRaw) ? eventsRaw.map(normalizeEvent) : undefined,
    recordId: asNullableString(pick(value, 'recordId', 'record_id')),
    decisionExplanation: asNullableString(pick(value, 'decisionExplanation', 'decision_explanation', 'explanation')),
    transactionHash: asNullableString(pick(value, 'transactionHash', 'transaction_hash', 'transaction')),
    transactionUrl: asNullableString(pick(value, 'transactionUrl', 'transaction_url', 'explorerUrl', 'explorer_url')),
    contractAddress: asNullableString(pick(value, 'contractAddress', 'contract_address')),
    network: asNullableString(pick(value, 'network', 'networkName', 'network_name')),
    policyVersion: asNullableString(pick(value, 'policyVersion', 'policy_version')),
    consensusState: asNullableString(pick(value, 'consensusState', 'consensus_state')),
    transactionStatus: asNullableString(pick(value, 'transactionStatus', 'transaction_status')),
    blockReference: asNullableObject(pick(value, 'blockReference', 'block_reference')),
    evidencePackageHash: asNullableString(pick(value, 'evidencePackageHash', 'evidence_package_hash')),
    reasonCode: asNullableString(pick(value, 'reasonCode', 'reason_code')),
    precheck: normalizePrecheck(pick(value, 'precheck', 'precheckResult', 'precheck_result')),
    errorCode: asNullableString(pick(value, 'errorCode', 'error_code')),
    errorMessage: asNullableString(pick(value, 'errorMessage', 'error_message')),
  };
}

function normalizeReviewStatus(value: unknown): unknown {
  if (!isObject(value)) return value;
  const nested = pick(value, 'review', 'status');
  if (isObject(nested)) return normalizeReviewStatus(nested);
  const rawState = asString(pick(value, 'state', 'transactionState', 'transaction_state', 'status'));
  const rawDecision = pick(value, 'decision', 'result');
  return {
    state: rawState?.toUpperCase(),
    decision: rawDecision == null ? rawDecision : String(rawDecision).toUpperCase(),
    consensusState: asNullableString(pick(value, 'consensusState', 'consensus_state')),
    transactionStatus: asNullableString(pick(value, 'transactionStatus', 'transaction_status')),
    blockReference: asNullableObject(pick(value, 'blockReference', 'block_reference')),
    recordId: asNullableString(pick(value, 'recordId', 'record_id')),
    transactionHash: asNullableString(pick(value, 'transactionHash', 'transaction_hash', 'transaction')),
    transactionUrl: asNullableString(pick(value, 'transactionUrl', 'transaction_url', 'explorerUrl', 'explorer_url')),
    contractAddress: asNullableString(pick(value, 'contractAddress', 'contract_address')),
    network: asNullableString(pick(value, 'network', 'networkName', 'network_name')),
    policyVersion: asNullableString(pick(value, 'policyVersion', 'policy_version')),
    reasonCode: asNullableString(pick(value, 'reasonCode', 'reason_code')),
    evidencePackageHash: asNullableString(pick(value, 'evidencePackageHash', 'evidence_package_hash')),
    precheck: normalizePrecheck(pick(value, 'precheck', 'precheckResult', 'precheck_result')),
    submittedAt: asNullableString(pick(value, 'submittedAt', 'submitted_at')),
    finalizedAt: asNullableString(pick(value, 'finalizedAt', 'finalized_at')),
    updatedAt: asNullableString(pick(value, 'updatedAt', 'updated_at')),
    errorCode: asNullableString(pick(value, 'errorCode', 'error_code')),
    errorMessage: asNullableString(pick(value, 'errorMessage', 'error_message')),
  };
}

function normalizeRecord(value: unknown): unknown {
  if (!isObject(value)) return value;
  const normalizedReview = normalizeReview(value);
  const evidence = pick(value, 'evidence', 'documents', 'evidenceDocuments', 'evidence_documents');
  const comparison = pick(value, 'comparison', 'evidenceComparison', 'evidence_comparison');
  const events = pick(value, 'events', 'timeline', 'auditEvents', 'audit_events');
  const id = asString(pick(value, 'id', 'recordId', 'record_id'));
  const recordId = asString(pick(value, 'recordId', 'record_id', 'id'));
  const rawDecision = pick(value, 'decision', 'result');
  return {
    ...normalizedReview as Record<string, unknown>,
    id,
    recordId,
    reviewId: asString(pick(value, 'reviewId', 'review_id')),
    siteId: asString(pick(value, 'siteId', 'site_id')),
    decision: rawDecision == null ? rawDecision : String(rawDecision).toUpperCase(),
    evidence: Array.isArray(evidence) ? evidence.map(normalizeDocument) : undefined,
    comparison: comparison == null ? comparison : normalizeComparison(comparison),
    explanation: asNullableString(pick(value, 'explanation', 'decisionExplanation', 'decision_explanation')),
    policyVersion: asNullableString(pick(value, 'policyVersion', 'policy_version')),
    network: asNullableString(pick(value, 'network', 'networkName', 'network_name')),
    contractAddress: asNullableString(pick(value, 'contractAddress', 'contract_address')),
    transactionHash: asNullableString(pick(value, 'transactionHash', 'transaction_hash')),
    transactionUrl: asNullableString(pick(value, 'transactionUrl', 'transaction_url', 'explorerUrl', 'explorer_url')),
    finalizedAt: asNullableString(pick(value, 'finalizedAt', 'finalized_at')),
    events: Array.isArray(events) ? events.map(normalizeEvent) : undefined,
  };
}

function unwrap(value: unknown, keys: string[] = [], depth = 0): unknown {
  if (!isObject(value) || depth >= 5) return value;
  for (const key of [...keys, 'data', 'result', 'item']) {
    if (value[key] !== undefined) return unwrap(value[key], keys, depth + 1);
  }
  return value;
}

async function request<Schema extends z.ZodTypeAny>(
  path: string,
  schema: Schema,
  init?: RequestInit,
  unwrapKeys: string[] = [],
): Promise<z.output<Schema>> {
  const endpoint = `${API_BASE}${path}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        Accept: 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new LotCheckApiError(
      'The LotCheck API could not be reached. Check that the backend is running and the API base URL is correct.',
      'API_UNAVAILABLE',
      endpoint,
    );
  }

  const rawText = await response.text();
  let payload: unknown = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = rawText;
    }
  }

  if (!response.ok) {
    const body = isObject(payload) ? payload : {};
    const code = String(pick(body, 'code', 'errorCode', 'error_code') ?? `HTTP_${response.status}`);
    const message = String(pick(body, 'message', 'error', 'detail') ?? `Request failed with status ${response.status}.`);
    throw new LotCheckApiError(message, code, endpoint, response.status);
  }

  const candidate = unwrap(payload, unwrapKeys);
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    throw new LotCheckApiError(
      'The API response did not match the LotCheck response contract. No decision data was displayed.',
      'INVALID_API_RESPONSE',
      endpoint,
      response.status,
    );
  }
  return parsed.data;
}

const siteResponseSchema = z.preprocess(normalizeSite, siteSchema);
const reviewResponseSchema = z.preprocess(normalizeReview, reviewSchema);
const recordResponseSchema = z.preprocess(normalizeRecord, recordSchema);
const reviewStatusResponseSchema = z.preprocess(normalizeReviewStatus, reviewStatusSchema);
const documentResponseSchema = z.preprocess(normalizeDocument, documentDetailSchema);

const sitesResponseSchema = z.array(siteResponseSchema);
const reviewsResponseSchema = z.array(reviewResponseSchema);

export interface ReviewCreateInput {
  siteId: string;
  siteName?: string;
  location?: string;
  milestone: string;
  sourceReference?: string;
}

export interface ReviewFilters {
  status?: string;
  siteId?: string;
  search?: string;
}

export const api = {
  getSites: () => request('/api/sites', sitesResponseSchema, undefined, ['sites']),
  getSite: (id: string) => request(`/api/sites/${encodeURIComponent(id)}`, siteResponseSchema, undefined, ['site']),
  getReviews: (filters: ReviewFilters = {}) => {
    const query = new URLSearchParams();
    if (filters.status) query.set('status', filters.status);
    if (filters.siteId) query.set('site_id', filters.siteId);
    if (filters.search) query.set('search', filters.search);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/reviews${suffix}`, reviewsResponseSchema, undefined, ['reviews', 'items']);
  },
  getReview: (id: string) => request(`/api/reviews/${encodeURIComponent(id)}`, reviewResponseSchema, undefined, ['review']),
  createReview: (input: ReviewCreateInput) => request(
    '/api/reviews',
    reviewResponseSchema,
    { method: 'POST', body: JSON.stringify(input) },
    ['review'],
  ),
  uploadEvidence: (reviewId: string, file: File, role: EvidenceRole, sourceUrl?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('role', role);
    if (sourceUrl) form.append('sourceUrl', sourceUrl);
    return request(
      `/api/reviews/${encodeURIComponent(reviewId)}/evidence`,
      z.preprocess(normalizeDocument, documentSchema),
      { method: 'POST', body: form },
      ['document', 'evidence'],
    );
  },
  compareReview: (reviewId: string) => request(
    `/api/reviews/${encodeURIComponent(reviewId)}/compare`,
    reviewResponseSchema,
    { method: 'POST' },
    ['review'],
  ),
  submitReview: (reviewId: string) => request(
    `/api/reviews/${encodeURIComponent(reviewId)}/submit`,
    reviewResponseSchema,
    { method: 'POST' },
    ['review'],
  ),
  getReviewStatus: (reviewId: string) => request(
    `/api/reviews/${encodeURIComponent(reviewId)}/status`,
    reviewStatusResponseSchema,
    undefined,
    ['review'],
  ),
  getRecord: (id: string) => request(`/api/records/${encodeURIComponent(id)}`, recordResponseSchema, undefined, ['record']),
  getDocument: (id: string) => request(`/api/documents/${encodeURIComponent(id)}`, documentResponseSchema, undefined, ['document']),
  getHealth: () => request('/api/health', healthSchema, undefined, ['health']),
  parseDecision: (value: unknown) => decisionSchema.safeParse(value),
};

export function isApiError(error: unknown): error is LotCheckApiError {
  return error instanceof LotCheckApiError;
}
