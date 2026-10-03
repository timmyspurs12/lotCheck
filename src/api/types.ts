import { z } from 'zod';

export const decisionSchema = z.enum(['ACCEPT', 'DISPUTED', 'INSUFFICIENT']);
export type Decision = z.infer<typeof decisionSchema>;

export const reviewStateSchema = z.enum([
  'DRAFT',
  'UPLOADING',
  'PROCESSING',
  'READY_FOR_REVIEW',
  'SUBMITTING',
  'SUBMITTED',
  'CONSENSUS_PENDING',
  'FINALIZING',
  'FINALIZED',
  'RECORDED',
  'FAILED',
]);
export type ReviewState = z.infer<typeof reviewStateSchema>;

export const evidenceRoleSchema = z.enum(['PROJECT', 'INDEPENDENT']);
export type EvidenceRole = z.infer<typeof evidenceRoleSchema>;

export const evidenceFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string().nullable().optional(),
  extractionStatus: z.string().optional(),
});
export type EvidenceField = z.infer<typeof evidenceFieldSchema>;

export const documentSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  filename: z.string().optional(),
  type: z.string().optional(),
  role: evidenceRoleSchema,
  issuer: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  referenceNumber: z.string().nullable().optional(),
  uploadedAt: z.string().nullable().optional(),
  uploadedBy: z.string().nullable().optional(),
  sha256: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  contentUrl: z.string().nullable().optional(),
  sizeBytes: z.number().nullable().optional(),
  processingStatus: z.string().nullable().optional(),
  fields: z.array(evidenceFieldSchema).optional(),
});
export type EvidenceDocument = z.infer<typeof documentSchema>;

export const comparisonFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  projectValue: z.string().nullable().optional(),
  independentValue: z.string().nullable().optional(),
  match: z.enum(['MATCH', 'CONFLICT', 'NOT_COMPARABLE', 'NOT_EXTRACTED']).optional(),
  whyItMatters: z.string().nullable().optional(),
});
export type ComparisonField = z.infer<typeof comparisonFieldSchema>;

export const comparisonSchema = z.object({
  fields: z.array(comparisonFieldSchema),
  projectDocumentId: z.string().nullable().optional(),
  independentDocumentId: z.string().nullable().optional(),
  policyVersion: z.string().nullable().optional(),
  comparedAt: z.string().nullable().optional(),
});
export type EvidenceComparison = z.infer<typeof comparisonSchema>;

export const auditEventSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.string(),
  timestamp: z.string().nullable().optional(),
  actor: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  detail: z.string().nullable().optional(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const siteSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  name: z.string(),
  location: z.string().nullable().optional(),
  milestone: z.string().nullable().optional(),
  evidenceState: z.string().nullable().optional(),
  projectEvidenceCount: z.number().nullable().optional(),
  independentEvidenceCount: z.number().nullable().optional(),
  lastReviewAt: z.string().nullable().optional(),
  currentStatus: z.string().nullable().optional(),
});
export type Site = z.infer<typeof siteSchema>;

export const precheckSchema = z.object({
  eligible: z.boolean(),
  decision: z.enum(['DISPUTED', 'INSUFFICIENT']).optional(),
  reasonCode: z.string().optional(),
  detail: z.string(),
});

export const reviewSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  siteId: z.string(),
  siteName: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  milestone: z.string().nullable().optional(),
  state: z.string(),
  decision: decisionSchema.nullable().optional(),
  createdAt: z.string().nullable().optional(),
  submittedAt: z.string().nullable().optional(),
  finalizedAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  evidence: z.array(documentSchema).optional(),
  comparison: comparisonSchema.nullable().optional(),
  events: z.array(auditEventSchema).optional(),
  recordId: z.string().nullable().optional(),
  decisionExplanation: z.string().nullable().optional(),
  reasonCode: z.string().nullable().optional(),
  evidencePackageHash: z.string().nullable().optional(),
  transactionHash: z.string().nullable().optional(),
  transactionUrl: z.string().nullable().optional(),
  contractAddress: z.string().nullable().optional(),
  network: z.string().nullable().optional(),
  policyVersion: z.string().nullable().optional(),
  consensusState: z.string().nullable().optional(),
  transactionStatus: z.string().nullable().optional(),
  blockReference: z.record(z.string(), z.unknown()).nullable().optional(),
  precheck: precheckSchema.nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
});
export type Review = z.infer<typeof reviewSchema>;

export const reviewStatusSchema = z.object({
  state: z.string(),
  decision: decisionSchema.nullable().optional(),
  consensusState: z.string().nullable().optional(),
  transactionStatus: z.string().nullable().optional(),
  blockReference: z.record(z.string(), z.unknown()).nullable().optional(),
  precheck: precheckSchema.nullable().optional(),
  recordId: z.string().nullable().optional(),
  transactionHash: z.string().nullable().optional(),
  transactionUrl: z.string().nullable().optional(),
  contractAddress: z.string().nullable().optional(),
  network: z.string().nullable().optional(),
  policyVersion: z.string().nullable().optional(),
  reasonCode: z.string().nullable().optional(),
  evidencePackageHash: z.string().nullable().optional(),
  submittedAt: z.string().nullable().optional(),
  finalizedAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
}).passthrough();
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const recordSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  reviewId: z.string(),
  siteId: z.string(),
  siteName: z.string().nullable().optional(),
  milestone: z.string().nullable().optional(),
  decision: decisionSchema,
  evidence: z.array(documentSchema).optional(),
  comparison: comparisonSchema.nullable().optional(),
  explanation: z.string().nullable().optional(),
  policyVersion: z.string().nullable().optional(),
  network: z.string().nullable().optional(),
  contractAddress: z.string().nullable().optional(),
  transactionHash: z.string().nullable().optional(),
  transactionUrl: z.string().nullable().optional(),
  transactionStatus: z.string().nullable().optional(),
  consensusState: z.string().nullable().optional(),
  blockReference: z.record(z.string(), z.unknown()).nullable().optional(),
  reasonCode: z.string().nullable().optional(),
  evidencePackageHash: z.string().nullable().optional(),
  finalizedAt: z.string().nullable().optional(),
  events: z.array(auditEventSchema).optional(),
});
export type VerificationRecord = z.infer<typeof recordSchema>;

export const documentDetailSchema = documentSchema.extend({
  siteId: z.string().nullable().optional(),
  reviewId: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});
export type DocumentDetail = z.infer<typeof documentDetailSchema>;

const serviceStatusSchema = z.object({
  status: z.string().optional(),
  connected: z.boolean().optional(),
  detail: z.string().nullable().optional(),
}).passthrough();

export const healthSchema = z.object({
  applicationApi: serviceStatusSchema.optional(),
  database: serviceStatusSchema.optional(),
  documentProcessing: serviceStatusSchema.optional(),
  genlayer: serviceStatusSchema.extend({
    network: z.string().nullable().optional(),
    contractAddress: z.string().nullable().optional(),
    lastSuccessfulTransaction: z.string().nullable().optional(),
    consensusState: z.string().nullable().optional(),
  }).optional(),
  reviewer: z.object({
    displayName: z.string().nullable().optional(),
    identity: z.string().nullable().optional(),
  }).optional(),
  checkedAt: z.string().nullable().optional(),
}).passthrough();
export type Health = z.infer<typeof healthSchema>;

export const reviewListSchema = z.array(reviewSchema);
export const siteListSchema = z.array(siteSchema);
