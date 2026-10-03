import type { z } from 'zod';
import type { decisionSchema, normalizedEvidenceSchema, comparisonFieldSchema, evidenceRoleSchema, reviewStateSchema, onchainRecordSchema } from '../schemas/domain.js';

export type Decision = z.infer<typeof decisionSchema>;
export type EvidenceRole = z.infer<typeof evidenceRoleSchema>;
export type ReviewState = z.infer<typeof reviewStateSchema>;
export type NormalizedEvidence = z.infer<typeof normalizedEvidenceSchema>;
export type ComparisonField = z.infer<typeof comparisonFieldSchema>;
export type OnchainRecord = z.infer<typeof onchainRecordSchema>;

export type Actor = {
  id: string;
  email?: string;
  roles: string[];
};

export type EvidenceDocument = {
  id: string;
  reviewId: string;
  role: EvidenceRole;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
  source: string | null;
  uploadedAt: string;
  uploadedBy: string;
  processingStatus: 'READY' | 'FAILED';
  processingError: string | null;
  storageReference: string;
  normalizedEvidence: NormalizedEvidence;
  fields: Array<{
    key: string;
    label: string;
    value: string | null;
    extractionStatus: string;
  }>;
};

export type PrecheckResult = {
  eligible: boolean;
  decision?: 'DISPUTED' | 'INSUFFICIENT';
  reasonCode?: string;
  detail: string;
};

export type ComparisonResult = {
  projectDocumentId: string | null;
  independentDocumentId: string | null;
  policyVersion: string;
  comparedAt: string;
  fields: ComparisonField[];
};

export type ReviewReadModel = {
  id: string;
  reviewId: string;
  siteId: string;
  siteName: string | null;
  location: string | null;
  milestone: string;
  sourceReference: string | null;
  policyVersion: string;
  version: number;
  supersedesReviewId: string | null;
  state: ReviewState;
  decision: Decision | null;
  decisionExplanation: string | null;
  reasonCode: string | null;
  createdAt: string;
  submittedAt: string | null;
  finalizedAt: string | null;
  updatedAt: string;
  evidence: EvidenceDocument[] | null;
  comparison: ComparisonResult | null;
  events: Array<{
    id: string;
    label: string;
    status: string;
    timestamp: string;
    actor: string;
    reference: string | null;
    detail: string | null;
  }>;
  recordId: string | null;
  transactionHash: string | null;
  transactionUrl: string | null;
  contractAddress: string | null;
  network: string | null;
  consensusState: string | null;
  transactionStatus: string | null;
  blockReference: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  evidencePackageHash: string | null;
  precheck: PrecheckResult | null;
};
