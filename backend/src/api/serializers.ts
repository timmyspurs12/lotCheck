import type { EvidenceDocument, ReviewReadModel } from '../types/domain.js';

export function mapDocument(document: EvidenceDocument, siteId?: string, contentUrl: string | null = null) {
  const normalized = document.normalizedEvidence;
  return {
    id: document.id,
    document_id: document.id,
    title: document.filename,
    filename: document.filename,
    type: document.mimeType,
    mime_type: document.mimeType,
    role: document.role,
    issuer: normalized.issuer,
    date: normalized.report_date,
    referenceNumber: normalized.report_reference,
    uploadedAt: document.uploadedAt,
    uploaded_at: document.uploadedAt,
    uploadedBy: document.uploadedBy,
    sha256: document.sha256,
    sourceUrl: document.source,
    contentUrl,
    sizeBytes: document.size,
    size_bytes: document.size,
    processingStatus: document.processingStatus,
    processing_status: document.processingStatus,
    processingErrorCode: document.processingError ? 'DOCUMENT_PROCESSING_FAILED' : null,
    processingError: document.processingError,
    reviewId: document.reviewId,
    siteId: siteId ?? null,
    fields: document.fields,
  };
}

function mapComparisonMatch(match: string) {
  if (match === 'EXACT_MATCH' || match === 'PARTIAL_MATCH') return 'MATCH';
  if (match === 'CONFLICT') return 'CONFLICT';
  if (match === 'NOT_COMPARABLE') return 'NOT_COMPARABLE';
  return 'NOT_EXTRACTED';
}

function frontendState(state: string) {
  return ['EVIDENCE_READY', 'COMPARISON_READY'].includes(state) ? 'READY_FOR_REVIEW' : state;
}

export function mapReview(review: ReviewReadModel) {
  return {
    id: review.id,
    reviewId: review.reviewId,
    siteId: review.siteId,
    siteName: review.siteName,
    location: review.location,
    milestone: review.milestone,
    sourceReference: review.sourceReference,
    version: review.version,
    supersedesReviewId: review.supersedesReviewId,
    state: frontendState(review.state),
    decision: review.decision,
    createdAt: review.createdAt,
    submittedAt: review.submittedAt,
    finalizedAt: review.finalizedAt,
    updatedAt: review.updatedAt,
    evidence: review.evidence?.map((document) => mapDocument(document, review.siteId)),
    comparison: review.comparison ? {
      fields: review.comparison.fields.map((field) => ({
        ...field,
        match: mapComparisonMatch(field.match),
      })),
      projectDocumentId: review.comparison.projectDocumentId,
      independentDocumentId: review.comparison.independentDocumentId,
      policyVersion: review.comparison.policyVersion,
      comparedAt: review.comparison.comparedAt,
    } : null,
    events: review.events,
    recordId: review.recordId,
    decisionExplanation: review.decisionExplanation,
    reasonCode: review.reasonCode,
    transactionHash: review.transactionHash,
    transactionUrl: review.transactionUrl,
    contractAddress: review.contractAddress,
    network: review.network,
    policyVersion: review.policyVersion,
    consensusState: review.consensusState,
    transactionStatus: review.transactionStatus,
    blockReference: review.blockReference,
    errorCode: review.errorCode,
    errorMessage: review.errorMessage,
    evidencePackageHash: review.evidencePackageHash,
    precheck: review.precheck,
  };
}

export function mapStatus(review: ReviewReadModel, refresh?: { refreshed: boolean; error?: { code: string; message: string } }) {
  return {
    state: frontendState(review.state),
    decision: review.decision,
    consensusState: review.consensusState,
    transactionStatus: review.transactionStatus,
    blockReference: review.blockReference,
    recordId: review.recordId,
    transactionHash: review.transactionHash,
    transactionUrl: review.transactionUrl,
    contractAddress: review.contractAddress,
    network: review.network,
    policyVersion: review.policyVersion,
    reasonCode: review.reasonCode,
    submittedAt: review.submittedAt,
    finalizedAt: review.finalizedAt,
    updatedAt: review.updatedAt,
    errorCode: review.errorCode,
    errorMessage: review.errorMessage,
    evidencePackageHash: review.evidencePackageHash,
    precheck: review.precheck,
    statusRefresh: refresh ?? null,
  };
}

export function mapRecord(review: ReviewReadModel) {
  return {
    id: review.recordId,
    recordId: review.recordId,
    reviewId: review.reviewId,
    siteId: review.siteId,
    siteName: review.siteName,
    milestone: review.milestone,
    decision: review.decision,
    evidence: review.evidence?.map((document) => mapDocument(document, review.siteId)),
    comparison: review.comparison ? mapReview(review).comparison : null,
    explanation: review.decisionExplanation,
    policyVersion: review.policyVersion,
    network: review.network,
    contractAddress: review.contractAddress,
    transactionHash: review.transactionHash,
    transactionUrl: review.transactionUrl,
    transactionStatus: review.transactionStatus,
    consensusState: review.consensusState,
    blockReference: review.blockReference,
    reasonCode: review.reasonCode,
    finalizedAt: review.finalizedAt,
    evidencePackageHash: review.evidencePackageHash,
    events: review.events,
  };
}
